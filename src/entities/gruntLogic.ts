// 小兵的決策：不 import phaser；數值從 tuning 來，薄殼只負責套用結果
import { canDie, newTarget, type Target } from '../combat/attack';
import { GRUNT, TICK_HZ, ticks } from '../data/tuning';

export enum GruntState {
  Idle,
  Walk,
  /** 受擊硬直，往後退 */
  Hurt,
  /** HP 歸零，維持受擊反應，等打它的攻擊都結束 */
  Dying,
  /** 播死亡動畫 */
  Death,
  /** 死亡動畫播完，從場上移除 */
  Gone,
}

export interface GruntLogic extends Target {
  state: GruntState;
  /** 腳底的 x，薄殼每個 tick 寫入 */
  x: number;
  /** 1＝面向右、−1＝面向左 */
  facing: 1 | -1;
  /** 目前狀態還剩幾個 tick（硬直、死亡動畫） */
  ticks: number;
  /** 被擊退的方向 */
  knockDir: number;
  /** 死亡動畫的長度（tick） */
  deathTicks: number;
}

export const newGrunt = (x: number, deathTicks: number): GruntLogic => ({
  ...newTarget(GRUNT.hp),
  state: GruntState.Idle,
  x,
  facing: -1,
  ticks: 0,
  knockDir: 0,
  deathTicks,
});

/** 擊退速度：硬直期間等速退完擊退距離 */
const KNOCK_SPEED = GRUNT.knockback / (GRUNT.hurtMs / 1000);

/** 被打中（造成傷害或命中不計段）：硬直、往 dir 擊退；HP 已歸零就進入待死亡 */
export function hurtGrunt(g: GruntLogic, dir: number): void {
  if (g.state === GruntState.Death || g.state === GruntState.Gone) return;
  g.state = g.dying ? GruntState.Dying : GruntState.Hurt;
  g.ticks = ticks(GRUNT.hurtMs);
  g.knockDir = dir;
}

/** 硬直中與待死亡的小兵不造成碰撞傷害 */
export const gruntHarmful = (g: GruntLogic) => g.state === GruntState.Idle || g.state === GruntState.Walk;

/** 每個 tick：回傳水平速度 */
export function tickGrunt(g: GruntLogic, heroX: number): number {
  switch (g.state) {
    case GruntState.Hurt:
      if (--g.ticks <= 0) g.state = GruntState.Idle;
      return g.knockDir * KNOCK_SPEED;
    case GruntState.Dying:
      if (canDie(g)) {
        g.state = GruntState.Death;
        g.ticks = g.deathTicks;
        return 0;
      }
      return g.ticks-- > 0 ? g.knockDir * KNOCK_SPEED : 0;
    case GruntState.Death:
      if (--g.ticks <= 0) g.state = GruntState.Gone;
      return 0;
    case GruntState.Gone:
      return 0;
    case GruntState.Idle:
    case GruntState.Walk: {
      const dx = heroX - g.x;
      g.state = Math.abs(dx) <= GRUNT.chaseRange ? GruntState.Walk : GruntState.Idle;
      if (g.state === GruntState.Idle || dx === 0) return 0;
      g.facing = dx > 0 ? 1 : -1;
      return g.facing * GRUNT.speed;
    }
  }
}

/** 死亡動畫的長度：meta 的 hold 合計換成 tick */
export const holdTicks = (holds: number[], fps: number) => (holds.reduce((a, b) => a + b, 0) * TICK_HZ) / fps;
