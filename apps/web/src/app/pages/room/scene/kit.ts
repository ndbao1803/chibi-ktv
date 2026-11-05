import * as THREE from 'three';

/** Small helpers shared by the room, the chibis and the seats. Plain Three.js, no Angular. */
export const C = { pink: 0xff3fa4, cyan: 0x33e1ed, gold: 0xf2c14e, wine: 0x6e1a37 } as const;

export const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mesh<G extends THREE.BufferGeometry, M extends THREE.Material>(geo: G, mat: M, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const m = new THREE.Mesh<G, M>(geo, mat);
  m.position.set(x, y, z);
  parent?.add(m);
  return m;
}

export const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });

export const basic = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

/** Glow-like see-through material (spotlight beams, light cones). */
export const glow = (color: number, opacity: number) =>
  basic(color, { transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

/** A texture drawn with the 2D canvas API; `redraw` paints it again later (fonts loaded, text changed). */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const redraw = () => {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    tex.needsUpdate = true;
  };
  redraw();
  return { tex, g, redraw };
}

/** Redraws once a web font is ready (the canvas cannot wait for CSS fonts by itself). */
export function whenFont(font: string, redraw: () => void) {
  document.fonts?.load(font).then(redraw).catch(() => {});
}

/** A rounded label that always faces the camera (names, "free seat"). */
export function label(text: string, style: 'me' | 'other' | 'hint' = 'other') {
  const W = text.length > 12 ? 512 : 256;
  const { tex, redraw } = canvasTexture(W, 64, (g, w) => {
    g.font = '600 30px "Be Vietnam Pro", sans-serif';
    const tw = Math.min(w - 6, g.measureText(text).width + 28);
    g.fillStyle = style === 'me' ? 'rgba(242,193,78,.95)' : style === 'hint' ? 'rgba(10,40,48,.8)' : 'rgba(20,14,30,.85)';
    g.beginPath();
    g.roundRect((w - tw) / 2, 8, tw, 48, 24);
    g.fill();
    g.fillStyle = style === 'me' ? '#241a05' : style === 'hint' ? '#bff7fc' : '#f4effa';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, 33);
  });
  whenFont('600 30px "Be Vietnam Pro"', redraw);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set((0.9 * W) / 256, 0.225, 1);
  sprite.renderOrder = 10;
  sprite.userData['baseScale'] = sprite.scale.clone();
  return sprite;
}

/** Frees every geometry, material and texture under `root`. */
export function disposeTree(root: THREE.Object3D, keep: ReadonlySet<THREE.BufferGeometry> = new Set()) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
