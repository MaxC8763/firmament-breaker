import { expect, test, type Page } from '@playwright/test';
import { shotPath } from './env';

// 遊戲邏輯是固定 tick，幀率低只是一幀補跑幾個 tick：一律等狀態變了再做下一步，不用固定秒數等
const state = (page: Page) => page.evaluate(() => (window as any).__game.getState());
const until = (page: Page, fn: string, timeout = 20_000) =>
  page.waitForFunction(`(() => { const s = window.__game.getState(); return ${fn}; })()`, null, { timeout });

/** 連按兩下並按住：兩下之間等邏輯跑過一個 tick，免得同一幀裡的兩下被當成一下 */
async function doubleTap(page: Page, key: string) {
  const { tick } = await state(page);
  await page.keyboard.press(key);
  await until(page, `s.tick > ${tick + 1}`);
  await page.keyboard.down(key);
}

/** 按 key 直到條件成立：機器忙、幀率很低時，一次按鍵可能剛好錯過接招的時機 */
async function pressUntil(page: Page, key: string, fn: string) {
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(key);
    if (await until(page, fn, 1_000).then(() => true, () => false)) return;
  }
  throw new Error(`按了 10 次 ${key}，${fn} 還是不成立`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.game === 'ready');
});

test('連按兩下 → 跑，鏡頭跟著主角捲動', async ({ page }) => {
  await doubleTap(page, 'ArrowRight');
  await until(page, "s.hero.state === 'Run'");
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
  // 每幀記下腳底最高到哪
  await page.evaluate(() => {
    const w = window as any;
    w.__top = Infinity;
    const sample = () => {
      w.__top = Math.min(w.__top, w.__game.getState().hero.y);
      requestAnimationFrame(sample);
    };
    sample();
  });
  await page.keyboard.down('z');
  await until(page, "s.hero.state === 'Air'");
  await until(page, "s.hero.state === 'Idle'");
  await page.keyboard.up('z');
  const { groundY } = await state(page);
  const rise = groundY - (await page.evaluate(() => (window as any).__top));
  console.log(`跳躍高度 ${rise.toFixed(1)} px`);
  expect(Math.abs(rise - 300)).toBeLessThanOrEqual(10);
});

test('XXX：三招依序出完，X3 生成劍氣往前飛', async ({ page }) => {
  for (const move of ['x1', 'x2', 'x3']) await pressUntil(page, 'x', `s.hero.move === '${move}'`);
  await until(page, 's.waves.length === 1');
  const from = (await state(page)).waves[0].x;
  await until(page, `s.waves.length === 1 && s.waves[0].x > ${from + 200}`);
  await page.screenshot({ path: shotPath('play-wave') });
  await until(page, 's.waves.length === 0');
  await until(page, "s.hero.state === 'Idle'");
});

test('開機有 3 隻小兵在待機；主角靠近到 600 px 內，小兵朝主角走過來', async ({ page }) => {
  const s = await state(page);
  expect(s.enemies).toHaveLength(3);
  expect(s.enemies.every((e: any) => e.state === 'Idle' && e.y === s.groundY)).toBe(true);
  const first = Math.min(...s.enemies.map((e: any) => e.x));
  await doubleTap(page, 'ArrowRight');
  await until(page, "s.enemies.some((e) => e.state === 'Walk')");
  await page.keyboard.up('ArrowRight');
  const t = await state(page);
  const chaser = t.enemies.find((e: any) => e.state === 'Walk');
  expect(chaser.facing).toBe(-1);
  expect(Math.abs(chaser.x - t.hero.x)).toBeLessThanOrEqual(600);
  await until(page, `s.enemies.some((e) => e.x < ${first - 20})`);
  await page.screenshot({ path: shotPath('play-grunt') });
});
