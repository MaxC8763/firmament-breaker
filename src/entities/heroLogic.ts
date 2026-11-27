// 主角的決策：不 import phaser。每個 tick 收輸入與著地狀態，決定狀態、要交給物理的速度、要顯示哪一格
import type { ArtFrame, ArtGroup } from '../data/manifest';
import { GRAVITY, HERO, TICK_HZ, ticks } from '../data/tuning';
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
  /** 停止奔跑後的滑行 */
  Slide,
  /** 受擊硬直，往後退 */
  Hurt,
  /** HP 歸零，播完死亡動畫就要求重來 */
  Dead,
}

/** 站在地上、腳下沒了就會往下掉的狀態 */
const GROUNDED = new Set([HeroState.Idle, HeroState.Walk, HeroState.Run, HeroState.Slide]);

/** X 連段的三招；X3 沒有下一招 */
export type XMove = 'x1' | 'x2' | 'x3';
const NEXT: Record<XMove, XMove | undefined> = { x1: 'x2', x2: 'x3', x3: undefined };

/** 正在出的招 */
export interface Attack {
  move: XMove;
  /** 在空中出的招：揮砍期間飄浮往前、收招期間下落 */
  air: boolean;
  /** 出招後經過的 tick；照 meta 的 hold 換算成第幾格 */
  t: number;
  /** 已經按了 X，判定結束就接下一招 */
  queued: boolean;
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
  /** 走出平台邊緣後，按 Z 還算一般跳的剩餘 tick */
  coyoteTicks: number;
  /** 落地後還要顯示落地格的 tick 數 */
  landTicks: number;
  attack: Attack | null;
  /** 這次離地用過空中 X 了沒（停在 X1、X2、X3 都算一輪） */
  airAttackUsed: boolean;
  /** 地面滑行（停止奔跑、跑＋X）目前的速度，沿著面向；出招中照樣滑，滑完才停 */
  slideV: number;
  /** 滑行每個 tick 減掉多少速度（按著反方向時再乘 brakeTurnFactor） */
  slideDecel: number;
  /** 空中出招當下的水平速度：出招期間一直保持 */
  carryVx: number;
  /** 上一個 tick 交給物理的水平速度 */
  lastVx: number;
  /** 空中揮砍期間由邏輯算的垂直速度（較小的重力） */
  airVy: number;
  hp: number;
  mp: number;
  /** 目前狀態經過的 tick（受擊、死亡） */
  stateTicks: number;
  /** 受擊後的無敵還剩幾個 tick */
  invulnTicks: number;
  /** 被擊退的方向 */
  knockDir: number;
  /** 開發模式的無敵作弊 */
  invincible: boolean;
  /** 死亡動畫播完了，場景該重來 */
  wantsRestart: boolean;
}

export interface HeroInput {
  frame: InputFrame;
  onGround: boolean;
  /** 腳下踩的是單向平台（不是地面） */
  onPlatform: boolean;
  /** 物理目前的垂直速度（+＝向下） */
  vy: number;
  /** 物理上一步被擋住的方向（牆、地圖兩端） */
  blocked: { left: boolean; right: boolean };
}

/** 交給物理的結果：vy 是 null 時保留物理自己的垂直速度 */
export interface HeroOutput {
  vx: number;
  vy: number | null;
  gravity: boolean;
  /** X3 判定開始的那個 tick：生成真空切劍氣 */
  spawnWave?: boolean;
  /** ↓＋Z：穿過腳下的單向平台往下掉 */
  dropThrough?: boolean;
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
  coyoteTicks: 0,
  landTicks: 0,
  attack: null,
  airAttackUsed: false,
  slideV: 0,
  slideDecel: 0,
  carryVx: 0,
  lastVx: 0,
  airVy: 0,
  hp: HERO.hpMax,
  mp: 0,
  stateTicks: 0,
  invulnTicks: 0,
  knockDir: 0,
  invincible: false,
  wantsRestart: false,
});

/** 擊退速度：硬直期間等速退完擊退距離 */
const KNOCK_SPEED = HERO.knockback / (HERO.hurtMs / 1000);

/** 被打：無敵中不受傷；否則扣血、打斷出招、硬直並往 dir 擊退，之後無敵；HP 歸零就死亡。回傳有沒有受傷 */
export function hurtHero(h: HeroLogic, damage: number, dir: number): boolean {
  if (h.invincible || h.invulnTicks > 0 || h.state === HeroState.Dead) return false;
  h.hp = Math.max(0, h.hp - damage);
  h.attack = null;
  h.slideV = 0;
  h.stateTicks = 0;
  h.knockDir = dir;
  h.state = h.hp === 0 ? HeroState.Dead : HeroState.Hurt;
  h.invulnTicks = ticks(HERO.invulnMs);
  return true;
}

export function tickHero(h: HeroLogic, input: HeroInput): HeroOutput {
  const out = decide(h, input);
  h.lastVx = out.vx;
  return out;
}

function decide(h: HeroLogic, input: HeroInput): HeroOutput {
  const t = ++h.tick;
  const f = input.frame;
  trackRun(h.run, f, t);
  bufferPresses(h.buffer, f, t);
  h.vy = input.vy;
  const dir = direction(f);
  if (h.invulnTicks > 0) h.invulnTicks--;
  if (h.coyoteTicks > 0) h.coyoteTicks--;
  // 往滑行的方向被擋住（撞牆、到了地圖兩端），滑行就結束
  if (h.slideV > 0 && (h.facing > 0 ? input.blocked.right : input.blocked.left)) h.slideV = 0;
  // 地面滑行每個 tick 減速；按著反方向減速更快
  if (h.slideV > 0) h.slideV = Math.max(0, h.slideV - h.slideDecel * (dir === -h.facing ? HERO.brakeTurnFactor : 1));

  switch (h.state) {
    case HeroState.Dead:
      if (++h.stateTicks >= lengthOf(h.moves['hero/death'])) h.wantsRestart = true;
      return { vx: 0, vy: null, gravity: true };
    case HeroState.Hurt:
      // 硬直的最後一個 tick 也照樣擊退，下一個 tick 才恢復行動
      if (++h.stateTicks >= ticks(HERO.hurtMs)) {
        h.state = input.onGround ? HeroState.Idle : HeroState.Air;
        if (input.onGround) h.doubleJumped = h.airAttackUsed = false;
      }
      return { vx: h.knockDir * KNOCK_SPEED, vy: null, gravity: true };
  }

  if (h.state === HeroState.Attack) {
    const out = attacking(h, input);
    if (out) return out;
  }

  // 走、跑、滑行出平台邊緣：進入空中往下掉，coyoteMs 內按 Z 還是一般跳。往下的速度擋掉剛開場、物理還沒跑過的那個 tick
  if (GROUNDED.has(h.state) && !input.onGround && input.vy > 0) {
    takeoff(h, dir);
    h.coyoteTicks = ticks(HERO.coyoteMs);
  }

  if (h.state === HeroState.Air) {
    h.airTicks++;
    h.doubleJumpTicks++;
    // 只認往下或靜止時的著地：起跳那一 tick 還貼著地面
    if (input.onGround && input.vy >= 0) land(h);
    else return air(h, f, dir);
  }

  if (h.landTicks > 0) h.landTicks--;
  if (takeBuffered(h.buffer, 'attack', t)) {
    // 跑＋X：和停止奔跑一樣從跑速滑行；滑行中出招：剩下的滑行照原本的減速繼續
    if (h.state === HeroState.Run) slide(h);
    return startAttack(h, 'x1', false);
  }
  if (takeBuffered(h.buffer, 'jump', t)) {
    takeoff(h, dir);
    // 站在單向平台上 ↓＋Z：往下穿過、不起跳
    if (f.held.down && input.onPlatform) return { ...air(h, f, dir), dropThrough: true };
    return air(h, f, dir, JUMP_SPEED);
  }
  if (h.state === HeroState.Slide) {
    // 往同方向按就不滑了，照一般的走跑；滑完了也一樣
    if (dir === h.facing || h.slideV === 0) h.slideV = 0;
    else return { vx: h.facing * h.slideV, vy: null, gravity: true };
  }
  // 停止奔跑：放開跑的方向（或兩個方向一起按）就滑行一小段
  if (h.state === HeroState.Run && !(dir && h.run.runDir === dir)) {
    h.state = HeroState.Slide;
    slide(h);
    return { vx: h.facing * h.slideV, vy: null, gravity: true };
  }
  if (dir) h.facing = dir > 0 ? 1 : -1;
  h.state = !dir ? HeroState.Idle : h.run.runDir === dir ? HeroState.Run : HeroState.Walk;
  if (dir) h.landTicks = 0;
  const speed = h.state === HeroState.Run ? HERO.runSpeed : HERO.walkSpeed;
  return { vx: dir * speed, vy: null, gravity: true };
}

/** 從跑速開始滑行：等減速，滑 brakeDistance 停下 */
function slide(h: HeroLogic) {
  h.slideV = HERO.runSpeed;
  h.slideDecel = (HERO.runSpeed * HERO.runSpeed) / (2 * HERO.brakeDistance) / TICK_HZ;
}

/** 出招：面向鎖定、不能自己左右移動（地面的滑行、X2／X3 往前照樣有）；空中每一招開始時，跳躍帶來的垂直速度變小 */
function startAttack(h: HeroLogic, move: XMove, air: boolean): HeroOutput {
  h.state = HeroState.Attack;
  h.landTicks = 0;
  h.attack = { move, air, t: 0, queued: false, landed: false };
  if (air) {
    h.airAttackUsed = true;
    h.airVy = h.vy * HERO.airSlashDamp;
  }
  return attackOutput(h);
}

/** 出招中的一個 tick；招式結束時回傳 null，讓這個 tick 照一般狀態處理 */
function attacking(h: HeroLogic, input: HeroInput): HeroOutput | null {
  const a = h.attack!;
  a.t++;
  if (a.air && !a.landed && input.onGround && input.vy >= 0) {
    // 空中出招落地：剩下的招式在地面做完
    a.landed = true;
    h.carryVx = 0;
    h.doubleJumped = false;
    h.airAttackUsed = false;
  }
  // 出招中任何時候按 X 都記下來；X3 沒有下一招，按鍵留在預先輸入裡，收招結束時還沒過期就接 X1
  const next = NEXT[a.move];
  if (next && !a.queued && takeBuffered(h.buffer, 'attack', h.tick)) a.queued = true;

  const frame = frameAt(h.moves[`hero/${a.move}`], a.t);
  // 空中揮砍期間：垂直速度照較小的重力變化
  if (a.air && !a.landed && frame && frame.phase !== 'recovery') {
    h.airVy = Math.min(HERO.maxFallSpeed, h.airVy + (GRAVITY * HERO.airSlashGravity) / TICK_HZ);
  }
  if (next && a.queued && (!frame || frame.phase === 'recovery')) {
    return startAttack(h, next, a.air && !a.landed && !input.onGround);
  }
  if (frame) return attackOutput(h);

  h.attack = null;
  if (!input.onGround) {
    // 地面招式被帶出平台邊緣：照一般重力掉下來，做完時在空中就照走出邊緣進入空中（沒有 coyote time）
    if (!a.air || a.landed) takeoff(h, 0);
    h.state = HeroState.Air;
  } else h.state = h.slideV > 0 ? HeroState.Slide : HeroState.Idle; // 招式結束時還在滑，就回到滑行
  return null;
}

/** 揮砍期間（預備＋判定）的 tick 數 */
const swingTicks = (g: ArtGroup) =>
  (g.frames ?? []).filter((f) => f.phase !== 'recovery').reduce((n, f) => n + f.hold, 0) * ticksPerHold(g);

function attackOutput(h: HeroLogic): HeroOutput {
  const a = h.attack!;
  const g = h.moves[`hero/${a.move}`];
  const frame = frameAt(g, a.t);
  const spawnWave = a.move === 'x3' && frame?.phase === 'active' && frameAt(h.moves['hero/x3'], a.t - 1)?.phase !== 'active';
  // X2、X3 在揮砍期間（預備＋判定）均勻往前，距離照格數換成速度
  const swinging = frame !== undefined && frame.phase !== 'recovery';
  const lunge = swinging ? (HERO.lunge[a.move] / swingTicks(g)) * TICK_HZ : 0;
  if (a.air && !a.landed) {
    // 空中：保持出招當下的水平速度再加上往前；揮砍期間垂直速度由邏輯算（重力較小），X2、X3 微幅往上帶，像在空中往前游
    if (!swinging) return { vx: h.carryVx, vy: null, gravity: true, spawnWave };
    const lift = (HERO.lift[a.move] / swingTicks(g)) * TICK_HZ;
    return { vx: h.carryVx + h.facing * lunge, vy: h.airVy - lift, gravity: false, spawnWave };
  }
  // 地面的滑行和往前踏重疊時，兩個速度相加
  return { vx: h.facing * (h.slideV + lunge), vy: null, gravity: true, spawnWave };
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
  h.slideV = 0;
  h.airDir = dir;
  h.state = HeroState.Air;
  h.airTicks = 0;
  h.doubleJumpTicks = Infinity;
  h.coyoteTicks = 0;
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
  // 空中 X 每次離地一輪；用完後到落地前按 X 沒反應。出招時保持當下（上一個 tick）的水平速度
  if (launch === undefined && takeBuffered(h.buffer, 'attack', h.tick) && !h.airAttackUsed) {
    h.carryVx = h.lastVx;
    return startAttack(h, 'x1', true);
  }
  let vy: number | null = launch === undefined ? null : -launch;
  if (vy === null && h.coyoteTicks > 0 && takeBuffered(h.buffer, 'jump', h.tick)) {
    h.coyoteTicks = 0;
    vy = -JUMP_SPEED;
  }
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

/** 上升、下落速度在這之內顯示頂點那一格；固定門檻，手繪的跳躍格多了再改成照速度分段 */
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
    case HeroState.Hurt:
      return { anim: 'hero/hurt', frame: frameAt(h.moves['hero/hurt'], h.stateTicks)?.file ?? h.moves['hero/hurt'].frames?.at(-1)?.file };
    case HeroState.Dead:
      return { anim: 'hero/death', frame: frameAt(h.moves['hero/death'], h.stateTicks)?.file ?? h.moves['hero/death'].frames?.at(-1)?.file };
    case HeroState.Slide:
      // 跑步煞車還沒有圖，先借用落地格
      return jump('land');
    case HeroState.Walk:
      return { anim: 'hero/walk' };
    case HeroState.Run:
      return { anim: 'hero/run' };
    default:
      return h.landTicks > 0 ? jump('land') : { anim: 'hero/idle' };
  }
}
