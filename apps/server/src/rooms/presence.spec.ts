import { Presence } from './presence.js';

describe('Presence', () => {
  it('counts a person with two tabs once, and removes them only when both close', () => {
    const p = new Presence();
    p.add('ABC123', 'u1', 'Tuấn', 's1');
    p.add('ABC123', 'u1', 'Tuấn', 's2');
    p.add('ABC123', 'u2', 'Thảo Vy', 's3');
    expect(p.count('ABC123')).toBe(2);
    expect(p.remove('ABC123', 'u1', 's1')).toBe(false);
    expect(p.remove('ABC123', 'u1', 's2')).toBe(true);
    expect(p.list('ABC123')).toEqual([{ userId: 'u2', displayName: 'Thảo Vy' }]);
  });
});
