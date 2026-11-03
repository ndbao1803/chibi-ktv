# Phase 01 — Shared contracts and pure rules

## Context Links

- [plan.md](plan.md)
- Existing contract: `E:\Work\chibi-ktv\packages\shared\src\index.ts`
- Existing pure-rule style: `E:\Work\chibi-ktv\apps\web\src\app\pages\room\sync\sync-math.ts`
- Existing shared tests: `E:\Work\chibi-ktv\packages\shared\test\shared.test.mjs` (node:test over `dist/`)
- Requirements: Q-03 (entry = song + singer), Q-05 (round-robin), Q-06 (remove own), Q-07 (vote-skip),
  Y-11 (server decides song end), N-12 (reconnect keeps seat)

## Overview

- **Priority:** P1 — everything else imports from here.
- **Status:** pending
- One place for the new socket contract (Zod + event names + state shapes) and the three pure rules
  Phase 2 needs: queue ordering, when a song ends, and when a skip passes. Server and browser both
  import them, so the rules cannot drift.

## Key Insights

- `packages/shared/src/index.ts` is already 199 lines; the repo rule is ≤200 per file. Split the
  realtime section out first (mechanical move, no logic change), then add new modules.
- Shared tests run `node --test` over `dist/`, so new pure functions must be exported from the
  package root.
- `expectedPosition(playback, serverNow)` already exists — song-end maths must build on it, not
  repeat it (DRY).
- Round-robin needs a tiebreak that survives re-sorting every broadcast: `(round, addedAtMs)` where
  `round = (songs this singer already sang) + (index among their pending entries)`. Stable, fair,
  and the order is visible to everyone.

## Requirements

Functional

1. `QueueEntry` = `{ id, song, singerId, singerName, addedAtMs }` (Q-03; no duet fields — Phase 4).
2. `orderQueue(entries, sungCount)` returns the round-robin order (Q-05), pure and stable.
3. `msUntilSongEnd(playback, nowMs, graceSec)` → `number | null` (null = cannot end by itself:
   no song, paused, or unknown duration) (Y-11).
4. `skipDecision(voterIds, memberIds, singerId)` → `{ have, needed, skip }` with needed =
   `max(1, ceil(eligible / 2))`, eligible = members minus the singer (Q-07).
5. Zod inputs for every new socket message; every error message in Vietnamese.
6. `PresenceMember` gains `away: boolean` (N-12).

Non-functional

- No dependency on NestJS, Angular or `zod` beyond what the package already has.
- Every function pure; no `Date.now()` inside (callers pass `nowMs`).

## Architecture

```
packages/shared/src/
  index.ts     accounts, rooms, songs, playback  + `export *` of the modules below
  events.ts    Events map, Ack, JoinAck, Clock*, Rtc*, PresenceMember/List   (moved out of index.ts)
  queue.ts     QueueEntry, TurnState, QueueState, QueueAddInput, QueueRemoveInput, orderQueue()
  turn.ts      SONG_END_GRACE_SEC, msUntilSongEnd(), PlayDurationInput, PlayErrorInput
  skip.ts      SKIP_RATIO, SkipState, SkipVoteInput, skipDecision()
```

New event names (added to the `Events` map in `events.ts`):

| Event | Direction | Payload | Ack |
| --- | --- | --- | --- |
| `queue:add` | client → server | `{ link }` | `Ack & { entryId }` |
| `queue:remove` | client → server | `{ entryId }` | `Ack` |
| `queue:state` | server → room | `QueueState` | — |
| `skip:vote` | client → server | `{ vote: boolean }` | `Ack` |
| `skip:state` | server → room | `SkipState` | — |
| `turn:keep` | client → server | — | `Ack` |
| `play:duration` | client → server | `{ rev, durationSec }` | `Ack` |
| `play:error` | client → server | `{ rev, code }` | `Ack` |

`play:set` keeps its schema but only accepts `TEST_TRACK_LINK` from Phase 2 on (see phase 02).
`stage:take` / `stage:leave` keep their names and gain turn meaning on the server.

State shapes:

```ts
export interface TurnState {
  entry: QueueEntry;
  startedAtServerMs: number;
  /** Server time the song is expected to end; null when the duration is unknown. */
  endsAtServerMs: number | null;
  /** Set when the singer dropped: the SONG ends at this moment unless kept or taken over (R-09).
   *  It never reserves the stage — anyone may step up straight away. */
  singerAwayUntilMs: number | null;
  /** Someone pressed "Giữ bài": the song finishes even with no singer. */
  kept: boolean;
}
export interface QueueState { current: TurnState | null; entries: QueueEntry[]; rev: number }
export interface SkipState { have: number; needed: number; voterNames: string[]; rev: number }
```

`JoinAck` gains `queue: QueueState` and `skip: SkipState` (Y-06: a late joiner sees the whole room).

## Related Code Files

Create

- `packages/shared/src/events.ts`
- `packages/shared/src/queue.ts`
- `packages/shared/src/turn.ts`
- `packages/shared/src/skip.ts`

Modify

- `packages/shared/src/index.ts` — remove the moved realtime block, add `export * from './events.js'`
  etc., extend `JoinAck`, add `away` to `PresenceMember`.
- `packages/shared/test/shared.test.mjs` — tests for the three new pure functions.
- `E:\Work\chibi-ktv\package.json` — root `test` script also runs `pnpm --filter @ktv/shared test`.

Delete: none.

## Implementation Steps

1. Create `events.ts` by moving the "Realtime events" + "Stage + voice" blocks out of `index.ts`
   verbatim; re-export from `index.ts`. Build (`pnpm --filter @ktv/shared build`) — no other file
   should need an import change, because everything imports from `@ktv/shared`.
2. Add the new event names to the `Events` map with a one-line comment each, in the existing style.
3. Add `queue.ts`:
   - `QueueAddInput = z.object({ link: z.string().trim().min(1, 'Hãy dán link YouTube').max(300) })`
   - `QueueRemoveInput = z.object({ entryId: z.string().uuid() })`
   - `MAX_QUEUE_PER_USER = 5`, `MAX_QUEUE_TOTAL = 50`
   - `orderQueue(entries, sungCount: ReadonlyMap<string, number> | Record<string, number>)`:
     per singer count their pending entries in `addedAtMs` order → `round = sung + ownIndex`;
     sort by `round`, then `addedAtMs`.
4. Add `turn.ts`:
   - `SONG_END_GRACE_SEC = 2`
   - `msUntilSongEnd(p, nowMs, graceSec = SONG_END_GRACE_SEC)`: `null` when `!p.song`, `p.paused`,
     or `p.song.durationSec == null`; else `(durationSec + graceSec - expectedPosition(p, nowMs)) * 1000`
     (may be ≤ 0, meaning "end now").
   - `PlayDurationInput = z.object({ rev: z.number().int().nonnegative(), durationSec: z.number().min(5).max(7200) })`
   - `PlayErrorInput = z.object({ rev: z.number().int().nonnegative(), code: z.number().int() })`
5. Add `skip.ts`: `SKIP_RATIO = 0.5`, `SkipVoteInput = z.object({ vote: z.boolean() })`,
   `skipDecision(voterIds, memberIds, singerId)` — eligible = members minus singer; votes from
   non-members or the singer are ignored; `needed = Math.max(1, Math.ceil(eligible.length * SKIP_RATIO))`;
   `skip = eligible.length > 0 && have >= needed`.
6. Extend `JoinAck`, `PresenceMember`.
7. Write the tests (below), build, run `pnpm --filter @ktv/shared test`.

## Todo List

- [ ] Move realtime block to `events.ts`, re-export, build stays green
- [ ] New event names added with comments
- [ ] `queue.ts` with types, Zod inputs, limits, `orderQueue`
- [ ] `turn.ts` with `msUntilSongEnd` + report schemas
- [ ] `skip.ts` with `skipDecision`
- [ ] `JoinAck` + `PresenceMember.away`
- [ ] Tests: round-robin with uneven counts, after someone has sung, empty queue
- [ ] Tests: `msUntilSongEnd` playing / paused / unknown duration / already over
- [ ] Tests: `skipDecision` for 1, 2, 3, 8 members and a vote from the singer
- [ ] Root `pnpm test` runs shared tests

## Success Criteria

- `pnpm --filter @ktv/shared build` and `test` pass; `pnpm build` passes unchanged.
- `orderQueue([T1,T2,T3,V1], {})` → `T1, V1, T2, T3`; with `{ T: 1 }` → `V1, T1, T2, T3`.
- `skipDecision` with 8 members and 1 singer needs 4 votes; with 2 members needs 1.
- No file in `packages/shared/src` exceeds 200 lines.

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| The `index.ts` split breaks imports across both apps | Pure move + re-export; `pnpm build` after step 1 before anything else |
| `orderQueue` surprises people (next-up changes when someone queues) | Order is broadcast and rendered as a numbered list; next-up is also shown in the panel |
| Unknown duration makes `msUntilSongEnd` null forever | Phase 04 adds the client duration report |

## Security Considerations

- Every new socket payload has a Zod schema with bounds (`link` ≤ 300 chars, `durationSec` 5–7200,
  `entryId` a UUID) — rejected input never reaches room state.
- `singerName` is copied from the server's own presence record, never from client input.

## Next Steps

- Phase 02 consumes these types in `RoomQueue` / `RoomState`.
- Phase 06 renders `QueueState` / `SkipState` in Angular.
