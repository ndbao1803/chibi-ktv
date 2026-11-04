import { skipDecision } from '@ktv/shared';
import { SkipVotes } from './room-skip.js';

const room = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);

describe('SkipVotes + skipDecision', () => {
  it('needs half of the non-singers, rounded up, at least 1', () => {
    // 8 members, u1 sings: 7 eligible → 4 needed
    expect(skipDecision(['u2', 'u3', 'u4'], room(8), 'u1')).toEqual({ have: 3, needed: 4, skip: false });
    expect(skipDecision(['u2', 'u3', 'u4', 'u5'], room(8), 'u1')).toEqual({ have: 4, needed: 4, skip: true });
    // room of 2: the one listener skips alone (decided)
    expect(skipDecision(['u2'], room(2), 'u1')).toEqual({ have: 1, needed: 1, skip: true });
    // 3 members: 2 eligible → 1 needed
    expect(skipDecision(['u3'], room(3), 'u1').skip).toBe(true);
    // only the singer is here: nobody can skip
    expect(skipDecision([], room(1), 'u1')).toEqual({ have: 0, needed: 1, skip: false });
  });

  it("ignores the singer's vote and votes from people who left", () => {
    expect(skipDecision(['u1', 'u9'], room(4), 'u1')).toEqual({ have: 0, needed: 2, skip: false });
  });

  it('toggles: a vote can be taken back; repeating a vote changes nothing', () => {
    const v = new SkipVotes();
    expect(v.toggle('u2', true)).toBe(true);
    expect(v.toggle('u2', true)).toBe(false);
    expect(v.ids).toEqual(['u2']);
    expect(v.toggle('u2', false)).toBe(true);
    expect(v.ids).toEqual([]);
  });

  it('drop and clear report whether anything changed', () => {
    const v = new SkipVotes();
    v.toggle('u2', true);
    expect(v.drop('u3')).toBe(false);
    expect(v.drop('u2')).toBe(true);
    expect(v.clear()).toBe(false);
    v.toggle('u4', true);
    expect(v.clear()).toBe(true);
  });
});
