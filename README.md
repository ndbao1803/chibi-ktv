# Chibi KTV

A 3D karaoke room for friends: chibi avatars on a neon KTV sofa, a synced YouTube video, one or two singers on stage, and everyone else cheering. Free to run.

This repository covers **Phases 0–4** of the [build plan](https://claude.ai/artifact/LjiLdQTz1dMBAry5duejm7): accounts, rooms, the 3D room, the hard part (everyone hears the song in step, and listeners hear the singer on the beat), and a real song queue with turns. The full requirements are in the [requirements doc](https://claude.ai/artifact/V5EHAsxFvTYYmevnu7bpL3).

## What works now

- Create an account (email + password) and log in. The login lives in an httpOnly cookie.
- Create a room (8 or 16 seats) and get a 6-character code and an invite link.
- Open the link on another device: it asks you to log in, then drops you into the same room.
- Everyone in the room appears as a chibi on the sofa, and in the "Đang online" list.
- The bottom bar shows your clock offset to the server and the round-trip delay.

**Phase 1 (sync):**

- A YouTube song plays for everyone, starting at the same moment. Anyone can pause or resume, and a message says who did it (version 1 has no host).
- **Nhạc thử nhịp** plays a built-in 120 BPM click track. Open the room on two laptops side by side: the clicks must sound together. No YouTube needed.
- **🎤 Lên hát**: confirm headphones, allow the mic, and your chibi walks onto the stage. Your voice goes straight to each friend's browser (peer-to-peer WebRTC, free).
- Listeners' music follows the singer, delayed by exactly as long as the voice takes to arrive, so voice and music line up. The video panel shows **Theo ca sĩ ±N ms** while following.
- The singer's chibi mouth moves with the real voice.

**Phase 2 (room and queue):**

- **Danh sách bài:** paste a YouTube link and press **Thêm bài**. You are the singer of every song you add. The panel shows the song playing now with the time left, then who sings next.
- **Turns are fair (round-robin):** someone who has sung less goes first, so one person can't hog the mic. Up to 5 songs each, 50 per room. Remove your own songs with ✕.
- **Your turn starts by itself:** your chibi goes on stage and your mic switches on with no extra click. The first time you add a song, it asks which headphones you use and asks the browser for mic permission right then.
- **Bỏ qua bài này:** a song is skipped when half of the listeners vote (the singer can't vote; they press **Xuống sân khấu**).
- **The server ends songs:** it knows each video's length (from YouTube's data API, or reported by the first player that loads it), so every browser moves on at the same moment. Videos that can't play (removed, embed blocked) are skipped for everyone with a message.
- **Dropped connections:** if you lose the connection, you keep your place, your songs and your vote for 20 seconds. Others see you greyed out "(mất kết nối)". If the singer drops, the music keeps going and everyone sees "… bài sẽ dừng sau 20 giây": anyone can press **Giữ bài** to finish the song, or **🎤 Lên hát** to sing it. If the singer comes back in time, they get the stage back.

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
4. **Singer audio:** with wired headphones the mic is sent raw (no echo cancellation or noise suppression, which damage singing), Opus mono, DTX off, up to 64 kbps. Listeners keep an 80 ms jitter buffer so Wi-Fi/4G hiccups don't cut the voice. On iPhone the mic is not tapped into Web Audio (it makes the voice crackle), so the singer's chibi mouth and mic meter don't move there; AirPods drop the mic to call quality, so use wired earphones.

Optional settings in `apps/server/.env`: `YOUTUBE_API_KEY` (checks title, length, embeddable, blocked in Vietnam), and `CF_TURN_KEY_ID` + `CF_TURN_KEY_TOKEN` (Cloudflare's free TURN relay, for friends behind strict networks). Without them, any valid link plays and free STUN servers are used.

**Phase 3 (the full 3D room):**

- The room from the design prototype: concrete walls, neon strips and signs ("CHIBI KTV", "Hát hết mình"), TV wall in a gold frame, truss towers with moving lights, disco ball, Edison bulbs, fairy lights, plants, balloons, a glowing drinks fridge, the U-sofa and the table with fruit and the song tablet.
- **Seats:** everyone gets a seat on arrival (side sofas first). Free seats show a pulsing ring and "Ghế trống · bấm để ngồi"; click one and your chibi stands up and walks round the table to it, and everyone sees the walk. Two people clicking the same seat: the first wins, the other is told. Rooms of 16 add a row of bar stools.
- **Stage:** when your turn starts, your chibi walks from your seat to the stage and picks up the mic; your seat says "Ghế của …" until you come back.
- **Camera:** **Cả phòng**, **Sân khấu**, **Chỗ tôi** (from your seat). Drag to look around.
- **Tiết kiệm pin:** hides the fairy lights, light cones and balloons and lowers the resolution. Phones start with it on, and it switches itself on if the room drops under ~28 fps.

**Phase 4 (everyone's voice and duets):**

- **Talk any time:** hold **V** or the 🎙️ button (push-to-talk), or tick **Mic mở** (open mic, sends only while you speak; up to 8 open mics per room). Echo cancelling is on for talking, so music from your speakers doesn't come back.
- **Mixing:** during a song the audience is at 30% under the singer; move **Khán giả khi hát** to change it for yourself. Singers hear the audience at 15%, or tick **Tắt tiếng khán giả**. 🔊/🔇 next to a name mutes that person for you only. A ring glows around whoever is talking.
- **📣 Hú hét:** a cheer everyone hears (at the audience level), and your chibi throws its arms up. One every 3 seconds.
- **Duets:** when adding a song pick **Mời song ca** and a friend. They get a card with **Đồng ý / Từ chối** and 30 seconds; the queue shows "đang chờ … trả lời" and you can **Huỷ mời**. Yes: both of you go on stage under two spotlights, each with your own mic. No answer: you sing it alone. **Không nhận lời mời song ca** turns invites off.
- How it works: the lead singer's voice and music timing travel as before; everyone else's voice (and the duet partner's singing) uses a second set of peer-to-peer connections, one per pair of people. `pnpm test:voice` checks all of this with three browsers.

## Try it on two laptops (checklist)

1. Laptop A creates a room, laptop B opens the invite link (different networks if you can, e.g. one on 4G hotspot).
2. A adds two songs, B adds one: both see A1, B1, A2.
3. A's song starts by itself, A's mic switches on, B hears A on the beat (B's video says "Theo ca sĩ").
4. B presses **Bỏ qua bài này** → B's song starts, B's mic switches on.
5. B refreshes the page mid-song → A sees "Bình mất kết nối…", B comes back on stage within a few seconds.

## Next: Phase 5 (the party layer)

- Props and shaking (maracas, tambourine, lightstick, clap), reactions, chat with bubbles
- Cheers, flowers, crowd dance, lightstick wave, fart prank
- Hype meter, star rating and the score screen
