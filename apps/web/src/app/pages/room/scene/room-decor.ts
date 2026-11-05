import * as THREE from 'three';
import { basic, C, canvasTexture, glow, mesh, std, whenFont } from './kit';
import { SEATS, STAGE } from './seats';

/**
 * The ICOOL-inspired room from the design prototype: concrete and neon, TV wall, stage, U-sofa,
 * and the decorations of RD-01..RD-03. Decoration never stands between a seat and the stage (RD-04).
 * `update()` animates the few moving parts; `setLowPower(true)` hides the costly ones (RD-05).
 */
export class RoomDecor {
  readonly root = new THREE.Group();
  private readonly pinkLight = new THREE.PointLight(C.pink, 9, 14, 1);
  private readonly cyanLight = new THREE.PointLight(C.cyan, 8, 14, 1);
  private readonly disco = new THREE.Group();
  private readonly stageRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly beams: THREE.Mesh[] = [];
  private readonly balloons: { g: THREE.Group; base: number; ph: number }[] = [];
  private readonly heads: { head: THREE.Group; ph: number }[] = [];
  /** Things RD-05 switches off on slow devices. */
  private readonly fancy: THREE.Object3D[] = [];
  private readonly stools = new THREE.Group();
  /** Ceiling, beams and pipes: hidden when the camera is above them (a dollhouse cut-away view). */
  private readonly ceiling = new THREE.Group();
  private readonly screen: ReturnType<typeof canvasTexture>;
  private screenText = { title: null as string | null, singers: [] as string[] };
  private lowPower = false;

  constructor() {
    const r = this.root;
    this.lights();
    this.shell();
    this.screen = canvasTexture(1024, 576, (g, w, h) => this.paintScreen(g, w, h));
    whenFont('110px Bungee', this.screen.redraw);
    this.tvWall();
    this.stageRing = this.stage();
    this.decorations();
    this.furniture();
    r.add(this.stools);
    r.add(this.ceiling);
  }

  /** Hide the ceiling when the camera looks in from above it. */
  setCameraHeight(y: number) {
    this.ceiling.visible = y < 4.7;
  }

  /** The 3D TV is decoration only (the real video is the flat panel, P-04): title + who sings. */
  drawScreen(title: string | null, singers: string[]) {
    this.screenText = { title, singers };
    this.screen.redraw();
  }

  /** Rooms of 8 have no bar stools. */
  setCapacity(capacity: number) {
    this.stools.visible = capacity > 8;
  }

  setLowPower(on: boolean) {
    this.lowPower = on;
    for (const o of this.fancy) o.visible = !on;
  }

  /** `party` (0..1) speeds up the lights during a crowd dance (FM-03); flashes stay under 3/s (N-12). */
  update(t: number, dt: number, party = 0, reduced = false) {
    const k = reduced ? 0.4 : 1;
    this.disco.rotation.y += dt * (party > 0 ? 1.6 : 0.35) * k;
    if (party > 0 && !reduced) {
      const on = Math.sin(t * Math.PI * 2 * 1.5) > 0 ? 1.6 : 0.7; // 1.5 flashes per second
      this.pinkLight.intensity = 9 * on;
      this.cyanLight.intensity = 8 * (2.3 - on);
    } else {
      this.pinkLight.intensity = 9 + Math.sin(t * 0.8);
      this.cyanLight.intensity = 8 + Math.cos(t * 0.8);
    }
    this.stageRing.material.color.setHex(Math.sin(t * 1.2) > 0 ? C.pink : C.cyan);
    if (this.lowPower) return;
    for (const b of this.balloons) {
      b.g.position.y = b.base + Math.sin(t * 1.3 + b.ph) * 0.06;
      b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.08;
    }
    const sp = (party > 0 ? 1.8 : 0.6) * k;
    for (const h of this.heads) h.head.rotation.set(Math.sin(t * sp + h.ph) * 0.45, 0, (h.ph ? -1 : 1) * (0.35 + Math.sin(t * sp * 0.7 + h.ph) * 0.25));
  }

  /** Spotlight beams on the stage: one for a solo, two for a duet (S-12). */
  setStageBeams(slots: { x: number }[]) {
    this.beams.forEach((b, i) => {
      b.visible = i < Math.max(1, slots.length);
      b.position.x = slots[i]?.x ?? STAGE.x;
      b.scale.set(slots.length > 1 ? 0.75 : 1, 1, slots.length > 1 ? 0.75 : 1);
    });
  }

  /* ---------- building ---------- */

  private add<T extends THREE.Object3D>(o: T, fancy = false): T {
    this.root.add(o);
    if (fancy) this.fancy.push(o);
    return o;
  }

  private lights() {
    this.add(new THREE.HemisphereLight(0x8a7ab8, 0x2a1830, 2.2));
    this.add(new THREE.AmbientLight(0x3a2f4a, 1.4));
    this.pinkLight.position.set(-5, 3.8, -3);
    this.cyanLight.position.set(5, 3.8, -3);
    const warm = new THREE.PointLight(0xffb070, 5, 9, 1);
    warm.position.set(0, 3.2, 2.2);
    const bulbs = new THREE.PointLight(0xffb070, 3, 6, 1);
    bulbs.position.set(0, 3.6, 2.4);
    const spot = new THREE.SpotLight(0xfff1d6, 30, 12, 0.42, 0.55, 1);
    spot.position.set(0, 4.9, -2.4);
    spot.target.position.set(STAGE.x, STAGE.y, STAGE.z);
    this.add(this.pinkLight);
    this.add(this.cyanLight);
    this.add(warm);
    this.add(bulbs);
    this.add(spot);
    this.add(spot.target);
  }

  private shell() {
    const r = this.root;
    const concrete = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#2b2833';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        const v = (30 + Math.random() * 30) | 0;
        g.fillStyle = `rgba(${v + 10},${v},${v + 18},.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 2;
      for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.45)';
      for (let x = 32; x < w; x += 64) for (let y = 32; y < h; y += 64) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    }).tex;
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    concrete.repeat.set(3, 2);
    const wall = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 });
    mesh(new THREE.PlaneGeometry(16, 5), wall, 0, 2.5, -5, r);
    mesh(new THREE.PlaneGeometry(12, 5), wall, -8, 2.5, 1, r).rotation.y = Math.PI / 2;
    mesh(new THREE.PlaneGeometry(12, 5), wall, 8, 2.5, 1, r).rotation.y = -Math.PI / 2;

    const carpet = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#1a1222';
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32)
        for (let y = 0; y < h; y += 32) {
          g.fillStyle = (x + y) % 64 ? 'rgba(255,63,164,.08)' : 'rgba(51,225,237,.06)';
          g.beginPath(); g.moveTo(x + 16, y); g.lineTo(x + 32, y + 16); g.lineTo(x + 16, y + 32); g.lineTo(x, y + 16); g.fill();
        }
    }).tex;
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
    carpet.repeat.set(4, 3);
    mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }), 0, 0, 1, r).rotation.x = -Math.PI / 2;
    const top = this.ceiling;
    mesh(new THREE.PlaneGeometry(16, 12), std(0x110d17), 0, 5, 1, top).rotation.x = Math.PI / 2;

    // Industrial ceiling: dark beams and copper pipes.
    for (const x of [-6, -3, 3, 6]) mesh(new THREE.BoxGeometry(0.25, 0.35, 9), std(0x0e0c12), x, 4.82, -0.5, top);
    const copper = std(0xb8734a, { metalness: 0.7, roughness: 0.35, flatShading: false });
    [[-0.6, 4.45], [0.2, 4.55], [0.9, 4.4]].forEach(([z, y], i) => {
      mesh(new THREE.CylinderGeometry(0.07, 0.07, 16, 10), copper, 0, y, z - 3 + i * 1.6, top).rotation.z = Math.PI / 2;
    });

    // Neon strips along the walls.
    const pink = basic(C.pink), cyan = basic(C.cyan);
    mesh(new THREE.BoxGeometry(15.6, 0.06, 0.06), pink, 0, 4.6, -4.95, r);
    mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), cyan, -7.95, 4.6, 1, r);
    mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), cyan, 7.95, 4.6, 1, r);
    mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), pink, -7.95, 0.08, 1, r);
    mesh(new THREE.BoxGeometry(0.06, 0.06, 11.6), pink, 7.95, 0.08, 1, r);
    for (const x of [-6.2, -4.6, 4.6, 6.2]) mesh(new THREE.BoxGeometry(0.05, 3.6, 0.05), x < 0 ? cyan : pink, x, 2.6, -4.95, r);
  }

  private paintScreen(g: CanvasRenderingContext2D, w: number, h: number) {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#3a0d33');
    grd.addColorStop(1, '#071c27');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const { title, singers } = this.screenText ?? { title: null, singers: [] };
    g.textAlign = 'center';
    g.shadowColor = '#ff3fa4';
    g.shadowBlur = 30;
    g.fillStyle = '#ffd1e9';
    if (title) {
      g.font = '700 64px "Be Vietnam Pro", sans-serif';
      let t = title;
      while (g.measureText(t).width > 920 && t.length > 4) t = t.slice(0, -2);
      g.fillText(t === title ? t : t + '…', w / 2, 250);
    } else {
      g.font = '110px Bungee, Impact, sans-serif';
      g.fillText('CHIBI KTV', w / 2, 270);
    }
    g.shadowBlur = 0;
    g.font = '600 36px "Be Vietnam Pro", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.8)';
    const who = singers.length ? `🎤 ${singers.join(' & ')} ${singers.length > 1 ? 'song ca' : 'đang hát'}` : title ? 'Ai lên hát nào?' : 'Chờ bài hát đầu tiên…';
    g.fillText(who, w / 2, 350);
    // A still equalizer strip, in the room's two neon colors.
    const n = 32, bw = (w - 160) / n;
    for (let i = 0; i < n; i++) {
      const v = (Math.sin(i * 0.7) * 0.5 + 0.5) * (Math.sin(i * 0.31) * 0.4 + 0.6);
      g.fillStyle = i % 2 ? '#33e1ed' : '#ff3fa4';
      g.globalAlpha = 0.5;
      g.fillRect(80 + i * bw + 3, 530 - (16 + v * 90), bw - 6, 16 + v * 90);
    }
    g.globalAlpha = 1;
  }

  private tvWall() {
    const r = this.root;
    const gold = basic(C.gold);
    mesh(new THREE.BoxGeometry(5.8, 3.4, 0.16), std(0x050407), 0, 2.6, -4.9, r);
    [[0, 4.38], [0, 0.82]].forEach(([x, y]) => mesh(new THREE.BoxGeometry(5.9, 0.07, 0.06), gold, x, y, -4.88, r));
    [-2.95, 2.95].forEach((x) => mesh(new THREE.BoxGeometry(0.07, 3.56, 0.06), gold, x, 2.6, -4.88, r));
    mesh(new THREE.PlaneGeometry(5.5, 3.1), basic(0xffffff, { map: this.screen.tex }), 0, 2.6, -4.81, r);
    for (const x of [-3.7, 3.7]) {
      const g = new THREE.Group();
      g.position.set(x, 0, -4.4);
      r.add(g);
      mesh(new THREE.BoxGeometry(0.9, 2.6, 0.7), std(0x111015), 0, 1.3, 0, g);
      for (const y of [0.6, 1.3, 2.0]) {
        mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20), std(0x26232c, { metalness: 0.4 }), 0, y, 0.36, g).rotation.x = Math.PI / 2;
        mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14), std(0x050505), 0, y, 0.38, g).rotation.x = Math.PI / 2;
      }
    }
  }

  private stage() {
    const r = this.root;
    mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 40), std(0x141019, { roughness: 0.3, metalness: 0.3, flatShading: false }), STAGE.x, 0.15, STAGE.z, r);
    const ring = mesh(new THREE.TorusGeometry(1.52, 0.035, 8, 64), basic(C.pink), STAGE.x, 0.3, STAGE.z, r);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 2; i++) {
      const beam = mesh(new THREE.ConeGeometry(1.3, 4.6, 32, 1, true), glow(0xfff1d6, 0.07), STAGE.x, 2.6, STAGE.z, r);
      beam.visible = i === 0;
      this.beams.push(beam);
    }
    // Disco ball with faint colored beams.
    this.disco.position.set(0, 4.6, -0.3);
    r.add(this.disco);
    mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), std(0x222222), 0, 0.3, 0, this.disco);
    mesh(new THREE.IcosahedronGeometry(0.28, 1), std(0xe8e8f0, { metalness: 0.3, roughness: 0.2, emissive: 0x2a2a3a }), 0, 0, 0, this.disco);
    const beams = new THREE.Group();
    this.disco.add(beams);
    this.fancy.push(beams);
    [C.pink, C.cyan, C.gold, C.pink, C.cyan, 0x9b6bff].forEach((col, i) => {
      const b = mesh(new THREE.ConeGeometry(0.3, 3.5, 12, 1, true), glow(col, 0.035), 0, 0, 0, beams);
      b.geometry.translate(0, -1.75, 0);
      b.rotation.set(0.9 + (i % 2) * 0.4, (i * Math.PI) / 3, 0);
    });
    return ring;
  }

  /** RD-01..RD-03: signs, art, bulbs, fairy lights, plants, balloons, rug, fridge, truss lights. */
  private decorations() {
    const r = this.root;
    const pink = basic(C.pink), cyan = basic(C.cyan), gold = basic(C.gold);

    // "CHIBI KTV" neon sign (left wall) and "Hát hết mình" script (right wall).
    const sign = canvasTexture(1024, 256, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '120px Bungee, Impact, sans-serif';
      g.shadowColor = '#ff3fa4'; g.shadowBlur = 40; g.fillStyle = '#ffd1e9'; g.fillText('CHIBI', w * 0.35, h / 2);
      g.shadowColor = '#33e1ed'; g.fillStyle = '#d4fbff'; g.fillText('KTV', w * 0.76, h / 2);
    });
    whenFont('120px Bungee', sign.redraw);
    mesh(new THREE.PlaneGeometry(4.4, 1.1), basic(0xffffff, { map: sign.tex, transparent: true }), -7.9, 3.4, -0.5, r).rotation.y = Math.PI / 2;
    const script = canvasTexture(1024, 256, (g) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 700 104px "Be Vietnam Pro", sans-serif';
      g.shadowColor = '#33e1ed'; g.shadowBlur = 36; g.fillStyle = '#d4fbff'; g.fillText('Hát hết mình', 512, 120);
      g.shadowColor = '#ff3fa4'; g.shadowBlur = 20; g.strokeStyle = '#ffb3da'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(170, 200); g.quadraticCurveTo(512, 250, 854, 200); g.stroke();
    });
    whenFont('italic 700 104px "Be Vietnam Pro"', script.redraw);
    mesh(new THREE.PlaneGeometry(4.2, 1.05), basic(0xffffff, { map: script.tex, transparent: true }), 7.9, 3.5, -0.3, r).rotation.y = -Math.PI / 2;

    // Neon music notes beside the TV.
    [['♫', '#ff3fa4', '#ffd1e9', -5.4], ['♪', '#33e1ed', '#d4fbff', 5.4]].forEach(([ch, shadow, fill, x]) => {
      const t = canvasTexture(256, 256, (g) => {
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '190px serif';
        g.shadowColor = shadow as string; g.shadowBlur = 26; g.fillStyle = fill as string; g.fillText(ch as string, 128, 136);
      });
      mesh(new THREE.PlaneGeometry(1.1, 1.1), basic(0xffffff, { map: t.tex, transparent: true, depthWrite: false }), x as number, 3.3, -4.93, r);
    });

    // Two framed neon artworks on the side walls (made up, no real brands: RD-02).
    const art = (x: number, z: number, rotY: number, frame: THREE.Material, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
      const g = new THREE.Group();
      g.position.set(x, 2.5, z);
      g.rotation.y = rotY;
      r.add(g);
      mesh(new THREE.PlaneGeometry(1.3, 1.62), basic(0xffffff, { map: canvasTexture(256, 320, draw).tex }), 0, 0, 0.01, g);
      [0.83, -0.83].forEach((y) => mesh(new THREE.BoxGeometry(1.36, 0.04, 0.04), frame, 0, y, 0, g));
      [-0.68, 0.68].forEach((x2) => mesh(new THREE.BoxGeometry(0.04, 1.7, 0.04), frame, x2, 0, 0, g));
    };
    art(-7.92, 3.1, Math.PI / 2, pink, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a0f3d'); gr.addColorStop(1, '#0b2230');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff3fa4'; g.lineWidth = 10; g.shadowColor = '#ff3fa4'; g.shadowBlur = 18;
      g.beginPath(); g.arc(128, 120, 52, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(128, 172); g.lineTo(128, 260); g.stroke();
      g.beginPath(); g.moveTo(88, 262); g.lineTo(168, 262); g.stroke();
      g.strokeStyle = '#33e1ed'; g.lineWidth = 4;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(98, 120 + i * 14); g.lineTo(158, 120 + i * 14); g.stroke(); }
    });
    art(7.92, 3.1, -Math.PI / 2, cyan, (g, w, h) => {
      g.fillStyle = '#120b1c'; g.fillRect(0, 0, w, h);
      for (let rr = 110; rr > 16; rr -= 9) {
        g.strokeStyle = rr % 2 ? 'rgba(51,225,237,.55)' : 'rgba(255,255,255,.12)'; g.lineWidth = 3;
        g.beginPath(); g.arc(128, 150, rr, 0, 7); g.stroke();
      }
      g.fillStyle = '#f2c14e'; g.shadowColor = '#f2c14e'; g.shadowBlur = 14; g.beginPath(); g.arc(128, 150, 22, 0, 7); g.fill();
      g.font = '700 30px "Be Vietnam Pro", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ff9ec4'; g.shadowColor = '#ff3fa4';
      g.fillText('VINYL NIGHT', 128, 300);
    });

    // Edison bulbs hanging from the pipes, above the sofas (never between a seat and the stage).
    const bulbMat = basic(0xffc46b), wire = std(0x111111), cap = std(0x3a2a1a, { metalness: 0.6 });
    [[-3, 2.6, 0.9], [-1.5, 2.2, 0.6], [1.5, 2.2, 0.7], [3, 2.6, 0.9], [-4.6, -0.6, 0.8], [4.6, -0.6, 0.8], [-4.6, 1.8, 0.6], [4.6, 1.8, 0.6]].forEach(
      ([x, z, len]) => {
        mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 4), wire, x, 4.95 - len / 2, z, r);
        mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), cap, x, 4.95 - len, z, r);
        mesh(new THREE.SphereGeometry(0.085, 12, 10), bulbMat, x, 4.95 - len - 0.1, z, r).scale.y = 1.3;
      },
    );

    // Fairy lights along the walls: one instanced mesh, so 130 bulbs cost one draw call.
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 56; i++) pts.push([-7.6 + (i * 15.2) / 56, 4.25 - Math.abs(Math.sin((i / 56) * Math.PI * 6)) * 0.22, -4.9]);
    for (const x of [-7.9, 7.9]) for (let i = 0; i <= 34; i++) pts.push([x, 4.25 - Math.abs(Math.sin((i / 34) * Math.PI * 4)) * 0.2, -4.6 + (i * 9) / 34]);
    const fairy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial(), pts.length);
    const d = new THREE.Object3D(), col = new THREE.Color();
    pts.forEach((p, i) => {
      d.position.set(...p);
      d.updateMatrix();
      fairy.setMatrixAt(i, d.matrix);
      fairy.setColorAt(i, col.setHex([C.gold, C.pink, C.cyan, 0xffffff][i % 4]));
    });
    this.add(fairy, true);

    // Potted plants in the corners.
    const plant = (x: number, z: number, s = 1) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      r.add(g);
      mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.55, 12), std(0x2a2430, { roughness: 0.6 }), 0, 0.275, 0, g);
      mesh(new THREE.TorusGeometry(0.31, 0.025, 6, 20), gold, 0, 0.55, 0, g).rotation.x = Math.PI / 2;
      const leafA = std(0x2f8f4e), leafB = std(0x3fae5f), leaf = new THREE.SphereGeometry(0.22, 8, 6);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, tilt = 0.5 + (i % 3) * 0.25;
        const l = mesh(leaf, i % 2 ? leafA : leafB, Math.cos(a) * 0.25, 0.95 + (i % 3) * 0.18, Math.sin(a) * 0.25, g);
        l.scale.set(0.45, 1.5, 0.12);
        l.rotation.set(Math.sin(a) * tilt, -a, -Math.cos(a) * tilt);
      }
    };
    plant(-6.9, -4.3, 1.15); plant(6.9, -4.3, 1.15); plant(-7.1, 6.2); plant(7.1, 6.2);

    // Balloon bunches beside the stage, bobbing gently.
    const string = basic(0xdddddd);
    for (const bx of [-2.15, 2.15]) {
      ([[0, 0, C.gold], [0.28, 0.18, C.pink], [-0.25, 0.22, C.cyan], [0.05, 0.42, C.pink]] as const).forEach(([dx, dy, c], i) => {
        const g = new THREE.Group();
        g.position.set(bx + dx, 1.9 + dy, -2.6 + (i % 2) * 0.15);
        this.add(g, true);
        mesh(new THREE.SphereGeometry(0.22, 14, 12), std(c, { metalness: 0.55, roughness: 0.25, flatShading: false }), 0, 0, 0, g).scale.y = 1.18;
        mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.6 + dy, 4), string, 0, -(1.6 + dy) / 2 - 0.25, 0, g);
        this.balloons.push({ g, base: g.position.y, ph: Math.random() * 6 });
      });
    }

    // Round rug under the table.
    const rug = canvasTexture(512, 512, (g) => {
      g.fillStyle = '#24142f'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
      ([[240, '#ff3fa4'], [200, '#33e1ed'], [150, '#f2c14e']] as const).forEach(([rr, c]) => {
        g.strokeStyle = c; g.globalAlpha = 0.35; g.lineWidth = 6; g.beginPath(); g.arc(256, 256, rr, 0, 7); g.stroke();
      });
    });
    mesh(new THREE.CircleGeometry(2.7, 48), new THREE.MeshStandardMaterial({ map: rug.tex, transparent: true, roughness: 1 }), 0, 0.006, 1.3, r).rotation.x = -Math.PI / 2;

    // Glowing drinks fridge, back left.
    const fridge = new THREE.Group();
    fridge.position.set(-6.4, 0, -2.2);
    fridge.rotation.y = Math.PI / 2;
    r.add(fridge);
    mesh(new THREE.BoxGeometry(0.9, 1.8, 0.7), std(0x15121b, { roughness: 0.4, metalness: 0.3 }), 0, 0.9, 0, fridge);
    mesh(new THREE.PlaneGeometry(0.74, 1.5), basic(0x1f6f7a, { transparent: true, opacity: 0.85 }), 0, 0.95, 0.351, fridge);
    const can = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8);
    const canMats = [0x7ee081, 0xff9ec4, 0xffd166, 0xd4fbff].map((c) => basic(c));
    for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) mesh(can, canMats[(row + c) % 4], -0.24 + c * 0.16, 0.42 + row * 0.34, 0.25, fridge);
    mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), cyan, 0, 1.83, 0.33, fridge);

    // Two truss towers beside the stage with moving-head lights.
    const metal = std(0x9aa0a8, { metalness: 0.8, roughness: 0.3 });
    [-2.3, 2.3].forEach((x, i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, -3.9);
      r.add(g);
      [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].forEach(([a, b]) => mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.2, 6), metal, a, 1.6, b, g));
      for (let y = 0.2; y < 3.2; y += 0.4) {
        mesh(new THREE.BoxGeometry(0.26, 0.02, 0.02), metal, 0, y, -0.12, g).rotation.z = 0.7;
        mesh(new THREE.BoxGeometry(0.26, 0.02, 0.02), metal, 0, y, 0.12, g).rotation.z = -0.7;
      }
      const head = new THREE.Group();
      head.position.set(0, 3.3, 0);
      g.add(head);
      mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), std(0x111111), 0, 0, 0, head);
      const cone = mesh(new THREE.ConeGeometry(0.45, 3.4, 16, 1, true), glow(i ? C.cyan : C.pink, 0.07), 0, 0, 0, head);
      cone.geometry.translate(0, -1.7, 0);
      this.fancy.push(cone);
      this.heads.push({ head, ph: i * Math.PI });
    });
  }

  /** The wine-velvet U-sofa, the table, and bar stools for rooms of 16. */
  private furniture() {
    const r = this.root;
    const gold = basic(C.gold);
    const velvet = std(C.wine, { roughness: 0.9 });
    const sofa = (len: number, x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      r.add(g);
      mesh(new THREE.BoxGeometry(len, 0.45, 0.95), velvet, 0, 0.225, 0, g);
      mesh(new THREE.BoxGeometry(len, 0.9, 0.28), velvet, 0, 0.6, 0.46, g);
      mesh(new THREE.BoxGeometry(len, 0.03, 0.03), gold, 0, 1.06, 0.33, g);
      mesh(new THREE.BoxGeometry(len, 0.03, 0.03), gold, 0, 0.46, -0.48, g);
    };
    sofa(7.6, 0, 3.4, 0);
    sofa(3.4, -4.6, 1.2, -Math.PI / 2);
    sofa(3.4, 4.6, 1.2, Math.PI / 2);

    const table = new THREE.Group();
    table.position.set(0, 0, 1.25);
    r.add(table);
    mesh(new THREE.BoxGeometry(3.4, 0.4, 1.4), std(0x0f0c14, { roughness: 0.25, metalness: 0.3, flatShading: false }), 0, 0.2, 0, table);
    ([[0, 0.71, 3.44, 0.03], [0, -0.71, 3.44, 0.03]] as const).forEach(([x, z, a, c]) => mesh(new THREE.BoxGeometry(a, 0.03, c), gold, x, 0.41, z, table));
    [1.71, -1.71].forEach((x) => mesh(new THREE.BoxGeometry(0.03, 0.03, 1.44), gold, x, 0.41, 0, table));
    mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.06, 24), std(0xf4f0ea), -0.4, 0.45, 0, table);
    const fruit = new THREE.SphereGeometry(0.09, 10, 8);
    ([[0xff6b3d, -0.55, 0.05], [0x7ccf4b, -0.3, -0.12], [0xf7d33a, -0.38, 0.15], [0xd93a5a, -0.2, 0.08], [0x7ccf4b, -0.52, -0.15]] as const).forEach(([c, x, z]) =>
      mesh(fruit, std(c), x, 0.53, z, table),
    );
    const canGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12);
    [[0.5, 0.2], [0.68, -0.15], [0.88, 0.25], [1.1, -0.05], [-1.2, 0.25]].forEach(([x, z], i) =>
      mesh(canGeo, std(i % 2 ? 0x1f7a3a : 0xcfd3d6, { metalness: 0.6, roughness: 0.4 }), x, 0.51, z, table),
    );
    // The song tablet on the table.
    mesh(new THREE.BoxGeometry(0.6, 0.03, 0.42), std(0x0a0a0a, { roughness: 0.2 }), 1.2, 0.43, 0.3, table);
    mesh(new THREE.PlaneGeometry(0.54, 0.36), basic(0x2b6b8a), 1.2, 0.447, 0.3, table).rotation.x = -Math.PI / 2;

    // Bar stools and a narrow bar ledge behind the sofa (seats 8–15).
    const seatTop = std(0x6e1a37, { roughness: 0.9 }), leg = std(0x2a2430, { metalness: 0.6 });
    const top = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16), pole = new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6);
    for (const s of SEATS.filter((x) => x.kind === 'stool')) {
      mesh(pole, leg, s.x, 0.28, s.z, this.stools);
      mesh(top, seatTop, s.x, 0.58, s.z, this.stools);
    }
    mesh(new THREE.BoxGeometry(8.2, 0.06, 0.3), std(0x0f0c14, { roughness: 0.3 }), 0, 1.0, 5.45, this.stools);
    mesh(new THREE.BoxGeometry(8.2, 0.03, 0.03), gold, 0, 1.03, 5.3, this.stools);
  }
}
