import * as THREE from 'three';
import { basic, C, label, mesh, std } from './kit';
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
      if (this.mode === 'seated') this.legs.forEach((l) => (l.rotation.x = -Math.PI / 2));
      return;
    }
    // Seated: head bobs to the beat, arms rest (A-03).
    const beat = Math.sin(t * Math.PI * 2 * 0.95 + this.phase * 0.2);
    this.head.rotation.z = beat * 0.06;
    this.torso.rotation.z = 0;
    this.torso.position.y = Math.abs(beat) * 0.02;
    const idle = Math.sin(t * 2 + this.phase) * 0.05;
    L.rotation.set(-0.55 + idle, 0, 0.12);
    R.rotation.set(-0.55 - idle, 0, -0.12);
    this.legs.forEach((l) => (l.rotation.x = -Math.PI / 2));
    this.mouth.scale.set(1, 1 + talk * 2.5, 1);
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
