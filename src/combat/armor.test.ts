import { describe, expect, test } from 'vitest';
import { armorDamage, armored, newArmor, tickArmor } from './armor';
import { newAttack, newTarget, strike } from './attack';

const BREAK_TICKS = 150;

describe('霸體', () => {
  test('霸體段數 8：前 7 段不硬直；第 8 段破甲，這一擊照正常受擊', () => {
    const a = newArmor(8);
    for (let i = 1; i <= 7; i++) {
      expect(armorDamage(a, BREAK_TICKS)).toBe(false);
      expect(armored(a)).toBe(true);
    }
    expect(armorDamage(a, BREAK_TICKS)).toBe(true);
    expect(armored(a)).toBe(false);
  });

  test('破甲期間受擊會硬直；經過破甲時間觸發回復，段數回滿', () => {
    const a = newArmor(8);
    for (let i = 0; i < 8; i++) armorDamage(a, BREAK_TICKS);
    // 破甲期間再被打：不計段、照常硬直
    expect(armorDamage(a, BREAK_TICKS)).toBe(false);
    expect(armored(a)).toBe(false);
    for (let i = 1; i < BREAK_TICKS; i++) expect(tickArmor(a)).toBe(false);
    expect(tickArmor(a)).toBe(true);
    expect(armored(a)).toBe(true);
    expect(a.left).toBe(8);
  });

  test('霸體段數不會自然回復，只在破甲時間結束時回滿', () => {
    const a = newArmor(8);
    armorDamage(a, BREAK_TICKS);
    for (let i = 0; i < 1000; i++) expect(tickArmor(a)).toBe(false);
    expect(a.left).toBe(7);
  });

  test('超過攻擊實例段數上限的接觸，不計入霸體段數', () => {
    const a = newArmor(8);
    const target = newTarget(10_000);
    const wave = newAttack({ maxHits: 5, intervalTicks: 1, damage: 10, mp: 1 });
    // 只有造成傷害的段才呼叫 armorDamage
    for (let t = 0; t < 20; t++) if (strike(wave, target, t).result === 'damage') armorDamage(a, BREAK_TICKS);
    expect(a.left).toBe(3);
    expect(armored(a)).toBe(true);
  });

  test('霸體段數 0 的敵人，每次受擊都正常硬直', () => {
    const a = newArmor(0);
    for (let i = 0; i < 10; i++) {
      expect(armorDamage(a, BREAK_TICKS)).toBe(false);
      expect(armored(a)).toBe(false);
    }
  });
});
