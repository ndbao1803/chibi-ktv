# Chibi KTV — notes for Claude Code

A free 3D karaoke web app for a group of friends (8–16 per room): chibi avatars in a Vietnamese KTV-style room (ICOOL-inspired look: concrete + neon, U-sofa, stage), a YouTube karaoke video that plays in sync for everyone, one or two singers on stage, the rest talking, cheering and rating. Owner: Bảo. Budget: $0 (free tiers only, no payment card anywhere). Purpose: have fun and learn new technology, so explain choices and keep code readable.

## Source documents (read these for scope)

- Requirements (IDs like Y-05, S-07, VC-02 are referenced in code comments): https://claude.ai/artifact/V5EHAsxFvTYYmevnu7bpL3
- Build plan, 7 phases with checklists: https://claude.ai/artifact/LjiLdQTz1dMBAry5duejm7
- Interactive 3D design prototype (the look to match): https://claude.ai/artifact/TpHcpP2DSVW9PGUAQp2ECZ

## Decisions already made

- Version 1 has **no host**: anyone can pause/resume/change song; skipping needs a vote. Host feature comes later.
- Login with email + password (argon2, JWT in an httpOnly cookie). Google sign-in later.
- Voice is **peer-to-peer WebRTC** (no LiveKit, no paid media server). Free STUN; optional Cloudflare TURN.
- The YouTube player is a **flat panel never covered or transformed** (YouTube player rules). The 3D TV is decoration only.
- Duets: two singers, two mics, singing together; partner is invited and answers yes/no. No duel/battle mode.
- Audience can talk and "hú hét" at any time, mixed at 30% under the singer during songs.
- Hosting: Render free web service + Neon free PostgreSQL (Render's free DB expires after 30 days).
- UI text is Vietnamese first.

## Stack

pnpm workspaces, TypeScript everywhere.

- `packages/shared` — Zod schemas, event names, pure helpers (`parseYouTubeId`, `expectedPosition`). Build it first.
- `apps/server` — NestJS 12, Socket.IO gateway (namespace `/rt`), Drizzle ORM + PostgreSQL, Vitest. Room live state is in memory (`rooms/room-state.ts`); users and rooms are in the DB.
- `apps/web` — Angular 22 (standalone components, signals, zoneless), Three.js used directly in `pages/room/ktv-scene.ts`, WebRTC in `pages/room/voice/voice.service.ts`, sync loop in `pages/room/player/player-panel.ts`, pure sync rules in `pages/room/sync/sync-math.ts`.
- Room live state ticks once a second (`RoomLiveService`): away sweep, singer-away deadline, vote-skip, song end, in that order.
- `e2e/sync.mjs` — T-01 multi-browser sync test with Playwright and a fake mic.

## Commands

```bash
pnpm install
pnpm db:up                         # PostgreSQL in Docker (port 5432, user/pass/db: ktv)
cp .env.example apps/server/.env   # set JWT_SECRET
pnpm dev:server                    # API + realtime on :3000, runs migrations on start
pnpm dev:web                       # Angular on :4200, proxies /api and /socket.io

pnpm test                          # shared build + server unit + server e2e (needs DB ktv_test)
pnpm --filter web test --watch=false
pnpm build && pnpm start           # production build, then in another terminal:
pnpm test:sync                     # T-01: 1 singer + 2 listeners, fails above 150 ms p90
```

Create the test database once: `docker compose exec db createdb -U ktv ktv_test`.
Database changes: edit `apps/server/src/db/schema.ts`, then `cd apps/server && pnpm db:generate --name <what>`.

## Status (5 Nov 2026)

- Phase 0 done: accounts, rooms with 6-character codes, 3D room, live presence, clock sync.
- Phase 1 done: synced playback (YouTube + built-in 120 BPM click track), singer mic over WebRTC, listeners follow the singer delayed by the measured voice delay, mouth follows the voice. T-01 on one machine: p90 5–21 ms.
- Phase 2 done: round-robin queue (`rooms/room-queue.ts`, `orderQueue` in shared), turns put the singer on stage and the mic arms itself, vote-skip (50% of non-singers), server-decided song end (`msUntilSongEnd`), fatal YouTube errors skip, 20 s away grace (`AWAY_GRACE_MS`) with singer-away rule and "Giữ bài" (`turn:keep`). Web queue panel in `pages/room/queue/`.
- Phase 3 done: room ported from the prototype into `pages/room/scene/` (`room-decor.ts`, `chibi.ts`, `seats.ts` with walking routes + tests, `kit.ts` helpers); `ktv-scene.ts` orchestrates. Server seats (`seat:take`, `firstFreeSeat`, `SEAT_FILL_ORDER` in shared), camera presets, low-power mode (RD-05) with automatic fallback.
- Deployed: GitHub ndbao1803/chibi-ktv (main auto-deploys to Render; Neon Postgres).
- **Not yet done:** real test on two laptops on different networks with a real YouTube video (checklist in README).
- Next: Phase 4 (everyone's voice, duet invites), Phase 5 (props, chat, fun moments, rating), Phase 6 (polish, first night).

## Conventions

- Validate every socket/HTTP input with the shared Zod schema; return `{ ok: false, error }` acks with a Vietnamese message.
- Keep sync logic in pure functions with unit tests.
- Server tests run against a real PostgreSQL, not mocks.
- Commit messages: short summary line, then bullet points.
