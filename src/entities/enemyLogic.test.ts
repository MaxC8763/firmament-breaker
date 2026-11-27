import { describe, expect, test } from 'vitest';
import { armored } from '../combat/armor';
import { newAttack, strike } from '../combat/attack';
import type { ArtGroup } from '../data/manifest';
import { ENEMIES, ENEMY, TICK_HZ, ticks } from '../data/tuning';
import { enemyHarmful, EnemyState, hurtEnemy, newEnemy, swingActive, tickEnemy, type EnemyLogic } from './enemyLogic';

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

/** 和佔位圖一樣的格數：預備 2＋2＋3、判定 1＋1、收招 2＋2（35／10／20 tick） */
const HEAVY_ATTACK: ArtGroup = {
  canvas: [320, 320],
  fps: 12,
  loop: false,
  frames: [
    { file: 'attack_00', hold: 2, phase: 'startup' },
    { file: 'attack_01', hold: 2, phase: 'startup' },
    { file: 'attack_02', hold: 3, phase: 'startup' },
    { file: 'attack_03', hold: 1, phase: 'active' },
    { file: 'attack_04', hold: 1, phase: 'active' },
    { file: 'attack_05', hold: 2, phase: 'recovery' },
    { file: 'attack_06', hold: 2, phase: 'recovery' },
  ],
};
const heavy = (x = 2000) => newEnemy('heavy', x, DEATH_TICKS, HEAVY_ATTACK);
const damage = (e: EnemyLogic, n: number, dir = 1) => {
  for (let i = 0; i < n; i++) {
    strike(newAttack({ maxHits: 1, intervalTicks: Infinity, damage: 10, mp: 5 }), e, i);
    hurtEnemy(e, dir, true);
  }
};

describe('重甲兵', () => {
  test('主角在水平 600 px 內就以 60 px/s 走近', () => {
    const h = heavy();
    expect(tickEnemy(h, 2000 - ENEMIES.heavy.chaseRange - 1).vx).toBe(0);
    expect(tickEnemy(h, 2000 - ENEMIES.heavy.chaseRange).vx).toBe(-ENEMIES.heavy.speed);
    expect(ENEMIES.heavy.speed).toBe(60);
  });

  test('主角在揮擊範圍內才揮；預備 600 ms 後才有判定，揮擊期間不動', () => {
    const h = heavy();
    expect(tickEnemy(h, 1900, false).vx).not.toBe(0);
    tickEnemy(h, 1900, true);
    expect(h.state).toBe(EnemyState.Attack);
    let t = 0;
    while (!swingActive(h)) {
      expect(tickEnemy(h, 1900, true).vx).toBe(0);
      t++;
    }
    // 預備 7 格＝35 tick（約 583 ms）
    expect(t).toBe(35);
  });

  test('揮完要距上次揮擊滿 3 秒才再揮', () => {
    const h = heavy();
    const starts: number[] = [];
    for (let t = 1; t <= 300; t++) {
      const before = h.state;
      tickEnemy(h, 1900, true);
      if (before !== EnemyState.Attack && h.state === EnemyState.Attack) starts.push(t);
    }
    expect(starts.slice(1).map((t, i) => t - starts[i])).toEqual([ticks(ENEMIES.heavy.swingEveryMs)]);
  });

  test('霸體：前 7 段照常扣血但不硬直、不擊退、揮擊不中斷；第 8 段破甲並照正常受擊', () => {
    const h = heavy();
    tickEnemy(h, 1900, true);
    damage(h, 7);
    expect(h.state).toBe(EnemyState.Attack);
    expect(h.hp).toBe(ENEMIES.heavy.hp - 70);
    damage(h, 1);
    expect(h.state).toBe(EnemyState.Hurt);
    expect(h.armor.broken).toBeGreaterThan(0);
  });

  test('破甲 2500 ms 內和小兵一樣會硬直；時間到霸體段數回滿', () => {
    const h = heavy();
    damage(h, 8);
    for (let i = 0; i < ticks(ENEMY.hurtMs); i++) tickEnemy(h, 0);
    damage(h, 1);
    expect(h.state).toBe(EnemyState.Hurt);
    for (let i = 0; i < ticks(ENEMIES.heavy.breakMs); i++) tickEnemy(h, 0);
    expect(armored(h.armor)).toBe(true);
    expect(h.armor.left).toBe(ENEMIES.heavy.armorHits);
  });

  test('命中但不計段（超過段數上限）的接觸，不計入霸體段數', () => {
    const h = heavy();
    for (let i = 0; i < 20; i++) hurtEnemy(h, 1, false);
    expect(h.armor.left).toBe(ENEMIES.heavy.armorHits);
    expect(h.state).toBe(EnemyState.Idle);
  });

  test('HP 歸零中止正在做的揮擊', () => {
    const h = heavy();
    tickEnemy(h, 1900, true);
    strike(newAttack({ maxHits: 1, intervalTicks: Infinity, damage: ENEMIES.heavy.hp, mp: 5 }), h, 0);
    hurtEnemy(h, 1, true);
    expect(h.state).toBe(EnemyState.Dying);
  });

  test('小兵與砲手沒有霸體，每次受擊都硬直', () => {
    for (const kind of ['grunt', 'gunner'] as const) {
      const e = newEnemy(kind, 1000, DEATH_TICKS);
      hurtEnemy(e, 1, true);
      expect(e.state).toBe(EnemyState.Hurt);
    }
  });
});
