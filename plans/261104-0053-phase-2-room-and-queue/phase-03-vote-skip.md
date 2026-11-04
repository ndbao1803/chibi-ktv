# Phase 03 — Vote-skip

## Context Links

- [plan.md](plan.md) · [phase-01](phase-01-shared-contracts-and-pure-rules.md) · [phase-02](phase-02-server-queue-and-turns.md)
- Requirements: **Q-07** "Vote-skip when at least 50% of non-singing members vote" — a **Must** in
  version 1 because there is no host (requirements §2: "Skipping a song needs a vote (Q-07 becomes M)").
- Pure-rule home: `packages/shared/src/skip.ts` (`skipDecision`, `SKIP_RATIO`)

## Overview

- **Priority:** P1
- **Status:** done (4 Nov 2026)
- Anyone except the current singer may vote to skip the song playing now. When half of the
  non-singing members have voted, the server ends the turn and advances the queue. Votes belong to
  one turn and are thrown away when it changes.

## Key Insights

- The threshold must be re-evaluated when **presence** changes, not only when a vote arrives: if
  four people voted out of eight and three leave, the vote now passes. The 1 s tick recomputes it,
  so no extra wiring is needed.
- The singer's own wish to stop is not a vote — it is `stage:leave` ("Xuống sân khấu" / "Bỏ qua bài
  của mình"), which ends their turn immediately. Keeping these separate avoids a confusing
  "the singer voted to skip himself" state.
- A vote is a toggle so people can take it back; the panel shows `have/needed` and who voted, which
  is half the fun.
- **Decided:** the threshold is plain 50% of non-singers with **no minimum-vote floor**, so in a room
  of two the single listener skips alone. `needed = max(1, ceil(eligible / 2))` is the whole rule —
  no `MIN_SKIP_VOTES`, no small-room branch.
- **Decided:** away members (phase 05) count as eligible for their 20 s grace — they keep their seat,
  so they keep their say.

## Requirements

Functional

1. `skip:vote { vote: boolean }` — add or remove the caller's vote for the current turn.
   Refuse with Vietnamese messages when: no turn is running (`'Chưa có bài nào đang phát'`), the
   caller is the current singer (`'Ca sĩ dùng “Xuống sân khấu” để bỏ bài của mình'`), or there is no
   one eligible (`'Cần ít nhất một người khác trong phòng'`).
2. After every vote and on every tick, evaluate `skipDecision(voters, memberIds, singerId)` with
   `needed = max(1, ceil(eligible / 2))` — no minimum-vote floor, and `memberIds` includes away
   members. When it passes: end the turn, advance the queue, broadcast a notice
   `'Cả phòng đã bỏ qua bài “<title>”'`.
3. `skip:state { have, needed, voterNames, rev }` is broadcast on every change and included in
   `JoinAck`.
4. Votes are cleared when the turn changes, when the song changes, and when a voter leaves the room
   for good.
5. Leaving the stage or a server-decided end also clears votes (same code path: `advance()`).

Non-functional

- Delivered within 200 ms p95 (N-04) — in-memory tally plus one broadcast.

## Architecture

```
rooms/room-skip.ts   NEW  class SkipVotes { private voters = new Set<string>()
                            toggle(userId, vote): void
                            drop(userId): void
                            clear(): void
                            state(memberIds, singerId, names, rev): SkipState }
```

`RoomState` owns one `SkipVotes`; `vote(userId, vote)` returns `Effects`:

```
vote(userId, v, now):
  guard: turn running, userId !== singerId, eligible > 0
  votes.toggle(userId, v)
  d = skipDecision(votes.ids, this.memberIds, stage.singerId)
  if (d.skip) return { ...this.advance(now), notice: `Cả phòng đã bỏ qua bài “${title}”` }
  return { skip: true }
```

`tick(now)` calls the same `skipDecision` so presence changes can tip it over.

## Related Code Files

Create

- `apps/server/src/rooms/room-skip.ts`
- `apps/server/src/rooms/room-skip.spec.ts`

Modify

- `apps/server/src/rooms/room-state.ts` — compose `SkipVotes`, add `vote()`, clear in `advance()`,
  evaluate in `tick()`, drop a leaver's vote.
- `apps/server/src/rooms/rooms.gateway.ts` — `skip:vote` handler (Zod → delegate → ack).
- `apps/server/src/rooms/room-live.service.ts` — `emitSkip`.
- `apps/server/test/queue.e2e-spec.ts` — vote-skip scenario (created in phase 07, extended here).

## Implementation Steps

1. `room-skip.ts` with the four methods above; no clock, no I/O.
2. `RoomState.vote(userId, vote, now)` with the three guards, returning `Effects`.
3. Clear votes inside `advance()` (single place) and on full member removal.
4. `tick()`: if a turn is running and `skipDecision` passes, advance and set the notice.
5. Gateway handler + `emitSkip` in `RoomLiveService.apply`.
6. Tests — `room-skip.spec.ts`: thresholds for 1/2/3/8 members, singer's vote ignored, toggle off.
   `room-state.spec.ts`: 4 of 8 vote → next song starts; 3 of 8 vote then 3 people leave → the tick
   advances it; a vote on an idle room is refused.

## Todo List

- [x] `room-skip.ts` + spec green
- [x] `RoomState.vote()` with the three Vietnamese guards
- [x] Votes cleared on turn change, song change and full leave
- [x] Tick re-evaluates after presence changes
- [x] `skip:state` broadcast + in `JoinAck`
- [x] e2e: two members, one votes, song advances (needed = 1)

## Success Criteria

- Room of 8 with 1 singer: 4 votes advance the queue, 3 do not.
- Room of 2: the listener's single vote advances it (needed = 1), as decided.
- The singer voting is refused with the "Xuống sân khấu" hint.
- `skip:state` always shows `have ≤ needed` and names only current members.

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| A small room makes skipping too easy (1 vote in a room of 2) | Accepted by decision — it is a room of friends; if it ever annoys, a `MIN_SKIP_VOTES` constant in `skip.ts` is a one-line change |
| Skip-spam (vote, unvote, vote) floods broadcasts | Only broadcast when the tally actually changes (`SkipVotes.toggle` returns whether it did) |
| A vote survives into the next song and skips it instantly | Votes cleared inside `advance()`, which every path goes through; covered by a test |

## Security Considerations

- Membership is re-checked per event; a non-member cannot vote.
- Only the caller's own id is ever added as a voter — no `userId` in the payload.
- `voterNames` come from server presence, so a client cannot inject display text.

## Next Steps

- Phase 05 reuses the skip path for "the singer is away" (vote-skip stays available while a song is
  kept; with the stage empty, *everyone* present is eligible).
- Phase 06 renders the "Bỏ qua (have/needed)" button and the voter list.
