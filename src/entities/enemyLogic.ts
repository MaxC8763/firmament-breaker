// 三種雜兵的決策：不 import phaser；數值依種類從 tuning 來，薄殼只負責套用結果
import { canDie, newTarget, type Target } from '../combat/attack';
import type { ArtFrame, ArtGroup } from '../data/manifest';
import { ENEMIES, ENEMY, TICK_HZ, ticks, type EnemyKind } from '../data/tuning';
import { frameAt } from './heroLogic';

export enum EnemyState {
  Idle,
  Walk,
  /** 出招中（砲手的射擊）：格照攻擊動作 meta 的 hold／phase 推進 */
  Attack,
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
  /** 攻擊動作的 meta；小兵沒有 */
  attack?: ArtGroup;
  /** 出招後經過的 tick */
  attackT: number;
  /** 砲手：主角在射程內經過的 tick，滿了就射 */
  timer: number;
}

/** 一個 tick 的結果：水平速度；shoot＝砲手這個 tick 到了發射格，該生成彈丸 */
export interface EnemyOutput {
  vx: number;
  shoot?: boolean;
}

export const newEnemy = (kind: EnemyKind, x: number, deathTicks: number, attack?: ArtGroup): EnemyLogic => ({
  ...newTarget(ENEMIES[kind].hp),
  kind,
  state: EnemyState.Idle,
  x,
  facing: -1,
  ticks: 0,
  knockDir: 0,
  deathTicks,
  attack,
  attackT: 0,
  timer: 0,
});

/** 擊退速度：硬直期間等速退完擊退距離 */
const KNOCK_SPEED = ENEMY.knockback / (ENEMY.hurtMs / 1000);

/** 被打中（造成傷害或命中不計段）：硬直、往 dir 擊退，正在做的攻擊中斷、砲手的計時重來；HP 已歸零就進入待死亡 */
export function hurtEnemy(e: EnemyLogic, dir: number): void {
  if (e.state === EnemyState.Death || e.state === EnemyState.Gone) return;
  e.state = e.dying ? EnemyState.Dying : EnemyState.Hurt;
  e.ticks = ticks(ENEMY.hurtMs);
  e.knockDir = dir;
  e.timer = 0;
}

/** 硬直中與待死亡的雜兵不造成碰撞傷害 */
export const enemyHarmful = (e: EnemyLogic) => e.state === EnemyState.Idle || e.state === EnemyState.Walk || e.state === EnemyState.Attack;

/** 出招中顯示哪一格；不在出招是 undefined */
export const attackFrame = (e: EnemyLogic): ArtFrame | undefined =>
  e.state === EnemyState.Attack && e.attack ? frameAt(e.attack, e.attackT) : undefined;

export function tickEnemy(e: EnemyLogic, heroX: number): EnemyOutput {
  switch (e.state) {
    case EnemyState.Hurt:
      if (--e.ticks <= 0) e.state = EnemyState.Idle;
      return { vx: e.knockDir * KNOCK_SPEED };
    case EnemyState.Dying:
      if (canDie(e)) {
        e.state = EnemyState.Death;
        e.ticks = e.deathTicks;
        return { vx: 0 };
      }
      return { vx: e.ticks-- > 0 ? e.knockDir * KNOCK_SPEED : 0 };
    case EnemyState.Death:
      if (--e.ticks <= 0) e.state = EnemyState.Gone;
      return { vx: 0 };
    case EnemyState.Gone:
      return { vx: 0 };
    case EnemyState.Attack:
      return attacking(e);
  }
  const dx = heroX - e.x;
  if (e.kind === 'gunner') return gunner(e, dx);
  const { chaseRange, speed } = ENEMIES.grunt;
  return chase(e, dx, chaseRange, speed);
}

/** 主角在水平 range 內就以 speed 朝主角走 */
function chase(e: EnemyLogic, dx: number, range: number, speed: number): EnemyOutput {
  e.state = Math.abs(dx) <= range ? EnemyState.Walk : EnemyState.Idle;
  if (e.state === EnemyState.Idle || dx === 0) return { vx: 0 };
  e.facing = dx > 0 ? 1 : -1;
  return { vx: e.facing * speed };
}

/** 砲手：不動、面向主角那側；主角在射程內滿 intervalMs 就出招，射擊動作的發射格生成彈丸 */
function gunner(e: EnemyLogic, dx: number): EnemyOutput {
  if (dx) e.facing = dx > 0 ? 1 : -1;
  if (Math.abs(dx) > ENEMIES.gunner.range) e.timer = 0;
  else if (++e.timer >= ticks(ENEMIES.gunner.intervalMs)) {
    e.state = EnemyState.Attack;
    e.attackT = 0;
    e.timer = 0;
  }
  return { vx: 0 };
}

/** 出招中：照攻擊動作的格推進，出招期間不動；播完回到待機。砲手的計時在出招中照樣算，兩發之間剛好 intervalMs */
function attacking(e: EnemyLogic): EnemyOutput {
  e.attackT++;
  e.timer++;
  const frame = attackFrame(e);
  if (!frame) {
    e.state = EnemyState.Idle;
    return { vx: 0 };
  }
  const firstActive = frame.phase === 'active' && frameAt(e.attack!, e.attackT - 1)?.phase !== 'active';
  return { vx: 0, shoot: e.kind === 'gunner' && firstActive };
}

/** 死亡動畫的長度：meta 的 hold 合計換成 tick */
export const holdTicks = (holds: number[], fps: number) => (holds.reduce((a, b) => a + b, 0) * TICK_HZ) / fps;
