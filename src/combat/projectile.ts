// 敵方的發射物：由邏輯每個 tick 移動，碰撞用判定框自己算；不 import phaser
import { overlaps, toWorld, type Box, type Rect } from './hitbox';

/** 水平直線飛的彈丸：不受重力、穿過單向平台 */
export interface Projectile {
  /** 中心（pivot）的世界座標 */
  x: number;
  y: number;
  /** 每個 tick 移動幾 px；正＝往右 */
  vx: number;
}

/** fly＝繼續飛；wall＝撞到地圖兩端的牆；cut＝被主角的攻擊消除；hero＝碰到主角的 hurtbox */
export type ProjectileResult = 'fly' | 'wall' | 'cut' | 'hero';

/**
 * 一個 tick：往前移動，再依序看撞牆、被主角的攻擊（斬擊判定格、劍氣）碰到、碰到主角。
 * 被消除不是打中敵人：不經過攻擊實例，不回 MP、不停頓。碰到主角時要不要消失由呼叫端決定（主角無敵就穿過去）
 */
export function stepProjectile(p: Projectile, shape: Omit<Rect, 'type'>, bounds: { left: number; right: number }, hero: Box, attacks: Box[]): ProjectileResult {
  p.x += p.vx;
  const box = toWorld(shape, p.x, p.y, Math.sign(p.vx) || 1);
  if (box.left <= bounds.left || box.right >= bounds.right) return 'wall';
  if (attacks.some((a) => overlaps(a, box))) return 'cut';
  return overlaps(hero, box) ? 'hero' : 'fly';
}
