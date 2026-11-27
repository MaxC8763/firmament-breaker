// 一關的 3 張小地圖與關卡流程：座標是世界座標，地面 y＝GROUND_Y，地圖兩端是牆，入口在左端、門在右端
import { GROUND_Y, HERO, WORLD_WIDTH, type EnemyKind } from './tuning';

/** 單向平台：只有上緣擋得住，從下面跳得上去。x 是左緣、top 是上緣的 y，寬是一個地板方格（240）的倍數 */
export interface Platform {
  x: number;
  top: number;
  w: number;
}

export interface MapData {
  platforms: Platform[];
  /** 敵人的腳底 x；敵人只走地面 */
  enemies: { kind: EnemyKind; x: number }[];
  /** 道具的腳底：放在地面（GROUND_Y）或平台的上緣 */
  items: { kind: 'hp' | 'mp'; x: number; y: number }[];
  /** 程式畫的背景：天空、遠山、地面兩色 */
  colors: { sky: number; hills: number; ground: [number, number] };
}

/** 平台的厚度：畫出來的樣子，也是 ↓＋Z 往下穿時要掉過的距離 */
export const PLATFORM_THICKNESS = 24;

/** 離地 200：一段跳就上得去 */
export const LOW = GROUND_Y - 200;
/** 離地 400：要二段跳，或從低的平台再跳 */
export const HIGH = GROUND_Y - 400;

/** 出口的門：每張都在右端，x 是門的中心；主角腳底在門的寬度內按 ↑ 就進門 */
export const DOOR = { x: WORLD_WIDTH - 160, w: 160, h: 240 };

export const MAPS: MapData[] = [
  // 第 1 張：平台少而低
  {
    platforms: [
      { x: 720, top: LOW, w: 480 },
      { x: 1920, top: LOW, w: 240 },
      { x: 2640, top: LOW, w: 480 },
    ],
    enemies: [
      { kind: 'grunt', x: 1600 },
      { kind: 'grunt', x: 2400 },
      { kind: 'grunt', x: 3300 },
    ],
    items: [
      { kind: 'mp', x: 960, y: LOW },
      { kind: 'hp', x: 2880, y: LOW },
    ],
    colors: { sky: 0xcfe3ef, hills: 0xa9c8d8, ground: [0x3b4a3f, 0x45574a] },
  },
  // 第 2 張：開始有高的平台
  {
    platforms: [
      { x: 600, top: LOW, w: 480 },
      { x: 1200, top: HIGH, w: 480 },
      { x: 2160, top: LOW, w: 480 },
      { x: 2880, top: HIGH, w: 240 },
    ],
    enemies: [
      { kind: 'grunt', x: 1500 },
      { kind: 'grunt', x: 2600 },
    ],
    items: [
      { kind: 'hp', x: 1440, y: HIGH },
      { kind: 'mp', x: 2400, y: LOW },
    ],
    colors: { sky: 0xf2dcc4, hills: 0xd9b48f, ground: [0x5a4632, 0x67513b] },
  },
  // 第 3 張：高低交錯
  {
    platforms: [
      { x: 480, top: LOW, w: 240 },
      { x: 960, top: HIGH, w: 480 },
      { x: 1680, top: LOW, w: 480 },
      { x: 2400, top: HIGH, w: 480 },
      { x: 3000, top: LOW, w: 240 },
    ],
    enemies: [
      { kind: 'grunt', x: 1400 },
      { kind: 'grunt', x: 2200 },
    ],
    items: [
      { kind: 'hp', x: 1200, y: HIGH },
      { kind: 'mp', x: 2640, y: HIGH },
    ],
    colors: { sky: 0xd6d2ea, hills: 0xa9a2cf, ground: [0x3d3a52, 0x48445f] },
  },
];

/** 進入一張地圖時帶進來的值：換地圖、死亡重來、從關卡開頭重來都用它重開關卡場景 */
export interface Entry {
  map: number;
  hp: number;
  mp: number;
}

/** 關卡開頭：第 1 張、HP 全滿、MP 0 */
export const LEVEL_START: Readonly<Entry> = { map: 0, hp: HERO.hpMax, mp: 0 };

/** 這張地圖的敵人全部 HP 歸零才開門（不等死亡動畫） */
export const doorOpen = (enemyHp: number[]) => enemyHp.every((hp) => hp === 0);

/**
 * 關卡場景接下來用哪些值重開：走進門到下一張的入口，HP／MP 照舊；死亡從這張的入口重來，用進入這張時的值。
 * 最後一張的門回傳 null＝關卡完成。
 */
export function nextEntry(event: 'door' | 'death', entry: Entry, hero: { hp: number; mp: number }): Entry | null {
  if (event === 'death') return { ...entry };
  return entry.map + 1 < MAPS.length ? { map: entry.map + 1, hp: hero.hp, mp: hero.mp } : null;
}
