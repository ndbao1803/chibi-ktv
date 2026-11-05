import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PresenceList } from '@ktv/shared';

/**
 * The 3D karaoke room, in plain Three.js (no Angular inside), ported from the
 * design prototype. The page creates it with a canvas and tells it who is in the room.
 */
const C = { pink: 0xff3fa4, cyan: 0x33e1ed, gold: 0xf2c14e, wine: 0x6e1a37 };
const SKIN = [0xffd9c0, 0xf6c9a5, 0xe8b48f];
const HAIR = [0x1b1418, 0x3a2418, 0x5a2a1a, 0x141420, 0x7a4a2a];
const OUTFIT = [0x3a7bd5, 0xff7eb6, 0x4fbf8f, 0x9b6bff, 0xe2543d, 0x33c4d6, 0xf2a93b, 0xff3fa4];

// 8 sofa seats, then 8 standing spots behind the sofa for 16-person rooms.
const SPOTS: [number, number, number, boolean][] = [
  // Side seats first: from the default camera you see their faces, not the backs of their heads.
  [-4.45, 0.4, Math.PI / 2, true], [4.45, 0.4, -Math.PI / 2, true], [-4.45, 2.0, Math.PI / 2, true], [4.45, 2.0, -Math.PI / 2, true],
  [-0.95, 3.25, Math.PI, true], [0.95, 3.25, Math.PI, true], [-2.85, 3.25, Math.PI, true], [2.85, 3.25, Math.PI, true],
  ...[-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5].map((x) => [x, 4.5, Math.PI, false] as [number, number, number, boolean]),
];

interface Chibi {
  root: THREE.Group;
  head: THREE.Group;
  mouth: THREE.Mesh;
  legs: THREE.Group[];
  arms: THREE.Group[];
  spot: number;
  phase: number;
  disposables: { dispose(): void }[];
  away?: boolean;
}

const STAGE = new THREE.Vector3(0, 0.3, -3.1);

export class KtvScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly timer = new THREE.Timer();
  private readonly chibis = new Map<string, Chibi>();
  private readonly disco = new THREE.Group();
  private readonly resize = new ResizeObserver(() => this.fit());
  private frame = 0;
  private singerId: string | null = null;
  private screen!: THREE.CanvasTexture;
  /** Loudness of the singer's voice (0..1), read every frame for the mouth (A-04). */
  singerLevel: () => number = () => 0;

  /** Called if the browser takes the 3D context away later (GPU reset, too many tabs). */
  onLost: () => void = () => {};

  /** Throws if this browser cannot create a 3D (WebGL) context; the room page then runs without 3D. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    // Phones: skip antialiasing, it is the most GPU-hungry setting and the chibis are flat-shaded anyway.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'low-power' });
    canvas.addEventListener('webglcontextlost', this.contextLost, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.scene.background = new THREE.Color(0x0b0912);
    this.scene.fog = new THREE.Fog(0x0b0912, 14, 26);
    this.camera.position.set(0, 5.4, 7.8);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1, -1.8);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 15;
    this.buildRoom();
    this.resize.observe(canvas);
    this.fit();
    this.loop();
  }

  /** Adds chibis for new members and removes those who left. */
  setMembers(members: PresenceList, meId: string | undefined) {
    const ids = new Set(members.map((m) => m.userId));
    for (const [id, c] of this.chibis) {
      if (!ids.has(id)) {
        this.scene.remove(c.root);
        c.disposables.forEach((d) => d.dispose());
        this.chibis.delete(id);
      }
    }
    const taken = new Set([...this.chibis.values()].map((c) => c.spot));
    members.forEach((m, i) => {
      const have = this.chibis.get(m.userId);
      if (have) {
        this.dim(have, m.away);
        return;
      }
      const spot = SPOTS.findIndex((_, k) => !taken.has(k));
      if (spot < 0) return;
      taken.add(spot);
      const c = this.makeChibi(m.displayName, m.userId === meId, i, spot);
      this.scene.add(c.root);
      this.chibis.set(m.userId, c);
      this.place(m.userId, c);
      this.dim(c, m.away);
    });
  }

  /** N-12: someone mid-reconnect is shown see-through until they are back. */
  private dim(c: Chibi, away: boolean) {
    if ((c.away ?? false) === away) return;
    c.away = away;
    c.root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat || Array.isArray(mat)) return;
      // Remember each material's own look (name tags are already see-through) and restore it.
      mat.userData['base'] ??= { transparent: mat.transparent, opacity: mat.opacity };
      const base = mat.userData['base'] as { transparent: boolean; opacity: number };
      mat.transparent = away || base.transparent;
      mat.opacity = away ? base.opacity * 0.35 : base.opacity;
      mat.needsUpdate = true;
    });
  }

  /**
   * The 3D TV is decoration only (the real video is the flat panel, P-04): it shows the song title
   * and who is singing.
   */
  drawScreen(title: string | null, singer: string | null) {
    const c = this.screen.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 1024, 576);
    grd.addColorStop(0, '#3a0d33');
    grd.addColorStop(1, '#071c27');
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 576);
    g.textAlign = 'center';
    g.shadowColor = '#ff3fa4';
    g.shadowBlur = 30;
    g.fillStyle = '#ffd1e9';
    if (title) {
      g.font = '700 64px "Be Vietnam Pro", sans-serif';
      let t = title;
      while (g.measureText(t).width > 920 && t.length > 4) t = t.slice(0, -2);
      g.fillText(t === title ? t : t + '…', 512, 250);
    } else {
      g.font = '110px Bungee, Impact, sans-serif';
      g.fillText('CHIBI KTV', 512, 270);
    }
    g.shadowBlur = 0;
    g.font = '600 36px "Be Vietnam Pro", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText(singer ? `🎤 ${singer} đang hát` : title ? 'Ai lên hát nào?' : 'Chờ bài hát đầu tiên…', 512, 350);
    this.screen.needsUpdate = true;
  }

  /** Moves the singer to the stage, standing and facing the room; everyone else back to their seat. */
  setSinger(userId: string | null) {
    this.singerId = userId;
    for (const [id, c] of this.chibis) this.place(id, c);
  }

  private place(id: string, c: Chibi) {
    const onStage = id === this.singerId;
    (c.root.userData['mic'] as THREE.Group).visible = onStage;
    const [x, z, rot, seated] = SPOTS[c.spot];
    if (onStage) {
      c.root.position.copy(STAGE);
      c.root.rotation.y = 0;
    } else {
      c.root.position.set(x, seated ? 0.15 : 0, z);
      c.root.rotation.y = rot;
    }
    const sitting = seated && !onStage;
    c.legs.forEach((l) => (l.rotation.x = sitting ? -Math.PI / 2 : 0));
    // On stage the right arm holds the mic up.
    c.arms[1].rotation.set(onStage ? -2.35 : -0.55, 0, onStage ? -0.35 : 0.12);
    c.mouth.scale.set(1, 1, 1);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost, false);
    this.resize.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat) => {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      });
    });
    this.renderer.dispose();
    // Give the GPU context back right away. Without this, entering and leaving rooms piles up
    // contexts until the browser starts killing them and then blocks 3D for the whole site.
    this.renderer.forceContextLoss();
  }

  /* ---------- internals ---------- */

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

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    this.timer.update();
    const t = this.timer.getElapsed();
    this.controls.update();
    this.disco.rotation.y = t * 0.35;
    for (const [id, c] of this.chibis) {
      const beat = Math.sin(t * Math.PI * 2 * 0.9 + c.phase);
      c.head.rotation.z = beat * 0.06;
      c.head.position.y = 0.72 + Math.abs(beat) * 0.02;
      if (id === this.singerId) {
        const level = this.singerLevel();
        c.mouth.scale.set(1 - level * 0.2, 1 + level * 4, 1);
        c.root.rotation.z = Math.sin(t * 2.2) * 0.03;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.scene) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  private std(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
  }
  private basic(color: number, extra: THREE.MeshBasicMaterialParameters = {}) {
    return new THREE.MeshBasicMaterial({ color, ...extra });
  }
  private canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildRoom() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8a7ab8, 0x2a1830, 2.2));
    s.add(new THREE.AmbientLight(0x3a2f4a, 1.4));
    const pink = new THREE.PointLight(C.pink, 9, 14, 1);
    pink.position.set(-5, 3.8, -3);
    const cyan = new THREE.PointLight(C.cyan, 8, 14, 1);
    cyan.position.set(5, 3.8, -3);
    const warm = new THREE.PointLight(0xffb070, 5, 9, 1);
    warm.position.set(0, 3.2, 2.2);
    s.add(pink, cyan, warm);

    // Concrete walls with form-tie dots (industrial ICOOL-inspired look).
    const concrete = this.canvasTexture(512, 256, (g) => {
      g.fillStyle = '#2b2833';
      g.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 4000; i++) {
        const v = (30 + Math.random() * 30) | 0;
        g.fillStyle = `rgba(${v + 10},${v},${v + 18},.35)`;
        g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
      }
      g.fillStyle = 'rgba(0,0,0,.45)';
      for (let x = 32; x < 512; x += 64) for (let y = 32; y < 256; y += 64) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    });
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    concrete.repeat.set(3, 2);
    const wall = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 });
    this.mesh(new THREE.PlaneGeometry(16, 5), wall, 0, 2.5, -5);
    this.mesh(new THREE.PlaneGeometry(12, 5), wall, -8, 2.5, 1).rotation.y = Math.PI / 2;
    this.mesh(new THREE.PlaneGeometry(12, 5), wall, 8, 2.5, 1).rotation.y = -Math.PI / 2;
    const carpet = this.canvasTexture(256, 256, (g) => {
      g.fillStyle = '#1a1222';
      g.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 32)
        for (let y = 0; y < 256; y += 32) {
          g.fillStyle = (x + y) % 64 ? 'rgba(255,63,164,.08)' : 'rgba(51,225,237,.06)';
          g.beginPath(); g.moveTo(x + 16, y); g.lineTo(x + 32, y + 16); g.lineTo(x + 16, y + 32); g.lineTo(x, y + 16); g.fill();
        }
    });
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
    carpet.repeat.set(4, 3);
    this.mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }), 0, 0, 1).rotation.x = -Math.PI / 2;

    // Neon strips.
    this.mesh(new THREE.BoxGeometry(15.6, 0.06, 0.06), this.basic(C.pink), 0, 4.6, -4.95);
    this.mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), this.basic(C.cyan), -7.95, 4.6, 1);
    this.mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), this.basic(C.cyan), 7.95, 4.6, 1);

    // TV wall: gold frame and an idle screen (the real YouTube player is a flat panel, not in 3D).
    this.mesh(new THREE.BoxGeometry(5.8, 3.4, 0.16), this.std(0x050407), 0, 2.6, -4.9);
    const gold = this.basic(C.gold);
    this.mesh(new THREE.BoxGeometry(5.9, 0.07, 0.06), gold, 0, 4.38, -4.88);
    this.mesh(new THREE.BoxGeometry(5.9, 0.07, 0.06), gold, 0, 0.82, -4.88);
    this.screen = this.canvasTexture(1024, 576, () => {});
    this.drawScreen(null, null);
    this.mesh(new THREE.PlaneGeometry(5.5, 3.1), this.basic(0xffffff, { map: this.screen }), 0, 2.6, -4.81);
    for (const x of [-3.7, 3.7]) this.mesh(new THREE.BoxGeometry(0.9, 2.6, 0.7), this.std(0x111015), x, 1.3, -4.4);

    // Stage with neon ring and spotlight beam.
    this.mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 40), this.std(0x141019, { roughness: 0.3, metalness: 0.3, flatShading: false }), 0, 0.15, -3.1);
    this.mesh(new THREE.TorusGeometry(1.52, 0.035, 8, 64), this.basic(C.pink), 0, 0.3, -3.1).rotation.x = Math.PI / 2;
    this.mesh(
      new THREE.ConeGeometry(1.3, 4.6, 32, 1, true),
      this.basic(0xfff1d6, { transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      0, 2.6, -3.1,
    );
    const spot = new THREE.SpotLight(0xfff1d6, 30, 12, 0.42, 0.55, 1);
    spot.position.set(0, 4.9, -2.4);
    spot.target.position.set(0, 0.3, -3.1);
    s.add(spot, spot.target);

    // Disco ball.
    this.disco.position.set(0, 4.6, -0.3);
    s.add(this.disco);
    this.mesh(new THREE.IcosahedronGeometry(0.28, 1), this.std(0xe8e8f0, { metalness: 0.3, roughness: 0.2, emissive: 0x2a2a3a }), 0, 0, 0, this.disco);

    // Wine velvet U-sofa with gold piping, and the table with a fruit plate.
    const velvet = this.std(C.wine, { roughness: 0.9 });
    const sofa = (len: number, x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      s.add(g);
      this.mesh(new THREE.BoxGeometry(len, 0.45, 0.95), velvet, 0, 0.225, 0, g);
      this.mesh(new THREE.BoxGeometry(len, 0.9, 0.28), velvet, 0, 0.6, 0.46, g);
      this.mesh(new THREE.BoxGeometry(len, 0.03, 0.03), gold, 0, 1.06, 0.33, g);
    };
    sofa(7.6, 0, 3.4, 0);
    sofa(3.4, -4.6, 1.2, -Math.PI / 2);
    sofa(3.4, 4.6, 1.2, Math.PI / 2);
    this.mesh(new THREE.BoxGeometry(3.4, 0.4, 1.4), this.std(0x0f0c14, { roughness: 0.25, metalness: 0.3, flatShading: false }), 0, 0.2, 1.25);
    this.mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.06, 24), this.std(0xf4f0ea), -0.4, 0.45, 1.25);
    [0xff6b3d, 0x7ccf4b, 0xf7d33a, 0xd93a5a].forEach((c, i) =>
      this.mesh(new THREE.SphereGeometry(0.09, 10, 8), this.std(c), -0.55 + (i % 2) * 0.25, 0.53, 1.15 + Math.floor(i / 2) * 0.2),
    );
  }

  private nameTag(text: string, me: boolean) {
    const tex = this.canvasTexture(256, 64, (g) => {
      g.font = '600 30px "Be Vietnam Pro", sans-serif';
      const tw = Math.min(250, g.measureText(text).width + 28);
      g.fillStyle = me ? 'rgba(242,193,78,.95)' : 'rgba(20,14,30,.85)';
      g.beginPath();
      g.roundRect((256 - tw) / 2, 8, tw, 48, 24);
      g.fill();
      g.fillStyle = me ? '#241a05' : '#f4effa';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 33);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(0.9, 0.225, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  /** Big head, small body: the chibi spec from the design (A-01). */
  private makeChibi(name: string, me: boolean, i: number, spot: number): Chibi {
    const root = new THREE.Group();
    const outfit = this.std(OUTFIT[i % OUTFIT.length]);
    const skin = this.std(SKIN[i % SKIN.length], { flatShading: false });
    const hair = this.std(HAIR[i % HAIR.length], { flatShading: false });
    const dark = this.basic(0x120d14);
    const hips = new THREE.Group();
    hips.position.y = 0.3;
    root.add(hips);
    const legs: THREE.Group[] = [];
    for (const x of [-0.11, 0.11]) {
      const leg = new THREE.Group();
      leg.position.x = x;
      hips.add(leg);
      this.mesh(new THREE.BoxGeometry(0.14, 0.28, 0.15), this.std(0x23202b), 0, -0.14, 0, leg);
      this.mesh(new THREE.BoxGeometry(0.16, 0.07, 0.2), this.std(0xf2f2f2), 0, -0.28, 0.03, leg);
      legs.push(leg);
    }
    this.mesh(new THREE.BoxGeometry(0.46, 0.42, 0.34), outfit, 0, 0.21, 0, hips);
    const head = new THREE.Group();
    head.position.y = 0.72;
    hips.add(head);
    this.mesh(new THREE.SphereGeometry(0.38, 20, 16), skin, 0, 0, 0, head).scale.set(1.05, 0.94, 1);
    this.mesh(new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.03, -0.02, head).rotation.x = -0.25;
    for (const x of [-0.13, 0.13]) {
      this.mesh(new THREE.SphereGeometry(0.06, 10, 8), dark, x, -0.02, 0.36, head).scale.set(1, 1.25, 0.6);
      this.mesh(new THREE.CircleGeometry(0.05, 12), this.basic(0xff8fb1, { transparent: true, opacity: 0.6 }), x * 1.55, -0.11, 0.335, head);
    }
    const mouth = this.mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), this.basic(0x5a1426), 0, -0.15, 0.365, head);
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.29, 0.36, 0);
      arm.rotation.set(-0.55, 0, side * -0.12);
      hips.add(arm);
      this.mesh(new THREE.BoxGeometry(0.12, 0.3, 0.13), outfit, 0, -0.14, 0, arm);
      this.mesh(new THREE.SphereGeometry(0.07, 10, 8), skin, 0, -0.32, 0, arm);
      arms.push(arm);
    }
    // A microphone in the right hand, shown only on stage.
    const mic = new THREE.Group();
    mic.position.y = -0.36;
    this.mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.2, 10), this.std(0x111111, { metalness: 0.6 }), 0, -0.06, 0, mic);
    this.mesh(new THREE.SphereGeometry(0.055, 10, 8), this.std(0x9a9a9a, { metalness: 0.9, roughness: 0.25 }), 0, -0.18, 0, mic);
    arms[1].add(mic);
    root.userData['mic'] = mic;
    const tag = this.nameTag(name, me);
    tag.position.y = 1.72;
    root.add(tag);
    const disposables: { dispose(): void }[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) disposables.push(m.geometry);
      if (m.material && !Array.isArray(m.material)) disposables.push(m.material);
    });
    return { root, head, mouth, legs, arms, spot, phase: Math.random() * 6, disposables };
  }
}
