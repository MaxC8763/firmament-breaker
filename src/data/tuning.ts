// 可調數值集中在這裡；單位是 1920×1080 畫面上的像素、毫秒

/** 地平線的 y：主角腳底踩在這條線上 */
export const GROUND_Y = 900;
/** 地圖寬：兩個畫面，兩端是牆 */
export const WORLD_WIDTH = 3840;

/** 戰鬥邏輯固定每秒 60 個 tick */
export const TICK_HZ = 60;
/** 毫秒換成 tick 數 */
export const ticks = (ms: number) => Math.round((ms * TICK_HZ) / 1000);

/** 主角與敵人共用的重力 */
export const GRAVITY = 3000;

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
  /** 先試原本 480 的 1.2 倍 */
  runSpeed: 576,
  /** 空中轉向後、或不是跑跳時的水平速度 */
  airTurnSpeed: 300,
  gravity: GRAVITY,
  /** 起跳速度由高度在 60 Hz 步長下反推 */
  jumpHeight: 300,
  doubleJumpHeight: 220,
  maxFallSpeed: 1500,
  /** 停止奔跑與跑＋X 的滑行距離：從跑速等減速到 0，約一個地板方格 */
  brakeDistance: 240,
  /** 滑行中按著反方向，減速快幾倍 */
  brakeTurnFactor: 3,
  /** X 連段在揮砍期間（預備＋判定）往前的距離，X2＋X3 合計一個地板方格；抵掉小兵每次受擊的擊退，X3 才打得到 */
  lunge: { x1: 0, x2: 80, x3: 160 },
  /** 空中揮砍期間往上帶的距離：像在空中往前游 */
  lift: { x1: 0, x2: 16, x3: 32 },
  /** 空中每一招開始時，跳躍帶來的垂直速度剩幾成 */
  airSlashDamp: 0.3,
  /** 空中揮砍期間（預備＋判定）重力剩幾成 */
  airSlashGravity: 0.3,
  hpMax: 1000,
  mpMax: 300,
  hurtMs: 300,
  knockback: 120,
  /** 被打後無敵多久（含硬直） */
  invulnMs: 1000,
  /** 受擊閃白多久 */
  flashMs: 100,
};

/** 真空切劍氣：X3 判定開始時在主角前方生成，往前飛 */
export const WAVE = {
  distance: 480,
  lifeMs: 400,
  /** 生成位置相對主角腳底；x 是面向的前方 */
  spawnX: 120,
  spawnY: -120,
  /** 對同一個敵人最多 5 段、每段間隔 50 ms */
  maxHits: 5,
  intervalMs: 50,
  damage: 10,
  mp: 1,
};

/** X1–X3 的斬擊：每個敵人 1 段 */
export const SLASH = {
  damage: 40,
  mp: 5,
  /** 命中瞬間的停頓 */
  hitstopMs: 60,
};

/** 雜兵 A 小兵 */
export const GRUNT = {
  hp: 120,
  speed: 120,
  /** 主角在水平這個距離內就追 */
  chaseRange: 600,
  hurtMs: 300,
  knockback: 40,
  /** 受擊閃白多久 */
  flashMs: 100,
  /** 碰到主角造成的傷害 */
  contactDamage: 50,
  /** 地圖上的位置：中段到右端 */
  spawnX: [1600, 2400, 3300],
};
