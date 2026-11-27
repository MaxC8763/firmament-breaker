// 三種雜兵的決策：不 import phaser；數值依種類從 tuning 來，薄殼只負責套用結果
import { canDie, newTarget, type Target } from '../combat/attack';
import { ENEMIES, ENEMY, TICK_HZ, ticks, type EnemyKind } from '../data/tuning';

export enum EnemyState {
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

export interface EnemyLogic extends Target {
  kind: EnemyKind;
  state: EnemyState;
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

export const newEnemy = (kind: EnemyKind, x: number, deathTicks: number): EnemyLogic => ({
  ...newTarget(ENEMIES[kind].hp),
  kind,
  state: EnemyState.Idle,
  x,
  facing: -1,
  ticks: 0,
  knockDir: 0,
  deathTicks,
});

/** 擊退速度：硬直期間等速退完擊退距離 */
const KNOCK_SPEED = ENEMY.knockback / (ENEMY.hurtMs / 1000);

/** 被打中（造成傷害或命中不計段）：硬直、往 dir 擊退；HP 已歸零就進入待死亡 */
export function hurtEnemy(e: EnemyLogic, dir: number): void {
  if (e.state === EnemyState.Death || e.state === EnemyState.Gone) return;
  e.state = e.dying ? EnemyState.Dying : EnemyState.Hurt;
  e.ticks = ticks(ENEMY.hurtMs);
  e.knockDir = dir;
}

/** 硬直中與待死亡的雜兵不造成碰撞傷害 */
export const enemyHarmful = (e: EnemyLogic) => e.state === EnemyState.Idle || e.state === EnemyState.Walk;

/** 每個 tick：回傳水平速度 */
export function tickEnemy(e: EnemyLogic, heroX: number): number {
  switch (e.state) {
    case EnemyState.Hurt:
      if (--e.ticks <= 0) e.state = EnemyState.Idle;
      return e.knockDir * KNOCK_SPEED;
    case EnemyState.Dying:
      if (canDie(e)) {
        e.state = EnemyState.Death;
        e.ticks = e.deathTicks;
        return 0;
      }
      return e.ticks-- > 0 ? e.knockDir * KNOCK_SPEED : 0;
    case EnemyState.Death:
      if (--e.ticks <= 0) e.state = EnemyState.Gone;
      return 0;
    case EnemyState.Gone:
      return 0;
    case EnemyState.Idle:
    case EnemyState.Walk: {
      const dx = heroX - e.x;
      const { chaseRange, speed } = ENEMIES[e.kind];
      e.state = Math.abs(dx) <= chaseRange ? EnemyState.Walk : EnemyState.Idle;
      if (e.state === EnemyState.Idle || dx === 0) return 0;
      e.facing = dx > 0 ? 1 : -1;
      return e.facing * speed;
    }
  }
}

/** 死亡動畫的長度：meta 的 hold 合計換成 tick */
export const holdTicks = (holds: number[], fps: number) => (holds.reduce((a, b) => a + b, 0) * TICK_HZ) / fps;
