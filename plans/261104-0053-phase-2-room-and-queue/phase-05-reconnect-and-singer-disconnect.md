# Phase 05 — Reconnect keeps your seat; singer disconnect rule

## Context Links

- [plan.md](plan.md) · [phase-02](phase-02-server-queue-and-turns.md) · [phase-03](phase-03-vote-skip.md)
- `E:\Work\chibi-ktv\apps\server\src\rooms\room-state.ts` (`addSocket` / `removeSocket` today)
- `E:\Work\chibi-ktv\apps\server\src\rooms\rooms.gateway.ts` (`leaveCurrentRoom`, `EMPTY_ROOM_TTL_MS`)
- `E:\Work\chibi-ktv\apps\web\src\app\pages\room\realtime.service.ts` (re-joins on every `connect`, N-12)
- Requirements: **N-12** "After a network drop, the client reconnects and re-syncs within 5 s and
  keeps its seat" · **R-09** "If the singer disconnects mid-song, the music keeps playing, the stage
  shows empty, and the song ends after 20 s unless the host keeps it" (no host in v1 → anyone may keep it)

## Overview

- **Priority:** P1
- **Status:** pending
- Today the last socket closing deletes the member instantly: presence drops them, the stage frees,
  and (after phase 02) their queue entries would go too — a plain F5 would cost you your turn. Add a
  20-second "away" grace that protects the member's **seat and queue entries**. The **stage is not
  protected**: it reads empty at once and anyone may step up. If the singer does not come back within
  20 s the song ends — unless somebody kept it ("Giữ bài") or somebody took the stage.

## Key Insights

- The browser already re-joins on every `connect` (`realtime.service.ts` re-emits `room:join`), and
  presence is keyed by `userId` with a set of socket ids. So identity already survives a reconnect —
  what is missing is that the member is removed before the reconnect lands.
- "Seat" in Phase 2 means presence slot + capacity slot + queue entries + the stage. Real 3D seat
  numbers are Phase 3; `away` is the hook Phase 3 will reuse to grey out the chair.
- Capacity must count away members, otherwise a friend's refresh in a full room loses their place to
  someone else — the opposite of N-12.
- R-09's 20 s and a comfortable reconnect window are the same number: one constant,
  `AWAY_GRACE_MS = 20_000`, used for both.
- Both rules are "has server time passed X", so they belong in the 1 s tick from phase 02. No extra
  timers.
- **Decided (Bảo): the stage is never reserved.** The grace covers the seat and the queue, not the
  microphone — a friend may jump on stage the second the singer drops, during the grace, kept song or
  not. That removes all reservation logic: `stage:take` is simply "is the stage empty?", exactly as in
  Phase 1, and `TurnState.singerAwayUntilMs` becomes only a deadline for ending the **song**.
- Consequence: someone taking the empty stage mid-song is an implicit "keep" — it would be silly to
  cut the song off at 20 s while a friend is rescuing it. So `stage:take` during an away window also
  sets `kept = true`.

## Requirements

Functional

1. `removeSocket(userId, socketId)` with no sockets left marks the member
   `away = true, awayUntilMs = now + AWAY_GRACE_MS` instead of deleting them. Presence is broadcast
   with `away: true` (N-12).
2. Re-join by the same `userId` within the grace clears `away` and `awayUntilMs`: same seat, same
   queue entries, same turn, same votes.
3. Capacity check in `room:join` counts away members too; a returning member is always let back in
   even in a full room (they already hold the slot).
4. `tick(now)`: a member whose `awayUntilMs` has passed is removed for good →
   remove their pending queue entries, drop their skip vote, broadcast presence + queue (+ skip).
5. If the **current turn's singer** goes away: `stage` is cleared for real
   (`singerId: null, singerName: null`) and **stays takeable by anyone**; `TurnState.singerAwayUntilMs`
   is set only as the song's end deadline; the music keeps playing (playback untouched); everyone sees
   `'<name> mất kết nối — bài sẽ dừng sau 20 giây. Bấm “Giữ bài” hoặc lên hát tiếp.'` (R-09).
6. `stage:take` has **no turn-related guard**: it succeeds whenever the stage is empty, including
   during an away window. Doing so clears `singerAwayUntilMs` and sets `kept = true`, with notice
   `'<name> lên hát tiếp bài này'` — the new singer finishes the song and the turn runs to its
   server-decided end (phase 04).
7. `turn:keep` ("Giữ bài") — any member, only while `singerAwayUntilMs` is set: sets `kept = true`,
   clears `singerAwayUntilMs`, notice `'<name> đã giữ bài — cả phòng hát tiếp'`. It keeps the **song**
   and nothing else: it never blocks, reserves or grants the stage.
8. If the grace passes and the song was neither kept nor taken over → `advance()` (the turn ends, the
   queue moves on).
9. If the singer returns within the grace: `away` cleared and they keep their seat and queue entries.
   The stage comes back to them **only if it is still empty** — notice `'<name> đã kết nối lại'`; if
   someone else is now singing, the returning member is a listener for the rest of the song. No
   stealing back, no reservation.
10. The room's empty-room TTL (R-10, 30 min) only starts once there are no members at all, away
    included — move that check after the sweep.

Non-functional

- Reconnect and re-sync in under 5 s (N-12): the grace is 20 s, so the window is comfortable; nothing
  about the clock sync or the player changes.
- Tick cost stays O(members) per second per live room.

## Architecture

```
Member { displayName; sockets:Set<string>; joinedAt; away:boolean; awayUntilMs:number|null }

disconnect (last socket)          → away = true,  awayUntilMs = now + 20 s   → emit presence
   if member is the turn's singer → stage = empty (free for anyone)
                                    turn.singerAwayUntilMs = now + 20 s      → emit stage + notice
re-join same userId within grace  → away = false, awayUntilMs = null         → emit presence
   if turn's singer AND stage empty → stage = { singerId, singerName },
                                      singerAwayUntilMs = null               → emit stage + notice
   if turn's singer AND stage taken → nothing (they listen; seat + queue kept)
tick(now)
   member.awayUntilMs  <= now     → delete member, queue.removeAllOf(id), votes.drop(id)
   turn.singerAwayUntilMs <= now  → advance()        // kept/taken-over already cleared it
stage:take (stage empty)          → stage = taker; if (singerAwayUntilMs) { kept = true;
                                    singerAwayUntilMs = null }               → emit stage + notice
turn:keep (singerAwayUntilMs set) → kept = true, singerAwayUntilMs = null    → emit queue + notice
```

There is **no** stage-reservation state: `stage:take` checks only "is the stage empty", the Phase 1
rule. `kept` and `singerAwayUntilMs` describe the song, never the microphone.

State placement: `away`, `awayUntilMs`, `singerAwayUntilMs` and `kept` are seconds-to-minutes old
facts about live sockets — memory only, no DB. Nothing here is worth surviving a restart (a restart
disconnects everyone anyway).

Two tabs: unchanged. The member only goes away when their **last** socket closes, so closing one tab
does nothing — the existing test covers it.

## Related Code Files

Modify

- `apps/server/src/rooms/room-state.ts` — `Member` gains `away`/`awayUntilMs`; `removeSocket` marks
  instead of deletes and frees the stage; `addSocket` clears the flag and takes the stage back only
  if it is still empty; `takeStage` keeps its Phase 1 "is the stage empty" guard and clears the away
  deadline; `presence()` includes `away`; `size` / capacity counting; the sweep inside `tick()`.
- `apps/server/src/rooms/rooms.gateway.ts` — `leaveCurrentRoom` delegates to the state (which frees
  the stage and sets the deadline); `turn:keep` handler; capacity check allows a returning member;
  empty-room TTL armed only when there are no members at all.
- `apps/server/src/rooms/room-queue.ts` — `removeAllOf(userId)` used by the sweep; `advance()` skips
  entries whose singer is no longer a member.
- `apps/server/src/rooms/room-state.spec.ts` — the scenarios below.
- `apps/web/src/app/pages/room/room.page.html` — "Giữ bài" button + the away countdown (phase 06
  details the UI).
- `apps/web/src/app/pages/room/ktv-scene.ts` — dim an away chibi (small change, uses the new
  `away` flag).

## Implementation Steps

1. Add `AWAY_GRACE_MS = 20_000` to `packages/shared/src/queue.ts` (both sides show the countdown).
2. `Member` fields + `removeSocket` marks away; `presence()` maps `away`.
3. `addSocket`: if the member exists and was away → clear `away` / `awayUntilMs` (seat and queue are
   already intact). If they are the current turn's singer **and** `stage.singerId === null` → put them
   back on stage, clear `singerAwayUntilMs`, notice. If someone else holds the stage, change nothing
   about the stage.
4. Singer-away branch in `removeSocket`: clear `stage` (anyone may take it), set
   `turn.singerAwayUntilMs = now + AWAY_GRACE_MS`, leave playback untouched, notice.
5. `takeStage(userId)`: keep the existing guard (refuse only when someone else is on stage — the
   Phase 1 rule, no turn check). On success, if `singerAwayUntilMs` is set, clear it and set
   `kept = true` so the rescued song is not cut off at the deadline.
6. `tick()` sweep: expire away members (with queue/vote cleanup), then `singerAwayUntilMs <= now`
   → `advance()` (kept and taken-over songs already cleared the deadline), then the song-end check
   from phase 04. Order matters — write it as one well-commented method.
7. `turn:keep` handler + `RoomState.keepSong(userId)` guard (only while `singerAwayUntilMs` is set).
   It touches `kept` / `singerAwayUntilMs` only — never `stage`.
8. Capacity: `size` counts away members; `join` lets a known member back in regardless.
9. Empty-room TTL: arm only when `members.size === 0` after the sweep.
10. Tests (fake clock):
    - last socket closes → still in presence with `away: true`; re-join in 5 s → `away` false, queue
      entries intact;
    - no re-join → removed at 20 s, their two queue entries gone, their vote gone;
    - singer drops mid-song → playback unchanged, stage empty, `singerAwayUntilMs` set; return at 10 s
      with an empty stage → stage back to them;
    - singer drops and nobody keeps or takes it → at 20 s the next entry starts;
    - singer drops, someone presses `turn:keep` → song still playing at 30 s, stage still empty and
      `stage:take` by another member succeeds;
    - **singer drops, another member takes the stage at 5 s** → `kept` true, no advance at 20 s, song
      runs to its own end; the original singer re-joins at 10 s and does **not** get the stage back,
      but keeps their seat and remaining queue entries;
    - full room (capacity 8): a member refreshes, a 9th person cannot take their slot.
11. e2e (phase 07 file): socket closes and reconnects with the same cookie → `JoinAck` still shows
    their queue entry, and the stage only if nobody took it.

## Todo List

- [ ] `AWAY_GRACE_MS` in shared
- [ ] `away` / `awayUntilMs` on `Member`, in `presence()` and in capacity counting
- [ ] Re-join inside the grace keeps seat, queue entries and votes
- [ ] Away sweep removes the member, their entries and their vote
- [ ] Singer-away: music keeps playing, stage is freed for anyone, 20 s song deadline, notice
- [ ] `stage:take` keeps its Phase 1 guard only (no turn/reservation check) and clears the deadline
      with `kept = true`
- [ ] `turn:keep` keeps the song and never touches the stage
- [ ] Singer's return restores the stage only when it is still empty
- [ ] Empty-room TTL only after the sweep
- [ ] `advance()` skips entries whose singer has left
- [ ] Unit tests for all eight scenarios green

## Success Criteria

- F5 in the middle of your own turn: within ~2 s you are back on the empty stage, the music never
  stopped, your queued songs are still there (N-12).
- Pull the network on the singer's laptop: everyone keeps hearing the backing track, the stage is
  immediately free ("🎤 Lên hát" appears for everyone), and 20 s later the next person's song starts —
  unless someone pressed "Giữ bài" or stepped on stage, in which case the song finishes (R-09).
- A friend who grabs the stage at second 5 keeps it for the rest of the song, even when the original
  singer reconnects at second 10.
- A full room still belongs to the people in it while they reconnect.
- `pnpm --filter server test` + `test:e2e` green; existing Phase 1 test
  "frees the stage when the singer disconnects" updated to the new rule (stage shows empty
  immediately, turn ends after the grace).

## Risk Assessment

| Risk | Mitigation |
| --- | --- |
| Away members pile up and hold seats in a small room | 20 s is short and the sweep is unconditional; capacity frees up right after |
| The old e2e expectation (stage frees instantly) now fails | Update that spec deliberately — the stage **does** read empty immediately; what changed is that the turn survives 20 s |
| Voice peers linger for an away singer | `VoiceService.reconcile` already closes peers when `stage.singerId` becomes null; the returning singer re-offers (phase 06 re-arms the mic) |
| A returning singer is surprised to find someone else on the mic | By decision; the notice says who took over, the song finishes, and their remaining queue entries are untouched |
| Grace feels long before the next singer | Single `AWAY_GRACE_MS` constant, and anyone can step on stage straight away, so nobody actually waits |

## Security Considerations

- Away members are identified by the JWT `userId` only, so nobody can reclaim someone else's seat or
  turn by guessing a socket id.
- `turn:keep` is membership-checked and only valid while a singer-away deadline exists, so it cannot
  be used to pin a song forever.
- Away state is not persisted and cannot be used to hold a room hostage past the 30-min TTL.

## Next Steps

- Phase 06 renders away members, the countdown, "Giữ bài" and the always-available "Lên hát" while a
  singer is away, and re-arms the singer's mic after a reconnect.
- Phase 3 of the project reuses `away` for the real seat map.

## Decided

1. `AWAY_GRACE_MS = 20_000` for both the seat grace and the song deadline (R-09). One constant.
2. The stage is never reserved: anyone may take it the moment the singer is away, during the grace,
   kept song or not. Taking it also keeps the song (`kept = true`).
3. An away member's **current turn** is dropped, not returned to the queue — they re-queue in one
   click. Their *pending* entries survive the whole grace.
