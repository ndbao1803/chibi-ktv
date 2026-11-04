# Progress — 4 Nov 2026

## Update: phase 03 (vote-skip) done
- `skip:vote { vote }` toggles your vote on the song playing now; half of the non-singers
  (rounded up, at least 1) ends the turn, the next song starts, and everyone gets the notice
  `Cả phòng đã bỏ qua bài “…”`. The singer is refused with the "Xuống sân khấu" hint.
- Votes belong to one turn (cleared in `advance()`), a leaver's vote is dropped, and the 1 s tick
  re-counts so people leaving can tip a vote over. `skip:state { have, needed, voterNames, rev }`
  is broadcast only when the numbers change, and is in `JoinAck` (the `EMPTY_SKIP` placeholder is gone).
- Code: `apps/server/src/rooms/room-skip.ts` (+ spec), `room-state.ts` (`vote`, `skipState`,
  `refreshSkip`), gateway handler, `RoomLiveService.emitSkip`.
- Tests: shared 17, server unit 28, server e2e 23 (2 new vote-skip scenarios), web 11 — all green.
- Still no web UI for the queue or the skip button (phase 06). Next: phase 04 (server-decided
  song end + blocked videos).

---


## What's in the latest push

### Phase 2 groundwork (phases 01–02 of 7 — plan at `plans/261104-0053-phase-2-room-and-queue/`)
Song queue + turns, server-side only so far:
- `packages/shared/src/{events,queue,turn,skip}.ts` — Zod schemas, event names, and pure
  rule functions (`orderQueue` round-robin, `msUntilSongEnd`, `skipDecision`), unit-tested.
- `apps/server/src/rooms/{room-queue,room-live.service,socket-session}.ts` (new) — in-memory
  queue, turn start/advance, one 1s tick per room driving every deadline.
- `rooms.gateway.ts` gained `queue:add` / `queue:remove`. **`play:set` now only accepts the
  test click track — YouTube links must go through `queue:add` instead** (this is an
  intentional behavior change, not a bug; the old e2e test for it was updated to match).
- All new state (queue, turns) is in-memory, dies with the room — no DB migration, per plan.

**Not yet built** (phases 03–07, plan docs for all of them already written and
implementation-ready with Bảo's decisions baked in):
- 03 vote-skip (50% of non-singers, no minimum floor — decided)
- 04 server-decided song end + blocked-video rejection on paste
- 05 reconnect-keeps-seat + singer-disconnect rule (stage opens immediately when singer is
  away — decided, overriding the plan's original "hold the stage" draft)
- 06 Angular queue UI (panel, skip button, auto-mic-on-turn) — **the web app has no UI for
  the queue yet**, only the server plumbing exists
- 07 e2e tests + docs updates for all of the above

### Two unrelated fixes bundled into the same push (found while testing locally tonight)
1. **Singer's own audio/mic delay now compensated.** The singer measures their sound card
   output latency + mic input latency (+0.2s fixed for Bluetooth) and sends it to listeners,
   who delay the music that much more. Headphone dialog now asks wired / Bluetooth / none.
   Added a listener-side fine-tune slider (±400ms, saved per browser) for by-ear adjustment.
   YouTube follow-correction tightened (jumps above 0.15s instead of 0.25s).
2. **Safari/iOS could silently lose the singer's voice.** Safari blocks a `new Audio()`
   element from autoplaying when it arrives from a WebRTC event (not a direct tap), and the
   old error message pointed at a button that had already disappeared from the screen. Added
   a visible "Bấm để nghe ca sĩ" retry button that re-attempts playback from a real tap.

## Test results (all green, just before this push)
- `pnpm test` (shared build + server unit + server e2e): **17 + 17 + 21 = 55 passing, 0 failing.**
- `pnpm --filter web test --watch=false`: **11/11 passing.**
- `pnpm build` (shared + server + web production build): clean, no errors.
- e2e ran against the real Neon `ktv_test` database (not mocked), per project convention.

## Unfinished / unsure — read before continuing
- **Phase 02 has no listener-facing UI at all.** `queue:add`/`queue:remove` exist on the
  server; nothing in `apps/web` calls them yet. Don't expect the running app to show a queue.
- **Phase 03 (vote-skip) was never started** — explicitly held back per tonight's instruction
  (usage was running low). `JoinAck.skip` is still a static `EMPTY_SKIP` placeholder in
  `rooms.gateway.ts` (marked with a `TODO`) until phase 03 replaces it.
- Phase 02's `room-state.ts` has a `tick()` stub with `TODO phase04/05` comments marking
  exactly where song-end detection and the away-grace timer need to plug in.
- The four product decisions from tonight (vote threshold, 20s grace, stage opens immediately
  when singer is away, 5-song queue cap) are written into `plan.md`'s "Decided" section and
  the relevant phase files — no open questions remain in the plan itself.
- Not deployed. Local dev only (Neon Postgres for both dev + test DB, not Docker — see
  `apps/server/.env`, gitignored, not pushed).

## Next step
Resume with **phase 03 (vote-skip)**, then 04, 05, 06, 07 in that order (03/04 touch the same
files — `room-state.ts` and `rooms.gateway.ts` — so run them one at a time, not in parallel,
despite the plan's phase table suggesting otherwise). Each phase file in
`plans/261104-0053-phase-2-room-and-queue/` has its own Implementation Steps and Todo List.
Once all of Phase 2 is done and tested, push to GitHub (already wired to
`https://github.com/ndbao1803/chibi-ktv`) and deploy per the README's Render + Neon
instructions — deploy was deliberately held off until Phase 2 is complete, per Bảo's call.
