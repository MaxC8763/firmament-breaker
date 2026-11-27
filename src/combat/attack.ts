// 攻擊實例、MP、待死亡：不 import phaser，時間一律用 tick
import { HERO } from '../data/tuning';

export interface AttackSpec {
  /** 對同一個敵人最多造成幾段傷害 */
  maxHits: number;
  /** 對同一個敵人兩次接觸判定之間最少幾個 tick；單段斬擊是 Infinity（只接觸一次） */
  intervalTicks: number;
  damage: number;
  /** 每段傷害回多少 MP */
  mp: number;
}

/** 被打的一方：HP、是不是待死亡、被哪些攻擊實例打過 */
export interface Target {
  hp: number;
  /** HP 歸零了，等打過它的攻擊實例都結束才死 */
  dying: boolean;
  hitBy: Set<AttackInstance>;
}

/** 一次出招，或它生成的劍氣：記錄對每個敵人已造成幾段、上次接觸的 tick */
export interface AttackInstance {
  spec: AttackSpec;
  contacts: Map<Target, { count: number; last: number }>;
  ended: boolean;
}

/** damage＝造成傷害；hit＝命中但已達段數上限（播受擊反應，不扣血、不回 MP）；none＝還在判定間隔內 */
export type HitResult = 'damage' | 'hit' | 'none';

export const newAttack = (spec: AttackSpec): AttackInstance => ({ spec, contacts: new Map(), ended: false });
export const newTarget = (hp: number): Target => ({ hp, dying: false, hitBy: new Set() });

/** 接觸一次：段數上限內、距上次接觸滿判定間隔才造成傷害；只有造成傷害的段回 MP */
export function strike(a: AttackInstance, target: Target, tick: number): { result: HitResult; mp: number } {
  const c = a.contacts.get(target);
  if (c && tick - c.last < a.spec.intervalTicks) return { result: 'none', mp: 0 };
  const record = c ?? { count: 0, last: tick };
  record.last = tick;
  a.contacts.set(target, record);
  target.hitBy.add(a);
  if (record.count >= a.spec.maxHits) return { result: 'hit', mp: 0 };
  record.count++;
  target.hp = Math.max(0, target.hp - a.spec.damage);
  if (target.hp === 0) target.dying = true;
  return { result: 'damage', mp: a.spec.mp };
}

/** 回 MP；超過上限的部分捨去 */
export const addMp = (mp: number, gain: number) => Math.min(HERO.mpMax, mp + gain);

/** 待死亡的敵人，等所有打過它的攻擊實例都結束才死 */
export const canDie = (t: Target) => t.dying && [...t.hitBy].every((a) => a.ended);
