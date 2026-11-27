import { expect, test } from '@playwright/test';
import { LOW, MAPS } from '../src/data/maps';
import { rec, ready, until, untilRec, watch } from './helpers';

// CI 的瀏覽器用軟體算繪，幀率低，整支測試給寬一點的時間
test.describe.configure({ timeout: 60_000 });

test.beforeEach(({ page }) => ready(page));

test('跳上低平台站穩，按 ↓＋Z 往下穿回地面、不會起跳', async ({ page }) => {
  // 第 1 張最左邊的平台離地 200，一段跳就上得去
  const p = MAPS[0].platforms[0];
  expect(p.top).toBe(LOW);
  await page.keyboard.down('ArrowRight');
  // 停在平台左半邊：離第一隻小兵夠遠，它不會追過來
  await until(page, `s.hero.x > ${p.x + 120}`);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('z');
  await until(page, `s.hero.state === 'Idle' && Math.abs(s.hero.y - ${p.top}) < 1`);
  await page.keyboard.up('z');

  await watch(page, `
    r.top = Math.min(r.top ?? Infinity, s.hero.y);
    if (s.hero.state === 'Idle' && Math.abs(s.hero.y - s.groundY) < 1) r.down = true;
  `);
  await page.keyboard.down('ArrowDown');
  await page.keyboard.press('z');
  await untilRec(page, 'r.down');
  await page.keyboard.up('ArrowDown');
  // 往下穿的時候沒有往上跳過
  expect((await rec(page)).top).toBeGreaterThanOrEqual(p.top - 1);
});
