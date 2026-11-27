import { describe, expect, test } from 'vitest';
import { addMp, canDie, newAttack, newTarget, strike, type AttackSpec, type Target } from './attack';

const SLASH: AttackSpec = { maxHits: 1, intervalTicks: Infinity, damage: 40, mp: 5 };
const WAVE: AttackSpec = { maxHits: 5, intervalTicks: 3, damage: 10, mp: 1 };

/** 每隔 every 個 tick 接觸一次、共 n 次，回傳 MP 合計與每次的結果 */
function contacts(spec: AttackSpec | ReturnType<typeof newAttack>, target: Target, n: number, every = 3, from = 0) {
  const a = 'spec' in spec ? spec : newAttack(spec);
  let mp = 0;
  const results: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = strike(a, target, from + i * every);
    mp += r.mp;
    results.push(r.result);
  }
  return { a, mp, results };
}

describe('多段攻擊', () => {
  test('段數上限：同一個攻擊實例對同一個敵人最多造成上限次傷害', () => {
    const t = newTarget(1000);
    const { results } = contacts(WAVE, t, 7);
    expect(results.filter((r) => r === 'damage')).toHaveLength(5);
    expect(t.hp).toBe(1000 - 5 * 10);
  });

  test('判定間隔：距上次接觸不到間隔的接觸不判定', () => {
    const t = newTarget(1000);
    const a = newAttack(WAVE);
    expect(strike(a, t, 0).result).toBe('damage');
    expect(strike(a, t, 1).result).toBe('none');
    expect(strike(a, t, 2).result).toBe('none');
    expect(strike(a, t, 3).result).toBe('damage');
  });

  test('單段斬擊對同一個敵人只接觸一次', () => {
    const t = newTarget(1000);
    const { results } = contacts(SLASH, t, 5, 1);
    expect(results).toEqual(['damage', 'none', 'none', 'none', 'none']);
  });

  test('已達上限：回報「命中、不計段」，不扣血、不回 MP', () => {
    const t = newTarget(1000);
    const { results, mp } = contacts(WAVE, t, 6);
    expect(results.at(-1)).toBe('hit');
    expect(mp).toBe(5);
    expect(t.hp).toBe(950);
  });

  test('待死亡：HP 歸零後要等所有打過它的攻擊實例都結束才死', () => {
    const t = newTarget(25);
    const slash = newAttack(SLASH);
    strike(slash, t, 0);
    slash.ended = true;
    const wave = newAttack(WAVE);
    contacts(wave, t, 1, 3, 3);
    expect(t.dying).toBe(true);
    expect(canDie(t)).toBe(false);
    wave.ended = true;
    expect(canDie(t)).toBe(true);
  });

  test('還沒歸零的敵人不會死', () => {
    const t = newTarget(120);
    const a = newAttack(SLASH);
    strike(a, t, 0);
    a.ended = true;
    expect(canDie(t)).toBe(false);
  });
});

describe('MP', () => {
  test('X1 同時砍到 2 個敵人 → +10', () => {
    const a = newAttack(SLASH);
    const mp = strike(a, newTarget(120), 0).mp + strike(a, newTarget(120), 0).mp;
    expect(mp).toBe(10);
  });

  test('XXX：斬擊打到敵人 1、劍氣接觸敵人 1 共 8 次、敵人 2 共 3 次 → +13', () => {
    const e1 = newTarget(1000);
    const e2 = newTarget(1000);
    const slash = strike(newAttack(SLASH), e1, 0).mp;
    const wave = newAttack(WAVE);
    const mp = slash + contacts(wave, e1, 8).mp + contacts(wave, e2, 3).mp;
    expect(mp).toBe(13);
  });

  test('劍氣第 3 段打死敵人 → 待死亡；第 4、5 段仍各 +1；劍氣消失後才死', () => {
    const t = newTarget(30);
    const wave = newAttack(WAVE);
    const first = contacts(wave, t, 3);
    expect(t.dying).toBe(true);
    const rest = contacts(wave, t, 2, 3, 9);
    expect(rest.results).toEqual(['damage', 'damage']);
    expect(first.mp + rest.mp).toBe(5);
    expect(canDie(t)).toBe(false);
    wave.ended = true;
    expect(canDie(t)).toBe(true);
  });

  test('MP 295 時回復 13 → 300，超過上限的部分捨去', () => {
    expect(addMp(295, 13)).toBe(300);
  });

  test('劍氣對同一敵人接觸 20 次 → 只造成 5 段、+5 MP，第 6 次起都是「命中、不計段」', () => {
    const t = newTarget(1000);
    const { results, mp } = contacts(WAVE, t, 20);
    expect(results.slice(0, 5).every((r) => r === 'damage')).toBe(true);
    expect(results.slice(5).every((r) => r === 'hit')).toBe(true);
    expect(mp).toBe(5);
    expect(t.hp).toBe(950);
  });
});
