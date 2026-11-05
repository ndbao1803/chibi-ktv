import * as THREE from 'three';
import type { Prop } from '@ktv/shared';
import { basic, C, canvasTexture, label, mesh, std } from './kit';
import type { Pt } from './seats';

const SKIN = [0xffd9c0, 0xf6c9a5, 0xe8b48f];
const HAIR = [0x1b1418, 0x3a2418, 0x5a2a1a, 0x141420, 0x7a4a2a];
const OUTFIT = [0x3a7bd5, 0xff7eb6, 0x4fbf8f, 0x9b6bff, 0xe2543d, 0x33c4d6, 0xf2a93b, 0xff3fa4];
const ACCESSORY = ['cap', 'band', 'glasses', 'none', 'band', 'cap'] as const;

/**
 * Geometry is shared by every chibi (16 avatars, one set of shapes on the GPU: N-04).
 * Materials stay per chibi, because each has its own colors and can be dimmed.
 */
const G = {
  leg: new THREE.BoxGeometry(0.14, 0.28, 0.15),
  shoe: new THREE.BoxGeometry(0.16, 0.07, 0.2),
  body: new THREE.BoxGeometry(0.46, 0.42, 0.34),
  head: new THREE.SphereGeometry(0.38, 20, 16),
  hair: new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  eye: new THREE.SphereGeometry(0.06, 10, 8),
  shine: new THREE.SphereGeometry(0.018, 6, 6),
  cheek: new THREE.CircleGeometry(0.05, 12),
  mouth: new THREE.BoxGeometry(0.1, 0.025, 0.02),
  arm: new THREE.BoxGeometry(0.12, 0.3, 0.13),
  hand: new THREE.SphereGeometry(0.07, 10, 8),
  micBody: new THREE.CylinderGeometry(0.03, 0.022, 0.2, 10),
  micHead: new THREE.SphereGeometry(0.055, 10, 8),
  band: new THREE.TorusGeometry(0.39, 0.03, 6, 24, Math.PI),
  lens: new THREE.TorusGeometry(0.065, 0.012, 6, 14),
  capTop: new THREE.SphereGeometry(0.41, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
  capBrim: new THREE.BoxGeometry(0.36, 0.03, 0.26),
  ring: new THREE.TorusGeometry(0.42, 0.022, 6, 32),
  shadow: new THREE.CircleGeometry(0.36, 24),
  maracaStick: new THREE.CylinderGeometry(0.022, 0.026, 0.16, 8),
  maracaHead: new THREE.SphereGeometry(0.075, 10, 8),
  maracaBand: new THREE.TorusGeometry(0.076, 0.012, 6, 16),
  stickGrip: new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8),
  stickGlow: new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10),
  tambRing: new THREE.TorusGeometry(0.12, 0.025, 6, 18),
  tambJingle: new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8),
  glass: new THREE.CylinderGeometry(0.06, 0.05, 0.16, 12),
  foam: new THREE.CylinderGeometry(0.062, 0.062, 0.04, 12),
};
export const SHARED_GEOMETRY: ReadonlySet<THREE.BufferGeometry> = new Set(Object.values(G));

const WALK_SPEED = 2.2; // metres per second

export type ChibiMode = 'seated' | 'walking' | 'stage';

/** One avatar: big head, small body (A-01), with idle, walk, sit and sing animations (A-03, A-04, S-01). */
export class Chibi {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly arms: THREE.Group[] = [];
  readonly hands: THREE.Mesh[] = [];
  private readonly torso = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly mic = new THREE.Group();
  private readonly tag: THREE.Sprite;
  /** Glows while this person talks (VC-07, Phase 4). */
  readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly phase = Math.random() * 10;
  private away = false;
  /** Seconds since a cheer started (arms up, mouth wide: VC-04); negative when not cheering. */
  private cheerT = -1;
  /** Phase 5 */
  private readonly props = new Map<Prop, THREE.Group[]>();
  private prop: Prop = 'maracas';
  private readonly lightstick: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly glass = new THREE.Group();
  /** Shaking the prop right now (M-02). */
  shaking = false;
  /** In the crowd dance: stand, step forward, dance with a lightstick (FM-03, FM-04). */
  dancing = false;
  /** Lightstick colour (0..1 hue) shared by the whole room during the dance (FM-04). */
  danceHue = 0;
  /** Seconds left holding a glass up (cụng ly, FM-01). */
  private glassT = 0;
  /** Seconds since a fart scare: jump, then hold the nose (FM-05); negative when calm. */
  private scareT = -1;
  private scareTurn = 0;
  private stand = 0;
  private bubble?: { sprite: THREE.Sprite; t: number };

  mode: ChibiMode = 'seated';
  /** Where they sit when not on stage (the seat's spot and height). */
  home = { x: 0, z: 0, rot: 0, y: 0.15 };
  private path: Pt[] = [];
  private after: ChibiMode = 'seated';
  private stageSpot = { x: 0, z: 0, rot: 0, y: 0.3 };
  /** 0..1 voice loudness, read every frame while singing (mouth) or talking (ring). */
  level: () => number = () => 0;
  talking: () => number = () => 0;

  constructor(
    readonly name: string,
    me: boolean,
    i: number,
  ) {
    const outfit = std(OUTFIT[i % OUTFIT.length]);
    const skin = std(SKIN[i % SKIN.length], { flatShading: false });
    const hair = std(HAIR[i % HAIR.length], { flatShading: false });
    const dark = basic(0x120d14), white = basic(0xffffff);
    const hips = new THREE.Group();
    hips.position.y = 0.3;
    this.root.add(hips);
    const pants = std(0x23202b), shoes = std(0xf2f2f2);
    for (const x of [-0.11, 0.11]) {
      const leg = new THREE.Group();
      leg.position.x = x;
      hips.add(leg);
      mesh(G.leg, pants, 0, -0.14, 0, leg);
      mesh(G.shoe, shoes, 0, -0.28, 0.03, leg);
      this.legs.push(leg);
    }
    hips.add(this.torso);
    mesh(G.body, outfit, 0, 0.21, 0, this.torso);
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    mesh(G.head, skin, 0, 0, 0, this.head).scale.set(1.05, 0.94, 1);
    mesh(G.hair, hair, 0, 0.03, -0.02, this.head).rotation.x = -0.25;
    const cheek = basic(0xff8fb1, { transparent: true, opacity: 0.6 });
    for (const x of [-0.13, 0.13]) {
      mesh(G.eye, dark, x, -0.02, 0.36, this.head).scale.set(1, 1.25, 0.6);
      mesh(G.shine, white, x + 0.018, 0.015, 0.395, this.head);
      mesh(G.cheek, cheek, x * 1.55, -0.11, 0.335, this.head).rotation.y = x > 0 ? 0.5 : -0.5;
    }
    this.mouth = mesh(G.mouth, basic(0x5a1426), 0, -0.15, 0.365, this.head);
    const acc = ACCESSORY[i % ACCESSORY.length], accCol = [C.gold, C.pink, C.cyan][i % 3];
    if (acc === 'band') mesh(G.band, basic(accCol), 0, 0.05, 0, this.head);
    if (acc === 'glasses') for (const x of [-0.13, 0.13]) mesh(G.lens, basic(0x111111), x, -0.02, 0.35, this.head);
    if (acc === 'cap') {
      mesh(G.capTop, std(accCol), 0, 0.06, 0, this.head);
      mesh(G.capBrim, std(accCol), 0, 0.12, 0.36, this.head);
    }
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.29, 0.36, 0);
      this.torso.add(arm);
      mesh(G.arm, outfit, 0, -0.14, 0, arm);
      this.hands.push(mesh(G.hand, skin, 0, -0.32, 0, arm));
      this.arms.push(arm);
    }
    // A microphone in the right hand, only on stage.
    this.mic.position.y = -0.34;
    mesh(G.micBody, std(0x111111, { metalness: 0.6 }), 0, -0.06, 0, this.mic);
    mesh(G.micHead, std(0x9a9a9a, { metalness: 0.9, roughness: 0.25 }), 0, -0.18, 0, this.mic);
    this.mic.visible = false;
    this.arms[1].add(this.mic);
    // Props in the hands (M-04): maracas in both, the others in the right hand.
    const maraca = (col: number) => {
      const g = new THREE.Group();
      mesh(G.maracaStick, std(0x5a3a22), 0, -0.08, 0, g);
      mesh(G.maracaHead, std(col, { roughness: 0.5 }), 0, -0.2, 0, g).scale.y = 1.25;
      mesh(G.maracaBand, basic(0xffffff), 0, -0.2, 0, g).rotation.x = Math.PI / 2;
      return g;
    };
    const stick = new THREE.Group();
    mesh(G.stickGrip, std(0x222222), 0, -0.06, 0, stick);
    this.lightstick = mesh(G.stickGlow, basic([C.pink, C.cyan, C.gold][i % 3]), 0, -0.33, 0, stick);
    const tamb = new THREE.Group();
    mesh(G.tambRing, std(0xc98a3a), 0, -0.12, 0, tamb).rotation.x = Math.PI / 2;
    const jingle = std(0xd8d8d8, { metalness: 0.9, roughness: 0.2 });
    for (let k = 0; k < 6; k++) mesh(G.tambJingle, jingle, Math.cos((k / 6) * Math.PI * 2) * 0.12, -0.12, Math.sin((k / 6) * Math.PI * 2) * 0.12, tamb);
    const left = maraca(C.pink), right = maraca(C.cyan);
    this.props.set('maracas', [left, right]);
    this.props.set('lightstick', [stick]);
    this.props.set('tambourine', [tamb]);
    this.props.set('clap', []);
    left.position.y = right.position.y = stick.position.y = tamb.position.y = -0.32;
    this.arms[0].add(left);
    this.arms[1].add(right, stick, tamb);
    // A glass of beer for cụng ly (FM-01).
    this.glass.position.y = -0.36;
    mesh(G.glass, new THREE.MeshStandardMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.85, roughness: 0.2 }), 0, -0.06, 0, this.glass);
    mesh(G.foam, basic(0xfff8e8), 0, 0.03, 0, this.glass);
    this.glass.visible = false;
    this.arms[0].add(this.glass);
    this.showProp();

    this.ring = mesh(G.ring, basic(C.cyan, { transparent: true, opacity: 0, depthWrite: false }), 0, 0.62, 0, this.root);
    this.ring.rotation.x = Math.PI / 2;
    this.tag = label(name, me ? 'me' : 'other');
    this.tag.position.y = 1.72;
    this.root.add(this.tag);
  }

  /** Sit down at a seat immediately (first appearance, or after a walk). */
  sitAt(spot: { x: number; z: number; rot: number; y: number }) {
    this.home = spot;
    this.mode = 'seated';
    this.path = [];
    this.root.position.set(spot.x, spot.y, spot.z);
    this.root.rotation.y = spot.rot;
    this.mic.visible = false;
  }

  /** Stand on the stage immediately (someone already singing when you arrive). */
  standOnStage(spot: { x: number; z: number; rot: number; y: number }) {
    this.stageSpot = spot;
    this.mode = 'stage';
    this.path = [];
    this.root.position.set(spot.x, spot.y, spot.z);
    this.root.rotation.y = spot.rot;
    this.mic.visible = true;
  }

  /** Walk along `path`, then sit at `home` or stand on stage. Everyone sees the same walk (R-12). */
  walk(path: Pt[], then: ChibiMode, stageSpot?: { x: number; z: number; rot: number; y: number }) {
    if (!path.length && this.mode !== 'walking') return then === 'stage' && stageSpot ? this.standOnStage(stageSpot) : this.sitAt(this.home);
    // Already walking: finish this walk first (it ends where the new route starts), then go on.
    this.path = this.mode === 'walking' ? [...this.path, ...path] : [...path];
    this.after = then;
    if (stageSpot) this.stageSpot = stageSpot;
    this.mode = 'walking';
    this.mic.visible = false;
    this.root.position.y = 0;
  }

  /** Move the singer to another spot on the stage (a second singer arrives or leaves). */
  shiftOnStage(spot: { x: number; z: number; rot: number; y: number }) {
    this.stageSpot = spot;
    if (this.mode === 'stage') this.standOnStage(spot);
  }

  get onStage() {
    return this.mode === 'stage' || (this.mode === 'walking' && this.after === 'stage');
  }

  /** See-through while mid-reconnect (N-12). Materials remember their own look and get it back. */
  setAway(away: boolean) {
    if (this.away === away) return;
    this.away = away;
    this.root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat || Array.isArray(mat) || o === this.ring) return;
      mat.userData['base'] ??= { transparent: mat.transparent, opacity: mat.opacity };
      const base = mat.userData['base'] as { transparent: boolean; opacity: number };
      mat.transparent = away || base.transparent;
      mat.opacity = away ? base.opacity * 0.35 : base.opacity;
      mat.needsUpdate = true;
    });
  }

  setProp(prop: Prop) {
    this.prop = prop;
    this.showProp();
  }

  /** Props show while seated; the stage has the mic, the dance has the lightstick (FM-04). */
  private showProp() {
    const show = this.dancing ? 'lightstick' : this.mode === 'seated' ? this.prop : null;
    for (const [p, groups] of this.props) for (const g of groups) g.visible = p === show;
  }

  /** FM-01: raise a glass for the "1, 2, 3, DÔ!" countdown. */
  raiseGlass(seconds: number) {
    this.glassT = seconds;
  }

  /** FM-05: someone farted nearby: jump out of the seat, then hold the nose and turn away. */
  scare(awayFrom: { x: number; z: number }, noJump = false) {
    this.scareT = noJump ? 0.6 : 0; // reduced motion: skip the jump (FM-08)
    const p = this.root.position;
    this.scareTurn = Math.atan2(p.x - awayFrom.x, p.z - awayFrom.z) - this.home.rot;
  }

  /** CH-02: a speech bubble above the head for 4 s; a newer one replaces it. */
  say(text: string) {
    this.bubble?.sprite.removeFromParent();
    this.bubble?.sprite.material.map?.dispose();
    this.bubble?.sprite.material.dispose();
    const short = text.length > 60 ? text.slice(0, 58) + '…' : text;
    const { tex } = canvasTexture(512, 128, (g, w, h) => {
      g.font = '600 30px "Be Vietnam Pro", sans-serif';
      const words = short.split(' ');
      const lines: string[] = [''];
      for (const word of words) {
        const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
        if (g.measureText(next).width > w - 60 && lines[lines.length - 1]) lines.push(word);
        else lines[lines.length - 1] = next;
      }
      const shown = lines.slice(0, 2);
      const tw = Math.min(w - 8, Math.max(...shown.map((l) => g.measureText(l).width)) + 40);
      const bh = shown.length * 38 + 22;
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath();
      g.roundRect((w - tw) / 2, h - bh - 16, tw, bh, 22);
      g.fill();
      g.beginPath();
      g.moveTo(w / 2 - 12, h - 17);
      g.lineTo(w / 2 + 12, h - 17);
      g.lineTo(w / 2, h - 2);
      g.fill();
      g.fillStyle = '#1a1222';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      shown.forEach((l, k) => g.fillText(l, w / 2, h - bh - 16 + 30 + k * 38));
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.y = 2.15;
    sprite.renderOrder = 12;
    this.root.add(sprite);
    this.bubble = { sprite, t: 0 };
  }

  /** "Hú hét": both arms up and a wide-open mouth for about a second. */
  cheer() {
    this.cheerT = 0;
  }

  /** Name tags shrink up close and grow far away, so they stay readable. */
  scaleTag(cameraDistance: number, visible = true) {
    const k = Math.min(1.25, Math.max(0.6, cameraDistance * 0.11));
    const base = this.tag.userData['baseScale'] as THREE.Vector3;
    this.tag.scale.set(base.x * k, base.y * k, 1);
    this.tag.visible = visible;
  }

  update(t: number, dt: number) {
    const [L, R] = this.arms;
    if (this.bubble) {
      this.bubble.t += dt;
      this.bubble.sprite.material.opacity = Math.min(1, (4 - this.bubble.t) * 2);
      if (this.bubble.t > 4) {
        this.bubble.sprite.removeFromParent();
        this.bubble.sprite.material.map?.dispose();
        this.bubble.sprite.material.dispose();
        this.bubble = undefined;
      }
    }
    this.showProp();
    this.glass.visible = this.glassT > 0 && this.mode === 'seated';
    if (this.glassT > 0) this.glassT -= dt;
    // Talking ring (VC-07): fades with the voice.
    const talk = this.talking();
    this.ring.material.opacity += ((talk > 0.05 ? 0.4 + talk * 0.6 : 0) - this.ring.material.opacity) * Math.min(1, dt * 12);

    if (this.mode === 'walking') {
      this.step(dt, t);
      const sw = Math.sin(t * 13) * 0.5;
      L.rotation.set(-sw, 0, 0.1);
      R.rotation.set(sw, 0, -0.1);
      this.legs[0].rotation.x = sw;
      this.legs[1].rotation.x = -sw;
      this.head.rotation.set(0, 0, 0);
      this.mouth.scale.set(1, 1, 1);
      return;
    }
    if (this.mode === 'stage') {
      // Sway, raise the mic, and open the mouth with the real voice (A-04).
      const sway = Math.sin(t * 2.2 + this.phase);
      this.torso.rotation.z = sway * 0.06;
      this.head.rotation.z = -sway * 0.05;
      this.torso.position.y = Math.abs(Math.sin(t * 3.8 + this.phase)) * 0.025;
      R.rotation.set(-2.35, 0, -0.35);
      L.rotation.set(-0.9 + Math.sin(t * 1.6) * 0.5, 0, 0.35 + Math.sin(t * 1.6) * 0.25);
      this.legs.forEach((l) => (l.rotation.x = 0));
      const v = this.level();
      this.mouth.scale.set(1 - v * 0.2, 1 + v * 4, 1);
      return;
    }
    if (this.cheerT >= 0) {
      this.cheerT += dt;
      const w = Math.sin(this.cheerT * 14) * 0.15;
      L.rotation.set(-2.9 + w, 0, -0.5);
      R.rotation.set(-2.9 - w, 0, 0.5);
      this.mouth.scale.set(0.8, 3.4, 1);
      if (this.cheerT > 1.1) this.cheerT = -1;
      if (this.mode === 'seated') this.legs.forEach((l) => (l.rotation.x = (-Math.PI / 2) * (1 - this.stand)));
      return;
    }
    // Seated (A-03), standing up for the dance or a fart scare (FM-03, FM-05).
    const scared = this.scareT >= 0;
    if (scared) {
      this.scareT += dt;
      if (this.scareT > 3) this.scareT = -1;
    }
    const target = this.dancing || scared ? 1 : 0;
    this.stand += (target - this.stand) * Math.min(1, dt * 4);
    const h = this.home;
    const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
    let y = h.y * (1 - this.stand);
    let legK = 1 - this.stand;
    if (scared && this.scareT < 0.6) {
      y += Math.sin((Math.PI * this.scareT) / 0.6) * 0.75; // jump out of the seat
      legK *= 0.25;
    }
    const sway = this.dancing ? Math.sin(t * 4 + this.phase) * 0.35 * this.stand : 0;
    this.root.position.set(h.x + fx * 0.6 * this.stand, y, h.z + fz * 0.6 * this.stand);
    this.root.rotation.y = h.rot + sway;
    this.legs.forEach((l) => (l.rotation.x = (-Math.PI / 2) * legK));
    const beat = Math.sin(t * Math.PI * 2 * 0.95 + this.phase * 0.2);
    this.head.rotation.set(0, 0, beat * 0.06);
    this.torso.rotation.z = 0;
    this.torso.position.y = Math.abs(beat) * 0.02;
    this.mouth.scale.set(1, 1 + talk * 2.5, 1);
    if (this.prop === 'lightstick' || this.dancing) {
      this.lightstick.material.color.setHSL(this.dancing ? this.danceHue : (t * 0.3 + this.phase) % 1, 0.9, 0.6);
    }
    if (scared && this.scareT >= 0.6) {
      // Hold the nose and look away from the smell.
      R.rotation.set(-2.5, 0, -0.55);
      L.rotation.set(-0.5 + Math.sin(t * 14) * 0.4, 0, -0.6);
      this.head.rotation.y = this.scareTurn;
      return;
    }
    if (this.glassT > 0) {
      const up = Math.min(1, this.glassT > 2.6 ? (3.2 - this.glassT) / 0.6 : 1);
      L.rotation.set(-0.6 - up * 2.1, 0, 0.12);
      R.rotation.set(-0.55, 0, -0.12);
      return;
    }
    if (this.dancing) {
      const w = Math.sin(t * 6 + this.phase);
      L.rotation.set(-2.6 + w * 0.35, 0, -0.45 - w * 0.3);
      R.rotation.set(-2.6 - w * 0.35, 0, 0.45 - w * 0.3);
      this.torso.position.y = Math.abs(Math.sin(t * 6 + this.phase)) * 0.07;
      return;
    }
    if (this.shaking) {
      // M-02: raise the prop and shake it.
      const s = Math.sin(t * 34 + this.phase);
      if (this.prop === 'maracas') {
        const m = Math.sin(t * 44 + this.phase);
        L.rotation.set(-2.3 + m * 0.45, 0, -0.8);
        R.rotation.set(-2.3 - m * 0.45, 0, 0.8);
      } else if (this.prop === 'tambourine') {
        L.rotation.set(-0.5, 0, 0.1);
        R.rotation.set(-2.3 + s * 0.25, 0, -0.2 + s * 0.15);
      } else if (this.prop === 'lightstick') {
        L.rotation.set(-0.6, 0, 0.15);
        R.rotation.set(-2.6, 0, Math.sin(t * 5 + this.phase) * 0.6 - 0.2);
      } else {
        const c = Math.sin(t * 22 + this.phase);
        L.rotation.set(-1.3, 0, -0.5 - c * 0.35);
        R.rotation.set(-1.3, 0, 0.5 + c * 0.35);
      }
      return;
    }
    const idle = Math.sin(t * 2 + this.phase) * 0.05;
    if (this.prop === 'lightstick') {
      L.rotation.set(-0.5, 0, 0.15);
      R.rotation.set(-1.6 + idle, 0, -0.1);
    } else {
      L.rotation.set(-0.55 + idle, 0, 0.12);
      R.rotation.set(-0.55 - idle, 0, -0.12);
    }
  }

  /** Advance along the walk path. */
  private step(dt: number, t: number) {
    const pos = this.root.position;
    let budget = WALK_SPEED * dt;
    while (budget > 0 && this.path.length) {
      const p = this.path[0];
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.001) this.root.rotation.y = Math.atan2(dx, dz);
      if (d <= budget) {
        pos.x = p.x;
        pos.z = p.z;
        budget -= d;
        this.path.shift();
      } else {
        pos.x += (dx / d) * budget;
        pos.z += (dz / d) * budget;
        budget = 0;
      }
    }
    pos.y = Math.abs(Math.sin(t * 13)) * 0.04;
    if (!this.path.length) {
      if (this.after === 'stage') this.standOnStage(this.stageSpot);
      else this.sitAt(this.home);
    }
  }

  /** Frees this chibi's materials and textures (geometry is shared and stays). */
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }
}
