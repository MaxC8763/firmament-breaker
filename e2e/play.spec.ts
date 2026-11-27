import { expect, test, type Page } from '@playwright/test';
import { shotPath } from './env';

// 遊戲邏輯是固定 tick，幀率低只是一幀補跑幾個 tick：一律等狀態變了再做下一步，不用固定秒數等。
// 機器很忙時，Playwright 的每個指令都可能慢到錯過只持續幾百毫秒的狀態，所以短暫的事件交給網頁裡的 watch 每幀記錄。
// CI 的瀏覽器用軟體算繪，幀率低，整支測試給寬一點的時間
test.describe.configure({ timeout: 60_000 });

const state = (page: Page) => page.evaluate(() => (window as any).__game.getState());
const until = (page: Page, fn: string, timeout = 30_000) =>
  page.waitForFunction(`(() => { const s = window.__game.getState(); return ${fn}; })()`, null, { timeout });

/** 在網頁裡每幀跑一次 body（s＝getState()、r＝紀錄），之後用 untilRec／rec 讀紀錄 */
async function watch(page: Page, body: string) {
  await page.evaluate((body) => {
    const w = window as any;
    w.__rec = {};
    const f = new Function('s', 'r', body);
    const loop = () => {
      f(w.__game.getState(), w.__rec);
      requestAnimationFrame(loop);
    };
    loop();
  }, body);
}
const rec = (page: Page) => page.evaluate(() => (window as any).__rec);
const untilRec = (page: Page, fn: string) =>
  page.waitForFunction(`(() => { const r = window.__rec; return ${fn}; })()`, null, { timeout: 30_000 });

/** 按 key 直到條件成立：機器忙、幀率很低時，一次按鍵可能剛好錯過接招的時機 */
async function pressUntil(page: Page, key: string, fn: string) {
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(key);
    if (await until(page, fn, 2_000).then(() => true, () => false)) return;
  }
  throw new Error(`按了 10 次 ${key}，${fn} 還是不成立`);
}

/** 連按兩下並按住，直到跑起來：兩下之間等邏輯跑過一個 tick，免得同一幀裡的兩下被當成一下；太慢沒接上就放開重來 */
async function doubleTap(page: Page, key: string) {
  for (let i = 0; i < 5; i++) {
    const { tick } = await state(page);
    await page.keyboard.press(key);
    await until(page, `s.tick > ${tick + 1}`);
    await page.keyboard.down(key);
    if (await until(page, "s.hero.state === 'Run'", 2_000).then(() => true, () => false)) return;
    await page.keyboard.up(key);
    await until(page, "s.hero.state === 'Idle'");
  }
  throw new Error(`連按兩下 ${key} 五次都沒有跑起來`);
}

/** 按 X 接完 XXX：每一步等到「至少到了這一招」，多按的一下提早接到下一招也算 */
async function xxx(page: Page) {
  for (const later of [`['x1', 'x2', 'x3']`, `['x2', 'x3']`, `['x3']`]) await pressUntil(page, 'x', `${later}.includes(s.hero.move)`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.game === 'ready', null, { timeout: 30_000 });
});

test('連按兩下 → 跑，鏡頭跟著主角捲動', async ({ page }) => {
  await doubleTap(page, 'ArrowRight');
  expect((await state(page)).hero.vx).toBe(480);
  await until(page, 's.hero.x > 1600');
  const s = await state(page);
  expect(s.cameraX).toBeGreaterThan(0);
  // 主角留在畫面裡
  expect(s.hero.x - s.cameraX).toBeGreaterThan(0);
  expect(s.hero.x - s.cameraX).toBeLessThan(1920);
  await page.screenshot({ path: shotPath('play-run') });
  await page.keyboard.up('ArrowRight');
  await until(page, "s.hero.state === 'Idle'");
});

test('按住 Z 起跳，腳底最高離地 300 px（±10）', async ({ page }) => {
  await watch(page, `
    r.top = Math.min(r.top ?? Infinity, s.hero.y);
    if (s.hero.state === 'Air') r.air = true;
    if (r.air && s.hero.state === 'Idle') r.landed = true;
  `);
  await page.keyboard.down('z');
  await untilRec(page, 'r.landed');
  await page.keyboard.up('z');
  const { groundY } = await state(page);
  const rise = groundY - (await rec(page)).top;
  console.log(`跳躍高度 ${rise.toFixed(1)} px`);
  expect(Math.abs(rise - 300)).toBeLessThanOrEqual(10);
});

test('XXX：三招依序出完，X3 生成劍氣往前飛 480 px 後消失', async ({ page }) => {
  await watch(page, `
    for (const w of s.waves) r.travel = Math.max(r.travel ?? 0, w.x - w.fromX);
    if (s.wavesSpawned > 0 && s.waves.length === 0) r.gone = true;
  `);
  await xxx(page);
  await untilRec(page, 'r.gone');
  const { travel } = await rec(page);
  console.log(`劍氣飛了 ${travel} px`);
  // 每幀取樣一次，幀率低時一幀最多補跑 6 個 tick（120 px），最後量到的位置可能還差一段
  expect(travel).toBeGreaterThan(340);
  expect(travel).toBeLessThanOrEqual(480);
  expect((await state(page)).wavesSpawned).toBe(1);
  await until(page, "s.hero.state === 'Idle'");
});

test('開機有 3 隻小兵在待機；主角靠近到 600 px 內，小兵朝主角走過來', async ({ page }) => {
  const s = await state(page);
  expect(s.enemies).toHaveLength(3);
  expect(s.enemies.every((e: any) => e.state === 'Idle' && e.y === s.groundY)).toBe(true);
  const first = Math.min(...s.enemies.map((e: any) => e.x));
  await page.keyboard.down('ArrowRight');
  await until(page, "s.enemies.some((e) => e.state === 'Walk')");
  await page.keyboard.up('ArrowRight');
  const t = await state(page);
  const chaser = t.enemies.find((e: any) => e.state === 'Walk');
  expect(chaser.facing).toBe(-1);
  expect(Math.abs(chaser.x - t.hero.x)).toBeLessThanOrEqual(600);
  await until(page, `s.enemies.some((e) => e.x < ${first - 20})`);
  await page.screenshot({ path: shotPath('play-grunt') });
});

test('XXX 打倒 1 隻小兵，MP 增加 16–20（斬擊 3 段各 5，加上劍氣 1–5 段各 1）', async ({ page }) => {
  // 先開無敵（作弊鍵 3），免得連段被小兵撞斷
  await pressUntil(page, '3', 's.hero.invincible');
  // 走到最近的小兵附近，等它追過來進到斬擊範圍
  await page.keyboard.down('ArrowRight');
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 400)');
  await page.keyboard.up('ArrowRight');
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 180)');
  const before = await state(page);
  await xxx(page);
  // 劍氣在飛的時候截一張戰鬥畫面（主角、小兵、劍氣、HUD）；機器太忙錯過了也不影響判定
  if (await until(page, 's.waves.length > 0 && s.waves[0].x - s.waves[0].fromX > 60', 5_000).then(() => true, () => false)) {
    await page.screenshot({ path: shotPath('play-combat') });
  }
  await until(page, `s.enemies.length === ${before.enemies.length - 1}`);
  const gained = (await state(page)).hero.mp - before.hero.mp;
  console.log(`打倒 1 隻小兵，MP +${gained}`);
  expect(gained).toBeGreaterThanOrEqual(16);
  expect(gained).toBeLessThanOrEqual(20);
});

test('被小兵撞到：HP −50、往後退、硬直結束後恢復行動', async ({ page }) => {
  await watch(page, `
    if (s.hero.state === 'Hurt' && !r.hurt) r.hurt = { hp: s.hero.hp, x: s.hero.x };
    if (r.hurt && !r.after && s.hero.state !== 'Hurt') r.after = { x: s.hero.x, state: s.hero.state };
  `);
  await page.keyboard.down('ArrowRight');
  await untilRec(page, 'r.hurt');
  await page.keyboard.up('ArrowRight');
  await untilRec(page, 'r.after');
  const { hurt, after } = await rec(page);
  expect(hurt.hp).toBe(950);
  expect(hurt.x - after.x).toBeGreaterThan(80);
  expect(after.state).not.toBe('Dead');
  await page.screenshot({ path: shotPath('play-hurt') });
});
