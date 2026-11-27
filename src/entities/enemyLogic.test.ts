import { describe, expect, test } from 'vitest';
import { newAttack, strike } from '../combat/attack';
import type { ArtGroup } from '../data/manifest';
import { ENEMIES, ENEMY, TICK_HZ, ticks } from '../data/tuning';
import { enemyHarmful, EnemyState, hurtEnemy, newEnemy, tickEnemy, type EnemyLogic } from './enemyLogic';

const DEATH_TICKS = 40;

describe('小兵追擊', () => {
  test('主角在水平 600 px 內就朝主角走', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    expect(tickEnemy(g, 1000 + ENEMIES.grunt.chaseRange).vx).toBe(ENEMIES.grunt.speed);
    expect(g).toMatchObject({ state: EnemyState.Walk, facing: 1 });
    expect(tickEnemy(g, 500).vx).toBe(-ENEMIES.grunt.speed);
    expect(g.facing).toBe(-1);
  });

  test('超過 600 px 就待機', () => {
    const g = newEnemy('grunt', 1000, DEATH_TICKS);
    expect(tickEnemy(g, 1000 - ENEMIES.grunt.chaseRange - 1).vx).toBe(0);
    expect(g.state).toBe(EnemyState.Idle);
    tickEnemy(g, 1200);
    expect(tickEnemy(g, 1000 + ENEMIES.grunt.chaseRange + 1).vx).toBe(0);
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
      moved += tickEnemy(g, 900).vx / TICK_HZ;
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

/** 和佔位圖一樣的格數：預備 2＋2、發射 1、收招 2＋2（20／5／20 tick） */
const GUNNER_ATTACK: ArtGroup = {
  canvas: [256, 256],
  fps: 12,
  loop: false,
  frames: [
    { file: 'attack_00', hold: 2, phase: 'startup' },
    { file: 'attack_01', hold: 2, phase: 'startup' },
    { file: 'attack_02', hold: 1, phase: 'active' },
    { file: 'attack_03', hold: 2, phase: 'recovery' },
    { file: 'attack_04', hold: 2, phase: 'recovery' },
  ],
};
const gunner = (x = 2000) => newEnemy('gunner', x, DEATH_TICKS, GUNNER_ATTACK);
/** 跑 n 個 tick（主角在 heroX 不動），回傳生成彈丸的 tick */
const shots = (e: EnemyLogic, heroX: number, n: number) => {
  const at: number[] = [];
  for (let t = 1; t <= n; t++) if (tickEnemy(e, heroX).shoot) at.push(t);
  return at;
};

describe('砲手', () => {
  test('主角在水平 900 px 內才射', () => {
    expect(shots(gunner(), 2000 - ENEMIES.gunner.range - 1, 600)).toEqual([]);
    expect(shots(gunner(), 2000 + ENEMIES.gunner.range - 1, 600).length).toBeGreaterThan(0);
  });

  test('進入射程 2 秒後開始射擊，發射格生成彈丸；之後每 2 秒一發', () => {
    const at = shots(gunner(), 1500, 600);
    const interval = ticks(ENEMIES.gunner.intervalMs);
    expect(at[0]).toBe(interval + 20);
    expect(at.slice(1).map((t, i) => t - at[i])).toEqual([interval, interval, interval]);
  });

  test('不動，面向主角那側', () => {
    const g = gunner();
    expect(tickEnemy(g, 2500).vx).toBe(0);
    expect(g.facing).toBe(1);
    expect(tickEnemy(g, 1500).vx).toBe(0);
    expect(g.facing).toBe(-1);
  });

  test('受擊中斷射擊，計時重來', () => {
    const g = gunner();
    const interval = ticks(ENEMIES.gunner.intervalMs);
    for (let t = 0; t < interval + 10; t++) tickEnemy(g, 1500);
    expect(g.state).toBe(EnemyState.Attack);
    hurtEnemy(g, 1);
    expect(g.state).toBe(EnemyState.Hurt);
    // 硬直 18 tick，之後重新數 2 秒才再出招
    const at = shots(g, 1500, 400);
    expect(at[0]).toBe(ticks(ENEMY.hurtMs) + interval + 20);
  });

  test('HP 歸零中止正在做的射擊', () => {
    const g = gunner();
    const interval = ticks(ENEMIES.gunner.intervalMs);
    for (let t = 0; t < interval + 10; t++) tickEnemy(g, 1500);
    strike(newAttack({ maxHits: 1, intervalTicks: Infinity, damage: ENEMIES.gunner.hp, mp: 5 }), g, 0);
    hurtEnemy(g, 1);
    expect(g.state).toBe(EnemyState.Dying);
    expect(shots(g, 1500, 200)).toEqual([]);
  });
});
