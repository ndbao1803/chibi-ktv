import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { HeadphoneKind, IceServersResponse, PresenceList, RtcSignalFromServer, SingerPosition, StageState } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';
import { AudioService } from '../audio.service';
import { BLUETOOTH_LAG_SEC, ema, MANUAL_OFFSET_LIMIT_MS } from '../sync/sync-math';
import { tuneOpus } from './opus';

interface Peer {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  pendingIce: RTCIceCandidateInit[];
  audio?: HTMLAudioElement;
  meter?: { level: () => number; stop: () => void };
  statsPrev?: { jbd: number; count: number };
}

/**
 * Opens the mic. With headphones we ask for the raw voice (no echo cancelling, best for singing).
 * Some phones (notably iPhone) reject or mishandle those settings, so on a settings error we
 * retry with the browser defaults rather than failing.
 */
async function openMic(headphones: boolean): Promise<MediaStream> {
  const tuned: MediaTrackConstraints = {
    echoCancellation: !headphones,
    noiseSuppression: !headphones,
    autoGainControl: !headphones,
    channelCount: 1,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: tuned });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'OverconstrainedError' || name === 'TypeError' || name === 'NotReadableError') {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw e;
  }
}

/** A clear Vietnamese message for each way the mic can fail, with the error name for debugging. */
export function micErrorText(e: unknown): string {
  const name = (e as DOMException)?.name ?? 'Error';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return ios
        ? `Safari chưa cho dùng micro. Bấm "aA" trên thanh địa chỉ → Cài đặt trang web → Micro → Cho phép, rồi thử lại. Nếu vẫn không được: Cài đặt → Safari → Micro → Hỏi/Cho phép. (${name})`
        : `Trình duyệt chưa cho dùng micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang → cho phép Micro, rồi thử lại. (${name})`;
    case 'NotFoundError':
      return `Không tìm thấy micro trên máy này. (${name})`;
    case 'NotReadableError':
    case 'AbortError':
      return `Micro đang bị ứng dụng khác dùng (cuộc gọi, Zalo, ghi âm…). Tắt ứng dụng đó rồi thử lại. (${name})`;
    default:
      return `Không mở được micro. (${name}: ${(e as Error)?.message ?? ''})`;
  }
}

const OFFSET_KEY = 'ktv.voiceOffsetMs';

/** iPhone/iPad (iPadOS reports itself as a Mac with touch). */
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** 64 kbps mono Opus is plenty for a singing voice and halves the upload in a peer-to-peer room. */
const VOICE_BITRATE = 64_000;
const JITTER_BUFFER_MS = 80;
function readOffset(): number {
  try {
    return Number(localStorage.getItem(OFFSET_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Encoding and playout time not visible in WebRTC stats (rough constant). */
const FIXED_AUDIO_PATH_SEC = 0.02;

/**
 * Peer-to-peer voice (free, no media server). The singer sends their mic to every listener,
 * plus their music position over a data channel. Listeners measure how late the voice arrives.
 */
@Injectable()
export class VoiceService implements OnDestroy {
  private readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly audio = inject(AudioService);

  private readonly peers = new Map<string, Peer>();
  private mic?: MediaStream;
  private micMeter?: { level: () => number; stop: () => void };
  private wakeLock?: { release(): Promise<void> };
  private iceServers?: RTCIceServer[];
  private statsTimer = setInterval(() => void this.measureDelay(), 1000);

  readonly role = computed<'singer' | 'listener' | 'idle'>(() => {
    const s = this.rt.stage().singerId;
    return !s ? 'idle' : s === this.auth.user()?.id ? 'singer' : 'listener';
  });
  /** Listener: the latest music position from the singer. */
  readonly singerPos = signal<{ msg: SingerPosition; receivedAt: number } | null>(null);
  /** Listener: how late the singer's voice reaches me (s). */
  readonly voiceDelaySec = signal(0.15);
  /** Listener: the singer's voice is playing here. */
  readonly hearingSinger = signal(false);
  /** Listener: the browser blocked autoplay (common on Safari/iOS); needs a real tap to retry. */
  readonly needsTap = signal(false);
  /** Singer: how many listeners are connected. */
  readonly listenersConnected = signal(0);
  /** Singer: my mic is on and being sent. A turn can put me on stage before I switch it on. */
  readonly micOn = signal(false);
  readonly error = signal('');
  /** Singer: how late I hear my own music + my mic delay (s), sent to listeners. */
  readonly singerLagSec = signal(0);
  /** Listener: my fine-tune (ms, positive = music later), remembered in this browser. */
  readonly manualOffsetMs = signal(readOffset());
  /** The headphones answer, asked once per visit and reused when my turn starts by itself. */
  readonly headphones = signal<HeadphoneKind | null>(null);
  /** Singer: the automatic mic start at my turn failed; the page shows a retry button. */
  readonly autoArmFailed = signal('');
  private arming = false;

  constructor() {
    this.rt.onSignal = (m) => void this.onSignal(m);
    effect(() => {
      const stage = this.rt.stage();
      const members = this.rt.members();
      untracked(() => void this.reconcile(stage, members));
    });
    // S-01/S-02: when my turn puts me on stage, switch my mic on without a second click,
    // as long as I already answered the headphones question (at queue time or earlier).
    effect(() => {
      const singer = this.role() === 'singer';
      const kind = this.headphones();
      untracked(() => {
        if (!singer) this.autoArmFailed.set('');
        // Only the visible tab arms the mic, so two open tabs do not both grab it.
        if (!singer || this.micOn() || kind === null || this.arming || document.visibilityState !== 'visible') return;
        void this.arm(kind);
      });
    });
  }

  private async arm(kind: HeadphoneKind) {
    this.arming = true;
    const err = await this.startSinging(kind);
    this.arming = false;
    this.autoArmFailed.set(err ?? '');
  }

  /**
   * S-02: ask for mic permission at queue time (the click is right there), then let go of the mic.
   * Later, when the turn starts with no click, the browser opens it without asking again.
   */
  async prepareMic(kind: HeadphoneKind): Promise<string | null> {
    this.headphones.set(kind);
    if (this.micOn() || !navigator.mediaDevices?.getUserMedia) return null;
    try {
      const s = await openMic(kind !== 'none');
      s.getTracks().forEach((t) => t.stop());
      return null;
    } catch (e) {
      return micErrorText(e);
    }
  }

  /** Go on stage: ask for the mic first, then claim the stage (S-02, S-05). */
  async startSinging(kind: HeadphoneKind): Promise<string | null> {
    this.headphones.set(kind);
    if (this.micOn()) return null;
    const headphones = kind !== 'none';
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Trình duyệt này không mở được micro. Hãy mở link https bằng Safari (iPhone) hoặc Chrome.';
    }
    try {
      this.mic = await openMic(headphones);
    } catch (e) {
      return micErrorText(e);
    }
    const track = this.mic.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      this.stopMic();
      return 'Micro mở được nhưng không có tiếng. Đóng các ứng dụng đang dùng micro (cuộc gọi, Zalo…) rồi thử lại. (track-ended)';
    }
    this.mic.getAudioTracks().forEach((t) => (t.contentHint = 'music'));
    // iPhone: opening the mic switches the phone's audio mode and can pause our audio clock.
    await this.audio.ctx.resume().catch(() => {});
    // iPhone: tapping the mic into Web Audio can make the captured voice crackle and break up
    // (the phone's mic and our AudioContext run at different sample rates), so no meter there.
    if (!IS_IOS) this.micMeter = this.audio.meter(this.mic);
    void this.keepScreenOn();
    this.singerLagSec.set(this.measureSingerLag(kind));
    const ack = await this.rt.takeStage();
    if (!ack.ok) {
      this.stopMic();
      return ack.error;
    }
    this.micOn.set(true);
    // If a turn already put me on stage, the stage did not change, so connect to listeners now.
    await this.reconcile(this.rt.stage(), this.rt.members());
    return null;
  }

  async stopSinging(): Promise<void> {
    await this.rt.leaveStage();
    this.stopMic();
  }

  /** Singer: send my music position to every listener (about 4 times a second). */
  sendPosition(msg: SingerPosition) {
    const text = JSON.stringify({ ...msg, lagSec: this.singerLagSec() });
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') p.dc.send(text);
  }

  /** Listener: retry playing the singer's voice after a tap (Safari/iOS blocks autoplay outside a user gesture). */
  retryAudio(): void {
    for (const p of this.peers.values()) if (p.audio) void this.playAudio(p.audio);
  }

  private async playAudio(el: HTMLAudioElement): Promise<void> {
    try {
      await el.play();
      this.needsTap.set(false);
    } catch {
      this.needsTap.set(true);
      this.error.set('Bấm để nghe được ca sĩ.');
    }
  }

  /** Singer: loudness of my own mic (0..1), for the on-screen meter. */
  micLevel(): number {
    return this.micMeter?.level() ?? 0;
  }

  /** Loudness of whoever is singing, for the chibi's mouth (A-04). */
  singerLevel(): number {
    if (this.role() === 'singer') return this.micMeter?.level() ?? 0;
    const singer = this.rt.stage().singerId;
    return (singer && this.peers.get(singer)?.meter?.level()) || 0;
  }

  setManualOffset(ms: number) {
    const v = Math.max(-MANUAL_OFFSET_LIMIT_MS, Math.min(MANUAL_OFFSET_LIMIT_MS, Math.round(ms)));
    this.manualOffsetMs.set(v);
    try {
      localStorage.setItem(OFFSET_KEY, String(v));
    } catch {
      /* private window: keep it for this visit only */
    }
  }

  /**
   * The singer hears the music late by the sound card's output latency (plus ~0.2 s with Bluetooth),
   * and the mic adds its own input latency. Both push the voice behind the music.
   */
  private measureSingerLag(kind: HeadphoneKind): number {
    const ctx = this.audio.ctx;
    const output = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const settings = this.mic?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
    const input = typeof settings?.latency === 'number' ? settings.latency : 0.01;
    return output + input + (kind === 'bluetooth' ? BLUETOOTH_LAG_SEC : 0);
  }

  ngOnDestroy(): void {
    clearInterval(this.statsTimer);
    this.closeAll();
    this.stopMic();
  }

  /* ---------- connection management ---------- */

  private async reconcile(stage: StageState, members: PresenceList) {
    const me = this.auth.user()?.id;
    if (!me) return;
    if (stage.singerId === me) {
      if (!this.mic) return; // stage taken in another tab; this tab has no mic
      const others = new Set(members.map((m) => m.userId).filter((id) => id !== me));
      for (const id of [...this.peers.keys()]) if (!others.has(id)) this.close(id);
      for (const id of others) if (!this.peers.has(id)) await this.callListener(id);
    } else {
      // Not singing: keep only the connection from the current singer.
      for (const id of [...this.peers.keys()]) if (id !== stage.singerId) this.close(id);
      if (this.mic) this.stopMic();
      if (!stage.singerId) this.singerPos.set(null);
    }
    this.updateCounts();
  }

  private async ice(): Promise<RTCIceServer[]> {
    if (!this.iceServers) {
      try {
        this.iceServers = (await firstValueFrom(this.http.get<IceServersResponse>('/api/rtc/ice'))).iceServers;
      } catch {
        this.iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
      }
    }
    return this.iceServers;
  }

  /** Singer side: one connection per listener, mic + an unreliable data channel for positions. */
  private async callListener(to: string) {
    const pc = new RTCPeerConnection({ iceServers: await this.ice() });
    const peer: Peer = { pc, pendingIce: [] };
    this.peers.set(to, peer);
    for (const t of this.mic!.getAudioTracks()) {
      const sender = pc.addTrack(t, this.mic!);
      const params = sender.getParameters();
      params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: VOICE_BITRATE }];
      void sender.setParameters(params).catch(() => {});
    }
    peer.dc = pc.createDataChannel('pos', { ordered: false, maxRetransmits: 0 });
    pc.onicecandidate = (e) => e.candidate && this.rt.signal(to, { type: 'ice', candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.error.set('Không kết nối được với một bạn (mạng chặn kết nối trực tiếp).');
      this.updateCounts();
    };
    const offer = await pc.createOffer();
    offer.sdp = tuneOpus(offer.sdp!);
    await pc.setLocalDescription(offer);
    this.rt.signal(to, { type: 'offer', sdp: offer.sdp! });
  }

  private async onSignal({ from, data }: RtcSignalFromServer) {
    if (data.type === 'offer') {
      if (from !== this.rt.stage().singerId) return; // only the current singer may call
      this.close(from);
      await this.answerSinger(from, data.sdp);
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (data.type === 'answer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.type === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingIce.push(data.candidate);
    }
  }

  /** Listener side: play the singer's voice, read their positions. */
  private async answerSinger(from: string, sdp: string) {
    const pc = new RTCPeerConnection({ iceServers: await this.ice() });
    const peer: Peer = { pc, pendingIce: [] };
    this.peers.set(from, peer);
    pc.onicecandidate = (e) => e.candidate && this.rt.signal(from, { type: 'ice', candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = stream;
      void this.playAudio(el);
      peer.audio = el;
      if (!IS_IOS) peer.meter = this.audio.meter(stream);
      // A slightly bigger jitter buffer rides out Wi-Fi/4G hiccups instead of dropping sound.
      // The measured voice delay includes it, so the music still lines up (where supported).
      const receiver = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null };
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = JITTER_BUFFER_MS;
      this.hearingSinger.set(true);
    };
    pc.ondatachannel = (e) => {
      peer.dc = e.channel;
      e.channel.onmessage = (ev) => this.singerPos.set({ msg: JSON.parse(ev.data as string), receivedAt: performance.now() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.error.set('Không nghe được ca sĩ: mạng chặn kết nối trực tiếp.');
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    const answer = await pc.createAnswer();
    answer.sdp = tuneOpus(answer.sdp!);
    await pc.setLocalDescription(answer);
    this.rt.signal(from, { type: 'answer', sdp: answer.sdp! });
  }

  /**
   * Listener: voice delay ≈ half the round trip + the jitter buffer + a fixed capture/playout part.
   * Smoothed, because the follower uses it to decide how late to play the music.
   */
  private async measureDelay() {
    const singer = this.rt.stage().singerId;
    const peer = singer ? this.peers.get(singer) : undefined;
    if (this.role() !== 'listener' || !peer) return;
    const stats = await peer.pc.getStats();
    let rtt: number | null = null;
    let jb: number | null = null;
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number')
        rtt = r.currentRoundTripTime;
      if (r.type === 'inbound-rtp' && r.kind === 'audio' && typeof r.jitterBufferDelay === 'number') {
        const prev = peer.statsPrev;
        const dCount = r.jitterBufferEmittedCount - (prev?.count ?? 0);
        if (dCount > 0) jb = (r.jitterBufferDelay - (prev?.jbd ?? 0)) / dCount;
        peer.statsPrev = { jbd: r.jitterBufferDelay, count: r.jitterBufferEmittedCount };
      }
    });
    if (rtt === null || jb === null) return;
    const estimate = rtt / 2 + jb + FIXED_AUDIO_PATH_SEC;
    this.voiceDelaySec.set(ema(this.voiceDelaySec(), estimate, 0.3));
  }

  private updateCounts() {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    this.listenersConnected.set(this.role() === 'singer' ? n : 0);
    if (this.role() !== 'listener') this.hearingSinger.set(false);
  }

  private close(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.meter?.stop();
    if (p.audio) p.audio.srcObject = null;
    p.dc?.close();
    p.pc.close();
    this.peers.delete(id);
    if (id === this.rt.stage().singerId || this.role() !== 'listener') {
      this.hearingSinger.set(false);
      this.needsTap.set(false);
    }
  }

  private closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
  }

  /** Phones dim and lock while you sing, which stops the mic; ask the screen to stay on. */
  private async keepScreenOn() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? undefined;
    } catch {
      /* not supported or refused: the singer just has to keep the screen on */
    }
  }

  private stopMic() {
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
    this.micOn.set(false);
    this.micMeter?.stop();
    this.micMeter = undefined;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = undefined;
    this.closeAll();
    this.updateCounts();
  }
}
