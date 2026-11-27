// 輸入的純邏輯：場景每幀讀一次鍵盤，換成每個 tick 的「按著」與「剛按下」；時間一律用 tick
import { INPUT, ticks } from '../data/tuning';

export type Button = 'left' | 'right' | 'jump' | 'attack';

export interface InputFrame {
  /** 這個 tick 按著的鍵 */
  held: Record<Button, boolean>;
  /** 這個 tick 剛按下的鍵 */
  pressed: Record<Button, boolean>;
}

export const noButtons = (): Record<Button, boolean> => ({ left: false, right: false, jump: false, attack: false });

/** 測試與場景共用：給按著、剛按下的鍵名，組成一個 tick 的輸入 */
export function frameOf(held: Button[] = [], pressed: Button[] = []): InputFrame {
  const f = { held: noButtons(), pressed: noButtons() };
  for (const b of held) f.held[b] = true;
  for (const b of pressed) f.pressed[b] = f.held[b] = true;
  return f;
}

/** 水平方向：只按右 1、只按左 −1，都沒按或兩個都按 0 */
export const direction = (f: InputFrame) => (f.held.right ? 1 : 0) - (f.held.left ? 1 : 0);

/** 雙擊跑步：同一個方向在 doubleTapMs 內按兩下，之後按著就是跑；放開那個方向就停 */
export interface RunTracker {
  lastDir: number;
  lastTick: number;
  /** 正在跑的方向，0＝沒有在跑 */
  runDir: number;
}

export const newRunTracker = (): RunTracker => ({ lastDir: 0, lastTick: -Infinity, runDir: 0 });

export function trackRun(r: RunTracker, f: InputFrame, tick: number): void {
  for (const [button, dir] of [['left', -1], ['right', 1]] as const) {
    if (!f.pressed[button]) continue;
    r.runDir = r.lastDir === dir && tick - r.lastTick <= ticks(INPUT.doubleTapMs) ? dir : 0;
    r.lastDir = dir;
    r.lastTick = tick;
  }
  if (r.runDir === 1 && !f.held.right) r.runDir = 0;
  if (r.runDir === -1 && !f.held.left) r.runDir = 0;
}

/** 預先輸入：還不能行動時按下的鍵存成 { 動作, tick }，超過 bufferMs 就丟掉 */
export interface Buffered {
  button: Button;
  tick: number;
}

export function bufferPresses(buf: Buffered[], f: InputFrame, tick: number): void {
  for (const b of Object.keys(f.pressed) as Button[]) if (f.pressed[b]) buf.push({ button: b, tick });
  const limit = ticks(INPUT.bufferMs);
  while (buf.length && tick - buf[0].tick > limit) buf.shift();
}

/** 取出一個還沒過期的按鍵；有就從清單移除並回傳 true */
export function takeBuffered(buf: Buffered[], button: Button, tick: number): boolean {
  const i = buf.findIndex((b) => b.button === button && tick - b.tick <= ticks(INPUT.bufferMs));
  if (i < 0) return false;
  buf.splice(i, 1);
  return true;
}
