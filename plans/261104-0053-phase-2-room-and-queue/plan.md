---
title: "Phase 2 — Room and queue (turns, vote-skip, server song end, reconnect)"
description: "Round-robin song queue with turns, 50% vote-skip, server-decided song end, blocked-video rejection, and reconnect that keeps your seat."
status: pending
priority: P1
effort: 16h
branch: main
tags: [phase-2, queue, realtime, nestjs, angular, socket-io]
created: 2026-11-04
---

# Phase 2 — Room and queue

Source checklist (build plan, Phase 2 · Room and queue):
paste link checked by `videos.list` (Q-01, Y-12) · round-robin queue, remove own entries, vote-skip,
anyone can pause (Q-03, Q-05, Q-06, Q-07) · server decides song end, late joiners seek (Y-06, Y-11) ·
reconnect keeps the seat (N-12) · singer disconnect rule (R-09).

Version 1 has **no host**: Q-07 is a Must, members remove only their own entries, no reorder/priority.

## Phases

| # | File | What | Effort | Status |
| - | ---- | ---- | ------ | ------ |
| 01 | [phase-01-shared-contracts-and-pure-rules.md](phase-01-shared-contracts-and-pure-rules.md) | Zod inputs, event names, queue/turn/skip types, pure rules + tests | 2h | done |
| 02 | [phase-02-server-queue-and-turns.md](phase-02-server-queue-and-turns.md) | `RoomQueue`, turn start/advance, 1 s room tick, gateway handlers | 3.5h | done |
| 03 | [phase-03-vote-skip.md](phase-03-vote-skip.md) | 50% of non-singers skip the current song | 1.5h | done |
| 04 | [phase-04-song-end-and-blocked-videos.md](phase-04-song-end-and-blocked-videos.md) | Y-11 server song end, duration reporting, Y-08 auto-skip, Y-12 on add | 2.5h | done |
| 05 | [phase-05-reconnect-and-singer-disconnect.md](phase-05-reconnect-and-singer-disconnect.md) | 20 s away grace keeps seat/queue; singer-away rule + "Giữ bài" | 2.5h | pending |
| 06 | [phase-06-web-queue-ui-and-auto-stage.md](phase-06-web-queue-ui-and-auto-stage.md) | Angular queue panel, skip button, auto mic on your turn | 3h | pending |
| 07 | [phase-07-verification-and-docs.md](phase-07-verification-and-docs.md) | e2e specs, T-01 regression, README/CLAUDE.md | 1h | pending |

Run in order: 01 → 02 → (03, 04 in parallel) → 05 → 06 → 07.

## Key decisions

- **Queue, turns, votes and away timers live in memory** (`rooms/room-state.ts` and its two new
  collaborators). No migration, no new table: a night's queue dies with the room, exactly like
  playback and stage today, and the 30-min empty-room TTL (R-10) already protects a refresh.
- **One 1-second tick per live room** drives every deadline (song end, away grace, re-counting
  votes). No per-member/per-turn `setTimeout` bookkeeping, and every transition is unit-testable
  with the injected clock already used by `room-state.spec.ts`.
- **The click track stays off the queue.** `play:set` keeps working for `test:click` only, so the
  T-01 sync test and the "Nhạc thử nhịp" sound check are untouched. YouTube songs go through
  `queue:add`.
- **The turn owns the stage** (S-01): when a turn starts the server puts the entry's singer on
  stage; `stage:leave` by that singer ends the turn. `stage:take` stays for an empty stage.
- **Round-robin counts songs already sung** this session, so five songs queued early do not take
  every other turn.

## Decided (Bảo, 4 Nov 2026) — no open questions remain

1. **Vote-skip = plain 50% of non-singing members**, no minimum-vote floor. In a room of two, the one
   listener can skip alone. Away members still count as eligible. No special cases.
2. **`AWAY_GRACE_MS = 20_000`** for both "reconnect keeps your seat" and the singer-disconnect rule.
3. **The stage is never reserved.** The moment the singer is away, the stage reads empty and *anyone*
   may `stage:take` — during the grace, and whether or not "Giữ bài" was pressed. The grace still
   protects their **seat and queue entries**, just not the stage. "Giữ bài" only keeps the *song*
   playing past the 20 s; someone taking the stage mid-song keeps it too.
4. **Max 5 songs per person** in the queue (50 per room).
