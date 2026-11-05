/**
 * Where the 16 seats are and how a chibi walks between them (R-12). Pure math, no Three.js,
 * so it is unit-tested. Numbering matches `packages/shared/src/seats.ts`.
 *
 * Floor plan, seen from above (the stage and TV are at the top, z = -3):
 *
 *            [ TV ]        [ stage ]
 *    5/6  left sofa   [table]   right sofa 4/7
 *          0  1  2  3   back sofa
 *       8  9 10 11 12 13 14 15  bar stools (rooms of 16)
 */
export interface Pt {
  x: number;
  z: number;
}
export interface SeatSpot extends Pt {
  /** Facing angle (radians around Y); 0 looks toward +z. */
  rot: number;
  /** Height of the chibi's root when sitting here. */
  y: number;
  kind: 'sofa' | 'stool';
}

const BACK = Math.PI; // facing the stage (−z)
export const SEATS: SeatSpot[] = [
  { x: -2.85, z: 3.25, rot: BACK, y: 0.15, kind: 'sofa' },
  { x: -0.95, z: 3.25, rot: BACK, y: 0.15, kind: 'sofa' },
  { x: 0.95, z: 3.25, rot: BACK, y: 0.15, kind: 'sofa' },
  { x: 2.85, z: 3.25, rot: BACK, y: 0.15, kind: 'sofa' },
  { x: 4.45, z: 0.4, rot: -Math.PI / 2, y: 0.15, kind: 'sofa' },
  { x: -4.45, z: 2.0, rot: Math.PI / 2, y: 0.15, kind: 'sofa' },
  { x: -4.45, z: 0.4, rot: Math.PI / 2, y: 0.15, kind: 'sofa' },
  { x: 4.45, z: 2.0, rot: -Math.PI / 2, y: 0.15, kind: 'sofa' },
  ...[-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5].map((x) => ({ x, z: 4.75, rot: BACK, y: 0.42, kind: 'stool' as const })),
];

/** The stage, its standing spots for one or two singers, and the step in front of it. */
export const STAGE = { x: 0, y: 0.3, z: -3.1 };
export const STAGE_FRONT: Pt = { x: 0, z: -1.25 };
export function stageSlot(index: number, singers: number): Pt & { rot: number } {
  if (singers < 2) return { x: STAGE.x, z: STAGE.z, rot: 0 };
  const left = index === 0;
  return { x: STAGE.x + (left ? -0.62 : 0.62), z: STAGE.z, rot: left ? 0.22 : -0.22 };
}

type Side = 'left' | 'right' | 'back';
const CORNER: Record<'left' | 'right', Pt> = { left: { x: -3.7, z: 2.5 }, right: { x: 3.7, z: 2.5 } };

/** Which side of the U-sofa you are on; stools exit through the nearer corner. */
function sideOf(seat: number): Side {
  const s = SEATS[seat];
  if (s.kind === 'stool') return s.x < 0 ? 'left' : 'right';
  return s.z > 3 ? 'back' : s.x < 0 ? 'left' : 'right';
}

/** From the seat to the walking lane inside the U (the stools go round the sofa's end). */
function exitPath(seat: number): Pt[] {
  const s = SEATS[seat];
  if (s.kind === 'stool') {
    const sx = s.x < 0 ? -1 : 1;
    return [{ x: sx * 4.35, z: 4.75 }, { x: sx * 4.35, z: 3.35 }, CORNER[sx < 0 ? 'left' : 'right']];
  }
  return [{ x: s.x + Math.sin(s.rot) * 0.75, z: s.z + Math.cos(s.rot) * 0.75 }];
}

/** Lane points to get from one side of the U to the other (the table sits in the middle). */
function lane(a: Side, b: Side): Pt[] {
  if (a === b) return [];
  if (a === 'back') return [CORNER[b as 'left' | 'right']];
  if (b === 'back') return [CORNER[a]];
  return [CORNER[a], CORNER[b]];
}

/** Every point a chibi walks through to move seats, ending on the new seat. */
export function seatRoute(from: number, to: number): Pt[] {
  if (from === to) return [];
  const pts = [...exitPath(from), ...lane(sideOf(from), sideOf(to)), ...exitPath(to).reverse(), { x: SEATS[to].x, z: SEATS[to].z }];
  return dedupe(pts);
}

/** From a seat up to the stage (S-01). The reverse is the way back. */
export function stageRoute(from: number, slot: Pt): Pt[] {
  const side = sideOf(from);
  const goLeft = side === 'left' || (side === 'back' && SEATS[from].x < 0);
  const corner = CORNER[goLeft ? 'left' : 'right'];
  const pts = [...exitPath(from)];
  if (side === 'back') pts.push(corner);
  pts.push({ x: corner.x * 0.66, z: -0.4 }, STAGE_FRONT, slot);
  return dedupe(pts);
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.01);
}

/** The furniture a path must never cross (axis-aligned boxes on the floor, x/z ranges). */
export const OBSTACLES: { x: [number, number]; z: [number, number] }[] = [
  { x: [-1.7, 1.7], z: [0.55, 1.95] }, // table
  { x: [-3.8, 3.8], z: [2.95, 3.85] }, // back sofa body (seat edge to backrest), excluding the seat lane
  { x: [-5.05, -4.15], z: [-0.5, 2.9] }, // left sofa body
  { x: [4.15, 5.05], z: [-0.5, 2.9] }, // right sofa body
];
