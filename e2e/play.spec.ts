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
