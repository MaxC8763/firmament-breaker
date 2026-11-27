import { expect, test, type Page } from '@playwright/test';
import { HERO } from '../src/data/tuning';
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

/** 按一下 key，等條件成立；作弊鍵這類切換鍵只能按一下，多按會切回去 */
async function pressOnce(page: Page, key: string, fn: string) {
  await page.keyboard.press(key);
  await until(page, fn);
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

/**
 * 出 XXX：接招的時機只有一招的長度（約 25 tick），機器很忙時 Playwright 一來一回就可能錯過，
 * 所以改在網頁裡每幀看招式，待機、X1、X2 各按一次 X（和真的鍵盤一樣送到 window），到 X3 為止
 */
async function xxx(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const press = () => {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'x', code: 'KeyX', keyCode: 88 } as KeyboardEventInit));
    };
    const pressed = new Set<string>();
    w.__xxx = false;
    const loop = () => {
      const move = w.__game.getState().hero.move ?? 'none';
      if (move === 'x3') return (w.__xxx = true);
      if (!pressed.has(move)) {
        pressed.add(move);
        press();
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.waitForFunction(() => (window as any).__xxx, null, { timeout: 30_000 });
}

/** 劍氣飛出去 60 px 的那一幀把關卡暫停（畫面照樣算繪），截圖一定拍得到劍氣；截完由 shootFrozen 繼續 */
const freezeWhenWaveFlies = (page: Page) =>
  watch(page, `
    if (!r.frozen && s.waves.length > 0 && s.waves[0].x - s.waves[0].fromX > 60) {
      r.frozen = true;
      window.__game.pause();
    }
  `);

async function shootFrozen(page: Page, name: string) {
  await untilRec(page, 'r.frozen');
  await page.screenshot({ path: shotPath(name) });
  await page.evaluate(() => (window as any).__game.resume());
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.game === 'ready', null, { timeout: 30_000 });
});

test('連按兩下 → 跑，鏡頭跟著主角捲動；放開後滑行一小段才停', async ({ page }) => {
  // 先開無敵：會跑過第一隻小兵，被撞到就不跑了
  await pressOnce(page, '3', 's.hero.invincible');
  await doubleTap(page, 'ArrowRight');
  expect((await state(page)).hero.vx).toBe(HERO.runSpeed);
  await until(page, 's.hero.x > 1600');
  const s = await state(page);
  expect(s.cameraX).toBeGreaterThan(0);
  // 主角留在畫面裡
  expect(s.hero.x - s.cameraX).toBeGreaterThan(0);
  expect(s.hero.x - s.cameraX).toBeLessThan(1920);
  await page.screenshot({ path: shotPath('play-run') });
  await watch(page, `
    if (s.hero.state === 'Slide' && r.from === undefined) r.from = s.hero.x;
    if (r.from !== undefined && s.hero.state === 'Idle') r.to = s.hero.x;
  `);
  await page.keyboard.up('ArrowRight');
  await untilRec(page, 'r.to !== undefined');
  const { from, to } = await rec(page);
  console.log(`放開後滑了 ${Math.round(to - from)} px`);
  expect(to).toBeGreaterThan(from);
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
  // 先開無敵（作弊鍵 3），免得連段被小兵撞斷；關掉判定框這些開發用的顯示，截乾淨的戰鬥畫面
  await pressOnce(page, '3', 's.hero.invincible');
  await pressOnce(page, 'Backquote', '!s.devShown');
  // 走到最近的小兵附近，等它追過來進到斬擊範圍
  await page.keyboard.down('ArrowRight');
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 400)');
  await page.keyboard.up('ArrowRight');
  // 小兵近一點才出招：每段斬擊都會重新硬直、擊退，X1 打中到 X3 判定約 40 tick，小兵會被推遠約 90 px，
  // X1 打中時超過 187 px，X3 的斬擊就搆不到（框伸到 210、小兵半寬 66）
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 150)');
  const before = await state(page);
  // 劍氣在飛的時候截一張戰鬥畫面（主角、小兵、劍氣、HUD）
  await freezeWhenWaveFlies(page);
  await xxx(page);
  await shootFrozen(page, 'play-combat');
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

test('開發模式：作弊鍵 1 MP 全滿、2 HP 全滿、3 無敵、` 切換判定框與傷害數字', async ({ page }) => {
  expect((await state(page)).devShown).toBe(true);
  await pressOnce(page, '1', 's.hero.mp === 300');
  await pressOnce(page, '3', 's.hero.invincible');
  // 走到小兵旁邊出 XXX：判定框、傷害數字與段數都畫出來
  await page.keyboard.down('ArrowRight');
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 400)');
  await page.keyboard.up('ArrowRight');
  // 小兵近一點才出招：每段斬擊都會重新硬直、擊退，X1 打中到 X3 判定約 40 tick，小兵會被推遠約 90 px，
  // X1 打中時超過 187 px，X3 的斬擊就搆不到（框伸到 210、小兵半寬 66）
  await until(page, 's.enemies.some((e) => e.x - s.hero.x < 150)');
  await freezeWhenWaveFlies(page);
  await xxx(page);
  await shootFrozen(page, 'play-dev');
  // 關掉無敵，往右走到被下一隻小兵撞到，再用 2 補滿
  await pressOnce(page, '3', '!s.hero.invincible');
  await page.keyboard.down('ArrowRight');
  await until(page, 's.hero.hp < 1000');
  await page.keyboard.up('ArrowRight');
  await pressOnce(page, '2', 's.hero.hp === 1000');
  await pressOnce(page, 'Backquote', '!s.devShown');
  await pressOnce(page, 'Backquote', 's.devShown');
});
