# Phase 07 — Verification and docs

## Context Links

- [plan.md](plan.md) · all previous phases
- `E:\Work\chibi-ktv\apps\server\test\rooms.e2e-spec.ts` (e2e style: real DB, real sockets)
- `E:\Work\chibi-ktv\apps\server\test\helpers.ts` (`startTestApp` truncates `rooms, users`)
- `E:\Work\chibi-ktv\e2e\sync.mjs` (T-01)
- `E:\Work\chibi-ktv\README.md` ("What works now", "Next: Phase 2") · `E:\Work\chibi-ktv\CLAUDE.md` (Status)
- Requirements: T-01, N-01 (150 ms p90), N-04 (room events 200 ms p95)

## Overview

- **Priority:** P2 — but nothing is "done" until this passes.
- **Status:** pending
- One e2e spec that drives the whole Phase 2 story over real sockets against the Neon test database,
  a T-01 regression run, and the two documents that tell the next person where the project stands.

## Key Insights

- Server tests run against a real PostgreSQL by project rule — here a Neon `ktv_test` database
  reached through `TEST_DATABASE_URL`; there is no Docker in this environment, so never add a
  `docker compose` step to the test instructions.
- Phase 1's spec `'frees the stage when the singer disconnects'` encodes the **old** rule and must be
  rewritten for R-09 (stage reads empty immediately; the turn survives 20 s).
- T-01 is the only guard against a sync regression, and it needs the built app
  (`pnpm build && pnpm start`) plus a second terminal.
- `README.md` is the project's real documentation (there is no `./docs` folder yet). Keep the Phase 2
  section honest about what is *not* done (deploy, two-laptop test).

## Requirements

Functional

1. `apps/server/test/queue.e2e-spec.ts` covering, with 3 members in one room:
   - add → the queue is broadcast, the first turn starts, the singer is on stage;
   - round-robin order across two singers;
   - removing someone else's entry is refused in Vietnamese;
   - `play:set` with a YouTube link is refused (click track still accepted);
   - vote-skip: 1 of 2 eligible advances the queue (and the notice arrives);
   - `play:duration` then automatic end → next turn starts;
   - `play:error` with code 150 skips the song;
   - reconnect with the same cookie keeps the seat, the queue entry and the stage;
   - singer closes the socket → stage empty, playback unchanged; after the grace the next song starts
     (use a shortened grace via the injected clock or a test-only constant — do **not** sleep 20 s in
     a test).
2. Phase 1 specs updated, not deleted.
3. `pnpm test` (shared + server unit + server e2e) and `pnpm --filter web test --watch=false` green.
4. `pnpm test:sync` PASS with a p90 comparable to Phase 1.
5. README: "What works now" gains the Phase 2 bullets; the "Next: Phase 2" section becomes
   "Next: Phase 3"; a short "How the queue works" paragraph (round-robin, 50% skip, server end,
   20 s away grace) and a note that the queue lives in memory and is lost on a server restart.
6. `CLAUDE.md`: Status block updated (Phase 2 done in code, what is still untested), plus the new
   event names in the conventions list if useful.
7. Manual two-laptop checklist written into the README (real YouTube video, one person refreshing
   mid-song, one person pulling the network).

Non-functional

- Measure a couple of `queue:add` → `queue:state` round trips in the e2e run and note them against
  N-04 (200 ms p95) — a log line is enough, no new tooling.

## Architecture

```
pnpm --filter @ktv/shared test     node:test over dist  (pure rules)
pnpm --filter server test          vitest unit          (RoomState, RoomQueue, SkipVotes)
pnpm --filter server test:e2e      vitest + supertest + socket.io against Neon ktv_test
pnpm --filter web test             Angular/vitest       (queue panel, sync-math)
pnpm test:sync                     Playwright, 3 browsers, built app  (T-01)
```

For the 20-second rules, expose the grace through a test hook rather than real time: pass a
`now()` clock into `RoomState` (already supported) and let `RoomLiveService` accept an injectable
tick interval, or export `AWAY_GRACE_MS` and allow an env override in test mode. Prefer the clock
injection used by the existing unit tests; keep the e2e assertion on the *immediate* effects (stage
empty, playback unchanged) and leave the 20 s expiry to the unit tests.

## Related Code Files

Create

- `apps/server/test/queue.e2e-spec.ts`

Modify

- `apps/server/test/rooms.e2e-spec.ts` — update the singer-disconnect expectation; keep the rest.
- `apps/server/test/helpers.ts` — only if the test clock hook needs it.
- `E:\Work\chibi-ktv\README.md`
- `E:\Work\chibi-ktv\CLAUDE.md`
- `E:\Work\chibi-ktv\.env.example` — a line about `YOUTUBE_API_KEY` making Y-12 and the song end work.

## Implementation Steps

1. Write `queue.e2e-spec.ts` following the existing two-describe pattern (`signup`, `connect`,
   `once`), three cookies, one room.
2. Fix the Phase 1 singer-disconnect spec.
3. Run `pnpm test` (shared + server). Fix real failures; never weaken an assertion to go green.
4. Run `pnpm --filter web test --watch=false`.
5. `pnpm build`, `pnpm start`, then `pnpm test:sync` in a second terminal; record the p90.
6. Update README, CLAUDE.md, `.env.example`.
7. Commit on a feature branch (`git checkout -b feat/phase-2-queue`) with a short summary line plus
   bullet points, per the repo convention; no AI references.

## Todo List

- [ ] `queue.e2e-spec.ts` written and green
- [ ] Phase 1 singer-disconnect spec updated
- [ ] `pnpm test` green (shared + server unit + e2e against Neon `ktv_test`)
- [ ] `pnpm --filter web test --watch=false` green
- [ ] `pnpm test:sync` PASS, p90 recorded
- [ ] README: what works now, how the queue works, Phase 3 next, two-laptop checklist
- [ ] CLAUDE.md status updated
- [ ] `.env.example` note about `YOUTUBE_API_KEY`
- [ ] Feature branch + conventional commit

## Success Criteria

- Every suite green with no skipped or weakened tests, no mocks standing in for the database.
- T-01 p90 within the Phase 1 range; if it regressed, the cause is found before the phase closes.
- A new reader of the README can explain the queue, the vote-skip threshold, the song-end rule and
  the 20 s grace without opening the code.

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| e2e flakiness around timing | Assert on broadcast events (`once(socket, event)`), never on sleeps; the 20 s rules stay in unit tests |
| Neon free tier cold start slows the e2e suite | Existing suites already live with it; keep `startTestApp` as it is |
| T-01 regression from the queue work | It is in the todo list of phase 06 too, so the cause is caught close to the change |
| `truncate rooms, users` misses new tables | No new tables in Phase 2 — nothing to add |

## Security Considerations

- Tests must not print JWTs or cookies to the console.
- No real `YOUTUBE_API_KEY` in test fixtures or in `.env.example` (placeholder only).
- Confirm `.env` is still git-ignored before committing.

## Next Steps

- Deploy to Render + Neon and run the two-laptop test with a real YouTube video (still open from
  Phase 1).
- Then Phase 3: full 3D room from the prototype and real seats (reusing the `away` flag).
