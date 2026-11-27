import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ALIGN_HITBOXES, ALIGN_TMP, ALIGN_URL, shotPath } from './env';

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

test.describe('編輯判定框', () => {
  // 放大 2× 的畫布比預設視窗寬
  test.use({ viewport: { width: 1920, height: 1080 } });
  const ORIGINAL = readFileSync('src/data/hitboxes.json', 'utf8');
  const saved = () => readFileSync(ALIGN_HITBOXES, 'utf8');
  const changedLines = (before: string, after: string) => after.split('\n').filter((line, i) => line !== before.split('\n')[i]);

  // 打開 x1 的判定格 x1_01、放大 2×；回傳「1x、相對腳底 (384, 492) 的點 → 螢幕座標」
  async function openX1(page: Page) {
    await page.goto(ALIGN_URL);
    await page.locator('summary[data-group="hero/x1"]').click();
    await page.keyboard.press('ArrowRight');
    await drawn(page, 'hero/x1/x1_01');
    await page.locator('[data-zoom="2"]').click();
    const box = (await page.locator('#stage').boundingBox())!;
    return (x: number, y: number) => [box.x + (384 + x) * 2, box.y + (492 + y) * 2] as const;
  }
  async function dragRight(page: Page, [x, y]: readonly [number, number], dx: number) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  }

  test('放大 2× 時拖 x_slash 的右上角往右 40 個螢幕像素：w 從 190 變 210；放棄修改就回到 190', async ({ page }) => {
    const at = await openX1(page);
    await page.mouse.click(...at(150, -125));
    expect((await alignState(page)).selected).toMatchObject({ role: 'attack', path: 'attacks.x_slash' });
    await dragRight(page, at(210, -250), 40);
    expect((await alignState(page)).selected.shape).toEqual({ type: 'rect', x: 20, y: -250, w: 210, h: 250 });
    await expect(page.locator('#fields input[data-field="w"]')).toHaveValue('210');
    await expect(page.locator('#status')).toHaveText('未儲存');

    await page.locator('#discard').click();
    await page.waitForFunction(() => !(window as any).__align.getState().dirty);
    expect((await alignState(page)).selected.shape.w).toBe(190);
    expect(saved()).toBe(ORIGINAL);
  });

  test('儲存：暫存檔只有 x_slash 那一行變了、重新打開還在；在工具外改了檔案，工具也會換新', async ({ page }) => {
    let at = await openX1(page);
    await page.mouse.click(...at(150, -125));
    await dragRight(page, at(210, -250), 40);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => (window as any).__align.getState().message === '已儲存');
    expect(changedLines(ORIGINAL, saved())).toEqual(['    "x_slash": { "type": "rect", "x": 20, "y": -250, "w": 210, "h": 250 },']);

    at = await openX1(page);
    await page.mouse.click(...at(150, -125));
    expect((await alignState(page)).selected.shape.w).toBe(210);

    // 沒有未儲存的修改時每秒重讀
    writeFileSync(ALIGN_HITBOXES, saved().replace('"w": 210, "h": 250', '"w": 210, "h": 260'));
    await page.waitForFunction(() => (window as any).__align.getState().selected?.shape.h === 260);
  });
});
