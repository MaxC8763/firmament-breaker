// 霸體：小的狀態物件，不 import phaser；敵人的邏輯只呼叫這些函式，時間一律用 tick
export interface Armor {
  /** 還差幾段破甲；max 是 0 的敵人沒有霸體 */
  left: number;
  max: number;
  /** 破甲狀態還剩幾個 tick；0＝沒有破甲 */
  broken: number;
}

export const newArmor = (max: number): Armor => ({ left: max, max, broken: 0 });

/** 霸體中：受擊不硬直、不被擊退，出招也不會被打斷 */
export const armored = (a: Armor) => a.max > 0 && a.broken === 0;

/** 造成傷害的那一段才呼叫；回傳 true＝這一擊打破霸體（這一擊本身照正常受擊） */
export function armorDamage(a: Armor, breakTicks: number): boolean {
  if (!armored(a)) return false;
  if (--a.left > 0) return false;
  a.broken = breakTicks;
  return true;
}

/** 每個 tick：破甲時間倒數，時間到霸體段數回滿；回傳 true＝這個 tick 回復 */
export function tickArmor(a: Armor): boolean {
  if (a.broken === 0 || --a.broken > 0) return false;
  a.left = a.max;
  return true;
}
