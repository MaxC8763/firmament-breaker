import { describe, expect, test } from 'vitest';
import { attackShape, overlaps, toWorld, type HitboxData, type Rect } from './hitbox';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ type: 'rect', x, y, w, h });
const SHARED = rect(20, -250, 190, 250);
const OWN_FRAME = rect(24, -240, 180, 240);
const AIR = rect(0, -200, 100, 200);

const data = (extra: Partial<HitboxData> = {}): HitboxData => ({
  attacks: { x_slash: SHARED, air_slash: AIR },
  byAction: { x1: 'x_slash', x2: 'x_slash' },
  perFrame: { x1: { x1_01: OWN_FRAME } },
  ...extra,
});

describe('攻擊框查表', () => {
  test('有逐格的框就用逐格的，其他格用共用框', () => {
    expect(attackShape(data(), 'x1', false, 'x1_01')).toBe(OWN_FRAME);
    expect(attackShape(data(), 'x1', false, 'x1_02')).toBe(SHARED);
  });

  test('空中招式沒有自己的鍵就照地面招式查，逐格框也一樣', () => {
    expect(attackShape(data(), 'x1', true, 'x1_01')).toBe(OWN_FRAME);
    expect(attackShape(data(), 'x2', true, 'x2_01')).toBe(SHARED);
  });

  test('空中招式有自己的鍵就整個照自己的查', () => {
    const d = data({ byAction: { x1: 'x_slash', air_x1: 'air_slash' } });
    expect(attackShape(d, 'x1', true, 'x1_01')).toBe(AIR);
    expect(attackShape(d, 'x1', false, 'x1_01')).toBe(OWN_FRAME);
    d.perFrame.air_x1 = { x1_02: SHARED };
    expect(attackShape(d, 'x1', true, 'x1_02')).toBe(SHARED);
  });
});

describe('世界座標與重疊', () => {
  test('面向右時框照原樣放在腳底的前方', () => {
    expect(toWorld(rect(20, -250, 190, 250), 1000, 900, 1)).toEqual({ left: 1020, right: 1210, top: 650, bottom: 900 });
  });

  test('面向左時左右鏡射', () => {
    expect(toWorld(rect(20, -250, 190, 250), 1000, 900, -1)).toEqual({ left: 790, right: 980, top: 650, bottom: 900 });
  });

  test('邊碰邊不算重疊，有交集才算', () => {
    const a = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(overlaps(a, { left: 100, right: 200, top: 0, bottom: 100 })).toBe(false);
    expect(overlaps(a, { left: 99, right: 200, top: 50, bottom: 60 })).toBe(true);
  });
});
