# Chibi KTV

A 3D karaoke room for friends: chibi avatars on a neon KTV sofa, a synced YouTube video, one or two singers on stage, and everyone else cheering. Free to run.

This repository covers **Phase 0 and Phase 1** of the [build plan](https://claude.ai/artifact/LjiLdQTz1dMBAry5duejm7): accounts, rooms, the 3D room, and the hard part: everyone hears the song in step, and listeners hear the singer on the beat. The full requirements are in the [requirements doc](https://claude.ai/artifact/V5EHAsxFvTYYmevnu7bpL3).

## What works now

- Create an account (email + password) and log in. The login lives in an httpOnly cookie.
- Create a room (8 or 16 seats) and get a 6-character code and an invite link.
- Open the link on another device: it asks you to log in, then drops you into the same room.
- Everyone in the room appears as a chibi on the sofa, and in the "Đang online" list.
- The bottom bar shows your clock offset to the server and the round-trip delay.

**Phase 1 (sync):**

- Paste a YouTube link and press **Phát**: it plays for everyone, starting at the same moment. Anyone can pause or resume, and a message says who did it (version 1 has no host).
- **Nhạc thử nhịp** plays a built-in 120 BPM click track. Open the room on two laptops side by side: the clicks must sound together. No YouTube needed.
- **🎤 Lên hát**: confirm headphones, allow the mic, and your chibi walks onto the stage. Your voice goes straight to each friend's browser (peer-to-peer WebRTC, free).
- Listeners' music follows the singer, delayed by exactly as long as the voice takes to arrive, so voice and music line up. The video panel shows **Theo ca sĩ ±N ms** while following.
- The singer's chibi mouth moves with the real voice.

## Tech stack, and what each piece teaches you

| Piece | What it is | Where to look |
| --- | --- | --- |
| **pnpm workspaces** | One repo, three packages that share code | `pnpm-workspace.yaml` |
| **Angular** (standalone components, signals) | The website: login, lobby, room HUD | `apps/web/src/app` |
| **Three.js** | The 3D room, in plain TypeScript classes | `apps/web/src/app/pages/room/ktv-scene.ts` |
| **NestJS** | The backend. Built like Angular: modules, services, dependency injection, decorators | `apps/server/src` |
| **PostgreSQL** | The database: users and rooms | `apps/server/src/db/schema.ts` |
| **Drizzle ORM** | Type-safe SQL from TypeScript; migrations are plain SQL files | `apps/server/drizzle/` |
| **argon2 + JWT cookie** | Password hashing and login sessions | `apps/server/src/auth` |
| **Socket.IO** | Realtime: join, presence, clock, playback, stage, WebRTC setup | `rooms.gateway.ts`, `realtime.service.ts` |
| **WebRTC** | Peer-to-peer voice and a data channel for the singer's position | `apps/web/.../room/voice/voice.service.ts` |
| **Web Audio** | The click track, and voice loudness for the chibi's mouth | `player/click-track.player.ts`, `audio.service.ts` |
| **YouTube IFrame API** | The official player, in a flat panel nothing covers | `player/youtube.player.ts` |
| **Sync maths** | Pure functions with unit tests: targets, jumps, speed nudges | `room/sync/sync-math.ts` |
| **Zod** | One set of validation rules used by both browser and server | `packages/shared/src/index.ts` |
| **Vitest + Supertest** | Tests that call the real API against a real database | `apps/server/test` |
| **Docker Compose** | PostgreSQL on your laptop | `docker-compose.yml` |
| **Render + Neon** | Free hosting for the app and the database | `render.yaml` |

## Run it on your laptop

You need Node.js 22+, Docker Desktop, and pnpm (`corepack enable` turns it on).

```bash
pnpm install
pnpm db:up                                  # start PostgreSQL in Docker
cp .env.example apps/server/.env            # then edit JWT_SECRET (optional keys inside)
```

Start the server and the website in two terminals:

```bash
# terminal 1 — API + realtime on http://localhost:3000 (reads apps/server/.env, applies DB migrations on start)
pnpm dev:server

# terminal 2 — Angular dev server on http://localhost:4200 (proxies /api and /socket.io to :3000)
pnpm dev:web
```

Open http://localhost:4200, create an account, create a room. To be two people at once, open a private window, make a second account and paste the room link.

## Tests

```bash
pnpm db:up
docker compose exec db createdb -U ktv ktv_test   # once
pnpm test                                          # unit + e2e (login, rooms, realtime presence)
pnpm --filter web test --watch=false               # Angular tests
```

The e2e tests start the whole NestJS app, register real users in the test database, and connect real Socket.IO clients.

### Sync test (T-01)

With the app running (`pnpm build && pnpm start`), in a second terminal:

```bash
pnpm test:sync          # 1 singer + 2 listeners in headless Chrome, 25 s
LISTENERS=5 SECONDS=60 pnpm test:sync
```

It prints, for each listener, how far its music is from where the singer's voice says it should be (p50 / p90 in ms) and the measured voice delay, and fails above 150 ms at p90. On one machine the result is about 2–17 ms p90 with a ~60 ms voice delay. That measures the sync logic; real networks and YouTube's own jumps add more, so also do the two-laptop test with real friends.

## Change the database

1. Edit `apps/server/src/db/schema.ts`.
2. `cd apps/server && pnpm db:generate --name what_changed` writes a new SQL file in `drizzle/`. Read it: it is plain SQL.
3. Restart the server: it applies new migrations on start.

## Deploy for free

1. **Database:** create a free project at [neon.com](https://neon.com) (no card). Copy the connection string (`postgres://…?sslmode=require`).
2. **Code:** push this repo to GitHub.
3. **App:** at [render.com](https://render.com) choose *New → Blueprint*, pick the repo. Render reads `render.yaml`. When asked, paste the Neon string as `DATABASE_URL`. Do not add a payment card: if a free limit is ever hit, the service pauses instead of billing.
4. Open `https://<your-app>.onrender.com`. The free server sleeps after 15 minutes without visitors and takes about a minute to wake, so open it a minute before your friends.

## Project layout

```
packages/shared/      Zod schemas + event names shared by both sides
apps/server/          NestJS
  src/db/             schema, database module, migration runner
  src/auth/           register/login/logout/me, cookie, guard
  src/rooms/          rooms REST API, Socket.IO gateway, presence
  src/health/         /api/health
  drizzle/            SQL migrations
  test/               e2e tests against PostgreSQL
apps/web/             Angular
  src/app/core/       auth service, route guards
  src/app/pages/      login, lobby, room (3D scene + realtime service)
```

## How the sync works

1. **One clock.** Every browser measures its offset to the server clock (5 pings, keep the fastest). The server says “this song was at 0 s at server time T”.
2. **Nobody singing:** each player follows server time. YouTube jumps only when more than 1 s off (at most every 10 s); the click track nudges its speed by up to 5%.
3. **Someone singing:** the singer's browser sends its exact music position 4 times a second over the WebRTC data channel. Each listener plays the music later than the singer by: how late the voice arrives (half the round trip + jitter buffer + ~20 ms), plus how late the singer hears their own music and how slow their mic is (sound card latency, +0.2 s for Bluetooth headphones; the singer's browser measures and sends this), plus the listener's own fine-tune slider. YouTube jumps when more than 0.15 s off (at most every 8 s) and learns how long its jumps take.
5. **Fine-tune by ear:** if the singer still sounds late or early, each listener can drag "Giọng trễ hơn nhạc? Kéo sang phải" (±400 ms). It is saved in that browser.
4. **Singer audio:** with wired headphones the mic is sent raw (no echo cancellation or noise suppression, which damage singing), Opus mono, DTX off, up to 96 kbps.

Optional settings in `apps/server/.env`: `YOUTUBE_API_KEY` (checks title, length, embeddable, blocked in Vietnam), and `CF_TURN_KEY_ID` + `CF_TURN_KEY_TOKEN` (Cloudflare's free TURN relay, for friends behind strict networks). Without them, any valid link plays and free STUN servers are used.

## Next: Phase 2 (room and queue)

- Song queue with turns, vote-skip, server-decided song end
- Rejecting blocked videos when pasted, auto-skip on player errors
- Reconnect keeps your seat; singer disconnect rule
