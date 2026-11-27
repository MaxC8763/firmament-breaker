import { describe, expect, test } from 'vitest';
import { HERO } from '../data/tuning';
import { frameOf, type Button } from '../input/input';
import { HeroState, newHero, tickHero, type HeroLogic } from './heroLogic';

const step = (h: HeroLogic, held: Button[] = [], pressed: Button[] = [], onGround = true, vy = 0) =>
  tickHero(h, { frame: frameOf(held, pressed), onGround, vy });

/** 空 n 個 tick */
const idle = (h: HeroLogic, n: number) => {
  for (let i = 0; i < n; i++) step(h);
};

describe('走與跑', () => {
  test('按著方向就走，放開就停', () => {
    const h = newHero();
    expect(step(h, [], ['right']).vx).toBe(HERO.walkSpeed);
    expect(h.state).toBe(HeroState.Walk);
    expect(step(h, ['right']).vx).toBe(HERO.walkSpeed);
    expect(step(h).vx).toBe(0);
    expect(h.state).toBe(HeroState.Idle);
  });

  test('250 ms 內連按兩下後按著是跑，放開就停', () => {
    const h = newHero();
    step(h, [], ['left']);
    idle(h, 5);
    expect(step(h, [], ['left']).vx).toBe(-HERO.runSpeed);
    expect(h.state).toBe(HeroState.Run);
    expect(step(h, ['left']).vx).toBe(-HERO.runSpeed);
    expect(step(h).vx).toBe(0);
    idle(h, 20);
    expect(step(h, [], ['left']).vx).toBe(-HERO.walkSpeed);
  });

  test('兩下間隔超過 250 ms 是走', () => {
    const h = newHero();
    step(h, [], ['right']);
    idle(h, 20);
    expect(step(h, [], ['right']).vx).toBe(HERO.walkSpeed);
  });

  test('面向跟著方向', () => {
    const h = newHero();
    step(h, [], ['left']);
    expect(h.facing).toBe(-1);
    step(h);
    expect(h.facing).toBe(-1);
    step(h, [], ['right']);
    expect(h.facing).toBe(1);
  });
});
