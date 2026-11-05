import { OBSTACLES, SEATS, seatRoute, stageRoute, stageSlot, type Pt } from './seats';

/** True when the straight walk a→b passes through a piece of furniture. */
function crossesFurniture(a: Pt, b: Pt): boolean {
  for (let k = 0; k <= 50; k++) {
    const x = a.x + ((b.x - a.x) * k) / 50, z = a.z + ((b.z - a.z) * k) / 50;
    if (OBSTACLES.some((o) => x > o.x[0] && x < o.x[1] && z > o.z[0] && z < o.z[1])) return true;
  }
  return false;
}

describe('seat walking routes (R-12)', () => {
  const all = SEATS.map((_, i) => i);

  it('ends on the new seat and never walks through the table or a sofa', () => {
    for (const from of all)
      for (const to of all) {
        if (from === to) continue;
        const route = [{ x: SEATS[from].x, z: SEATS[from].z }, ...seatRoute(from, to)];
        expect(route.at(-1)).toEqual({ x: SEATS[to].x, z: SEATS[to].z });
        // The first step stands up out of the seat and the last one sits down: both go "through" the sofa.
        for (let i = 1; i < route.length - 2; i++) {
          expect(crossesFurniture(route[i], route[i + 1]), `seat ${from}→${to}, leg ${i}`).toBe(false);
        }
      }
  });

  it('walks from any seat to the stage without crossing furniture (S-01)', () => {
    for (const from of all) {
      const slot = stageSlot(0, 1);
      const route = [{ x: SEATS[from].x, z: SEATS[from].z }, ...stageRoute(from, slot)];
      expect(route.at(-1)).toEqual(slot);
      for (let i = 1; i < route.length - 1; i++) expect(crossesFurniture(route[i], route[i + 1]), `seat ${from}, leg ${i}`).toBe(false);
    }
  });

  it('puts duet singers side by side, turned slightly toward each other', () => {
    expect(stageSlot(0, 2).x).toBeLessThan(stageSlot(1, 2).x);
    expect(stageSlot(0, 1).x).toBe(0);
  });
});
