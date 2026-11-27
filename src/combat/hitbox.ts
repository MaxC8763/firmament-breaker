// 判定框（src/data/hitboxes.json）的查表與重疊判斷；座標相對腳底 pivot，+x＝面向的前方、+y＝向下

export interface Rect {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
  arc?: [number, number];
}

export type Shape = Rect | Circle;

export interface HitboxData {
  attacks: Record<string, Shape>;
  /** 招式 → attacks 的鍵 */
  byAction: Record<string, string>;
  /** 招式 → 格名 → 只給這一格用的框 */
  perFrame: Record<string, Record<string, Shape>>;
}

/** 世界座標的矩形 */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 判定格的攻擊框：空中招式在 byAction 有自己的鍵（air_<招式>）就整個照自己的查，否則照地面招式；
 * 先查這一格的逐格框，沒有才用共用框。
 */
export function attackShape(data: HitboxData, move: string, air: boolean, frame: string): Shape | undefined {
  const key = air && data.byAction[`air_${move}`] ? `air_${move}` : move;
  return data.perFrame[key]?.[frame] ?? data.attacks[data.byAction[key]];
}

/** 放到腳底在 (x, y) 的世界座標；面向左時左右鏡射 */
export function toWorld(r: Rect, x: number, y: number, facing: number): Box {
  const left = facing > 0 ? x + r.x : x - r.x - r.w;
  return { left, right: left + r.w, top: y + r.y, bottom: y + r.y + r.h };
}

/** 有交集才算重疊，邊碰邊不算 */
export const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
