import { describe, expect, test } from 'vitest';
import { DOOR, doorOpen, LEVEL_START, MAPS, nextEntry } from './maps';
import { GROUND_Y, HERO } from './tuning';

describe('關卡流程', () => {
  test('敵人全部 HP 歸零才開門', () => {
    expect(doorOpen([120, 0, 0])).toBe(false);
    expect(doorOpen([0, 0, 0])).toBe(true);
    // 死亡動畫播完、從場上移除的敵人不算
    expect(doorOpen([])).toBe(true);
  });

  test('走進門到下一張的入口，HP／MP 照離開時的值', () => {
    expect(nextEntry('door', { map: 0, hp: 1000, mp: 0 }, { hp: 640, mp: 120 })).toEqual({ map: 1, hp: 640, mp: 120 });
  });

  test('最後一張的門是關卡完成', () => {
    expect(nextEntry('door', { map: MAPS.length - 1, hp: 500, mp: 50 }, { hp: 500, mp: 50 })).toBeNull();
  });

  test('死亡重來：從這張的入口開始，HP／MP 是進入這張地圖時的值', () => {
    expect(nextEntry('death', { map: 1, hp: 640, mp: 120 }, { hp: 0, mp: 300 })).toEqual({ map: 1, hp: 640, mp: 120 });
  });

  test('從關卡開頭重來：第 1 張、HP 1000、MP 0', () => {
    expect(LEVEL_START).toEqual({ map: 0, hp: HERO.hpMax, mp: 0 });
    expect(HERO.hpMax).toBe(1000);
  });
});

describe('地圖資料', () => {
  test('3 張地圖，每張 3–5 個平台：離地 200 或 400、寬是 240 的倍數、不蓋到門', () => {
    expect(MAPS).toHaveLength(3);
    for (const map of MAPS) {
      expect(map.platforms.length).toBeGreaterThanOrEqual(3);
      expect(map.platforms.length).toBeLessThanOrEqual(5);
      for (const p of map.platforms) {
        expect([200, 400]).toContain(GROUND_Y - p.top);
        expect(p.w % 240).toBe(0);
        expect(p.x + p.w).toBeLessThanOrEqual(DOOR.x - DOOR.w / 2);
      }
    }
  });
});
