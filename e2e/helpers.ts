import type { Page } from '@playwright/test';
import { shotPath } from './env';

// 各支瀏覽器測試共用的函式。遊戲邏輯是固定 tick，幀率低只是一幀補跑幾個 tick：一律等狀態變了再做下一步，不用固定秒數等。
// 機器很忙時，Playwright 的每個指令都可能慢到錯過只持續幾百毫秒的狀態，所以短暫的事件交給網頁裡的 watch 每幀記錄。

/** 等遊戲起來 */
export async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.game === 'ready', null, { timeout: 30_000 });
}

export const state = (page: Page) => page.evaluate(() => (window as any).__game.getState());
export const until = (page: Page, fn: string, timeout = 30_000) =>
  page.waitForFunction(`(() => { const s = window.__game.getState(); return ${fn}; })()`, null, { timeout });

/** 在網頁裡每幀跑一次 body（s＝getState()、r＝紀錄），之後用 untilRec／rec 讀紀錄 */
export async function watch(page: Page, body: string) {
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
export const rec = (page: Page) => page.evaluate(() => (window as any).__rec);
export const untilRec = (page: Page, fn: string) =>
  page.waitForFunction(`(() => { const r = window.__rec; return ${fn}; })()`, null, { timeout: 30_000 });

/** 按一下 key，等條件成立；作弊鍵這類切換鍵只能按一下，多按會切回去 */
export async function pressOnce(page: Page, key: string, fn: string) {
  await page.keyboard.press(key);
  await until(page, fn);
}

/** 連按兩下並按住，直到跑起來：兩下之間等邏輯跑過一個 tick，免得同一幀裡的兩下被當成一下；太慢沒接上就放開重來 */
export async function doubleTap(page: Page, key: string) {
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
 * 所以改在網頁裡每幀看招式，待機、X1、X2 各按一次 X（和真的鍵盤一樣送到 window），到 X3 為止。
 * startWhen（s＝getState()）成立的那一幀才按第一下：出招時和小兵的距離不受 Playwright 的延遲影響
 */
export async function xxx(page: Page, startWhen = 'true') {
  await page.evaluate((startWhen) => {
    const w = window as any;
    const ready = new Function('s', `return ${startWhen};`);
    const press = () => {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'x', code: 'KeyX', keyCode: 88 } as KeyboardEventInit));
    };
    const pressed = new Set<string>();
    w.__xxx = false;
    const loop = () => {
      const s = w.__game.getState();
      const move = s.hero.move ?? 'none';
      if (move === 'x3') return (w.__xxx = true);
      if (!pressed.has(move) && (move !== 'none' || ready(s))) {
        pressed.add(move);
        press();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }, startWhen);
  await page.waitForFunction(() => (window as any).__xxx, null, { timeout: 30_000 });
}

/**
 * 小兵走到前方 250 px 內就出 XXX：X1 的斬擊搆得到（框伸到 210、小兵半寬 66），
 * X2、X3 往前合計 240 px 會一路追上被擊退的小兵；再近的話，主角會衝到小兵身上，劍氣生成在它前面、打不到它
 */
export const CLOSE_ENOUGH = 's.enemies.some((e) => e.x - s.hero.x < 250)';

/** 劍氣飛出去 60 px 的那一幀把關卡暫停（畫面照樣算繪），截圖一定拍得到劍氣；截完由 shootFrozen 繼續 */
export const freezeWhenWaveFlies = (page: Page) =>
  watch(page, `
    if (!r.frozen && s.waves.length > 0 && s.waves[0].x - s.waves[0].fromX > 60) {
      r.frozen = true;
      window.__game.pause();
    }
  `);

export async function shootFrozen(page: Page, name: string) {
  await untilRec(page, 'r.frozen');
  await page.screenshot({ path: shotPath(name) });
  await page.evaluate(() => (window as any).__game.resume());
}
