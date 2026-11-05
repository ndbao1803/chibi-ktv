// Phase 4 check: everyone's voice (push-to-talk, open mic), cheers, and a duet invite that ends with
// two singers on stage and a listener hearing both. Three real browsers with a steady fake-mic tone.
//
//   pnpm build && pnpm start      (server with a database)
//   pnpm test:voice               (in another terminal)
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = mkdtempSync(join(tmpdir(), 'ktv-voice-'));
// Chrome's default fake mic only beeps now and then; a steady 330 Hz tone makes levels reliable.
const TONE = join(OUT, 'tone.wav');
{
  const rate = 48000, n = rate * 20, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 330 * i) / rate)), 44 + i * 2);
  writeFileSync(TONE, buf);
}
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const tag = Math.random().toString(36).slice(2, 8);
async function signup(name) {
  const res = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `u${Math.random().toString(36).slice(2, 8)}-${tag}@p4.test`, password: 'sync-test-123', displayName: name }) });
  return /ktv_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1];
}
const FAKE_YT = () => {
  window.YT = { Player: class {
    constructor(el, o) { this.t0 = null; this.at = 0; setTimeout(() => o.events.onReady(), 50); this.o = o; }
    getCurrentTime() { return this.t0 == null ? this.at : this.at + (performance.now() - this.t0) / 1000; }
    getDuration() { return 200; }
    playVideo() { if (this.t0 == null) { this.t0 = performance.now(); this.o.events.onStateChange({ data: 1 }); } }
    pauseVideo() { this.at = this.getCurrentTime(); this.t0 = null; this.o.events.onStateChange({ data: 2 }); }
    seekTo(s) { this.at = s; if (this.t0 != null) this.t0 = performance.now(); }
    setVolume() {} destroy() {}
  } };
};
const names = ['An', 'Binh', 'Chi'];
const tokens = []; for (const n of names) tokens.push(await signup(n));
const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `ktv_token=${tokens[0]}` }, body: JSON.stringify({ name: 'P4', capacity: 8 }) })).json();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${TONE}`, '--autoplay-policy=no-user-gesture-required'] });
const P = {};
for (const [i, t] of tokens.entries()) {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: 'ktv_token', value: t, url: BASE }]);
  const p = await ctx.newPage();
  await p.addInitScript(FAKE_YT);
  p.on('pageerror', (e) => console.error('[pageerror]', names[i], e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.error('[console]', names[i], m.text().slice(0, 160)); });
  await p.goto(`${BASE}/room/${room.code}?lite=1`);
  await p.getByRole('button', { name: 'Vào phòng' }).click();
  P[names[i]] = p;
}
const { An: a, Binh: b, Chi: c } = P;
await a.waitForTimeout(2500);
const talking = async (p) => (await p.locator('.members li.talking').allInnerTexts()).map((s) => s.split('\n')[0].trim());
// 1. Talk: An holds V.
await a.keyboard.down('KeyV');
await a.waitForTimeout(2500);
check((await talking(b)).includes('An') && (await talking(c)).includes('An'), 'push-to-talk: both others see An talking');
await a.keyboard.up('KeyV');
await a.waitForTimeout(1200);
check(!(await talking(b)).includes('An'), 'releasing V stops sending');
// 2. Open mic for Chi.
await c.getByLabel('Mic mở').check();
await c.waitForTimeout(2000);
check((await talking(a)).includes('Chi'), 'open mic: An hears Chi');
await c.getByLabel('Mic mở').uncheck();
// 3. Cheer.
await b.getByRole('button', { name: /Hú hét/ }).click();
await b.getByRole('button', { name: /Hú hét/ }).click();
await b.waitForTimeout(400);
check((await b.locator('.toast').innerText().catch(() => '')).includes('Chậm lại'), 'second cheer within 3 s is refused');
// 4. Duet: Chi sings first, An invites Binh.
await c.fill('#qlink', 'https://youtu.be/cccccccccc1'); await c.getByRole('button', { name: 'Thêm bài' }).click();
await c.getByRole('button', { name: /tai nghe có dây/ }).click();
await a.waitForTimeout(1500);
await a.fill('#qlink', 'https://youtu.be/aaaaaaaaaa1');
await a.getByRole('radio', { name: 'Mời song ca' }).check();
await a.locator('select[name=partner]').selectOption({ label: 'Binh' });
await a.getByRole('button', { name: 'Thêm bài' }).click();
await a.getByRole('button', { name: /tai nghe có dây/ }).click(); // prepare dialog
await b.waitForTimeout(800);
check((await b.locator('.invite').innerText()).includes('An mời bạn song ca'), 'Binh gets the invite card');
check((await a.locator('app-queue-panel .list').innerText()).includes('đang chờ Binh trả lời'), 'An sees the pending invite');
await b.getByRole('button', { name: 'Đồng ý' }).click();
await b.getByRole('button', { name: /tai nghe có dây/ }).click();
await a.waitForTimeout(800);
check((await a.locator('app-queue-panel .list').innerText()).includes('An & Binh'), 'after yes the entry is a duet');
await c.getByRole('button', { name: 'Xuống sân khấu' }).click();
await a.waitForTimeout(6000);
check((await a.locator('.stage').innerText()).includes('2 người đang nghe'), 'An sings to both listeners');
check((await b.locator('.stage').innerText()).includes('Song ca với An') && !(await b.locator('.stage').innerText()).includes('Bật micro'), 'Binh is the duet partner with the mic on');
check((await c.locator('.stage').innerText()).includes('giọng tới trễ'), 'Chi hears An (the singer hand-over works)');
check((await talking(c)).includes('Binh'), 'Chi hears Binh singing');
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS: voice, cheers and duets work across three browsers.');
