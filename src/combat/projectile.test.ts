import { describe, expect, test } from 'vitest';
import type { Box } from './hitbox';
import { stepProjectile, type Projectile } from './projectile';

const SHAPE = { x: -16, y: -16, w: 32, h: 32 };
const BOUNDS = { left: 24, right: 3816 };
const FAR: Box = { left: 0, right: 1, top: 0, bottom: 1 };
const box = (left: number, right: number): Box => ({ left, right, top: 700, bottom: 900 });
const bullet = (x: number, vx: number): Projectile => ({ x, y: 800, vx });

describe('敵方彈丸', () => {
  test('每個 tick 水平等速移動，不受重力', () => {
    const p = bullet(1000, -500 / 60);
    for (let i = 0; i < 60; i++) expect(stepProjectile(p, SHAPE, BOUNDS, FAR, [])).toBe('fly');
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBe(800);
  });

  test('撞到地圖兩端的牆就消失', () => {
    const left = bullet(50, -10);
    expect(stepProjectile(left, SHAPE, BOUNDS, FAR, [])).toBe('wall');
    const right = bullet(3790, 10);
    expect(stepProjectile(right, SHAPE, BOUNDS, FAR, [])).toBe('wall');
  });

  test('碰到主角的 hurtbox 是打中', () => {
    const p = bullet(1000, -10);
    expect(stepProjectile(p, SHAPE, BOUNDS, box(950, 1000), [])).toBe('hero');
  });

  test('只打到發射物：主角的攻擊碰到彈丸就消除，消除不經過攻擊實例，所以不回 MP', () => {
    const p = bullet(1000, -10);
    // 攻擊框和主角的 hurtbox 同時碰到：先算被消除
    expect(stepProjectile(p, SHAPE, BOUNDS, box(950, 1000), [box(960, 1100)])).toBe('cut');
  });
});
