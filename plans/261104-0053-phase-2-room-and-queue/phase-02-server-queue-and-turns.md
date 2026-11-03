# Phase 02 — Server queue and turns

## Context Links

- [plan.md](plan.md) · [phase-01](phase-01-shared-contracts-and-pure-rules.md)
- `E:\Work\chibi-ktv\apps\server\src\rooms\room-state.ts` (114 lines today: presence, playback, stage)
- `E:\Work\chibi-ktv\apps\server\src\rooms\rooms.gateway.ts` (226 lines today — must not grow)
- `E:\Work\chibi-ktv\apps\server\src\rooms\room-state.spec.ts` (fake-clock test style to follow)
- Requirements: Q-01, Q-03, Q-05, Q-06, S-01 (singer walks on stage when the song starts), R-10

## Overview

- **Priority:** P1 — the backbone of Phase 2.
- **Status:** pending
- The server holds a round-robin queue per room, starts a turn when one is free, puts that turn's
  singer on stage, and advances when the turn ends. Anyone may add a song; you may only remove your
  own entries (no host in v1).

## Key Insights

- `rooms.gateway.ts` is already at the 200-line limit and `room-state.ts` would roughly triple.
  Split by concern instead of adding to either: `RoomQueue` (queue + current turn) and
  `RoomLiveService` (the `Map<code, RoomState>`, the tick, the broadcasts). The gateway stays a thin
  validate → delegate → ack layer.
- Two Nest gateways on one namespace would duplicate connection hooks — do **not** add a second
  `@WebSocketGateway`. Extract services instead.
- Every deadline in Phase 2 (song end, away grace, re-counting votes) is "has server time passed X".
  A single 1-second `setInterval` per live room that calls `state.tick(now)` and returns the list of
  changed things replaces all other timers and is fully testable with the injected clock.
- Reuse `RoomState.setSong()` to start a turn: playback already gets `START_LEAD_MS` so every
  browser loads the new video before it starts (Y-06).
- Keep `play:set` for `test:click` only. The T-01 sync test clicks "Nhạc thử nhịp" then "Lên hát";
  if the click track went through the queue it would make the clicker the singer and the test would
  break.

## Requirements

Functional

1. `queue:add { link }` — any member; parse the id (`parseYouTubeId`), check it with
   `YouTubeService.check` (Q-01, Y-12), append `{ id: randomUUID(), song, singerId, singerName, addedAtMs }`.
   Reject over `MAX_QUEUE_PER_USER` ("Bạn đang có 5 bài trong danh sách rồi") or `MAX_QUEUE_TOTAL`.
2. `queue:remove { entryId }` — only your own pending entry (Q-06): otherwise
   `{ ok: false, error: 'Chỉ xoá được bài của bạn' }`. The current turn is not removable by this
   event (use `stage:leave` or vote-skip).
3. When no turn is running and the queue is not empty → start a turn immediately: set playback to
   that song, set `stage` to the entry's singer, increment that singer's `sungCount`, broadcast
   `queue:state`, `play:state`, `stage:state`.
4. `stage:leave` by the current turn's singer ends the turn and advances the queue; by anyone else
   it is a no-op `{ ok: true }` (unchanged behaviour for ad-hoc stage use).
5. `stage:take` keeps its Phase 1 rule unchanged: it succeeds whenever the stage is empty and is
   refused only when someone else is on it (`'<name> đang hát'`). There is **no** turn or reservation
   check — a turn simply puts its singer on the stage, and if that singer drops (phase 05) the stage
   is free for anyone, mid-song included.
6. Advancing with an empty queue → clear playback (`song: null`), clear stage, broadcast an idle
   room (Y-11 second half).
7. `queue:state` is broadcast on every change, with entries already in `orderQueue` order and a
   `rev` that only increases (the browser ignores stale updates, like `PlaybackState.rev`).
8. A member removed from the room for good loses their pending entries (phase 05 calls this).

Non-functional

- Room events within 200 ms p95 (N-04): all of this is in-memory work plus one broadcast.
- One instance handles 50 rooms of 16 (N-11): one interval per live room, cleared with the room.
- No new DB table, no migration.

## Architecture

```
rooms.gateway.ts        thin: auth, join, clock, rtc relay, Zod parse → RoomLiveService / RoomState
rooms/room-live.service.ts   owns Map<code, RoomState>, the 1 s tick per room, empty-room TTL,
                             and the emit helpers (holds the Namespace, set by the gateway)
rooms/room-state.ts     presence + away + playback + stage, composes RoomQueue and SkipVotes,
                        exposes tick(now): Effects
rooms/room-queue.ts     NEW: entries, current turn, add/remove/start/advance, sungCount
rooms/room-skip.ts      NEW (phase 03): votes for the current turn
```

`Effects` is a plain object the tick and the mutators return, so the caller knows what to broadcast:

```ts
export interface Effects { presence?: boolean; playback?: boolean; stage?: boolean; queue?: boolean; skip?: boolean; notice?: string }
```

Turn start/advance sequence (all inside `RoomState`, no I/O):

```
advance(now):
  current = null; votes.clear()
  next = queue.shift(now)                 // orderQueue head
  if (!next) { playback = EMPTY_PLAYBACK (rev+1); stage = empty; return {playback, stage, queue} }
  queue.current = { entry: next, startedAtServerMs: now + START_LEAD_MS, endsAtServerMs: null, singerAwayUntilMs: null, kept: false }
  setSong(next.song, next.singerName)     // existing method, keeps the 2.5 s lead
  queue.sung(next.singerId)
  stage = { singerId: next.singerId, singerName: next.singerName }
  endsAtServerMs = startedAtServerMs + (durationSec + grace) * 1000   // when duration known
  return { playback: true, stage: true, queue: true }
```

**State placement justification**

| State | Where | Why |
| --- | --- | --- |
| Queue entries, current turn | memory (`RoomQueue`) | Ephemeral per night; dies with the room like playback/stage; the 30-min empty-room TTL already covers refreshes (R-10). A table would add a migration and writes for no user-visible gain. |
| `sungCount` per member | memory | Only meaningful inside one session's fairness ordering. |
| Vote tallies | memory (phase 03) | Valid for one turn only. |
| Away deadlines | memory (phase 05) | Seconds-long, worthless after a restart. |
| Users, rooms | PostgreSQL (unchanged) | Identity and room codes must survive restarts. |

A server restart therefore loses the queue — acceptable on Render free tier (the service also sleeps
after 15 min); noted in the README update in phase 07.

## Related Code Files

Create

- `apps/server/src/rooms/room-queue.ts`
- `apps/server/src/rooms/room-queue.spec.ts`
- `apps/server/src/rooms/room-live.service.ts`

Modify

- `apps/server/src/rooms/room-state.ts` — compose `RoomQueue`, add `tick(now): Effects`, keep
  presence/playback/stage; move the `live` map bookkeeping out.
- `apps/server/src/rooms/rooms.gateway.ts` — new handlers `queue:add`, `queue:remove`; `stage:take` /
  `stage:leave` turn rules; `play:set` restricted to `TEST_TRACK_LINK`; join ack carries queue+skip;
  delegate state/broadcast to `RoomLiveService`.
- `apps/server/src/rooms/rooms.module.ts` — provide `RoomLiveService`.
- `apps/server/src/rooms/room-state.spec.ts` — turn tests.

## Implementation Steps

1. **`room-queue.ts`** (keep under 150 lines):
   `entries: QueueEntry[]`, `current: TurnState | null`, `sungCount = new Map<string, number>()`.
   Methods: `ordered()` (uses `orderQueue`), `add(entry): { ok } | { ok: false, error }` with the two
   limits, `removeOwn(entryId, userId)`, `removeAllOf(userId)`, `shift()`, `sung(userId)`,
   `state(rev): QueueState`.
2. **`room-state.ts`**: hold `readonly queue = new RoomQueue()`; add `startTurnIfIdle(): Effects`,
   `endTurn(byUserId | null): Effects`, `advance(): Effects`, and `tick(now): Effects` (for now only
   song end from phase 04 and away from phase 05 — leave the hooks in place and return `{}`).
3. **`room-live.service.ts`**: move `live`, `cleanup` (empty-room TTL) and the `emitPresence` /
   `emitPlayback` / `emitStage` helpers here, add `emitQueue`, `emitSkip`, `emitNotice`, plus
   `apply(state, effects)` that broadcasts exactly what changed, and `attach(ns)` called from the
   gateway's `afterInit`. Start the 1 s interval when a room becomes live; `clearInterval` when it is
   deleted (`.unref()` like the existing TTL timer, so tests exit).
4. **Gateway**: add the two queue handlers (Zod parse → ack with the Vietnamese error), rewrite
   `takeStage` / `leaveStage` for turn rules, restrict `play:set`
   (`if (link !== TEST_TRACK_LINK) return { ok: false, error: 'Hãy dùng “Thêm vào danh sách”' }`),
   and include `queue` + `skip` in `JoinAck`.
5. **Tests** — `room-queue.spec.ts`: ordering after adds/removes, per-user limit, remove-own only.
   `room-state.spec.ts`: adding the first song starts a turn with `START_LEAD_MS` and puts the
   singer on stage; `stage:leave` by the singer advances to the next entry; empty queue clears
   playback; a second person's `stage:take` during a turn is refused.
6. `pnpm --filter server test` and `pnpm build`.

## Todo List

- [ ] `room-queue.ts` + spec green
- [ ] `RoomState` composes the queue, `tick()` hook in place
- [ ] `RoomLiveService` owns the map, tick and broadcasts; gateway `afterInit` attaches the namespace
- [ ] `queue:add` validates the link through `YouTubeService` and enforces both limits
- [ ] `queue:remove` refuses other people's entries
- [ ] First add starts a turn; `stage:leave` advances; empty queue goes idle
- [ ] `stage:take` guard unchanged from Phase 1 (empty stage only, no turn check)
- [ ] `play:set` accepts only the click track
- [ ] `JoinAck` carries queue + skip
- [ ] `rooms.gateway.ts` and `room-state.ts` both back under 200 lines
- [ ] `pnpm --filter server test` + `pnpm build` green

## Success Criteria

- Two sockets in a room: A adds a song → both receive `queue:state` with one entry, `play:state`
  with the song, `stage:state` with A as singer.
- A adds 2, B adds 1 → order is A1, B1, A2.
- B cannot remove A's entry; B cannot take the stage while A is actually on it.
- A `stage:leave` from A starts B's song within one tick.
- No file over 200 lines; `room-state.spec.ts` and `room-queue.spec.ts` pass with the fake clock.

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| Breaking T-01 / Phase 1 behaviour | Click track keeps the old `play:set` path; run `pnpm test:sync` in phase 07 before closing |
| Tick interval keeps the Node process alive in tests | `.unref()` on the interval, and `RoomLiveService.onModuleDestroy` clears all intervals |
| Gateway refactor churn | Do step 3 as a pure move (no behaviour change), run the existing e2e suite, then add features |
| A member with queue entries leaves → queue stalls on an absent singer | Phase 05 removes their entries on full leave; `advance()` skips entries whose singer is not present |

## Security Considerations

- Every handler re-checks membership through the existing `context(client)` helper: a socket that
  never joined cannot touch a room's queue.
- `singerId` / `singerName` come from the verified JWT user and server presence, never from the body.
- Queue limits (5 per user, 50 per room) stop one person flooding a room or the memory of the
  free-tier instance.
- `queue:add` still runs the YouTube check, so link validation cannot be skipped by a crafted client.

## Next Steps

- Phase 03 adds votes on top of `RoomState` + `Effects`.
- Phase 04 fills `tick()` with the song-end rule.
- Phase 05 fills `tick()` with away/singer-disconnect rules.
