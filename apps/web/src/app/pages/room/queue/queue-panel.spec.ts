import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EMPTY_PLAYBACK, type QueueState, type SkipState } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';
import { formatLeft, QueuePanel } from './queue-panel';

const song = (n: number) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec: 200 });
const entry = (n: number, singerId: string, singerName: string) => ({ id: `e${n}`, song: song(n), singerId, singerName, addedAtMs: n });

function setup(queue: QueueState, meId = 'me', members = 3) {
  const rt = {
    queue: signal<QueueState | null>(queue),
    skip: signal<SkipState | null>({ have: 1, needed: 2, voterNames: ['Khoa'], rev: 1 }),
    playback: signal({ ...EMPTY_PLAYBACK, paused: false }),
    members: signal(Array.from({ length: members }, (_, i) => ({ userId: `u${i}`, displayName: `U${i}`, away: false }))),
    serverNow: () => 1_000_000,
    addToQueue: async () => ({ ok: true }),
    removeFromQueue: async () => ({ ok: true }),
    voteSkip: async () => ({ ok: true }),
  };
  TestBed.configureTestingModule({
    imports: [QueuePanel],
    providers: [
      { provide: RealtimeService, useValue: rt },
      { provide: AuthService, useValue: { user: signal({ id: meId, displayName: 'Tôi', email: 'x@y.z' }) } },
    ],
  });
  const f = TestBed.createComponent(QueuePanel);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

const turn = (singerId: string, singerName: string) => ({
  entry: entry(0, singerId, singerName),
  startedAtServerMs: 1_000_000,
  endsAtServerMs: 1_000_000 + 125_000,
  singerAwayUntilMs: null,
  kept: false,
});

describe('QueuePanel', () => {
  it('shows the current song with its time left, then the order with singer names', () => {
    const el = setup({ current: turn('u1', 'Tuấn'), entries: [entry(1, 'me', 'Tôi'), entry(2, 'u1', 'Tuấn')], rev: 1 });
    expect(el.querySelector('.now .title')?.textContent).toBe('Bài 0');
    expect(el.querySelector('.who')?.textContent).toContain('còn 2:05');
    const rows = [...el.querySelectorAll('.list li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Bài 1');
    expect(rows[1]).toContain('Tuấn');
  });

  it('puts a remove button only on my own entries', () => {
    const el = setup({ current: null, entries: [entry(1, 'me', 'Tôi'), entry(2, 'u1', 'Tuấn')], rev: 1 });
    const li = el.querySelectorAll('.list li');
    expect(li[0].querySelector('.x')).not.toBeNull();
    expect(li[1].querySelector('.x')).toBeNull();
  });

  it('offers vote-skip to listeners but not to the singer', () => {
    expect(setup({ current: turn('u1', 'Tuấn'), entries: [], rev: 1 }).querySelector('.skip')?.textContent).toContain('(1/2)');
    TestBed.resetTestingModule();
    expect(setup({ current: turn('me', 'Tôi'), entries: [], rev: 1 }).querySelector('.skip')).toBeNull();
  });

  it('says what to do when the room is idle', () => {
    expect(setup({ current: null, entries: [], rev: 0 }).querySelector('.idle')?.textContent).toContain('Chưa có bài');
  });

  it('formats countdowns', () => {
    expect(formatLeft(125_000)).toBe('2:05');
    expect(formatLeft(-5)).toBe('0:00');
    expect(formatLeft(999)).toBe('0:01');
  });
});
