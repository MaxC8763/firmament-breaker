// 可調數值集中在這裡；單位是 1920×1080 畫面上的像素、毫秒

/** 地平線的 y：主角腳底踩在這條線上 */
export const GROUND_Y = 900;
/** 地圖寬：兩個畫面，兩端是牆 */
export const WORLD_WIDTH = 3840;

/** 戰鬥邏輯固定每秒 60 個 tick */
export const TICK_HZ = 60;
/** 毫秒換成 tick 數 */
export const ticks = (ms: number) => Math.round((ms * TICK_HZ) / 1000);

export const INPUT = {
  /** 同一個方向連按兩下的間隔在這之內，按著就是跑 */
  doubleTapMs: 250,
  /** 還不能行動時按下的鍵保留多久 */
  bufferMs: 150,
};

export const HERO = {
  /** 入口：地圖左端 */
  startX: 240,
  walkSpeed: 300,
  runSpeed: 480,
  /** 空中轉向後、或不是跑跳時的水平速度 */
  airTurnSpeed: 300,
  gravity: 3000,
  /** 起跳速度由高度在 60 Hz 步長下反推 */
  jumpHeight: 300,
  doubleJumpHeight: 220,
  maxFallSpeed: 1500,
  /** 跑＋X：滑行多久減速到 0 */
  slideMs: 100,
};

/** 真空切劍氣：X3 判定開始時在主角前方生成，往前飛 */
export const WAVE = {
  distance: 480,
  lifeMs: 400,
  /** 生成位置相對主角腳底；x 是面向的前方 */
  spawnX: 120,
  spawnY: -120,
};
