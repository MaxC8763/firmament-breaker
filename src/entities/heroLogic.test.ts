import { describe, expect, test } from 'vitest';
import type { ArtGroup } from '../data/manifest';
import { HERO, TICK_HZ, ticks } from '../data/tuning';
import { frameOf, type Button } from '../input/input';
import { activeFrame, HeroState, heroView, hurtHero, newHero, tickHero, type HeroLogic, type HeroMoves } from './heroLogic';

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
  h: HeroLogic = newHero(MOVES);
  x = 0;
  y = 0;
  vy = 0;
  onGround = true;
  /** 這次離地以來最高到哪（負的） */
  top = 0;

  step(held: Button[] = [], pressed: Button[] = []) {
    const out = tickHero(this.h, { frame: frameOf(held, pressed), onGround: this.onGround, vy: this.vy });
    if (out.vy !== null) this.vy = out.vy;
    if (out.gravity) this.vy += HERO.gravity / TICK_HZ;
    this.vy = Math.max(-HERO.maxFallSpeed, Math.min(HERO.maxFallSpeed, this.vy));
    this.x += out.vx / TICK_HZ;
    this.y += this.vy / TICK_HZ;
    if (this.y >= 0) {
      this.y = 0;
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

  test('250 ms 內連按兩下後按著是跑，放開就停', () => {
    const w = new World();
    w.step([], ['left']);
    idle(w, 5);
    expect(w.step([], ['left']).vx).toBe(-HERO.runSpeed);
    expect(w.h.state).toBe(HeroState.Run);
    expect(w.step(['left']).vx).toBe(-HERO.runSpeed);
    expect(w.step().vx).toBe(0);
    idle(w, 20);
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

  test('跑＋X：X1 立刻開始，100 ms 內減速到 0', () => {
    const w = new World();
    w.step([], ['right']);
    w.step([], ['right']);
    const first = w.step(['right'], ['attack']);
    expect(move(w)).toBe('x1');
    expect(first.vx).toBe(HERO.runSpeed);
    const speeds = Array.from({ length: ticks(HERO.slideMs) }, () => w.step(['right']).vx);
    expect(speeds.at(-1)).toBe(0);
    expect(speeds.every((v, i) => i === 0 || v <= speeds[i - 1])).toBe(true);
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

  test('預備＋判定期間滯空，收招期間下落', () => {
    const w = airX1();
    const y = w.y;
    for (let i = 1; i < X1.startup + X1.active; i++) {
      expect(w.step(['jump'])).toMatchObject({ vx: 0, vy: 0, gravity: false });
    }
    expect(w.y).toBeCloseTo(y);
    expect(w.step(['jump']).gravity).toBe(true);
    w.step(['jump']);
    expect(w.y).toBeGreaterThan(y);
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
    // 小跳後馬上出招：滯空結束時離地很近，收招中會落地
    const w = new World();
    w.step([], ['jump']);
    w.step();
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
