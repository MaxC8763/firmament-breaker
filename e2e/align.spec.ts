import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ALIGN_TMP, ALIGN_URL } from './env';

const EXPORT_DIR = path.join(ALIGN_TMP, 'export');
const alignState = (page: Page) => page.evaluate(() => (window as any).__align.getState());

test.describe.configure({ mode: 'serial', timeout: 60_000 });

// 上一次測試中斷時可能留下暫存的手繪
test.beforeAll(() => rmSync(EXPORT_DIR, { recursive: true, force: true }));
test.afterAll(() => rmSync(EXPORT_DIR, { recursive: true, force: true }));

test('對齊工具：動作清單、選格、逐格、播放、翻面', async ({ page }) => {
  await page.goto(ALIGN_URL);
  const summaries = page.locator('#list summary');
  await expect(summaries.first()).toBeVisible({ timeout: 30_000 });
  const counts = await page.locator('#list summary .count').allTextContents();
  expect(counts.length).toBeGreaterThanOrEqual(19);
  for (const c of counts) expect(c).toMatch(/^手繪 0／\d+$/);

  await page.locator('summary[data-group="hero/idle"]').click();
  await page.waitForFunction(() => (window as any).__align.getState().drawn === 'hero/idle/idle_00');

  await page.keyboard.press('ArrowRight');
  expect(await alignState(page)).toMatchObject({ group: 'hero/idle', index: 1 });
  await page.waitForFunction(() => (window as any).__align.getState().drawn === 'hero/idle/idle_01');

  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__align.getState().index !== 1);
  expect((await alignState(page)).playing).toBe(true);

  await page.keyboard.press('KeyF');
  expect((await alignState(page)).flipped).toBe(true);
});
