import { describe, expect, test } from 'vitest';
import type { ArtGroup } from '../data/manifest';
import { GRAVITY, HERO, TICK_HZ, ticks } from '../data/tuning';
import { frameOf, type Button } from '../input/input';
import { activeFrame, HeroState, heroView, hurtHero, launchSpeed, newHero, tickHero, type HeroLogic, type HeroMoves } from './heroLogic';

// 和佔位圖同樣的格數；測試只依賴這份，不讀美術檔
const group = (frames: ArtGroup['frames']): ArtGroup => ({ canvas: [768, 512], fps: 12, loop: false, frames });
const MOVES: HeroMoves = {
  'hero/jump': group([
    { file: 'jump_00', hold: 1, role: 'takeoff' },
    { file: 'jump_01', hold: 1, role: 'rise' },
    { file: 'jump_02', hold: 1, role: 'apex' },
    { file: 'jump_03', hold: 1, role: 'fall' },
    { file: 'jump_04', hold: 1, role: 'land' },
  ]),
  'hero/double_jump': group([
    { file: 'double_jump_00', hold: 1 },
    { file: 'double_jump_01', hold: 1 },
    { file: 'double_jump_02', hold: 1 },
  ]),
  // 預備 1 格、判定 2 格、收招 2 格：5／10／10 tick
  'hero/x1': group([
    { file: 'x1_00', hold: 1, phase: 'startup' },
    { file: 'x1_01', hold: 1, phase: 'active' },
    { file: 'x1_02', hold: 1, phase: 'active' },
    { file: 'x1_03', hold: 2, phase: 'recovery' },
  ]),
  'hero/x2': group([
    { file: 'x2_00', hold: 1, phase: 'startup' },
    { file: 'x2_01', hold: 1, phase: 'active' },
    { file: 'x2_02', hold: 1, phase: 'active' },
    { file: 'x2_03', hold: 2, phase: 'recovery' },
  ]),
  // 預備 2 格、判定 2 格、收招 4 格：10／10／20 tick
  'hero/x3': group([
    { file: 'x3_00', hold: 2, phase: 'startup' },
    { file: 'x3_01', hold: 1, phase: 'active' },
    { file: 'x3_02', hold: 1, phase: 'active' },
    { file: 'x3_03', hold: 2, phase: 'recovery' },
    { file: 'x3_04', hold: 2, phase: 'recovery' },
  ]),
  'hero/hurt': group([
    { file: 'hurt_00', hold: 2 },
    { file: 'hurt_01', hold: 2 },
  ]),
  // 2＋2＋2＋6 格＝60 tick
  'hero/death': group([
    { file: 'death_00', hold: 2 },
    { file: 'death_01', hold: 2 },
    { file: 'death_02', hold: 2 },
    { file: 'death_03', hold: 6 },
  ]),
};
const X1 = { startup: 5, active: 10, recovery: 10 };
const X3 = { startup: 10, active: 10, recovery: 20 };

/** 照 Arcade 的順序模擬物理：邏輯先決定速度，再「先加重力、再移動」一步；地面在 y＝0，往上是負的 */
class World {
  h: HeroLogic;
  constructor(moves: HeroMoves = MOVES) {
    this.h = newHero(moves);
  }
  x = 0;
  y = 0;
  vy = 0;
  onGround = true;
  /** 這次離地以來最高到哪（負的） */
  top = 0;
  /** 牆的位置（主角腳底的 x 最遠能到哪）；沒有牆是 ±Infinity */
  wallLeft = -Infinity;
  wallRight = Infinity;
  blocked = { left: false, right: false };
  /** 腳下能站的高度：0＝地面，負的＝單向平台；改回 0 就是平台到了盡頭 */
  floorY = 0;

  step(held: Button[] = [], pressed: Button[] = []) {
    const onPlatform = this.onGround && this.floorY < 0;
    const out = tickHero(this.h, { frame: frameOf(held, pressed), onGround: this.onGround, onPlatform, vy: this.vy, blocked: this.blocked });
    if (out.dropThrough) this.floorY = 0;
    if (out.vy !== null) this.vy = out.vy;
    if (out.gravity) this.vy += HERO.gravity / TICK_HZ;
    this.vy = Math.max(-HERO.maxFallSpeed, Math.min(HERO.maxFallSpeed, this.vy));
    this.x += out.vx / TICK_HZ;
    // 和 Arcade 的世界邊界一樣：越過牆就擋回來，並記下被擋住的方向
    this.blocked = { left: this.x < this.wallLeft, right: this.x > this.wallRight };
    this.x = Math.min(this.wallRight, Math.max(this.wallLeft, this.x));
    this.y += this.vy / TICK_HZ;
    if (this.y >= this.floorY) {
      this.y = this.floorY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
      this.top = Math.min(this.top, this.y);
    }
    return out;
  }

  /** 按著 held 一直跑到落地 */
  untilLanded(held: Button[] = []) {
    for (let i = 0; i < 600 && !(this.onGround && this.h.state !== HeroState.Air); i++) this.step(held);
  }
}

const idle = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step();
};

describe('走與跑', () => {
  test('按著方向就走，放開就停', () => {
    const w = new World();
    expect(w.step([], ['right']).vx).toBe(HERO.walkSpeed);
    expect(w.h.state).toBe(HeroState.Walk);
    expect(w.step(['right']).vx).toBe(HERO.walkSpeed);
    expect(w.step().vx).toBe(0);
    expect(w.h.state).toBe(HeroState.Idle);
  });

  test('250 ms 內連按兩下後按著是跑，放開就不跑了（滑行一小段）', () => {
    const w = new World();
    w.step([], ['left']);
    idle(w, 5);
    expect(w.step([], ['left']).vx).toBe(-HERO.runSpeed);
    expect(w.h.state).toBe(HeroState.Run);
    expect(w.step(['left']).vx).toBe(-HERO.runSpeed);
    w.step();
    expect(w.h.state).toBe(HeroState.Slide);
    idle(w, 60);
    expect(w.h.state).toBe(HeroState.Idle);
    expect(w.step([], ['left']).vx).toBe(-HERO.walkSpeed);
  });

  test('兩下間隔超過 250 ms 是走', () => {
    const w = new World();
    w.step([], ['right']);
    idle(w, 20);
    expect(w.step([], ['right']).vx).toBe(HERO.walkSpeed);
  });

  test('面向跟著方向', () => {
    const w = new World();
    w.step([], ['left']);
    expect(w.h.facing).toBe(-1);
    w.step();
    expect(w.h.facing).toBe(-1);
    w.step([], ['right']);
    expect(w.h.facing).toBe(1);
  });
});

describe('跳躍', () => {
  test('按住 Z 跳高 300 px（±1）', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    w.untilLanded(['jump']);
    expect(Math.abs(-w.top - HERO.jumpHeight)).toBeLessThanOrEqual(1);
    expect(w.h.state).toBe(HeroState.Idle);
  });

  test('二段跳從起跳點再高 220 px（±1）', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    while (w.vy < 0) w.step(['jump']);
    const from = w.y;
    w.top = 0;
    w.step(['jump'], ['jump']);
    expect(w.h.doubleJumped).toBe(true);
    while (w.vy < 0) w.step(['jump']);
    expect(Math.abs(from - w.top - HERO.doubleJumpHeight)).toBeLessThanOrEqual(1);
  });

  test('二段跳每次離地只有 1 次，落地後重置', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    idle(w, 3);
    w.step(['jump'], ['jump']);
    idle(w, 3);
    const vy = w.vy;
    expect(w.step(['jump'], ['jump']).vy).toBeNull();
    expect(w.vy).toBeGreaterThan(vy);
    w.untilLanded();
    w.step(['jump'], ['jump']);
    idle(w, 3);
    expect(w.step(['jump'], ['jump']).vy).toBeLessThan(0);
  });

  test('上升中放開 Z，上升速度減半，只減一次', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    w.step(['jump']);
    const rising = w.vy;
    expect(w.step().vy).toBe(rising / 2);
    expect(w.step().vy).toBeNull();
  });

  test('跑跳保持跑速，空中轉向後降為 300 px/s，放開方向就不動', () => {
    const w = new World();
    w.step([], ['right']);
    w.step([], ['right']);
    expect(w.step(['right'], ['jump']).vx).toBe(HERO.runSpeed);
    expect(w.step(['right', 'jump']).vx).toBe(HERO.runSpeed);
    expect(w.step(['jump']).vx).toBe(0);
    expect(w.step(['left', 'jump']).vx).toBe(-HERO.airTurnSpeed);
    expect(w.step(['right', 'jump']).vx).toBe(HERO.airTurnSpeed);
  });

  test('照垂直速度選格：起跳、上升、頂點、下落、落地', () => {
    const w = new World();
    const seen: string[] = [];
    w.step(['jump'], ['jump']);
    for (let i = 0; i < 600 && w.h.state === HeroState.Air; i++) {
      const f = heroView(w.h).frame!;
      if (seen.at(-1) !== f) seen.push(f);
      w.step(['jump']);
    }
    seen.push(heroView(w.h).frame!);
    expect(seen).toEqual(['jump_00', 'jump_01', 'jump_02', 'jump_03', 'jump_04']);
  });
});

const move = (w: World) => w.h.attack?.move;

/** 每 tick 記下招式，直到不在出招；pressAt[i] 是第 i 個 tick 剛按下的鍵 */
function trace(w: World, held: Button[] = [], pressAt: Record<number, Button[]> = {}) {
  const moves: (string | undefined)[] = [];
  for (let i = 0; i < 300; i++) {
    w.step(held, pressAt[i] ?? []);
    moves.push(move(w));
    if (w.h.state !== HeroState.Attack) break;
  }
  return moves;
}

/** 從待機按 X 一路接到 X3 的開頭 */
function toX3(w: World) {
  w.step([], ['attack']);
  w.step([], ['attack']);
  while (move(w) !== 'x2') w.step();
  w.step([], ['attack']);
  while (move(w) !== 'x3') w.step();
}

describe('X 連段', () => {
  test('X1 預備中按 X，最早在 X1 判定結束時接 X2', () => {
    const w = new World();
    w.step([], ['attack']);
    w.step([], ['attack']);
    const moves = trace(w);
    // 前面已經跑了 2 tick；X1 一共預備＋判定 15 tick，第 16 tick 換成 X2
    expect(moves.indexOf('x2') + 2).toBe(X1.startup + X1.active);
  });

  test('X1 收招中按 X，馬上接 X2', () => {
    const w = new World();
    w.step([], ['attack']);
    const at = X1.startup + X1.active + 3;
    const moves = trace(w, [], { [at]: ['attack'] });
    expect(moves.indexOf('x2')).toBe(at);
  });

  test('XXX 依序出完三招；X3 判定開始時生成劍氣，只生成一次', () => {
    const w = new World();
    let waves = 0;
    w.step([], ['attack']);
    for (let i = 0; i < 300 && w.h.state === HeroState.Attack; i++) {
      const out = w.step([], i % 4 === 0 ? ['attack'] : []);
      if (out.spawnWave) {
        waves++;
        expect(activeFrame(w.h)).toMatchObject({ move: 'x3', file: 'x3_01' });
      }
      if (move(w) === 'x3') break;
    }
    expect(move(w)).toBe('x3');
    while (w.h.state === HeroState.Attack) if (w.step().spawnWave) waves++;
    expect(waves).toBe(1);
  });

  test('收招結束前沒按 X，回到待機，下一次從 X1 開始', () => {
    const w = new World();
    w.step([], ['attack']);
    trace(w);
    expect(w.h.state).toBe(HeroState.Idle);
    w.step([], ['attack']);
    expect(move(w)).toBe('x1');
  });

  test('收招中按 Z 不取消；收招結束時還在 150 ms 內就起跳', () => {
    const w = new World();
    w.step([], ['attack']);
    const left = X1.startup + X1.active + X1.recovery - 1;
    const moves = trace(w, [], { [left - 5]: ['jump'] });
    expect(moves.slice(0, -1).every((m) => m === 'x1')).toBe(true);
    expect(moves.length).toBe(left + 1);
    expect(w.h.state).toBe(HeroState.Air);
  });

  test('收招中太早按 Z，收招結束後不會起跳', () => {
    const w = new World();
    w.step([], ['attack']);
    trace(w, [], { [X1.startup]: ['jump'] });
    expect(w.h.state).toBe(HeroState.Idle);
  });

  test('預先輸入超過 150 ms 就丟掉：X3 預備中按 X，收招結束後不會接 X1', () => {
    const w = new World();
    toX3(w);
    w.step([], ['attack']);
    trace(w);
    expect(w.h.state).toBe(HeroState.Idle);
  });

  test('X3 收招最後 150 ms 內按 X，收招結束就接 X1', () => {
    const w = new World();
    toX3(w);
    const left = X3.startup + X3.active + X3.recovery - 1;
    const moves = trace(w, [], { [left - 5]: ['attack'] });
    expect(moves[left - 1]).toBe('x3');
    expect(moves[left]).toBe('x1');
  });

  test('出招期間面向鎖定、不能移動', () => {
    const w = new World();
    w.step([], ['attack']);
    const out = w.step(['left']);
    expect(w.h.facing).toBe(1);
    expect(out.vx).toBe(0);
  });

  test('跑＋X：X1 立刻開始，按著方向也照停止奔跑的滑行往前滑、一路減速', () => {
    const w = new World();
    w.step([], ['right']);
    w.step([], ['right']);
    const first = w.step(['right'], ['attack']);
    expect(move(w)).toBe('x1');
    expect(first.vx).toBe(HERO.runSpeed);
    const speeds: number[] = [];
    for (;;) {
      const out = w.step(['right']);
      if (move(w) !== 'x1') {
        // 招式結束時還按著跑的方向，就接著跑
        expect(out.vx).toBe(HERO.runSpeed);
        expect(w.h.state).toBe(HeroState.Run);
        break;
      }
      speeds.push(out.vx);
    }
    // 滑行比 X1 長：整招都還在滑，速度一路變小
    expect(speeds.every((v) => v > 0)).toBe(true);
    expect(speeds.every((v, i) => i === 0 || v < speeds[i - 1])).toBe(true);
  });
});

describe('空中 X', () => {
  /** 跳到上升中再出空中 X1 */
  function airX1() {
    const w = new World();
    w.step(['jump'], ['jump']);
    for (let i = 0; i < 8; i++) w.step(['jump']);
    w.step(['jump'], ['attack']);
    expect(w.h.attack).toMatchObject({ move: 'x1', air: true });
    return w;
  }

  test('空中出招：跳躍帶來的垂直速度剩三成，揮砍期間重力也只剩三成；收招照一般重力', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    for (let i = 0; i < 8; i++) w.step(['jump']);
    const rising = w.vy;
    let out = w.step(['jump'], ['attack']);
    expect(w.h.attack).toMatchObject({ move: 'x1', air: true });
    expect(out).toMatchObject({ vx: 0, gravity: false });
    expect(out.vy).toBeCloseTo(rising * HERO.airSlashDamp);
    for (let i = 1; i < X1.startup + X1.active; i++) {
      const before = out.vy!;
      out = w.step(['jump']);
      expect(out.gravity).toBe(false);
      expect(out.vy! - before).toBeCloseTo((GRAVITY * HERO.airSlashGravity) / TICK_HZ);
    }
    out = w.step(['jump']);
    expect(out).toMatchObject({ vy: null, gravity: true });
  });

  test('空中出招保持出招當下的水平速度，放開方向也一樣，收招期間也是', () => {
    const w = new World();
    w.step([], ['right']);
    w.step([], ['right']);
    w.step(['right'], ['jump']);
    for (let i = 0; i < 5; i++) w.step(['right', 'jump']);
    expect(w.step(['jump'], ['attack']).vx).toBe(HERO.runSpeed);
    let ticksChecked = 0;
    for (;;) {
      const out = w.step(['jump']);
      // 招式結束後回到一般的空中操作：沒按方向就不水平移動
      if (w.h.state !== HeroState.Attack || w.h.attack?.landed) break;
      expect(out.vx).toBe(HERO.runSpeed);
      ticksChecked++;
    }
    expect(ticksChecked).toBeGreaterThan(X1.startup + X1.active);
  });

  test('空中 X2、X3：水平再加上往前的速度，垂直微幅往上帶', () => {
    const w = airX1();
    w.step(['jump'], ['attack']);
    let out = w.step(['jump']);
    while (w.h.attack?.move !== 'x2') out = w.step(['jump']);
    // X2 的揮砍（預備＋判定）是 15 tick；沒按方向，出招當下的水平速度是 0
    expect(out.vx).toBeCloseTo((HERO.lunge.x2 / 15) * TICK_HZ);
    expect(out.vy).toBeCloseTo(w.h.airVy - (HERO.lift.x2 / 15) * TICK_HZ);
    expect(out.gravity).toBe(false);
  });

  test('揮砍中落地：剩下的招式在地面做完', () => {
    // 跳起來落下、快到地面時出招：揮砍中就落地
    const w = new World();
    w.step(['jump'], ['jump']);
    while (!(w.vy > 0 && w.y > -40)) w.step(['jump']);
    w.step([], ['attack']);
    let landedWhileSwinging = false;
    while (w.h.state === HeroState.Attack) {
      const out = w.step();
      if (w.h.attack?.landed && activeFrame(w.h)) {
        landedWhileSwinging = true;
        expect(out).toMatchObject({ vy: null, gravity: true });
      }
    }
    expect(landedWhileSwinging).toBe(true);
    expect(w.h.state).toBe(HeroState.Idle);
    expect(w.onGround).toBe(true);
  });

  test('每次離地只有 1 輪，二段跳不重置，用完後到落地前按 X 沒反應；落地後重置', () => {
    const w = airX1();
    trace(w, ['jump']);
    expect(w.h.state).toBe(HeroState.Air);
    w.step(['jump'], ['jump']);
    expect(w.h.doubleJumped).toBe(true);
    w.step(['jump'], ['attack']);
    expect(w.h.state).toBe(HeroState.Air);
    expect(w.h.attack).toBeNull();
    w.untilLanded();
    w.step([], ['jump']);
    idle(w, 3);
    w.step([], ['attack']);
    expect(w.h.attack).toMatchObject({ air: true });
  });

  test('收招中落地：剩下的收招在地面繼續，顯示落地格', () => {
    // 跳起來落下、離地約 150 px 時出招：揮砍期間飄得慢，收招照一般重力落下，收招中落地
    const w = new World();
    w.step(['jump'], ['jump']);
    while (!(w.vy > 0 && w.y > -170)) w.step(['jump']);
    w.step([], ['attack']);
    let landedView = '';
    for (let i = 0; i < 100 && w.h.state === HeroState.Attack; i++) {
      w.step();
      if (w.h.attack?.landed) landedView = heroView(w.h).frame!;
    }
    expect(landedView).toBe('jump_04');
    expect(w.h.state).toBe(HeroState.Idle);
    expect(w.onGround).toBe(true);
  });
});

describe('主角受擊與死亡', () => {
  test('受擊硬直 300 ms、擊退 120 px，期間不能行動', () => {
    const w = new World();
    expect(hurtHero(w.h, 50, -1)).toBe(true);
    expect(w.h.hp).toBe(HERO.hpMax - 50);
    let n = 0;
    while (w.h.state === HeroState.Hurt) {
      w.step(['right'], ['attack']);
      n++;
    }
    expect(n).toBe(ticks(HERO.hurtMs));
    expect(w.x).toBeCloseTo(-HERO.knockback, 0);
    expect(w.h.state).toBe(HeroState.Idle);
  });

  test('被打會打斷出招', () => {
    const w = new World();
    w.step([], ['attack']);
    hurtHero(w.h, 50, -1);
    expect(w.h.attack).toBeNull();
    expect(w.h.state).toBe(HeroState.Hurt);
  });

  test('被打後無敵 1000 ms：期間不再受傷，之後才會', () => {
    const w = new World();
    hurtHero(w.h, 50, 1);
    for (let i = 1; i < ticks(HERO.invulnMs); i++) {
      w.step();
      expect(hurtHero(w.h, 50, 1)).toBe(false);
    }
    w.step();
    expect(hurtHero(w.h, 50, 1)).toBe(true);
    expect(w.h.hp).toBe(HERO.hpMax - 100);
  });

  test('無敵作弊開著時不受傷', () => {
    const w = new World();
    w.h.invincible = true;
    expect(hurtHero(w.h, 50, 1)).toBe(false);
    expect(w.h.hp).toBe(HERO.hpMax);
  });

  test('HP 歸零進入死亡，播完死亡動畫才要求重來', () => {
    const w = new World();
    w.h.hp = 50;
    hurtHero(w.h, 50, 1);
    expect(w.h.state).toBe(HeroState.Dead);
    for (let i = 1; i < 60; i++) {
      w.step([], ['jump']);
      expect(w.h.wantsRestart).toBe(false);
    }
    expect(heroView(w.h).frame).toBe('death_03');
    w.step();
    expect(w.h.wantsRestart).toBe(true);
    expect(w.h.state).toBe(HeroState.Dead);
  });
});

/** 連按兩下跑起來，再按著跑 n 個 tick（預設超過雙擊的 250 ms，之後再按右不會又算成連按兩下） */
function runRight(w: World, n = 20) {
  w.step([], ['right']);
  w.step([], ['right']);
  for (let i = 0; i < n; i++) w.step(['right']);
  expect(w.h.state).toBe(HeroState.Run);
}

describe('停止奔跑的滑行', () => {
  test('放開跑的方向就滑行，等減速滑大約一個地板方格（brakeDistance）才停', () => {
    const w = new World();
    runRight(w);
    const from = w.x;
    let last = Infinity;
    for (let i = 0; i < 120; i++) {
      const out = w.step();
      if (w.h.state !== HeroState.Slide) break;
      expect(out.vx).toBeGreaterThan(0);
      expect(out.vx).toBeLessThan(last);
      last = out.vx;
    }
    expect(w.h.state).toBe(HeroState.Idle);
    expect(Math.abs(w.x - from - HERO.brakeDistance)).toBeLessThan(10);
    expect(heroView(w.h).anim).toBe('hero/idle');
  });

  test('滑行中按著反方向，停得比較快，停下來才轉身往回走', () => {
    const plain = new World();
    runRight(plain);
    let n = 0;
    while (plain.step().vx > 0) n++;

    const w = new World();
    runRight(w);
    let m = 0;
    while (w.step(['left']).vx > 0) {
      expect(w.h.facing).toBe(1);
      m++;
    }
    expect(m).toBeLessThan(n);
    expect(w.step(['left']).vx).toBe(-HERO.walkSpeed);
  });

  test('滑行中往同方向按，就不滑了、照一般的走', () => {
    const w = new World();
    runRight(w);
    w.step();
    expect(w.h.state).toBe(HeroState.Slide);
    expect(w.step(['right'], ['right']).vx).toBe(HERO.walkSpeed);
    expect(w.h.state).toBe(HeroState.Walk);
  });

  test('滑行中出 X：出招照樣往前滑；招式出完還在滑就回到滑行，滑完才停，總距離不變', () => {
    const w = new World();
    runRight(w);
    const from = w.x;
    w.step();
    const out = w.step([], ['attack']);
    expect(w.h.attack?.move).toBe('x1');
    expect(out.vx).toBeGreaterThan(0);
    while (w.h.state === HeroState.Attack) expect(w.step().vx).toBeGreaterThan(0);
    expect(w.h.state).toBe(HeroState.Slide);
    while (w.h.state === HeroState.Slide) w.step();
    expect(w.h.state).toBe(HeroState.Idle);
    expect(Math.abs(w.x - from - HERO.brakeDistance)).toBeLessThan(10);
  });

  test('跑跳保持跑速；從滑行起跳就不帶滑行的速度', () => {
    const w = new World();
    runRight(w);
    expect(w.step(['right'], ['jump']).vx).toBe(HERO.runSpeed);
    w.untilLanded();
    const v = new World();
    runRight(v);
    v.step();
    expect(v.step([], ['jump']).vx).toBe(0);
    expect(v.h.slideV).toBe(0);
  });
});

describe('X2、X3 往前踏', () => {
  /** 按著 held 一路接到 X3 出完，記下每一招期間的水平位移 */
  function comboMoves(w: World, held: Button[] = []) {
    const moved: Record<string, number> = { x1: 0, x2: 0, x3: 0 };
    const x = { from: w.x };
    for (let i = 0; i < 200; i++) {
      const before = w.x;
      w.step(held, i % 4 === 0 && w.h.attack?.move !== 'x3' ? ['attack'] : []);
      const move = w.h.attack?.move;
      if (!move) break;
      moved[move] += w.x - before;
    }
    return { moved, total: w.x - x.from };
  }

  test('X2、X3 在揮砍期間往前，X3 比 X2 遠、合計一個地板方格；X1 不動', () => {
    const w = new World();
    w.step([], ['attack']);
    const { moved } = comboMoves(w);
    expect(moved.x1).toBeCloseTo(0);
    expect(moved.x2).toBeCloseTo(HERO.lunge.x2);
    expect(moved.x3).toBeCloseTo(HERO.lunge.x3);
    expect(HERO.lunge.x3).toBeGreaterThan(HERO.lunge.x2);
    expect(HERO.lunge.x2 + HERO.lunge.x3).toBe(240);
  });

  test('面向左時往左踏', () => {
    const w = new World();
    w.step([], ['left']);
    w.step([], ['attack']);
    const { moved } = comboMoves(w);
    expect(moved.x2).toBeCloseTo(-HERO.lunge.x2);
    expect(moved.x3).toBeCloseTo(-HERO.lunge.x3);
  });

  test('空中的 X2、X3 也往前，揮砍期間不受一般重力', () => {
    const w = new World();
    w.step(['jump'], ['jump']);
    for (let i = 0; i < 8; i++) w.step(['jump']);
    w.step(['jump'], ['attack']);
    expect(w.h.attack).toMatchObject({ move: 'x1', air: true });
    let checked = 0;
    const moved: Record<string, number> = { x1: 0, x2: 0, x3: 0 };
    for (let i = 0; i < 200 && w.h.attack; i++) {
      const before = w.x;
      const out = w.step(['jump'], i % 4 === 0 && w.h.attack.move !== 'x3' ? ['attack'] : []);
      const a = w.h.attack;
      if (!a) break;
      moved[a.move] += w.x - before;
      if (activeFrame(w.h) === null && heroView(w.h).frame?.endsWith('_00') && !a.landed) {
        // 預備格：垂直速度由邏輯算，不受一般重力
        expect(out.gravity).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(moved.x1).toBeCloseTo(0);
    expect(moved.x2).toBeCloseTo(HERO.lunge.x2);
    expect(moved.x3).toBeCloseTo(HERO.lunge.x3);
  });

  test('跑＋X 按著方向接 X2：滑行和往前的速度相加', () => {
    const w = new World();
    runRight(w);
    w.step(['right'], ['attack']);
    w.step(['right'], ['attack']);
    let out = w.step(['right']);
    while (w.h.attack?.move !== 'x2') out = w.step(['right']);
    expect(w.h.slideV).toBeGreaterThan(0);
    // X2 的揮砍（預備＋判定）是 3 格＝15 tick
    expect(out.vx).toBeCloseTo(w.h.slideV + (HERO.lunge.x2 / 15) * TICK_HZ);
  });
});

describe('撞牆終止滑行', () => {
  test('停止奔跑的滑行往前撞到牆就停下，回到待機', () => {
    const w = new World();
    runRight(w);
    // 牆在前方 5 px：滑行的第一步（約 9.6 px）就撞到
    w.wallRight = w.x + 5;
    w.step();
    expect(w.h.state).toBe(HeroState.Slide);
    let n = 0;
    while (w.h.state === HeroState.Slide && n < 100) {
      w.step();
      n++;
    }
    // 第一步就撞到牆，下一個 tick 滑行結束
    expect(n).toBeLessThanOrEqual(2);
    expect(w.h.state).toBe(HeroState.Idle);
    expect(w.h.slideV).toBe(0);
    expect(w.x).toBe(w.wallRight);
  });

  test('往左滑撞到左邊的牆也一樣', () => {
    const w = new World();
    w.step([], ['left']);
    w.step([], ['left']);
    for (let i = 0; i < 20; i++) w.step(['left']);
    w.wallLeft = w.x - 5;
    w.step();
    w.step();
    w.step();
    expect(w.h.state).toBe(HeroState.Idle);
    expect(w.x).toBe(w.wallLeft);
  });

  test('出招帶著的滑行撞到牆就停下，招式照常做完', () => {
    const w = new World();
    runRight(w);
    w.wallRight = w.x + 5;
    w.step(['right'], ['attack']);
    w.step(['right']);
    w.step(['right']);
    expect(w.h.attack?.move).toBe('x1');
    expect(w.h.slideV).toBe(0);
    expect(w.step(['right']).vx).toBe(0);
  });

  test('背後有牆不影響往前滑', () => {
    const w = new World();
    runRight(w);
    w.wallLeft = w.x;
    w.step();
    const out = w.step();
    expect(w.h.state).toBe(HeroState.Slide);
    expect(out.vx).toBeGreaterThan(0);
  });
});

describe('單向平台與 coyote time', () => {
  /** 站在離地 height 的平台上 */
  const standOn = (height = 200) => {
    const w = new World();
    w.y = w.floorY = -height;
    idle(w, 2);
    return w;
  };
  /** 在平台上往右走，走到平台盡頭：物理已經掉出邊緣，邏輯還沒看到 */
  const leaveEdge = () => {
    const w = standOn();
    w.step(['right']);
    w.floorY = 0;
    w.step(['right']);
    return w;
  };
  const JUMP = launchSpeed(HERO.jumpHeight, HERO.gravity);

  test('站在單向平台上 ↓＋Z：往下穿過、不起跳', () => {
    const w = standOn();
    expect(w.step(['down'], ['jump']).dropThrough).toBe(true);
    expect(w.h.state).toBe(HeroState.Air);
    w.untilLanded(['down']);
    expect(w.y).toBe(0);
    expect(w.top).toBeGreaterThanOrEqual(-200);
  });

  test('在地面 ↓＋Z 照常起跳', () => {
    const w = new World();
    const out = w.step(['down', 'jump'], ['jump']);
    expect(out.dropThrough).toBeUndefined();
    expect(out.vy).toBe(-JUMP);
    w.untilLanded(['jump']);
    expect(Math.abs(-w.top - HERO.jumpHeight)).toBeLessThanOrEqual(1);
  });

  test('走出平台邊緣就進入空中往下掉', () => {
    const w = leaveEdge();
    w.step(['right']);
    expect(w.h.state).toBe(HeroState.Air);
    expect(w.vy).toBeGreaterThan(0);
    w.untilLanded(['right']);
    expect(w.y).toBe(0);
    expect(w.h.state).toBe(HeroState.Walk);
  });

  test('走出平台邊緣後 100 ms 內按 Z 是一般跳，之後是二段跳', () => {
    /** 掉出邊緣後的第 k 個 tick 按 Z */
    const jumpAt = (k: number) => {
      const w = leaveEdge();
      idle(w, k - 1);
      const out = w.step([], ['jump']);
      return { vy: out.vy, doubleJumped: w.h.doubleJumped };
    };
    const n = ticks(HERO.coyoteMs);
    expect(jumpAt(1)).toEqual({ vy: -JUMP, doubleJumped: false });
    expect(jumpAt(n)).toEqual({ vy: -JUMP, doubleJumped: false });
    expect(jumpAt(n + 1)).toEqual({ vy: -launchSpeed(HERO.doubleJumpHeight, HERO.gravity), doubleJumped: true });
  });

  test('coyote time 的一般跳之後，還能再二段跳一次', () => {
    const w = leaveEdge();
    w.step([], ['jump']);
    while (w.vy < 0) w.step(['jump']);
    w.step(['jump'], ['jump']);
    expect(w.h.doubleJumped).toBe(true);
  });

  test('地面招式被帶出平台邊緣：照一般重力往下掉、招式做完，做完時在空中就回到空中狀態', () => {
    const w = standOn(800);
    w.step([], ['attack']);
    w.floorY = 0;
    for (let i = 1; i < X1.startup + X1.active + X1.recovery; i++) w.step();
    expect(w.h.attack?.move).toBe('x1');
    expect(w.y).toBeGreaterThan(-800);
    w.step();
    expect(w.h.state).toBe(HeroState.Air);
    w.untilLanded();
    expect(w.y).toBe(0);
  });
});
