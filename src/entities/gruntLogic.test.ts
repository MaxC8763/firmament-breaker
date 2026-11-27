import { describe, expect, test } from 'vitest';
import { GRUNT } from '../data/tuning';
import { GruntState, newGrunt, tickGrunt } from './gruntLogic';

describe('小兵追擊', () => {
  test('主角在水平 600 px 內就朝主角走', () => {
    const g = newGrunt(1000);
    expect(tickGrunt(g, 1000 + GRUNT.chaseRange)).toBe(GRUNT.speed);
    expect(g).toMatchObject({ state: GruntState.Walk, facing: 1 });
    expect(tickGrunt(g, 500)).toBe(-GRUNT.speed);
    expect(g.facing).toBe(-1);
  });

  test('超過 600 px 就待機', () => {
    const g = newGrunt(1000);
    expect(tickGrunt(g, 1000 - GRUNT.chaseRange - 1)).toBe(0);
    expect(g.state).toBe(GruntState.Idle);
    tickGrunt(g, 1200);
    expect(tickGrunt(g, 1000 + GRUNT.chaseRange + 1)).toBe(0);
    expect(g.state).toBe(GruntState.Idle);
  });
});
