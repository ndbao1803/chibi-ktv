import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  AUDIENCE_LEVEL_DEFAULT,
  SINGER_HEARS_AUDIENCE,
  type HeadphoneKind,
  type IceServersResponse,
  type MicMode,
  type RtcSignalFromServer,
} from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';
import { AudioService } from '../audio.service';
import { tuneOpus } from './opus';
import { createEcho, type Echo, type EchoLevel } from './echo';
import { VoiceService } from './voice.service';

/**
 * One connection per pair of people, carrying exactly one two-way audio line. Only the person with
 * the smaller user id makes the offer, and mics are swapped in later with `replaceTrack` (no new
 * offer needed), so two offers can never cross. This is separate from the singer's connections
 * (voice.service.ts), which carry the music timing and must stay untouched for sync (T-01).
 */
interface TalkPeer {
  pc: RTCPeerConnection;
  sender?: RTCRtpSender;
  pendingIce: RTCIceCandidateInit[];
  el?: HTMLAudioElement;
  src?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  an?: AnalyserNode;
  buf?: Float32Array<ArrayBuffer>;
  /** The duet partner's voice gets the lead singer's echo too (S-04). */
  echo?: { fx: Echo; level: EchoLevel };
}

const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const TALK_BITRATE = 32_000;
const SING_BITRATE = 64_000;
/** Open mic only sends while you are actually speaking (VC-05); quiet for this long closes the gate. */
const GATE_LEVEL = 0.05;
const GATE_HOLD_MS = 450;
const AUDIENCE_KEY = 'ktv.audienceLevel';

function readAudience(): number {
  try {
    const v = Number(localStorage.getItem(AUDIENCE_KEY));
    return localStorage.getItem(AUDIENCE_KEY) !== null && v >= 0 && v <= 1 ? v : AUDIENCE_LEVEL_DEFAULT;
  } catch {
    return AUDIENCE_LEVEL_DEFAULT;
  }
}

function rms(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

@Injectable()
export class TalkService implements OnDestroy {
  private readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly audio = inject(AudioService);
  private readonly voice = inject(VoiceService);

  private readonly peers = new Map<string, TalkPeer>();
  /** Calls being set up right now (between "start" and the connection existing), so we never call twice. */
  private readonly calling = new Set<string>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private present = new Set<string>();
  /** ICE candidates that arrived before their connection existed. */
  private readonly earlyIce = new Map<string, RTCIceCandidateInit[]>();
  private iceServers?: RTCIceServer[];
  /** My talk mic (echo cancelling on: VC-05), opened the first time I talk. */
  private talkMic?: MediaStream;
  /** My singing mic as a duet partner (raw with headphones, like the lead's). */
  private singMic?: MediaStream;
  private ownMeter?: { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; src: MediaStreamAudioSourceNode; track: MediaStreamTrack };
  private gateUntil = 0;
  private timer = setInterval(() => this.refresh(), 100);
  private sentTrack: MediaStreamTrack | null = null;

  /** How I talk (VC-01). Mirrors the server, which limits open mics (VC-10). */
  readonly mode = signal<MicMode>('off');
  /** Holding V or the 🎙️ button. */
  readonly pressing = signal(false);
  /** "Khán giả" slider: audience voices during songs (VC-02, VC-03). */
  readonly audienceLevel = signal(readAudience());
  /** "Tắt tiếng khán giả" while I sing (VC-06). */
  readonly singerMutesAudience = signal(false);
  /** People I muted, for me only (VC-08). */
  readonly muted = signal<ReadonlySet<string>>(new Set());
  readonly error = signal('');
  /** I am sending my voice right now (for the 🎙️ button and my own ring). */
  readonly sending = signal(false);

  readonly iAmLead = computed(() => !!this.me() && this.rt.stage().singerId === this.me());
  readonly iAmPartner = computed(() => !!this.me() && this.rt.stage().partnerId === this.me());
  private readonly me = computed(() => this.auth.user()?.id ?? null);

  constructor() {
    // Keep one connection with every other person present (the mesh).
    effect(() => {
      const me = this.me();
      const others = this.rt
        .members()
        .filter((m) => m.userId !== me && !m.away)
        .map((m) => m.userId);
      untracked(() => this.reconcile(others));
    });
    // When my place changes (lead / duet partner / audience), send the right mic.
    effect(() => {
      this.iAmLead();
      this.iAmPartner();
      untracked(() => void this.syncTrack());
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.release);
    void this.ice(); // fetch early, so an incoming offer is answered without waiting
    this.rt.onTalkSignal = (m) => this.onSignal(m);
  }

  /* ---------- what the page calls ---------- */

  onSignal(m: RtcSignalFromServer) {
    void this.handleSignal(m);
  }

  /** Push-to-talk: hold to talk (VC-01). */
  async press(on: boolean) {
    if (on === this.pressing()) return;
    this.pressing.set(on);
    if (on && this.mode() === 'off') await this.setMode('ptt');
    if (on && !this.talkMic) await this.openTalkMic();
    void this.syncTrack();
  }

  async setMode(mode: MicMode): Promise<void> {
    if (mode !== 'off' && !this.talkMic && !(await this.openTalkMic())) return;
    const ack = await this.rt.setMicMode(mode);
    if (!ack.ok) {
      this.error.set(ack.error);
      return;
    }
    this.mode.set(mode);
    void this.syncTrack();
  }

  setAudienceLevel(v: number) {
    this.audienceLevel.set(Math.max(0, Math.min(1, v)));
    try {
      localStorage.setItem(AUDIENCE_KEY, String(this.audienceLevel()));
    } catch {
      /* not remembered */
    }
  }

  toggleMute(userId: string) {
    const next = new Set(this.muted());
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    this.muted.set(next);
  }

  /** Talking loudness 0..1 of anyone, for the speaking ring (VC-07). */
  levelOf(userId: string): number {
    if (userId === this.me()) {
      if (!this.sending() || this.iAmPartner()) return 0;
      return this.ownMeter ? rms(this.ownMeter.an, this.ownMeter.buf) : 0.5;
    }
    const p = this.peers.get(userId);
    return p?.an && p.buf && (p.gain?.gain.value ?? 0) > 0 ? rms(p.an, p.buf) : 0;
  }

  /** The duet partner's singing voice, for their chibi's mouth (A-04). */
  partnerLevel(userId: string): number {
    if (userId === this.me()) return this.ownMeter && this.iAmPartner() ? rms(this.ownMeter.an, this.ownMeter.buf) : 0;
    const p = this.peers.get(userId);
    return p?.an && p.buf ? rms(p.an, p.buf) : 0;
  }

  /** How loud a voice (or a cheer) from this person plays for me right now (VC-02, VC-06, VC-08). */
  gainFor(userId: string): number {
    if (this.muted().has(userId)) return 0;
    const stage = this.rt.stage();
    if (userId === stage.partnerId || userId === stage.singerId) return this.iAmLead() || this.iAmPartner() ? 0.6 : 1;
    if (this.iAmLead() || this.iAmPartner()) return this.singerMutesAudience() ? 0 : SINGER_HEARS_AUDIENCE;
    const p = this.rt.playback();
    return p.song && !p.paused ? this.audienceLevel() : 1;
  }

  /** As the duet partner, open my singing mic (raw with headphones) and send it on the talk lines. */
  async startPartnerMic(kind: HeadphoneKind): Promise<string | null> {
    if (this.singMic) return null;
    const headphones = kind !== 'none';
    try {
      this.singMic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: !headphones, noiseSuppression: !headphones, autoGainControl: !headphones, channelCount: 1 },
      });
    } catch (e) {
      return (e as Error)?.name ?? 'mic';
    }
    this.singMic.getAudioTracks().forEach((t) => (t.contentHint = 'music'));
    await this.syncTrack();
    return null;
  }
  get partnerMicOn() {
    return !!this.singMic;
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.release);
    for (const id of [...this.peers.keys()]) this.close(id);
    this.stopMeter();
    this.talkMic?.getTracks().forEach((t) => t.stop());
    this.singMic?.getTracks().forEach((t) => t.stop());
  }

  /* ---------- mics ---------- */

  private async openTalkMic(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Trình duyệt này không mở được micro.');
      return false;
    }
    try {
      this.talkMic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      return true;
    } catch (e) {
      const name = (e as DOMException)?.name ?? 'Error';
      this.error.set(
        name === 'NotAllowedError'
          ? 'Trình duyệt chưa cho dùng micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang → cho phép Micro.'
          : `Không mở được micro (${name}).`,
      );
      return false;
    }
  }

  /** The track to send right now: none while I lead (my voice goes on the singer lines). */
  private currentTrack(): MediaStreamTrack | null {
    if (this.iAmLead()) return null;
    if (this.iAmPartner()) return this.singMic?.getAudioTracks()[0] ?? null;
    return this.talkMic?.getAudioTracks()[0] ?? null;
  }

  private async syncTrack() {
    if (!this.iAmPartner() && this.singMic) {
      this.singMic.getTracks().forEach((t) => t.stop());
      this.singMic = undefined;
    }
    const track = this.currentTrack();
    if (track !== this.sentTrack) {
      this.sentTrack = track;
      this.startMeter(track);
      for (const p of this.peers.values()) await this.attach(p);
    }
    this.applyGate();
  }

  /** On/off for the talk mic: push-to-talk, or the noise gate in open mode. The partner always sends. */
  private applyGate() {
    const track = this.sentTrack;
    let on = false;
    if (track) {
      if (this.iAmPartner()) on = true;
      else if (this.mode() === 'open') on = !this.ownMeter || performance.now() < this.gateUntil;
      else on = this.pressing();
      track.enabled = on;
    }
    if (this.sending() !== on) this.sending.set(on);
  }

  /** A meter on a copy of the mic, so the gate can still hear me while the sent track is off. */
  private startMeter(track: MediaStreamTrack | null) {
    this.stopMeter();
    if (!track || IS_IOS) return; // tapping the mic into Web Audio makes iPhone voices crackle
    const copy = track.clone();
    copy.enabled = true;
    const src = this.audio.ctx.createMediaStreamSource(new MediaStream([copy]));
    const an = this.audio.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    this.ownMeter = { an, buf: new Float32Array(new ArrayBuffer(an.fftSize * 4)), src, track: copy };
  }
  private stopMeter() {
    this.ownMeter?.src.disconnect();
    this.ownMeter?.track.stop();
    this.ownMeter = undefined;
  }

  /** Every 100 ms: noise gate and mixing levels (song started, slider moved, someone muted). */
  private refresh() {
    if (this.ownMeter && this.mode() === 'open' && rms(this.ownMeter.an, this.ownMeter.buf) > GATE_LEVEL) {
      this.gateUntil = performance.now() + GATE_HOLD_MS;
    }
    this.applyGate();
    const now = this.audio.ctx.currentTime;
    const stage = this.rt.stage();
    const echo = (this.iAmLead() ? this.voice.echoLevel() : Math.round(this.voice.singerPos()?.msg.echo ?? 0)) as EchoLevel;
    for (const [id, p] of this.peers) {
      p.gain?.gain.setTargetAtTime(this.gainFor(id), now, 0.08);
      this.partnerEcho(p, id === stage.partnerId ? echo : 0);
    }
  }

  private keyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.code !== 'KeyV' || e.repeat || t?.closest('input, textarea, [contenteditable]')) return;
    void this.press(true);
  };
  private keyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyV') void this.press(false);
  };
  private release = () => void this.press(false);

  /* ---------- the mesh ---------- */

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

  private reconcile(others: string[]) {
    this.present = new Set(others);
    for (const id of [...this.peers.keys()]) if (!this.present.has(id)) this.close(id);
    const me = this.me();
    if (!me) return;
    // The smaller id calls; the other waits for the offer.
    for (const id of others) if (me < id) void this.call(id);
  }

  private newPeer(id: string, iceServers: RTCIceServer[]): TalkPeer {
    const pc = new RTCPeerConnection({ iceServers });
    const peer: TalkPeer = { pc, pendingIce: this.earlyIce.get(id) ?? [] };
    this.earlyIce.delete(id);
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => e.candidate && this.rt.signal(id, { type: 'ice', candidate: e.candidate.toJSON() }, 'talk');
    pc.ontrack = (e) => this.play(peer, e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed' || this.peers.get(id) !== peer) return;
      // The caller tries again a little later; the other side waits for the new offer.
      this.close(id);
      const me = this.me();
      if (me && me < id) this.retries.set(id, setTimeout(() => (this.retries.delete(id), void this.call(id)), 3000));
    };
    return peer;
  }

  private async call(id: string) {
    if (this.peers.has(id) || this.calling.has(id) || !this.present.has(id)) return;
    this.calling.add(id);
    const ice = await this.ice();
    this.calling.delete(id);
    if (this.peers.has(id) || !this.present.has(id)) return; // they left meanwhile
    const peer = this.newPeer(id, ice);
    const t = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.sender = t.sender;
    await this.attach(peer);
    const offer = await peer.pc.createOffer();
    offer.sdp = tuneOpus(offer.sdp!);
    await peer.pc.setLocalDescription(offer);
    this.rt.signal(id, { type: 'offer', sdp: offer.sdp! }, 'talk');
  }

  private async handleSignal({ from, data }: RtcSignalFromServer) {
    const me = this.me();
    if (!me) return;
    if (data.type === 'offer') {
      if (me < from) return; // I am the caller for this pair; ignore a stray offer
      this.close(from); // a new offer means they restarted: start fresh
      const peer = this.newPeer(from, await this.ice());
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const t = peer.pc.getTransceivers()[0];
      if (t) {
        t.direction = 'sendrecv';
        peer.sender = t.sender;
        await this.attach(peer);
      }
      const answer = await peer.pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp!);
      await peer.pc.setLocalDescription(answer);
      this.rt.signal(from, { type: 'answer', sdp: answer.sdp! }, 'talk');
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) {
      if (data.type === 'ice') this.earlyIce.set(from, [...(this.earlyIce.get(from) ?? []), data.candidate].slice(-30));
      return;
    }
    if (data.type === 'answer') {
      if (peer.pc.signalingState !== 'have-local-offer') return; // late or duplicate answer
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.type === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingIce.push(data.candidate);
    }
  }

  /** Put my current mic on one connection (no renegotiation: same audio line). */
  private async attach(peer: TalkPeer) {
    if (!peer.sender) return;
    await peer.sender.replaceTrack(this.sentTrack).catch(() => {});
    const params = peer.sender.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].maxBitrate = this.iAmPartner() ? SING_BITRATE : TALK_BITRATE;
      await peer.sender.setParameters(params).catch(() => {});
    }
  }

  /** Someone's voice: through a gain (the mix rules) and an analyser (their speaking ring). */
  private play(peer: TalkPeer, stream: MediaStream) {
    if (peer.src) return;
    // Chrome only feeds a remote stream into Web Audio while a media element also plays it (muted).
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    void el.play().catch(() => {});
    const ctx = this.audio.ctx;
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    src.connect(gain).connect(ctx.destination);
    Object.assign(peer, { el, src, gain, an, buf: new Float32Array(new ArrayBuffer(an.fftSize * 4)) });
  }

  /** Only the partner's line goes through an echo (a reverb per person would cost too much CPU). */
  private partnerEcho(p: TalkPeer, level: EchoLevel) {
    if (!p.src || !p.gain || (p.echo?.level ?? 0) === level) return;
    if (level === 0) {
      p.src.disconnect(p.echo!.fx.input);
      p.echo!.fx.disconnect();
      p.echo = undefined;
      p.src.connect(p.gain);
      return;
    }
    if (!p.echo) {
      const fx = createEcho(this.audio.ctx);
      p.src.disconnect(p.gain);
      p.src.connect(fx.input);
      fx.output.connect(p.gain);
      p.echo = { fx, level };
    }
    p.echo.level = level;
    p.echo.fx.set(level);
  }

  private close(id: string) {
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    const p = this.peers.get(id);
    if (!p) return;
    p.src?.disconnect();
    p.echo?.fx.disconnect();
    p.gain?.disconnect();
    if (p.el) p.el.srcObject = null;
    p.pc.close();
    this.peers.delete(id);
  }
}
