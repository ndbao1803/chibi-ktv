# Progress — 5 Nov 2026

## Update: Phase 4 complete (everyone's voice and duets)
- Talk mesh (`voice/talk.service.ts`): one RTCPeerConnection per pair, single sendrecv audio line,
  only the smaller user id offers, mics swapped with `replaceTrack` (no renegotiation, no glare).
  Web Audio gain per person implements VC-02/03/06/08; analysers drive speaking rings (VC-07).
  Open mic has a noise gate on a cloned track (not on iPhone, where tapping the mic crackles).
- Server: `mic:mode` (max 8 open), `fx:send` cheers with 3 s cooldown, duet invites with 30 s
  expiry, cancel, opt-out; partner on `StageState`; partner can step down alone and does not vote.
  Personal messages (`Effects.tell`) go only to one member's tabs.
- Fixed two singer-path bugs found by the 3-browser run: a double call to the same listener
  ("wrong state: stable"), and a singer hand-over where the new singer reused a stale incoming
  connection so the old singer never heard them.
- Tests: server unit 54, e2e 30, web 20; `pnpm test:voice` 11/11; T-01 PASS (worst 20.6 ms).
- Not testable here: real phones, Bluetooth, two networks. Next: Phase 5.

---

## Update: Phase 3 complete (the full 3D room)
- Scene split into `pages/room/scene/`: `room-decor.ts` (everything from the prototype, RD-01..03),
  `chibi.ts` (shared geometry for 16 avatars, sit/walk/stage poses, away dimming, talk ring ready
  for Phase 4), `seats.ts` (16 seats, walking routes that never cross furniture — unit-tested for
  every pair), `kit.ts`. `ktv-scene.ts` keeps the page API small: setMembers, setStage(ids[]),
  setCapacity, setView, setLowPower, onSeatClick.
- Server: `seat` on every member (auto-assigned in `SEAT_FILL_ORDER`, kept while away or on stage,
  freed when they leave for good), `seat:take` first-click-wins. Unit + e2e tests.
- Checked in Chromium with 16 people (SwiftShader): stools row, singer walks to the stage, reserved
  seat label, clicking a free seat walks you there and frees the old one.
- Seen during the 16-person run: a WebRTC "setRemoteDescription … wrong state: stable" console
  error in the voice code (an answer arriving twice). To fix in Phase 4 with the voice mesh rework.
- Tests: server unit 46, e2e 28, web 19. Next: Phase 4.

---

## Update: Phase 2 complete (steps 04–07)
- **04 song end + broken videos:** the server ends each song at its length + 2 s; the length comes
  from the YouTube API or the first player (`play:duration`); fatal player errors (`play:error`
  2/100/101/150) skip for everyone.
- **05 reconnect:** a closed tab is "away" for 20 s (`AWAY_GRACE_MS`), keeping seat, songs and
  vote. A dropped singer frees the stage but not the music; the song stops after 20 s unless
  someone presses "Giữ bài" (`turn:keep`) or steps on stage. Back in time = stage back if free.
- **06 web:** `pages/room/queue/` panel (now playing + time left, round-robin list, ✕ on your
  own, vote-skip with have/needed), mic permission asked when you first queue a song, mic arms
  itself at your turn (retry button if it fails), away people greyed in the list and see-through
  in 3D, singer-away banner with countdown.
- **07:** `test/queue.e2e-spec.ts` (three friends, order, remove-own, singer drop + return,
  queue broadcasts < 200 ms), docs updated.
- Tests: server unit 42, server e2e 27, web 16 — green. T-01 PASS (worst listener p90 14.7 ms).
  Browser run with a stand-in YouTube player (the sandbox can't reach YouTube): A1/B1/A2 order,
  skip → B's mic on with no click, B drops → A sees the banner, "Giữ bài" works.
- Still to do by hand: the two-laptop checklist in the README with a real YouTube video.
- Next: Phase 3 (full 3D room from the prototype).

---

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
