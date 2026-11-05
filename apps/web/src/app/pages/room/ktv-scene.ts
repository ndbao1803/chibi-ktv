import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PresenceList } from '@ktv/shared';
import { Chibi, SHARED_GEOMETRY } from './scene/chibi';
import { basic, C, disposeTree, label, mesh, REDUCED_MOTION } from './scene/kit';
import { RoomDecor } from './scene/room-decor';
import { SEATS, seatRoute, STAGE, stageRoute, stageSlot } from './scene/seats';

export type CameraView = 'all' | 'stage' | 'me';

interface SeatMarker {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  hit: THREE.Mesh;
  owner?: THREE.Sprite;
  ownerName?: string;
}

const VIEWS: Record<Exclude<CameraView, 'me'> | 'all16', [THREE.Vector3, THREE.Vector3]> = {
  all: [new THREE.Vector3(0, 5.4, 7.8), new THREE.Vector3(0, 1.0, -1.8)],
  // Rooms of 16: higher and further back, so the bar-stool row does not block the stage.
  all16: [new THREE.Vector3(0, 7.6, 10.6), new THREE.Vector3(0, 0.6, -1.4)],
  stage: [new THREE.Vector3(0, 1.8, 0.6), new THREE.Vector3(0, 1.1, -3.1)],
};

/**
 * The 3D karaoke room (plain Three.js, no Angular inside), ported from the design prototype.
 * The page tells it who is in the room, where they sit and who is on stage; it animates the rest.
 * Pieces: `scene/room-decor.ts` (the room), `scene/chibi.ts` (avatars), `scene/seats.ts` (layout + walks).
 */
export class KtvScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly timer = new THREE.Timer();
  private readonly decor = new RoomDecor();
  private readonly chibis = new Map<string, { c: Chibi; seat: number | null }>();
  private readonly markers: SeatMarker[] = [];
  private readonly resize = new ResizeObserver(() => this.fit());
  private readonly ray = new THREE.Raycaster();
  private frame = 0;
  private capacity = 8;
  private meId: string | undefined;
  private stageIds: string[] = [];
  private view: CameraView = 'all';
  private camGoal: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private lowPower = false;
  private slow = { frames: 0, time: 0, strikes: 0 };
  private readonly pixelRatio: number;

  /** Voice loudness (0..1) of a singer, for their mouth (A-04). */
  levelOf: (userId: string) => number = () => 0;
  /** Talking loudness (0..1) of anyone, for the speaking ring (VC-07). */
  talkOf: (userId: string) => number = () => 0;
  /** I clicked a free seat (R-11); the page asks the server, and the walk starts when it agrees. */
  onSeatClick: (seat: number) => void = () => {};
  /** The frame rate stayed low, so the extra effects were switched off (RD-05). */
  onSlow: () => void = () => {};
  /** Called if the browser takes the 3D context away later (GPU reset, too many tabs). */
  onLost: () => void = () => {};

  /** Throws if this browser cannot create a 3D (WebGL) context; the room page then runs without 3D. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    // Phones: skip antialiasing, it is the most GPU-hungry setting and the chibis are flat-shaded anyway.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'low-power' });
    canvas.addEventListener('webglcontextlost', this.contextLost, false);
    this.pixelRatio = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.scene.background = new THREE.Color(0x0b0912);
    this.scene.fog = new THREE.Fog(0x0b0912, 18, 32);
    this.camera.position.copy(VIEWS.all[0]);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(VIEWS.all[1]);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 17;
    this.controls.addEventListener('start', () => (this.camGoal = null)); // dragging cancels a preset glide
    this.scene.add(this.decor.root);
    this.buildMarkers();
    this.setCapacity(8);
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointermove', this.pointerMove);
    this.resize.observe(canvas);
    this.fit();
    this.loop();
  }

  /* ---------- what the page tells the room ---------- */

  setCapacity(capacity: number) {
    const changed = this.capacity !== capacity;
    this.capacity = capacity;
    if (changed && this.view === 'all') this.setView('all');
    this.decor.setCapacity(capacity);
    this.refreshMarkers();
  }

  /** Adds chibis for new members, removes those who left, walks those who changed seats (R-12). */
  setMembers(members: PresenceList, meId: string | undefined) {
    this.meId = meId;
    const ids = new Set(members.map((m) => m.userId));
    for (const [id, entry] of this.chibis) {
      if (ids.has(id)) continue;
      entry.c.dispose();
      this.chibis.delete(id);
    }
    members.forEach((m, i) => {
      let entry = this.chibis.get(m.userId);
      if (!entry) {
        entry = { c: new Chibi(m.displayName, m.userId === meId, i), seat: m.seat };
        entry.c.level = () => this.levelOf(m.userId);
        entry.c.talking = () => this.talkOf(m.userId);
        this.chibis.set(m.userId, entry);
        this.scene.add(entry.c.root);
        if (m.seat !== null) entry.c.sitAt(SEATS[m.seat]);
        const slot = this.stageIds.indexOf(m.userId);
        if (slot >= 0) entry.c.standOnStage(this.slotSpot(slot));
        entry.c.root.visible = m.seat !== null || slot >= 0;
      } else if (m.seat !== entry.seat && m.seat !== null) {
        const from = entry.seat;
        entry.seat = m.seat;
        entry.c.home = SEATS[m.seat];
        entry.c.root.visible = true;
        // On stage they keep singing; they walk to the new seat when they come down.
        if (!entry.c.onStage) {
          if (from === null) entry.c.sitAt(SEATS[m.seat]);
          else entry.c.walk(seatRoute(from, m.seat), 'seated');
        }
      }
      entry.c.setAway(m.away);
    });
    this.refreshMarkers();
  }

  /** Who is on stage, in order (one singer, or two for a duet: S-12). They walk up; others walk back (S-01). */
  setStage(singerIds: string[]) {
    const before = this.stageIds;
    this.stageIds = [...singerIds];
    for (const [id, { c, seat }] of this.chibis) {
      const slot = this.stageIds.indexOf(id);
      if (slot >= 0) {
        const spot = this.slotSpot(slot);
        if (c.onStage) c.shiftOnStage(spot);
        else if (seat === null) c.standOnStage(spot);
        else c.walk(stageRoute(seat, spot), 'stage', spot);
        c.root.visible = true;
      } else if (before.includes(id) && c.onStage && seat !== null) {
        const route = [{ x: SEATS[seat].x, z: SEATS[seat].z }, ...stageRoute(seat, stageSlot(0, 1))].reverse().slice(1);
        c.walk(route, 'seated');
      }
    }
    this.decor.setStageBeams(this.stageIds.map((_, i) => stageSlot(i, this.stageIds.length)));
    this.refreshMarkers();
  }

  drawScreen(title: string | null, singerNames: string[]) {
    this.decor.drawScreen(title, singerNames);
  }

  /** Camera presets: the whole room, close on the stage, or from my own seat. */
  setView(view: CameraView) {
    this.view = view;
    const me = this.meId ? this.chibis.get(this.meId) : undefined;
    if (view === 'me' && me?.seat != null) {
      const s = SEATS[me.seat];
      const back = { x: -Math.sin(s.rot), z: -Math.cos(s.rot) };
      this.camGoal = {
        pos: new THREE.Vector3(s.x + back.x * 1.1, s.y + 2.1, s.z + back.z * 1.1),
        tgt: new THREE.Vector3(STAGE.x, 1.1, STAGE.z),
      };
    } else {
      const key = view === 'stage' ? 'stage' : this.capacity > 8 ? 'all16' : 'all';
      const [pos, tgt] = VIEWS[key];
      this.camGoal = { pos: pos.clone(), tgt: tgt.clone() };
    }
  }

  /** RD-05: fewer effects and a lower resolution, for phones that cannot hold 30 fps. */
  setLowPower(on: boolean) {
    this.lowPower = on;
    this.decor.setLowPower(on);
    this.renderer.setPixelRatio(on ? 1 : this.pixelRatio);
    this.fit();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost, false);
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointermove', this.pointerMove);
    this.resize.disconnect();
    this.controls.dispose();
    for (const { c } of this.chibis.values()) c.dispose();
    disposeTree(this.scene, SHARED_GEOMETRY);
    SHARED_GEOMETRY.forEach((g) => g.dispose());
    this.renderer.dispose();
    // Give the GPU context back right away. Without this, entering and leaving rooms piles up
    // contexts until the browser starts killing them and then blocks 3D for the whole site.
    this.renderer.forceContextLoss();
  }

  /* ---------- seats you can click (R-11) ---------- */

  private buildMarkers() {
    const freeLabel = label('Ghế trống · bấm để ngồi', 'hint');
    const ringGeo = new THREE.TorusGeometry(0.34, 0.03, 6, 28), hitGeo = new THREE.BoxGeometry(1.1, 1.2, 1.1);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    SEATS.forEach((s, i) => {
      const group = new THREE.Group();
      group.position.set(s.x, 0, s.z);
      this.scene.add(group);
      const ring = mesh(ringGeo, basic(C.cyan, { transparent: true, opacity: 0.8 }), 0, s.y + 0.33, 0, group);
      ring.rotation.x = Math.PI / 2;
      const tag = new THREE.Sprite(freeLabel.material); // one texture shared by every free seat
      tag.scale.copy(freeLabel.scale);
      tag.position.y = s.y + 1.0;
      tag.renderOrder = 10;
      group.add(tag);
      const hit = mesh(hitGeo, hitMat, s.x, s.y + 0.45, s.z, this.scene);
      hit.userData['seat'] = i;
      this.markers.push({ group, ring, hit });
    });
  }

  private refreshMarkers() {
    const owners = new Map<number, string>();
    for (const [id, { c, seat }] of this.chibis) if (seat !== null) owners.set(seat, id);
    this.markers.forEach((m, i) => {
      const owner = owners.get(i);
      const free = i < this.capacity && owner === undefined;
      m.group.visible = free;
      m.hit.visible = free;
      // R-13: the seat of someone on stage is kept for them, and says so.
      const holder = owner ? this.chibis.get(owner) : undefined;
      const reserved = holder?.c.onStage ? holder.c.name : '';
      if (reserved && m.ownerName !== reserved) {
        m.owner?.removeFromParent();
        (m.owner?.material as THREE.SpriteMaterial | undefined)?.map?.dispose();
        m.owner = label(`Ghế của ${reserved}`, 'other');
        m.owner.material.opacity = 0.6;
        m.owner.position.set(SEATS[i].x, SEATS[i].y + 0.95, SEATS[i].z);
        this.scene.add(m.owner);
        m.ownerName = reserved;
      }
      if (m.owner) m.owner.visible = !!reserved;
    });
  }

  private seatUnder(e: PointerEvent): number | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.markers.filter((m) => m.hit.visible).map((m) => m.hit));
    return hits.length ? (hits[0].object.userData['seat'] as number) : null;
  }

  private pointerDown = (e: PointerEvent) => (this.downAt = { x: e.clientX, y: e.clientY });
  private pointerUp = (e: PointerEvent) => {
    if (!this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6) return; // that was a camera drag, not a click
    const seat = this.seatUnder(e);
    if (seat !== null) this.onSeatClick(seat);
  };
  private pointerMove = (e: PointerEvent) => {
    if (e.buttons) return;
    this.canvas.style.cursor = this.seatUnder(e) !== null ? 'pointer' : '';
  };

  /* ---------- internals ---------- */

  private slotSpot(index: number) {
    const s = stageSlot(index, this.stageIds.length);
    return { ...s, y: STAGE.y };
  }

  private contextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frame);
    this.onLost();
  };

  private fit() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 600 ? 60 : 48;
    this.camera.updateProjectionMatrix();
  }

  /** Two slow 4-second windows in a row (under ~28 fps) switch the extras off once (RD-05, N-04). */
  private watchSpeed(dt: number) {
    if (this.lowPower || document.hidden) return;
    this.slow.frames++;
    this.slow.time += dt;
    if (this.slow.time < 4) return;
    const fps = this.slow.frames / this.slow.time;
    this.slow = { frames: 0, time: 0, strikes: fps < 28 ? this.slow.strikes + 1 : 0 };
    if (this.slow.strikes >= 2) {
      this.setLowPower(true);
      this.onSlow();
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    this.timer.update();
    const raw = this.timer.getDelta(), t = this.timer.getElapsed();
    // Capped so a hidden tab coming back does not jump, but loose enough for slow phones to keep walking.
    const dt = Math.min(0.2, raw);
    if (raw < 1) this.watchSpeed(raw);
    if (this.camGoal) {
      const k = 1 - Math.pow(0.02, dt);
      this.camera.position.lerp(this.camGoal.pos, k);
      this.controls.target.lerp(this.camGoal.tgt, k);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.02) this.camGoal = null;
    }
    this.controls.update();
    this.decor.setCameraHeight(this.camera.position.y);
    this.decor.update(t, dt, 0, REDUCED_MOTION);
    for (const [id, { c }] of this.chibis) {
      c.update(t, dt);
      c.scaleTag(this.camera.position.distanceTo(c.root.position), !(this.view === 'me' && id === this.meId));
    }
    const pulse = 0.45 + Math.sin(t * 4) * 0.35;
    for (const m of this.markers) if (m.group.visible) m.ring.material.opacity = pulse;
    this.renderer.render(this.scene, this.camera);
  };
}
