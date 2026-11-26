import { expect, test } from '@playwright/test';
import { shotPath } from './shot';

test('遊戲開機到就緒、主角 idle 站在地平線上、沒有 console error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.game === 'ready');
  const state = await page.evaluate(() => (window as any).__game.getState());

  expect(state.hero.anim).toBe('hero/idle');
  expect(Math.abs(state.hero.bottom - state.groundY)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: shotPath('boot') });
  expect(errors).toEqual([]);
});
