import { describe, expect, test } from 'vitest';
import { newAttack, strike } from '../combat/attack';
import { ENEMIES, ENEMY, TICK_HZ, ticks } from '../data/tuning';
import { enemyHarmful, EnemyState, hurtEnemy, newEnemy, tickEnemy } from './enemyLogic';

const DEATH_TICKS = 40;

describe('小兵追擊', () => {
  test('主角在水平 600 px 內就朝主角走', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    expect(tickEnemy(g, 1000 + ENEMIES.grunt.chaseRange)).toBe(ENEMIES.grunt.speed);
    expect(g).toMatchObject({ state: EnemyState.Walk, facing: 1 });
    expect(tickEnemy(g, 500)).toBe(-ENEMIES.grunt.speed);
    expect(g.facing).toBe(-1);
  });

  test('超過 600 px 就待機', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    expect(tickEnemy(g, 1000 - ENEMIES.grunt.chaseRange - 1)).toBe(0);
    expect(g.state).toBe(EnemyState.Idle);
    tickEnemy(g, 1200);
    expect(tickEnemy(g, 1000 + ENEMIES.grunt.chaseRange + 1)).toBe(0);
    expect(g.state).toBe(EnemyState.Idle);
  });
});

describe('小兵受擊', () => {
  test('受擊硬直 300 ms，期間往擊退方向退 40 px，硬直中不造成碰撞傷害', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    hurtEnemy(g, 1);
    let moved = 0;
    let n = 0;
    while (g.state === EnemyState.Hurt) {
      expect(enemyHarmful(g)).toBe(false);
      moved += tickEnemy(g, 900) / TICK_HZ;
      n++;
    }
    expect(n).toBe(ticks(ENEMY.hurtMs));
    expect(moved).toBeCloseTo(ENEMY.knockback, 0);
    expect(enemyHarmful(g)).toBe(true);
  });

  test('HP 歸零進入待死亡，打它的攻擊都結束才播死亡動畫，播完就移除', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    const a = newAttack({ maxHits: 1, intervalTicks: Infinity, damage: ENEMIES.grunt.hp, mp: 5 });
    strike(a, g, 0);
    hurtEnemy(g, 1);
    expect(g.state).toBe(EnemyState.Dying);
    expect(enemyHarmful(g)).toBe(false);
    for (let i = 0; i < 60; i++) tickEnemy(g, 900);
    expect(g.state).toBe(EnemyState.Dying);
    a.ended = true;
    tickEnemy(g, 900);
    expect(g.state).toBe(EnemyState.Death);
    for (let i = 0; i < DEATH_TICKS; i++) tickEnemy(g, 900);
    expect(g.state).toBe(EnemyState.Gone);
  });
});
