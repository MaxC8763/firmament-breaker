// 主角的決策：不 import phaser。每個 tick 收輸入與著地狀態，決定狀態、要交給物理的速度、要顯示哪一格
import { HERO } from '../data/tuning';
import { bufferPresses, direction, newRunTracker, trackRun, type Buffered, type InputFrame, type RunTracker } from '../input/input';

export enum HeroState {
  Idle,
  Walk,
  Run,
}

export interface HeroLogic {
  state: HeroState;
  /** 1＝面向右、−1＝面向左 */
  facing: 1 | -1;
  /** 邏輯自己的 tick 計數 */
  tick: number;
  run: RunTracker;
  buffer: Buffered[];
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
}

export const newHero = (): HeroLogic => ({
  state: HeroState.Idle,
  facing: 1,
  tick: 0,
  run: newRunTracker(),
  buffer: [],
});

export function tickHero(h: HeroLogic, input: HeroInput): HeroOutput {
  const t = ++h.tick;
  const f = input.frame;
  trackRun(h.run, f, t);
  bufferPresses(h.buffer, f, t);

  const dir = direction(f);
  if (dir) h.facing = dir > 0 ? 1 : -1;
  h.state = !dir ? HeroState.Idle : h.run.runDir === dir ? HeroState.Run : HeroState.Walk;
  const speed = h.state === HeroState.Run ? HERO.runSpeed : HERO.walkSpeed;
  return { vx: dir * speed, vy: null, gravity: true };
}

/** 目前要顯示的動作；循環動作只給動作名，由薄殼播放 */
export function heroAnim(h: HeroLogic): string {
  switch (h.state) {
    case HeroState.Walk:
      return 'hero/walk';
    case HeroState.Run:
      return 'hero/run';
    default:
      return 'hero/idle';
  }
}
