import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { IceServersResponse, PresenceList, RtcSignalFromServer, SingerPosition, StageState } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';
import { AudioService } from '../audio.service';
import { ema } from '../sync/sync-math';
import { tuneOpus } from './opus';

interface Peer {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  pendingIce: RTCIceCandidateInit[];
  audio?: HTMLAudioElement;
  meter?: { level: () => number; stop: () => void };
  statsPrev?: { jbd: number; count: number };
}

/** Capture, encoding and playout time not visible in WebRTC stats (rough constant). */
const FIXED_AUDIO_PATH_SEC = 0.03;

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
  /** Singer: how many listeners are connected. */
  readonly listenersConnected = signal(0);
  readonly error = signal('');

  constructor() {
    this.rt.onSignal = (m) => void this.onSignal(m);
    effect(() => {
      const stage = this.rt.stage();
      const members = this.rt.members();
      untracked(() => void this.reconcile(stage, members));
    });
  }

  /** Go on stage: ask for the mic first, then claim the stage (S-02, S-05). */
  async startSinging(headphones: boolean): Promise<string | null> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          // With headphones the music cannot leak into the mic, so keep the raw voice for singing.
          echoCancellation: !headphones,
          noiseSuppression: !headphones,
          autoGainControl: !headphones,
          channelCount: 1,
        },
      });
    } catch {
      return 'Không mở được micro. Hãy cho phép trình duyệt dùng micro rồi thử lại.';
    }
    this.mic.getAudioTracks().forEach((t) => (t.contentHint = 'music'));
    this.micMeter = this.audio.meter(this.mic);
    const ack = await this.rt.takeStage();
    if (!ack.ok) {
      this.stopMic();
      return ack.error;
    }
    return null;
  }

  async stopSinging(): Promise<void> {
    await this.rt.leaveStage();
    this.stopMic();
  }

  /** Singer: send my music position to every listener (about 4 times a second). */
  sendPosition(msg: SingerPosition) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') p.dc.send(text);
  }

  /** Loudness of whoever is singing, for the chibi's mouth (A-04). */
  singerLevel(): number {
    if (this.role() === 'singer') return this.micMeter?.level() ?? 0;
    const singer = this.rt.stage().singerId;
    return (singer && this.peers.get(singer)?.meter?.level()) || 0;
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
      params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: 96_000 }];
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
      void el.play().catch(() => this.error.set('Bấm “Vào phòng” để nghe được ca sĩ.'));
      peer.audio = el;
      peer.meter = this.audio.meter(stream);
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
    if (id === this.rt.stage().singerId || this.role() !== 'listener') this.hearingSinger.set(false);
  }

  private closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
  }

  private stopMic() {
    this.micMeter?.stop();
    this.micMeter = undefined;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = undefined;
    this.closeAll();
    this.updateCounts();
  }
}
