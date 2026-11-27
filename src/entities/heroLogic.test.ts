import { describe, expect, test } from 'vitest';
import type { ArtGroup } from '../data/manifest';
import { HERO, TICK_HZ } from '../data/tuning';
import { frameOf, type Button } from '../input/input';
import { HeroState, heroView, newHero, tickHero, type HeroLogic, type HeroMoves } from './heroLogic';

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
};

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
