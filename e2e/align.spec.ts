import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ALIGN_TMP, ALIGN_URL, shotPath } from './env';

const EXPORT_DIR = path.join(ALIGN_TMP, 'export');
const alignState = (page: Page) => page.evaluate(() => (window as any).__align.getState());
const drawn = (page: Page, key: string) =>
  page.waitForFunction((k) => (window as any).__align?.getState().drawn === k, key, { timeout: 30_000 });

test.describe.configure({ mode: 'serial', timeout: 60_000 });

// 上一次測試中斷時可能留下暫存的手繪
test.beforeAll(() => rmSync(EXPORT_DIR, { recursive: true, force: true }));
test.afterAll(() => rmSync(EXPORT_DIR, { recursive: true, force: true }));

test('動作清單、選格、逐格、播放、翻面', async ({ page }) => {
  await page.goto(ALIGN_URL);
  await expect(page.locator('#list summary').first()).toBeVisible({ timeout: 30_000 });
  const counts = await page.locator('#list summary .count').allTextContents();
  expect(counts.length).toBeGreaterThanOrEqual(19);
  for (const c of counts) expect(c).toMatch(/^手繪 0／\d+$/);

  await page.locator('summary[data-group="hero/idle"]').click();
  await drawn(page, 'hero/idle/idle_00');

  await page.keyboard.press('ArrowRight');
  expect(await alignState(page)).toMatchObject({ group: 'hero/idle', index: 1 });
  await drawn(page, 'hero/idle/idle_01');

  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__align.getState().index !== 1);
  expect((await alignState(page)).playing).toBe(true);

  await page.keyboard.press('KeyF');
  expect((await alignState(page)).flipped).toBe(true);
});

test('只有佔位圖：貼地的格都在地平線上、沒有任何警告；截圖 idle、x1 判定幀、立繪 normal', async ({ page, request }) => {
  await page.goto(ALIGN_URL);
  await drawn(page, 'hero/idle/idle_00');

  const manifest = await (await request.get(`${ALIGN_URL}build/manifest.json`)).json();
  const grounded = Object.entries<any>(manifest.groups).flatMap(([g, m]) =>
    (m.frames ?? []).filter((f: any) => f.grounded).map((f: any) => manifest.images[`${g}/${f.file}`]?.ground),
  );
  expect(grounded.length).toBeGreaterThan(50);
  expect(grounded.filter((d) => d !== 0)).toEqual([]);
  expect((await alignState(page)).warningCount).toBe(0);
  await page.screenshot({ path: shotPath('align-idle'), fullPage: true });

  await page.locator('summary[data-group="hero/x1"]').click();
  await page.keyboard.press('ArrowRight');
  await drawn(page, 'hero/x1/x1_01');
  await page.screenshot({ path: shotPath('align-x1-active'), fullPage: true });

  await page.locator('[data-mode="portrait"]').click();
  await page.locator('[data-expression="normal"]').click();
  await drawn(page, 'portrait/normal');
  await page.screenshot({ path: shotPath('align-portrait-normal'), fullPage: true });
});

test('手繪往下移了 20 px（2x）：標成手繪、顯示低於地平線 10 px、出現黃色警告', async ({ page }) => {
  // 佔位圖的副本整張往下移 20 px，放進暫存的手繪資料夾
  const dst = path.join(EXPORT_DIR, 'hero/idle/idle_00.png');
  mkdirSync(path.dirname(dst), { recursive: true });
  const moved = await sharp('art/placeholder/hero/idle/idle_00.png')
    .extend({ top: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp(moved).extract({ left: 0, top: 0, width: 1536, height: 1024 }).toFile(dst);

  await page.goto(ALIGN_URL);
  await page.waitForFunction(
    () => {
      const s = (window as any).__align?.getState();
      return s?.group === 'hero/idle' && s.index === 0 && s.source === 'export';
    },
    null,
    { timeout: 45_000 },
  );
  const s = await alignState(page);
  expect(s).toMatchObject({ source: 'export', ground: 10 });
  expect(s.warnings).toEqual([{ level: 'warn', text: '腳底低於地平線 10 px' }]);
  await expect(page.locator('summary[data-group="hero/idle"] .count')).toHaveText('手繪 1／4');
  await expect(page.locator('#info .warn')).toContainText('低於地平線 10 px');
});
