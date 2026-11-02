# Chibi KTV

A 3D karaoke room for friends: chibi avatars on a neon KTV sofa, a synced YouTube video, one or two singers on stage, and everyone else cheering. Free to run.

This repository is **Phase 0** of the [build plan](https://claude.ai/artifact/LjiLdQTz1dMBAry5duejm7): accounts, rooms, a 3D room you can enter, live "who is online", and the clock sync that later keeps YouTube in step. The full requirements are in the [requirements doc](https://claude.ai/artifact/V5EHAsxFvTYYmevnu7bpL3).

## What works now

- Create an account (email + password) and log in. The login lives in an httpOnly cookie.
- Create a room (8 or 16 seats) and get a 6-character code and an invite link.
- Open the link on another device: it asks you to log in, then drops you into the same room.
- Everyone in the room appears as a chibi on the sofa, and in the "Đang online" list.
- The bottom bar shows your clock offset to the server and the round-trip delay (Phase 1 builds on this).

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
| **Socket.IO** | Realtime: join a room, presence, clock pings | `rooms.gateway.ts`, `realtime.service.ts` |
| **Zod** | One set of validation rules used by both browser and server | `packages/shared/src/index.ts` |
| **Vitest + Supertest** | Tests that call the real API against a real database | `apps/server/test` |
| **Docker Compose** | PostgreSQL on your laptop | `docker-compose.yml` |
| **Render + Neon** | Free hosting for the app and the database | `render.yaml` |

## Run it on your laptop

You need Node.js 22+, Docker Desktop, and pnpm (`corepack enable` turns it on).

```bash
pnpm install
pnpm db:up                                  # start PostgreSQL in Docker
cp .env.example apps/server/.env            # then edit JWT_SECRET
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

## Next: Phase 1 (sync spike)

- Flat YouTube player panel that follows server time
- One singer's mic sent peer-to-peer (WebRTC) to listeners
- Singer sends its video position; listeners follow it
- Playwright test with several browsers measuring the voice-to-music offset
