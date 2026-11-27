// 主角的決策：不 import phaser。每個 tick 收輸入與著地狀態，決定狀態、要交給物理的速度、要顯示哪一格
import type { ArtFrame, ArtGroup } from '../data/manifest';
import { HERO, TICK_HZ, ticks } from '../data/tuning';
import {
  bufferPresses,
  direction,
  newRunTracker,
  takeBuffered,
  trackRun,
  type Buffered,
  type InputFrame,
  type RunTracker,
} from '../input/input';

export enum HeroState {
  Idle,
  Walk,
  Run,
  Air,
  Attack,
}

/** X 連段的三招；X3 沒有下一招 */
export type XMove = 'x1' | 'x2' | 'x3';
const NEXT: Record<XMove, XMove | undefined> = { x1: 'x2', x2: 'x3', x3: undefined };

/** 正在出的招 */
export interface Attack {
  move: XMove;
  /** 在空中出的招：預備＋判定期間滯空，收招期間下落 */
  air: boolean;
  /** 出招後經過的 tick；照 meta 的 hold 換算成第幾格 */
  t: number;
  /** 已經按了 X，判定結束就接下一招 */
  queued: boolean;
  /** 跑＋X 的滑行初速，slideMs 內減到 0 */
  slide: number;
  /** 空中出招、收招中落地：剩下的收招在地面繼續，顯示落地格 */
  landed: boolean;
}

/** 主角各動作的 meta（manifest 的 hero/<動作>），出招與跳躍照它的格推進 */
export type HeroMoves = Record<string, ArtGroup>;

export interface HeroLogic {
  state: HeroState;
  /** 1＝面向右、−1＝面向左 */
  facing: 1 | -1;
  /** 邏輯自己的 tick 計數 */
  tick: number;
  run: RunTracker;
  buffer: Buffered[];
  moves: HeroMoves;
  /** 物理上一次回報的垂直速度，選跳躍的格用 */
  vy: number;
  /** 這次離地用過二段跳了沒 */
  doubleJumped: boolean;
  /** 這一段上升已經因為放開 Z 減速過 */
  jumpCut: boolean;
  /** 空中的水平速度：跑跳 480，其餘或轉向過 300 */
  airSpeed: number;
  /** 起跳時的方向，用來判斷空中有沒有轉向 */
  airDir: number;
  /** 離地後經過的 tick */
  airTicks: number;
  /** 二段跳後經過的 tick；沒有二段跳是 Infinity */
  doubleJumpTicks: number;
  /** 落地後還要顯示落地格的 tick 數 */
  landTicks: number;
  attack: Attack | null;
  /** 這次離地用過空中 X 了沒（停在 X1、X2、X3 都算一輪） */
  airAttackUsed: boolean;
  mp: number;
}

export interface HeroInput {
  frame: InputFrame;
  onGround: boolean;
  /** 物理目前的垂直速度（+＝向下） */
  vy: number;
}

/** 交給物理的結果：vy 是 null 時保留物理自己的垂直速度 */
export interface HeroOutput {
  vx: number;
  vy: number | null;
  gravity: boolean;
  /** X3 判定開始的那個 tick：生成真空切劍氣 */
  spawnWave?: boolean;
}

/**
 * 起跳速度：物理每一步先加重力再移動（60 Hz），照 v²＝2gh 算出的速度會跳不到指定高度，
 * 所以照同樣的積分順序，用二分搜尋解出剛好跳到 height 的速度。
 */
export function launchSpeed(height: number, gravity: number, hz = TICK_HZ): number {
  const peak = (v0: number) => {
    let v = -v0;
    let y = 0;
    let top = 0;
    while (v < 0) {
      v += gravity / hz;
      y += v / hz;
      top = Math.min(top, y);
    }
    return -top;
  };
  let lo = 0;
  let hi = 10 * Math.sqrt(2 * gravity * height);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (peak(mid) < height) lo = mid;
    else hi = mid;
  }
  return hi;
}

const JUMP_SPEED = launchSpeed(HERO.jumpHeight, HERO.gravity);
const DOUBLE_JUMP_SPEED = launchSpeed(HERO.doubleJumpHeight, HERO.gravity);

/** 一個 hold 是幾個 tick（12 fps 的 1 格＝60 Hz 的 5 tick） */
const ticksPerHold = (g: ArtGroup) => TICK_HZ / g.fps;
const lengthOf = (g: ArtGroup) => (g.frames ?? []).reduce((n, f) => n + f.hold, 0) * ticksPerHold(g);

/** 從動作開始經過 t 個 tick 時的那一格；播完是 undefined */
export function frameAt(g: ArtGroup, t: number): ArtFrame | undefined {
  let left = Math.floor(t / ticksPerHold(g));
  for (const f of g.frames ?? []) {
    if (left < f.hold) return f;
    left -= f.hold;
  }
  return undefined;
}

export const newHero = (moves: HeroMoves): HeroLogic => ({
  state: HeroState.Idle,
  facing: 1,
  tick: 0,
  run: newRunTracker(),
  buffer: [],
  moves,
  vy: 0,
  doubleJumped: false,
  jumpCut: false,
  airSpeed: HERO.walkSpeed,
  airDir: 0,
  airTicks: 0,
  doubleJumpTicks: Infinity,
  landTicks: 0,
  attack: null,
  airAttackUsed: false,
  mp: 0,
});

export function tickHero(h: HeroLogic, input: HeroInput): HeroOutput {
  const t = ++h.tick;
  const f = input.frame;
  trackRun(h.run, f, t);
  bufferPresses(h.buffer, f, t);
  h.vy = input.vy;
  const dir = direction(f);

  if (h.state === HeroState.Attack) {
    const out = attacking(h, input);
    if (out) return out;
  }

  if (h.state === HeroState.Air) {
    h.airTicks++;
    h.doubleJumpTicks++;
    // 只認往下或靜止時的著地：起跳那一 tick 還貼著地面
    if (input.onGround && input.vy >= 0) land(h);
    else return air(h, f, dir);
  }

  if (h.landTicks > 0) h.landTicks--;
  if (takeBuffered(h.buffer, 'attack', t)) return startAttack(h, 'x1', false, h.state === HeroState.Run ? HERO.runSpeed : 0);
  if (takeBuffered(h.buffer, 'jump', t)) {
    takeoff(h, dir);
    return air(h, f, dir, JUMP_SPEED);
  }
  if (dir) h.facing = dir > 0 ? 1 : -1;
  h.state = !dir ? HeroState.Idle : h.run.runDir === dir ? HeroState.Run : HeroState.Walk;
  if (dir) h.landTicks = 0;
  const speed = h.state === HeroState.Run ? HERO.runSpeed : HERO.walkSpeed;
  return { vx: dir * speed, vy: null, gravity: true };
}

/** 出招：面向鎖定、不能左右移動；空中招在預備＋判定期間滯空 */
function startAttack(h: HeroLogic, move: XMove, air: boolean, slide: number): HeroOutput {
  h.state = HeroState.Attack;
  h.landTicks = 0;
  h.attack = { move, air, t: 0, queued: false, slide, landed: false };
  if (air) h.airAttackUsed = true;
  return attackOutput(h);
}

/** 出招中的一個 tick；招式結束時回傳 null，讓這個 tick 照一般狀態處理 */
function attacking(h: HeroLogic, input: HeroInput): HeroOutput | null {
  const a = h.attack!;
  a.t++;
  if (a.air && !a.landed && input.onGround && input.vy >= 0) {
    a.landed = true;
    h.doubleJumped = false;
    h.airAttackUsed = false;
  }
  // 出招中任何時候按 X 都記下來；X3 沒有下一招，按鍵留在預先輸入裡，收招結束時還沒過期就接 X1
  const next = NEXT[a.move];
  if (next && !a.queued && takeBuffered(h.buffer, 'attack', h.tick)) a.queued = true;

  const frame = frameAt(h.moves[`hero/${a.move}`], a.t);
  if (next && a.queued && (!frame || frame.phase === 'recovery')) {
    return startAttack(h, next, a.air && !a.landed && !input.onGround, 0);
  }
  if (frame) return attackOutput(h);

  h.attack = null;
  h.state = a.air && !a.landed && !input.onGround ? HeroState.Air : HeroState.Idle;
  return null;
}

function attackOutput(h: HeroLogic): HeroOutput {
  const a = h.attack!;
  const frame = frameAt(h.moves[`hero/${a.move}`], a.t);
  const spawnWave = a.move === 'x3' && frame?.phase === 'active' && frameAt(h.moves['hero/x3'], a.t - 1)?.phase !== 'active';
  if (a.air && !a.landed && frame?.phase !== 'recovery') return { vx: 0, vy: 0, gravity: false, spawnWave };
  const slide = Math.max(0, a.slide * (1 - a.t / ticks(HERO.slideMs)));
  return { vx: h.facing * slide, vy: null, gravity: true, spawnWave };
}

/** 判定中的那一格：招式、是不是空中招、格名；不在判定期間是 null */
export function activeFrame(h: HeroLogic): { move: XMove; air: boolean; file: string } | null {
  const a = h.attack;
  if (!a) return null;
  const frame = frameAt(h.moves[`hero/${a.move}`], a.t);
  return frame?.phase === 'active' ? { move: a.move, air: a.air && !a.landed, file: frame.file } : null;
}

function takeoff(h: HeroLogic, dir: number) {
  h.airSpeed = h.state === HeroState.Run ? HERO.runSpeed : HERO.walkSpeed;
  h.airDir = dir;
  h.state = HeroState.Air;
  h.airTicks = 0;
  h.doubleJumpTicks = Infinity;
  h.jumpCut = false;
  h.landTicks = 0;
}

function land(h: HeroLogic) {
  h.state = HeroState.Idle;
  h.doubleJumped = false;
  h.airAttackUsed = false;
  h.landTicks = ticksPerHold(h.moves['hero/jump']);
}

/** 空中：按著方向才移動，轉向後降速；二段跳；上升中放開 Z 減速一次 */
function air(h: HeroLogic, f: InputFrame, dir: number, launch?: number): HeroOutput {
  // 空中 X 每次離地一輪；用完後到落地前按 X 沒反應
  if (launch === undefined && takeBuffered(h.buffer, 'attack', h.tick) && !h.airAttackUsed) return startAttack(h, 'x1', true, 0);
  let vy: number | null = launch === undefined ? null : -launch;
  if (vy === null && !h.doubleJumped && takeBuffered(h.buffer, 'jump', h.tick)) {
    h.doubleJumped = true;
    h.jumpCut = false;
    h.doubleJumpTicks = 0;
    vy = -DOUBLE_JUMP_SPEED;
  }
  if (vy === null && !f.held.jump && !h.jumpCut && h.vy < 0) {
    h.jumpCut = true;
    vy = h.vy / 2;
  }
  if (dir) {
    if (h.airDir && dir !== h.airDir) h.airSpeed = HERO.airTurnSpeed;
    h.facing = dir > 0 ? 1 : -1;
  }
  return { vx: dir * h.airSpeed, vy, gravity: true };
}

/** 要顯示的動作；frame 有值時由邏輯指定格，沒有時由薄殼循環播放 */
export interface HeroView {
  anim: string;
  frame?: string;
}

/** 上升、下落速度在這之內顯示頂點那一格 */
// ponytail: 固定門檻，手繪的跳躍格多了再改成照速度分段
const APEX_VY = 300;

export function heroView(h: HeroLogic): HeroView {
  const jump = (role: ArtFrame['role']): HeroView => ({
    anim: 'hero/jump',
    frame: h.moves['hero/jump'].frames?.find((f) => f.role === role)?.file,
  });
  switch (h.state) {
    case HeroState.Air: {
      const dj = h.moves['hero/double_jump'];
      if (h.doubleJumpTicks < lengthOf(dj)) return { anim: 'hero/double_jump', frame: frameAt(dj, h.doubleJumpTicks)?.file };
      if (h.airTicks < ticksPerHold(h.moves['hero/jump'])) return jump('takeoff');
      return jump(h.vy < -APEX_VY ? 'rise' : h.vy > APEX_VY ? 'fall' : 'apex');
    }
    case HeroState.Attack: {
      const a = h.attack!;
      const frame = frameAt(h.moves[`hero/${a.move}`], a.t);
      if (a.landed && frame?.phase === 'recovery') return jump('land');
      return { anim: `hero/${a.move}`, frame: frame?.file };
    }
    case HeroState.Walk:
      return { anim: 'hero/walk' };
    case HeroState.Run:
      return { anim: 'hero/run' };
    default:
      return h.landTicks > 0 ? jump('land') : { anim: 'hero/idle' };
  }
}
