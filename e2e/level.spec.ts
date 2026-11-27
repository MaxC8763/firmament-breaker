import { expect, test, type Page } from '@playwright/test';
import { DOOR, LOW, MAPS } from '../src/data/maps';
import { ENEMIES } from '../src/data/tuning';
import { shotPath } from './env';
import { pressOnce, rec, ready, resumeGame, state, until, untilRec, watch } from './helpers';

// CI 的瀏覽器用軟體算繪，幀率低，整支測試給寬一點的時間
test.describe.configure({ timeout: 60_000 });

test.beforeEach(({ page }) => ready(page));

const game = (page: Page, call: string) => page.evaluate(`window.__game.${call}`);

/** 主角（無敵）放到地圖右半邊，鏡頭捲到右端時定格截圖：拍得到平台、敵人和門。判定框這些開發用的顯示關掉 */
async function shootMap(page: Page, name: string) {
  await pressOnce(page, '3', 's.hero.invincible');
  await pressOnce(page, 'Backquote', '!s.devShown');
  await game(page, 'placeHero(2900)');
  await until(page, 's.cameraX > 1915');
  await game(page, 'pause()');
  await page.screenshot({ path: shotPath(name) });
  await resumeGame(page);
}

/** 記下關卡場景重開後第一幀的狀態（tick 從頭算）：MP 會自然回復，要在重開後馬上讀 */
const watchRestart = (page: Page) =>
  watch(page, `
    if (r.last !== undefined && s.tick < r.last && !r.first) r.first = { map: s.map, hp: s.hero.hp, mp: s.hero.mp, x: s.hero.x, facing: s.hero.facing };
    r.last = s.tick;
  `);

/** 等網頁畫 n 幀：關卡停住時 tick 不該前進 */
const frames = (page: Page, n: number) =>
  page.evaluate((n) => new Promise((done) => { const f = () => (--n > 0 ? requestAnimationFrame(f) : done(null)); requestAnimationFrame(f); }), n);

/** 站到門前；先按一下 ↓（單按沒有作用）：站著不動太久的主角在打盹，按了才會醒 */
async function atDoor(page: Page) {
  await game(page, `placeHero(${DOOR.x})`);
  await page.keyboard.press('ArrowDown');
  await until(page, `s.hero.state === 'Idle' && Math.abs(s.hero.x - ${DOOR.x}) < 1`);
}

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

test('清光第 1 張（作弊鍵 4）→ 門打開 → 站到門前按 ↑ → 進第 2 張，HP／MP 和離開時一樣', async ({ page }) => {
  await shootMap(page, 'level-map1');
  expect((await state(page)).doorOpen).toBe(false);
  await pressOnce(page, '4', 's.doorOpen');
  await game(page, 'setHp(640)');
  await pressOnce(page, '1', 's.hero.mp === 300');
  await atDoor(page);
  await watchRestart(page);
  await page.keyboard.press('ArrowUp');
  await untilRec(page, 'r.first');
  // 新地圖的入口在左端、面向右
  const { first } = await rec(page);
  expect(first).toMatchObject({ map: 1, hp: 640, mp: 300, facing: 1 });
  expect(first.x).toBeLessThan(300);
  expect((await state(page)).entry).toEqual({ hp: 640, mp: 300 });
});

test('在第 2 張死亡 → 從第 2 張的入口重來，HP／MP 是進入第 2 張時的值', async ({ page }) => {
  await game(page, 'enter(1, 640, 100)');
  await until(page, 's.map === 1');
  await shootMap(page, 'level-map2');
  // 離開進入時的值：HP 1、MP 全滿，再關掉無敵，站著等追過來的小兵撞上（截圖時小兵就在 300 px 內追著主角）
  await pressOnce(page, '3', '!s.hero.invincible');
  await game(page, 'setHp(1)');
  await pressOnce(page, '1', 's.hero.mp === 300');
  await watchRestart(page);
  await until(page, "s.hero.state === 'Dead'");
  await untilRec(page, 'r.first');
  const { first } = await rec(page);
  expect(first).toMatchObject({ map: 1, hp: 640, mp: 100 });
  expect(first.x).toBeLessThan(300);
});

test('第 3 張的門 → 關卡完成畫面（關卡停住）→ 按 Z 回到第 1 張、HP 1000、MP 0', async ({ page }) => {
  await game(page, 'enter(2, 500, 200)');
  await until(page, 's.map === 2');
  await shootMap(page, 'level-map3');
  await pressOnce(page, '4', 's.doorOpen');
  await atDoor(page);
  await page.keyboard.press('ArrowUp');
  await until(page, 's.complete');
  await page.screenshot({ path: shotPath('level-complete') });
  // 關卡停住：過 10 幀 tick 也沒有前進
  const { tick } = await state(page);
  await frames(page, 10);
  expect((await state(page)).tick).toBe(tick);
  await watchRestart(page);
  await page.keyboard.press('z');
  await untilRec(page, 'r.first');
  expect((await rec(page)).first).toMatchObject({ map: 0, hp: 1000, mp: 0 });
  expect((await state(page)).complete).toBe(false);
});

test('平台上的 MP 道具：從底下走過吃不到，跳上去就吃到，MP 至少 +100', async ({ page }) => {
  const item = MAPS[0].items.find((i) => i.kind === 'mp')!;
  expect(item.y).toBe(MAPS[0].platforms[0].top);
  const before = await state(page);
  await page.keyboard.down('ArrowRight');
  await until(page, `s.hero.x > ${item.x}`);
  await page.keyboard.up('ArrowRight');
  expect((await state(page)).items.some((i: any) => i.kind === 'mp')).toBe(true);
  await page.keyboard.down('z');
  await until(page, "!s.items.some((i) => i.kind === 'mp')");
  await page.keyboard.up('z');
  const gained = (await state(page)).hero.mp - before.hero.mp;
  console.log(`吃到 MP 道具，MP +${gained}`);
  expect(gained).toBeGreaterThanOrEqual(100);
});

test('暫停選單：Esc 停住關卡、再按 Esc 繼續；選「從關卡開頭重來」回到第 1 張、HP 1000、MP 0', async ({ page }) => {
  await page.keyboard.press('Escape');
  await until(page, 's.paused');
  const { tick } = await state(page);
  await frames(page, 10);
  expect((await state(page)).tick).toBe(tick);
  await page.screenshot({ path: shotPath('level-pause') });
  await page.keyboard.press('Escape');
  await until(page, `!s.paused && s.tick > ${tick}`);

  // 到第 2 張、HP／MP 都不是關卡開頭的值，再從暫停選單回到關卡開頭
  await game(page, 'enter(1, 400, 250)');
  await until(page, 's.map === 1');
  await page.keyboard.press('Escape');
  await until(page, 's.paused');
  await page.keyboard.press('ArrowDown');
  await watchRestart(page);
  await page.keyboard.press('z');
  await untilRec(page, 'r.first');
  expect((await rec(page)).first).toMatchObject({ map: 0, hp: 1000, mp: 0 });
  expect((await state(page)).paused).toBe(false);
});

test('不動 10 秒進入打盹（頭上冒 Zzz），按 → 驚醒後往右走', async ({ page }) => {
  await until(page, "s.hero.anim === 'hero/doze'", 45_000);
  await page.screenshot({ path: shotPath('level-doze') });
  const { x } = (await state(page)).hero;
  await watch(page, `
    if (s.hero.state === 'Wake') r.woke = true;
    if (r.woke && s.hero.state === 'Walk') r.walked = true;
  `);
  await page.keyboard.down('ArrowRight');
  await untilRec(page, 'r.walked');
  await until(page, `s.hero.x > ${x + 30}`);
  await page.keyboard.up('ArrowRight');
});

test('砲手的彈丸打中主角 HP −60；用 X 砍掉彈丸，命中回復的 MP 沒有增加', async ({ page }) => {
  // 第 2 張入口前方有一隻砲手：主角站在入口不動，2 秒多後彈丸飛過來
  await game(page, 'enter(1, 1000, 0)');
  await until(page, 's.map === 1');
  await pressOnce(page, 'Backquote', '!s.devShown');
  await watch(page, `
    if (!r.shot && s.bullets.length > 0 && s.bullets[0].x - s.hero.x < 400) { r.shot = true; window.__game.pause(); }
  `);
  await untilRec(page, 'r.shot');
  await page.screenshot({ path: shotPath('level-gunner') });
  await resumeGame(page);
  await until(page, 's.hero.hp < 1000');
  expect((await state(page)).hero.hp).toBe(1000 - ENEMIES.gunner.bulletDamage);

  // 下一發：彈丸飛到主角前方 260 px 內就出 X（在網頁裡每幀看，Playwright 一來一回趕不上）
  await until(page, "s.hero.state === 'Idle' && s.bullets.length === 0");
  const before = await state(page);
  await watch(page, `
    if (!r.pressed && s.bullets.some((b) => b.x > s.hero.x && b.x - s.hero.x < 260)) {
      r.pressed = true;
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'x', code: 'KeyX', keyCode: 88 }));
    }
    if (r.pressed && s.bullets.length === 0 && !r.after) r.after = { hp: s.hero.hp, mpFromHits: s.mpFromHits };
  `);
  await untilRec(page, 'r.after');
  const { after } = await rec(page);
  expect(after.hp).toBe(before.hero.hp);
  expect(after.mpFromHits).toBe(before.mpFromHits);
});

test('重甲兵吃 7 段不硬直、第 8 段破甲並硬直', async ({ page }) => {
  // 第 3 張右端有一隻重甲兵：開無敵，在網頁裡每幀驅動——主角待機時站回它左邊 200 px、出 XXX，破甲那一幀就定格
  await game(page, 'enter(2, 1000, 0)');
  await until(page, 's.map === 2');
  await pressOnce(page, '3', 's.hero.invincible');
  await watch(page, `
    const h = s.enemies.find((e) => e.kind === 'heavy');
    if (!h || r.broke) return;
    r.max = h.armor.max;
    if (h.armor.broken === 0 && h.state === 'Hurt') r.staggeredWhileArmored = true;
    if (h.armor.broken > 0) {
      r.broke = { state: h.state, hp: h.hp };
      window.__game.pause();
      return;
    }
    const move = s.hero.move ?? 'none';
    if (move === 'none' && s.hero.state === 'Idle' && r.last !== 'placed') {
      window.__game.placeHero(h.x - 200);
      r.last = 'placed';
    } else if (move !== r.last && move !== 'x3') {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'x', code: 'KeyX', keyCode: 88 }));
      r.last = move;
    }
  `);
  await untilRec(page, 'r.broke');
  // 定格在破甲那一幀：碎片飛散，頭上顯示破甲剩幾秒
  await until(page, 's.paused');
  await page.screenshot({ path: shotPath('level-heavy-break') });
  await resumeGame(page);
  const r = await rec(page);
  expect(r.max).toBe(8);
  expect(r.staggeredWhileArmored).toBeUndefined();
  expect(r.broke.state).toBe('Hurt');
});
