// T-01: several real browsers in one room. One sings (fake mic) over the test click track,
// the others listen. Measures how closely each listener's music follows the singer's voice.
//
//   pnpm build && pnpm start            (server with a database, on BASE_URL)
//   pnpm test:sync                      (in another terminal)
//
// Env: BASE_URL (default http://localhost:3000), LISTENERS (2), SECONDS (25), TARGET_P90_MS (150)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LISTENERS = Number(process.env.LISTENERS ?? 2);
const SECONDS = Number(process.env.SECONDS ?? 25);
const TARGET = Number(process.env.TARGET_P90_MS ?? 150);
const SETTLE_SAMPLES = 30; // ignore the first ~3 s of each listener while it locks on

const tag = Math.random().toString(36).slice(2, 8);
async function signup(name) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name.toLowerCase()}-${tag}@sync.test`, password: 'sync-test-123', displayName: name }),
  });
  if (!res.ok) throw new Error(`register ${name}: ${res.status} ${await res.text()}`);
  return /ktv_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1];
}
const pct = (xs, p) => {
  const s = xs.map(Math.abs).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

const names = ['Singer', ...Array.from({ length: LISTENERS }, (_, i) => `Listener${i + 1}`)];
const tokens = await Promise.all(names.map(signup));
const room = await (
  await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `ktv_token=${tokens[0]}` },
    body: JSON.stringify({ name: 'Sync test', capacity: 8 }),
  })
).json();

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const pages = [];
for (const token of tokens) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addCookies([{ name: 'ktv_token', value: token, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
  await page.goto(`${BASE}/room/${room.code}?lite=1`);
  await page.getByRole('button', { name: 'Vào phòng' }).click();
  pages.push(page);
}
const [singer, ...listeners] = pages;

await singer.getByRole('button', { name: 'Nhạc thử nhịp' }).click();
await singer.getByRole('button', { name: /Lên hát/ }).click();
await singer.getByRole('button', { name: /tai nghe có dây/ }).click();
console.log(`Room ${room.code}: ${names[0]} sings the test track, ${LISTENERS} listening for ${SECONDS} s…`);
await singer.waitForTimeout(SECONDS * 1000);

let worst = 0;
const rows = [];
for (const [i, page] of listeners.entries()) {
  const probe = await page.evaluate(() => window.__ktvSync);
  const samples = probe.samplesMs.slice(SETTLE_SAMPLES);
  const p50 = pct(samples, 50);
  const p90 = pct(samples, 90);
  worst = Math.max(worst, Number.isNaN(p90) ? Infinity : p90);
  rows.push({ listener: names[i + 1], mode: probe.mode, samples: samples.length, 'p50 ms': p50.toFixed(1), 'p90 ms': p90.toFixed(1), 'voice delay ms': probe.voiceDelayMs });
}
const singerProbe = await singer.evaluate(() => window.__ktvSync);
console.table(rows);
console.log(`Singer role: ${singerProbe.role}, music at ${singerProbe.position.toFixed(1)} s`);
await browser.close();

if (!(worst <= TARGET)) {
  console.error(`FAIL: worst listener p90 ${worst.toFixed(1)} ms > ${TARGET} ms (or no follow samples)`);
  process.exit(1);
}
console.log(`PASS: every listener follows the singer within ${TARGET} ms at p90 (worst ${worst.toFixed(1)} ms).`);
