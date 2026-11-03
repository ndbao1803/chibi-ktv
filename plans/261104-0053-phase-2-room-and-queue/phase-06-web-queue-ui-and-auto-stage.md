# Phase 06 — Web: queue panel, vote-skip, automatic stage

## Context Links

- [plan.md](plan.md) · [phase-02](phase-02-server-queue-and-turns.md) · [phase-03](phase-03-vote-skip.md) · [phase-05](phase-05-reconnect-and-singer-disconnect.md)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\realtime.service.ts` (signals + `emitWithAck` helper)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\room.page.html` (paste form, stage row, dialogs)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\voice\voice.service.ts` (`startSinging(headphones)`)
- `E:\Work\chibi-ktv\e2e\sync.mjs` (T-01 clicks "Vào phòng", "Nhạc thử nhịp", "Lên hát", "tai nghe có dây")
- Requirements: Q-01, Q-03, Q-05, Q-06, Q-07, S-01, **S-02** (mic permission asked the first time a
  user queues a song), E-01 (clear message + next step), N-09/N-10 (Vietnamese, desktop-first)

## Overview

- **Priority:** P1
- **Status:** pending
- The room gets a "Danh sách bài" panel: paste a link to queue it, see the round-robin order with
  who sings each song, remove your own, and vote to skip what is playing. When your turn starts, your
  chibi walks on stage and your mic arms itself — no second click.

## Key Insights

- **T-01 must keep passing.** Keep the exact button labels `Vào phòng`, `Nhạc thử nhịp`, `Lên hát`,
  `tai nghe có dây` and keep the click-track path ad-hoc (`play:set`). Run `pnpm test:sync` before
  calling this phase done.
- `getUserMedia` needs a user gesture only for the **permission prompt**. So ask for the mic the
  first time someone queues a song (S-02 — the click is right there), stop the tracks immediately,
  and the later automatic arming at turn start works without a prompt.
- Store the headphones answer once per visit (the existing dialog) and reuse it when the turn starts,
  so the dialog does not interrupt the song.
- `player-panel.ts` is 184 lines and `room.page.html` is 98 — the queue belongs in its own standalone
  component, not in either.
- Everything the panel shows is already broadcast: `QueueState`, `SkipState`, presence with `away`.
  No polling, no extra HTTP.

## Requirements

Functional

1. **Queue panel** (`app-queue-panel`): paste box + "Thêm vào danh sách" button; the current turn at
   the top (song title, singer name, "còn m:ss" from `endsAtServerMs`); then the ordered list with
   position, title and singer; an "✕" on your own entries only (Q-06).
2. Rejection messages from the server (blocked in Vietnam, not embeddable, too many songs…) appear
   under the paste box in red and stay until the next attempt (E-01).
3. **Vote-skip button**: "Bỏ qua bài này ({have}/{needed})", hidden for the current singer, disabled
   when there is nobody else in the room; pressing it again takes the vote back; voter names in the
   tooltip.
4. **Singer controls**: when it is your turn, the footer shows "● Đang hát · N người đang nghe" and
   "Xuống sân khấu" (which ends your turn). "🎤 Lên hát" shows whenever the stage is empty — idle
   room, click track, **and mid-song while a singer is away** (phase 05 decision: the stage is never
   reserved, so this button must not be hidden during a turn whose singer dropped).
5. **Automatic stage (S-01/S-02)**: when `stage().singerId` becomes me and I am not yet publishing,
   `VoiceService` arms the mic with the stored headphones answer. If it fails, show
   "Không mở được micro — bấm để thử lại" with a retry button; the song keeps playing.
6. **Mic pre-flight at queue time**: after a successful `queue:add`, if permission was never granted,
   ask the headphones question once and call a new `VoiceService.prepareMic(headphones)` that opens
   and immediately stops a stream (permission + remembered answer).
7. **Away members**: presence list shows them greyed with "(mất kết nối)"; the 3D chibi is dimmed.
8. **Singer away banner**: "<name> mất kết nối — bài sẽ dừng sau N giây" with a "Giữ bài" button and
   the normal "🎤 Lên hát" button side by side (any member may do either) — the countdown comes from
   `TurnState.singerAwayUntilMs` and the server clock, and the banner disappears once the song is
   kept or someone steps up.
9. **Idle room**: when nothing is queued, the player panel says "Chưa có bài — dán link YouTube để
   thêm vào danh sách".
10. The paste form no longer calls `play:set` for YouTube links; "Nhạc thử nhịp" still does.
11. `player-panel.ts` reports the duration once per song and reports fatal player errors (phase 04).

Non-functional

- Vietnamese text everywhere (N-10); keyboard reachable (N-13 best effort); no layout change that
  covers or transforms the YouTube panel (P-04).
- Signals + zoneless, standalone component, no new dependency.

## Architecture

```
pages/room/
  queue/queue-panel.ts|.html|.scss     NEW standalone component (reads RealtimeService signals)
  realtime.service.ts                  + queue, skip signals; addSong(), removeSong(), voteSkip(),
                                         keepSong(), reportDuration(), reportError()
  room.page.ts|.html                   paste form → queue panel; singer away banner; away styling
  voice/voice.service.ts               + prepareMic(headphones), + headphones memory,
                                         + auto-arm effect when I become the singer
  player/player-panel.ts               + duration/error reporting, server-owned end
  ktv-scene.ts                         dim away chibis
```

`RealtimeService` additions follow the existing pattern exactly (a `signal` per server event, an
`emit()` wrapper returning `Ack`, `rev` guard against stale updates):

```ts
readonly queue = signal<QueueState>(EMPTY_QUEUE);
readonly skip  = signal<SkipState>(EMPTY_SKIP);
addSong(link: string) { return this.emit(Events.queueAdd, { link }); }
```

## Related Code Files

Create

- `apps/web/src/app/pages/room/queue/queue-panel.ts`
- `apps/web/src/app/pages/room/queue/queue-panel.html`
- `apps/web/src/app/pages/room/queue/queue-panel.scss`
- `apps/web/src/app/pages/room/queue/queue-panel.spec.ts`

Modify

- `apps/web/src/app/pages/room/realtime.service.ts`
- `apps/web/src/app/pages/room/room.page.ts` / `.html` / `.scss`
- `apps/web/src/app/pages/room/voice/voice.service.ts`
- `apps/web/src/app/pages/room/player/player-panel.ts` (+ `ktv-player.ts`, `youtube.player.ts`,
  `click-track.player.ts` for `duration()`)
- `apps/web/src/app/pages/room/ktv-scene.ts` (away dimming)

## Implementation Steps

1. `RealtimeService`: new signals, emitters, `queue:state` / `skip:state` listeners with the `rev`
   stale guard; include `ack.queue` / `ack.skip` in the join handler.
2. `queue-panel` component: inputs none (injects `RealtimeService` + `AuthService`), template with
   the current turn, the ordered list, own-entry remove buttons, the paste form and the error line.
3. Countdown: a `computed()` over `rt.serverNow()` refreshed by a 1 s `setInterval` signal in the
   panel (same style as the player's tick), formatted `m:ss`.
4. Skip button with `have/needed`, hidden for the singer, tooltip of voter names.
5. `room.page.html`: replace the YouTube part of the paste form with `<app-queue-panel />` in the
   side HUD; keep "Nhạc thử nhịp" and the pause/resume button in the footer; add the singer-away
   banner with "Giữ bài".
6. `VoiceService`: `prepareMic(headphones)` (open + stop a stream, remember the answer);
   an `effect()` that calls `startSinging(remembered)` when `role()` becomes `'singer'` and no mic is
   open; keep `startSinging` public for the manual "Lên hát" path. Guard against double-arming and
   against arming in a second tab (the existing `reconcile` already handles "no mic in this tab").
7. Mic pre-flight after the first successful `queue:add`.
8. Away styling in the presence list and `ktv-scene.setMembers` (dim + "(mất kết nối)").
9. `player-panel.ts` duration/error reporting; remove the local end stop.
10. Web unit tests: `queue-panel.spec.ts` renders the order, shows "✕" only on my entries, hides the
    skip button for the singer. Then `pnpm --filter web test --watch=false`.
11. Run `pnpm build`, then `pnpm start` + `pnpm test:sync` to prove T-01 still passes.

## Todo List

- [ ] `RealtimeService` queue/skip signals + emitters + join ack
- [ ] `queue-panel` renders current turn, order, singer names, own-entry removal
- [ ] Server rejection messages shown under the paste box
- [ ] Vote-skip button with live `have/needed`, hidden for the singer
- [ ] "Xuống sân khấu" ends the turn; "Lên hát" only when the stage is free
- [ ] Mic permission asked at queue time (S-02); mic arms itself at turn start (S-01)
- [ ] Mic failure shows a retry, song keeps playing
- [ ] Away members greyed in the list and dimmed in 3D
- [ ] Singer-away banner with countdown, "Giữ bài" and a working "Lên hát" for everyone
- [ ] Idle-room wording
- [ ] Duration/error reporting from the player
- [ ] `pnpm --filter web test --watch=false` green, `pnpm build` green, `pnpm test:sync` PASS

## Success Criteria

- Two browsers: A queues two songs, B queues one → both see A1, B1, A2 with the right names.
- A's turn starts by itself, A's chibi is on stage, A's mic is live without a second click, B hears A.
- B presses "Bỏ qua bài này" → in a room of two it advances to B's song.
- A refreshes mid-song → A is back on stage within a couple of seconds, music never stopped.
- `pnpm test:sync` still prints PASS with the same p90 range as Phase 1 (2–17 ms on one machine).

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| T-01 breaks because labels or flows moved | Keep the four button labels and the click-track path untouched; run `test:sync` in this phase, not only in phase 07 |
| Automatic `getUserMedia` blocked (no prior permission, iOS) | Pre-flight at queue time; clear retry button; the song plays regardless (iOS is listener-only per N-08) |
| Two tabs both try to arm the mic | `reconcile` already ignores a tab without a mic; the auto-arm effect runs only when `role() === 'singer'` and this tab has no mic, and the ack from `stage` keeps one owner |
| Side HUD gets crowded on a laptop | Queue panel scrolls inside its own box; the video panel keeps its size (P-04) |
| Countdown drifts | Use `rt.serverNow()`, the clock already synced every 30 s (Y-03) |

## Security Considerations

- No new HTTP endpoint; all queue actions go over the authenticated socket.
- Nothing from the server is rendered as HTML (Angular interpolation only), so a song title from
  YouTube cannot inject markup.
- The mic is opened only for the person whose turn it is, and stopped as soon as the turn ends
  (existing `stopMic`), so no background recording (requirements §5).

## Next Steps

- Phase 07 runs the whole suite plus the two-laptop checklist and updates the docs.
- Phase 4 of the project (everyone's voice, duets) builds on the queue entry's singer fields.
