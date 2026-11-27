// 小地圖的資料：座標是世界座標，地面 y＝GROUND_Y，地圖兩端是牆
import { GROUND_Y } from './tuning';

/** 單向平台：只有上緣擋得住，從下面跳得上去。x 是左緣、top 是上緣的 y，寬是一個地板方格（240）的倍數 */
export interface Platform {
  x: number;
  top: number;
  w: number;
}

export interface MapData {
  platforms: Platform[];
}

/** 平台的厚度：畫出來的樣子，也是 ↓＋Z 往下穿時要掉過的距離 */
export const PLATFORM_THICKNESS = 24;

/** 離地 200：一段跳就上得去 */
export const LOW = GROUND_Y - 200;
/** 離地 400：要二段跳，或從低的平台再跳 */
export const HIGH = GROUND_Y - 400;

export const MAPS: MapData[] = [
  // 第 1 張：平台少而低
  {
    platforms: [
      { x: 720, top: LOW, w: 480 },
      { x: 1920, top: LOW, w: 240 },
      { x: 2640, top: LOW, w: 480 },
    ],
  },
];
