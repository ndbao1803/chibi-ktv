// Phase 5 check: props and shaking, reactions, chat with bubbles, cụng ly, flowers, the prank,
// rating and the score screen. Three real browsers (the first one renders the 3D room).
//
//   pnpm build && pnpm start      (server with a database)
//   pnpm test:party               (in another terminal; SHOTS=dir to keep screenshots)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const tag = Math.random().toString(36).slice(2, 8);
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
async function signup(name) {
  const res = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `u${Math.random().toString(36).slice(2, 8)}-${tag}@party.test`, password: 'party-test-123', displayName: name }) });
  return /ktv_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1];
}
// The test machine cannot reach YouTube: a stand-in player that plays a 200 s "video".
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
const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `ktv_token=${tokens[0]}` }, body: JSON.stringify({ name: 'Party', capacity: 8 }) })).json();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const P = {};
for (const [i, t] of tokens.entries()) {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: 'ktv_token', value: t, url: BASE }]);
  const p = await ctx.newPage();
  await p.addInitScript(FAKE_YT);
  p.on('pageerror', (e) => console.error('[pageerror]', names[i], e.message));
  await p.goto(`${BASE}/room/${room.code}${i === 0 ? '' : '?lite=1'}`);
  await p.getByRole('button', { name: 'Vào phòng' }).click();
  P[names[i]] = p;
}
const { An: a, Binh: b, Chi: c } = P;
await a.waitForTimeout(2000);
const chatText = async (p) => (await p.locator('app-chat-panel .list').innerText()).replace(/\s+/g, ' ');
/** Waits up to 5 s for some text to appear in a page's chat. */
const chatHas = (p, text) => p.locator('app-chat-panel .list li', { hasText: text }).first().waitFor({ timeout: 5000 }).then(() => true, () => false);

// Chat (CH-01..CH-04): joins in the stream, messages, filter, /me.
check((await chatText(a)).includes('Chi vào phòng'), 'joins appear in the chat as system lines');
await b.fill('#chat-in', 'Hay vcl @An');
await b.keyboard.press('Enter');
await c.fill('#chat-in', '/me nhảy lên ghế');
await c.keyboard.press('Enter');
const okChat = await chatHas(a, 'Hay *** @An');
check(okChat, 'chat arrives, with the word filter');
check((await a.locator('app-chat-panel li.forme').count()) === 1, 'an @mention is highlighted for the person mentioned');
check(await chatHas(a, '* Chi nhảy lên ghế'), '/me shows as an action line');

// Props and shaking (M-01..M-04).
await b.getByRole('radio', { name: /Lục lạc/ }).click();
await b.locator('.shake').dispatchEvent('pointerdown');
await c.keyboard.down('Space');
await a.waitForTimeout(1500);
const hype1 = Number(await a.locator('.hype').getAttribute('aria-valuenow'));
check(hype1 > 0, `two people shaking fill the hype meter (${hype1}%)`);
await b.locator('.shake').dispatchEvent('pointerup');
await c.keyboard.up('Space');

// Reactions, cụng ly, a flower needs someone on stage, the prank cooldown.
await b.getByRole('button', { name: 'Thả ❤️' }).click();
await c.getByRole('button', { name: /Cụng ly/ }).click();
// Checked in a lite tab: An's tab renders 3D in software here (~3 fps), which delays its timers.
await b.waitForTimeout(1000);
check(/^[123]$/.test(await b.locator('.cung').innerText().catch(() => '')), 'cụng ly countdown shows on everyone’s screen');
await b.waitForTimeout(2300);
check((await b.locator('.cung').innerText().catch(() => '')) === 'DÔ!', '… and ends with "DÔ!" together');
await b.getByRole('button', { name: /Cụng ly/ }).click();
check((await b.locator('.toast').innerText().catch(() => '')).includes('Vừa cụng ly'), 'only one cụng ly per minute per room');
check(await b.getByRole('button', { name: /Tặng hoa/ }).isDisabled(), 'no flowers while nobody is on stage');
await c.getByRole('button', { name: /Xì hơi/ }).click();
await c.waitForTimeout(300);
await c.getByRole('button', { name: /Xì hơi/ }).click();
await c.waitForTimeout(300);
check((await c.locator('.toast').innerText().catch(() => '')).includes('2 phút'), 'the prank has a 2-minute cooldown');
if (SHOTS) await a.screenshot({ path: `${SHOTS}/party-1.png` });

// Rating (G-01..G-06): An sings, Binh throws a flower, An steps down (skip), Binh and Chi rate.
await a.fill('#qlink', 'https://youtu.be/aaaaaaaaaa1');
await a.getByRole('button', { name: 'Thêm bài' }).click();
await a.getByRole('button', { name: /tai nghe có dây/ }).click();
await a.waitForTimeout(2500);
await b.getByRole('button', { name: /Tặng hoa/ }).click();
check(!(await a.locator('app-party-bar .shake').isEnabled()), 'the singer cannot shake props');
await a.getByRole('button', { name: 'Xuống sân khấu' }).click();
await b.waitForTimeout(800);
check((await b.locator('.rate h2').innerText().catch(() => '')).includes('Chấm điểm An'), 'listeners get the star card when the song ends');
check((await a.locator('.rate').count()) === 0, 'the singer gets no star card (G-06)');
await b.getByRole('radio', { name: '5 sao' }).click();
await c.getByRole('radio', { name: '4 sao' }).click();
if (SHOTS) await b.screenshot({ path: `${SHOTS}/party-2.png` });
await a.waitForTimeout(11_000);
const score = await a.locator('.screen .box').innerText().catch(() => '');
check(/\d+/.test(score) && score.includes('An'), `the score screen shows (${score.replace(/\s+/g, ' ').slice(0, 60)})`);
if (SHOTS) await a.screenshot({ path: `${SHOTS}/party-3.png` });
check((await chatText(c)).includes('An:') && (await chatText(c)).includes('điểm'), 'the score is posted in the chat');
check((await a.getByRole('button', { name: /Bảng điểm/ }).count()) === 1, 'the leaderboard button appears');

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS: the party layer works across three browsers.');
