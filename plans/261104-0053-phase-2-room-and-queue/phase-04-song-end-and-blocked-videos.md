# Phase 04 — Server-decided song end and blocked videos

## Context Links

- [plan.md](plan.md) · [phase-01](phase-01-shared-contracts-and-pure-rules.md) · [phase-02](phase-02-server-queue-and-turns.md)
- `E:\Work\chibi-ktv\apps\server\src\youtube\youtube.service.ts` (`judgeVideo` already implements Y-12)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\player\youtube.player.ts` (`youTubeErrorText`, Y-08)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\player\player-panel.ts` (client-side "Hết bài" today)
- Requirements: **Y-11** server decides the end from the duration, idle screen when the queue is
  empty · **Y-08** embed errors mark the song unplayable, skip it, toast everyone · **Y-12** age
  restricted / region-blocked (VN) / live / non-embeddable rejected when queued · **Q-01**

## Overview

- **Priority:** P1
- **Status:** done (5 Nov 2026)
- Today each browser independently decides "Hết bài" and just stops. The server must own the end of
  the song so the queue advances once, for everybody, at the same moment. Also: make the Y-12 check
  real (it is already coded but needs `YOUTUBE_API_KEY` and a visible rejection), and auto-skip a
  song whose player reports a fatal error.

## Key Insights

- `YouTubeService.check()` + `judgeVideo()` **already** reject non-embeddable, private, live,
  age-restricted and VN-blocked videos, and are already called from `play:set`. Two real gaps:
  (a) without `YOUTUBE_API_KEY` the check silently accepts everything and `durationSec` is `null`,
  (b) the check must move to `queue:add` and its message must reach the person who pasted the link.
- Because `durationSec` can be `null`, the server cannot always compute the end. Fix cheaply: the
  first client whose player is ready reports `getDuration()` once (`play:duration { rev, durationSec }`),
  the server stores it on the current song, broadcasts, and the tick can now end the turn. This makes
  Y-11 work with a $0 setup and no API key.
- Fatal YouTube errors (100 / 101 / 150 / 2) are properties of the video, not of one network, so one
  report is enough to skip — bounded to the current `rev` so it cannot loop.
- `expectedPosition` + `msUntilSongEnd` already hold the maths; the tick just compares with `now`.
  Pausing stops the countdown automatically because `msUntilSongEnd` returns `null` when paused.

## Requirements

Functional

1. Turn start sets `endsAtServerMs = startedAtServerMs + (durationSec + SONG_END_GRACE_SEC) * 1000`
   when the duration is known, else `null`.
2. `tick(now)`: if a turn is running, not paused, and `msUntilSongEnd(playback, now) <= 0` →
   `advance()` with notice `'Hết bài — tới lượt <next singer>'` (or `'Hết bài'` when the queue is empty).
3. `play:duration { rev, durationSec }` — accepted only when `rev` equals the current playback rev
   and the song's duration is still unknown; first plausible report (5–7200 s) wins, then
   `endsAtServerMs` is computed and `play:state` + `queue:state` are broadcast.
4. `play:error { rev, code }` — for codes 2, 100, 101, 150 and only for the current rev: mark the
   entry unplayable, `advance()`, broadcast notice `'Video này không phát được — đã bỏ qua'`
   (Y-08). Other codes are ignored (ack `{ ok: true }`).
5. `queue:add` runs the YouTube check and returns `judgeVideo`'s Vietnamese reason unchanged
   (`'Video này bị chặn ở Việt Nam'`, `'Video này không cho phát ngoài YouTube'`, …) so the UI can show
   it next to the paste box (Y-12, E-01).
6. Empty queue after an end → idle room: `song: null`, stage cleared, `queue:state.current = null`.
   The browser shows the idle panel that already exists ("Dán link YouTube bên dưới…", reworded in
   phase 06).
7. Client side: `player-panel.ts` stops deciding the end itself — it reports the duration once and
   reports fatal errors, and otherwise just follows `playback`.

Non-functional

- Song end fires within one tick (≤ 1 s) of the true end; `SONG_END_GRACE_SEC = 2` absorbs
  YouTube's own trailing frames so the last line is never cut.
- `videos.list` stays at 1 quota unit per distinct video, cached 24 h (unchanged).

## Architecture

```
queue:add ──► YouTubeService.check(id) ──► judgeVideo (Y-12) ──► ok ? entry : { ok:false, error }
turn start ─► endsAtServerMs (duration known?)
tick 1 s ───► msUntilSongEnd(playback, now) <= 0 ? advance() : —
play:duration ► fill song.durationSec (once per rev) ► recompute endsAtServerMs
play:error ───► fatal code + current rev ► advance() + notice
```

`SongRef.durationSec` is already `number | null`, so filling it in later needs no type change; the
playback `rev` increases when it is filled so clients pick it up through the normal stale-guard.

State placement: `endsAtServerMs` lives in the in-memory `TurnState`; nothing is persisted. A song
that the server could not time (no API key, no client report — e.g. everyone on a blocked network)
simply never auto-ends, and the room uses vote-skip or "Xuống sân khấu" instead. Documented, not
engineered around.

## Related Code Files

Modify

- `apps/server/src/rooms/room-state.ts` — `endsAtServerMs` on turn start, `reportDuration()`,
  `reportError()`, the end branch of `tick()`.
- `apps/server/src/rooms/rooms.gateway.ts` — `play:duration` and `play:error` handlers.
- `apps/web/src/app/pages/room/player/player-panel.ts` — report duration on ready, report fatal
  error through the error callback, drop the local "Hết bài" stop.
- `apps/web/src/app/pages/room/player/youtube.player.ts` — expose `duration()` and pass the raw error
  `code` to the callback alongside the Vietnamese text.
- `apps/web/src/app/pages/room/player/ktv-player.ts` — add `duration(): number | null` to the
  interface; `click-track.player.ts` returns its fixed length.
- `apps/web/src/app/pages/room/realtime.service.ts` — `reportDuration()`, `reportError()`.
- `E:\Work\chibi-ktv\.env.example` + README — explain that `YOUTUBE_API_KEY` is what makes Y-12 and
  automatic song end work on the first try.

## Implementation Steps

1. Add `endsAtServerMs` when a turn starts (duration known) — unit test with the fake clock.
2. `tick()` end branch: `const left = msUntilSongEnd(this.playback, now); if (left !== null && left <= 0) return this.advance(now)`.
3. `RoomState.reportDuration(rev, durationSec)`: ignore unless `rev === playback.rev` and
   `playback.song.durationSec == null`; set it, bump `rev`, recompute `endsAtServerMs`.
4. `RoomState.reportError(rev, code)`: ignore unless `rev === playback.rev` and the code is fatal;
   else advance with the notice.
5. Gateway handlers with `PlayDurationInput` / `PlayErrorInput`.
6. `KtvPlayer.duration()`; `YouTubePlayer` reads `getDuration()` in `onReady` (0 until ready — report
   only a value > 5).
7. `player-panel.ts`: after `player.ready`, if `song.durationSec == null` and `duration() > 5`, call
   `rt.reportDuration(rev, d)` once per loaded song; in the error callback call `rt.reportError(rev, code)`;
   remove the `expectedPosition(...) >= durationSec` stop (the server now decides) but keep showing
   "Hết bài" as status while waiting for the server's advance.
8. Move the YouTube check call into `queue:add` (phase 02 already wires it) and keep `play:set`
   (click track only) check-free.
9. Tests: `room-state.spec.ts` — song ends after duration + grace and starts the next entry; a paused
   song never ends; duration report fills in and schedules the end; a fatal error skips; a stale `rev`
   report is ignored. Web: a small spec for the duration-report guard if it is extracted as a pure
   helper.

## Todo List

- [x] `endsAtServerMs` computed on turn start
- [x] Tick ends the song and advances, once, for everyone
- [x] `play:duration` fills an unknown duration (first plausible report wins)
- [x] `play:error` auto-skips fatal codes for the current rev only
- [x] `queue:add` surfaces `judgeVideo`'s Vietnamese reason
- [x] Idle room when the queue is empty
- [x] `player-panel.ts` no longer decides the end locally
- [x] `.env.example` / README explain `YOUTUBE_API_KEY`
- [x] Server unit tests green

## Success Criteria

- With `YOUTUBE_API_KEY` set, pasting a VN-blocked or non-embeddable link returns the Vietnamese
  reason and nothing enters the queue.
- A 20-second test video queued twice: the first turn ends by itself and the second starts, with
  `startedAtServerMs` 2.5 s in the future, on both browsers.
- Without an API key, the first browser's duration report still makes the song end on time.
- Pausing for a minute delays the end by a minute.
- A deleted video (error 100) skips within a second and everyone sees the toast.

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| A lying client reports a 10-second duration and cuts songs short | Bounds 5–7200 s, one report per rev, friends-only app; noted below |
| YouTube ad before the song shifts the real end | `SONG_END_GRACE_SEC = 2` plus "Hết bài" status; a song cut short can be re-queued; ads are never skipped or hidden (Y-07) |
| Quota exhausted mid-night → unknown durations | `check()` already degrades to "accept unchecked"; the client duration report covers the end |
| Error reports from one broken client skip good songs | Only fatal, video-level codes (2/100/101/150), bounded per rev |

## Security Considerations

- `play:duration` / `play:error` are membership-checked and rev-bound; a stale or forged rev is a
  no-op, so a client cannot skip the room's song by replaying an old message.
- Duration bounds stop a client from setting a 10-hour or 0-second song.
- The API key stays server-side only (it is already read from `config()` and never sent to the
  browser).

## Next Steps

- Phase 05 adds the away rules to the same `tick()`.
- Phase 06 shows "còn 1:23" from `endsAtServerMs` and the rejection message under the paste box.
