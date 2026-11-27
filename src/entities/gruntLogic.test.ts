import { describe, expect, test } from 'vitest';
import { newAttack, strike } from '../combat/attack';
import { GRUNT, TICK_HZ, ticks } from '../data/tuning';
import { gruntHarmful, GruntState, hurtGrunt, newGrunt, tickGrunt } from './gruntLogic';

const DEATH_TICKS = 40;

describe('小兵追擊', () => {
  test('主角在水平 600 px 內就朝主角走', () => {
    const g = newGrunt(1000, DEATH_TICKS);
    expect(tickGrunt(g, 1000 + GRUNT.chaseRange)).toBe(GRUNT.speed);
    expect(g).toMatchObject({ state: GruntState.Walk, facing: 1 });
    expect(tickGrunt(g, 500)).toBe(-GRUNT.speed);
    expect(g.facing).toBe(-1);
  });

  test('超過 600 px 就待機', () => {
    const g = newGrunt(1000, DEATH_TICKS);
    expect(tickGrunt(g, 1000 - GRUNT.chaseRange - 1)).toBe(0);
    expect(g.state).toBe(GruntState.Idle);
    tickGrunt(g, 1200);
    expect(tickGrunt(g, 1000 + GRUNT.chaseRange + 1)).toBe(0);
    expect(g.state).toBe(GruntState.Idle);
  });
});

describe('小兵受擊', () => {
  test('受擊硬直 300 ms，期間往擊退方向退 40 px，硬直中不造成碰撞傷害', () => {
    const g = newGrunt(1000, DEATH_TICKS);
    hurtGrunt(g, 1);
    let moved = 0;
    let n = 0;
    while (g.state === GruntState.Hurt) {
      expect(gruntHarmful(g)).toBe(false);
      moved += tickGrunt(g, 900) / TICK_HZ;
      n++;
    }
    expect(n).toBe(ticks(GRUNT.hurtMs));
    expect(moved).toBeCloseTo(GRUNT.knockback, 0);
    expect(gruntHarmful(g)).toBe(true);
  });

  test('HP 歸零進入待死亡，打它的攻擊都結束才播死亡動畫，播完就移除', () => {
    const g = newGrunt(1000, DEATH_TICKS);
    const a = newAttack({ maxHits: 1, intervalTicks: Infinity, damage: GRUNT.hp, mp: 5 });
    strike(a, g, 0);
    hurtGrunt(g, 1);
    expect(g.state).toBe(GruntState.Dying);
    expect(gruntHarmful(g)).toBe(false);
    for (let i = 0; i < 60; i++) tickGrunt(g, 900);
    expect(g.state).toBe(GruntState.Dying);
    a.ended = true;
    tickGrunt(g, 900);
    expect(g.state).toBe(GruntState.Death);
    for (let i = 0; i < DEATH_TICKS; i++) tickGrunt(g, 900);
    expect(g.state).toBe(GruntState.Gone);
  });
});
