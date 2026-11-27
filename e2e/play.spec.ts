import { expect, test } from '@playwright/test';
import { HERO } from '../src/data/tuning';
import { shotPath } from './env';
import { state, until, watch, rec, untilRec, pressOnce, doubleTap, xxx, CLOSE_ENOUGH, freezeWhenWaveFlies, shootFrozen, ready } from './helpers';

// CI 的瀏覽器用軟體算繪，幀率低，整支測試給寬一點的時間
test.describe.configure({ timeout: 60_000 });

test.beforeEach(({ page }) => ready(page));

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
  const before = await state(page);
  // 劍氣在飛的時候截一張戰鬥畫面（主角、小兵、劍氣、HUD）
  await freezeWhenWaveFlies(page);
  await xxx(page, CLOSE_ENOUGH);
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
  await freezeWhenWaveFlies(page);
  await xxx(page, CLOSE_ENOUGH);
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

test('往左跑到地圖左端的牆再放開：撞牆就不滑，幾個 tick 內回到待機', async ({ page }) => {
  await doubleTap(page, 'ArrowLeft');
  // 主角的物理框半寬 30，左牆 24：腳底停在 x＝54
  await until(page, 's.hero.x <= 60');
  // 滑行只會有 1 tick，幀率低時取樣不一定看得到：改記最後一次看到在跑的 tick，和之後第一次看到待機的 tick
  await watch(page, `
    if (s.hero.state === 'Run') r.lastRun = s.tick;
    if (r.lastRun !== undefined && s.hero.state === 'Idle' && r.idle === undefined) r.idle = { tick: s.tick, x: s.hero.x };
  `);
  await page.keyboard.up('ArrowLeft');
  await untilRec(page, 'r.idle !== undefined');
  const { lastRun, idle } = await rec(page);
  console.log(`放開後 ${idle.tick - lastRun} tick 就回到待機`);
  // 沒撞牆的話要滑約 50 tick；一幀最多補跑 6 tick，留兩幀的餘裕
  expect(idle.tick - lastRun).toBeLessThanOrEqual(15);
  expect(idle.x).toBeLessThanOrEqual(60);
});
