import Phaser from 'phaser';
import { addMp, newAttack, strike, type AttackInstance, type AttackSpec, type HitResult } from '../combat/attack';
import { attackShape, overlaps, toWorld, type Box, type HitboxData } from '../combat/hitbox';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, GRUNT, SLASH, TICK_HZ, WAVE, WORLD_WIDTH, ticks } from '../data/tuning';
import { installDevTools } from '../dev/devTools';
import { Grunt } from '../entities/Grunt';
import { GruntState, hurtGrunt } from '../entities/gruntLogic';
import { Hero } from '../entities/Hero';
import { activeFrame, type Attack } from '../entities/heroLogic';
import { noButtons, type Button, type InputFrame } from '../input/input';

const HITBOXES = hitboxes as unknown as HitboxData;
const SLASH_SPEC: AttackSpec = { maxHits: 1, intervalTicks: Infinity, damage: SLASH.damage, mp: SLASH.mp };
const WAVE_SPEC: AttackSpec = { maxHits: WAVE.maxHits, intervalTicks: ticks(WAVE.intervalMs), damage: WAVE.damage, mp: WAVE.mp };

/** 命中時發給開發模式的事件：(小兵, 結果, 這一段的傷害, 攻擊實例) */
export const HIT_EVENT = 'hit';

const TICK_MS = 1000 / TICK_HZ;
/** 卡頓後最多補多少時間，避免一次補跑太多 tick */
const MAX_DELTA_MS = 100;
/** 兩端牆的厚度 */
const WALL = 24;

/** 飛行中的劍氣 */
interface Wave {
  sprite: Phaser.GameObjects.Sprite;
  dir: 1 | -1;
  age: number;
  attack: AttackInstance;
}

const KEYS: Record<Button, number> = {
  left: Phaser.Input.Keyboard.KeyCodes.LEFT,
  right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
  jump: Phaser.Input.Keyboard.KeyCodes.Z,
  attack: Phaser.Input.Keyboard.KeyCodes.X,
};

export class Stage extends Phaser.Scene {
  hero: Hero;
  grunts: Grunt[];
  waves: Wave[];
  /** 正在出的招和它的攻擊實例；換招時舊的實例結束 */
  private slash: { move: Attack; attack: AttackInstance } | null;
  /** 命中停頓還剩幾個 tick：期間邏輯與物理都不前進 */
  private hitstop: number;
  private keys: Record<Button, Phaser.Input.Keyboard.Key>;
  /** 還沒累積滿一個 tick 的時間 */
  private elapsed: number;
  /** 剛按下、還沒被 tick 讀到的鍵：這一幀沒有跑 tick 時留給下一幀 */
  private pressed: Record<Button, boolean>;

  constructor() {
    super('Stage');
  }

  init() {
    this.elapsed = 0;
    this.pressed = noButtons();
    this.waves = [];
    this.slash = null;
    this.hitstop = 0;
  }

  create() {
    this.drawBackground();
    this.physics.world.setBounds(WALL, 0, WORLD_WIDTH - WALL * 2, GROUND_Y, true, true, false, true);
    // 物理不自己跟著幀跑：每個邏輯 tick 跑一步，邏輯讀到的永遠是上一步的結果（場景重來會重新連上，所以每次都關）
    this.physics.disableUpdate();

    const manifest: Manifest = this.cache.json.get('manifest');
    this.grunts = GRUNT.spawnX.map((x) => new Grunt(this, manifest, x));
    this.hero = new Hero(this, manifest);
    this.hero.show();

    // 鏡頭只水平跟隨
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.scale.height);
    this.cameras.main.startFollow(this.hero, false, 0.15, 0);

    this.keys = this.input.keyboard!.addKeys(KEYS) as Record<Button, Phaser.Input.Keyboard.Key>;
    // 用按下事件記「剛按下」：同一幀裡按下又放開時，JustDown 讀不到。場景關閉時鍵盤外掛會連同監聽一起移除
    for (const b of Object.keys(KEYS) as Button[]) this.keys[b].on(Phaser.Input.Keyboard.Events.DOWN, () => (this.pressed[b] = true));

    if (import.meta.env.DEV) installDevTools(this, manifest);

    // smoke 與 e2e 靠這個旗標判斷遊戲已經起來
    document.body.dataset.game = 'ready';
  }

  update(_time: number, delta: number) {
    // 每幀只在這裡讀一次鍵盤；剛按下的鍵存到被 tick 讀到為止
    const held = noButtons();
    for (const b of Object.keys(KEYS) as Button[]) held[b] = this.keys[b].isDown;

    this.elapsed += Math.min(delta, MAX_DELTA_MS);
    while (this.elapsed >= TICK_MS) {
      this.elapsed -= TICK_MS;
      if (this.hitstop > 0) {
        this.hitstop--;
        continue;
      }
      const frame: InputFrame = { held: { ...held }, pressed: this.pressed };
      // 剛按就放開的鍵，這個 tick 也算按著
      for (const b of Object.keys(KEYS) as Button[]) frame.held[b] ||= this.pressed[b];
      this.pressed = noButtons();
      this.tick(frame);
    }
    this.hero.show();
    for (const g of this.grunts) g.show();
  }

  /** 一個邏輯 tick：決策 → 物理一步 → 發射物 → 命中 */
  private tick(frame: InputFrame) {
    const out = this.hero.step(frame);
    for (const g of this.grunts) g.step(this.hero.x);
    this.physics.world.singleStep();
    if (out.spawnWave) this.spawnWave();
    this.moveWaves();
    this.resolveHits();
    for (const g of this.grunts) if (g.logic.state === GruntState.Gone) g.destroy();
    this.grunts = this.grunts.filter((g) => g.logic.state !== GruntState.Gone);
  }

  /** 斬擊在判定格打小兵；劍氣整段飛行都會打 */
  private resolveHits() {
    const hero = this.hero;
    const move = hero.logic.attack;
    if (this.slash && this.slash.move !== move) {
      this.slash.attack.ended = true;
      this.slash = null;
    }
    if (move && !this.slash) this.slash = { move, attack: newAttack(SLASH_SPEC) };

    const active = activeFrame(hero.logic);
    const shape = active && attackShape(HITBOXES, active.move, active.air, active.file);
    if (this.slash && shape?.type === 'rect') {
      this.hitAll(this.slash.attack, toWorld(shape, hero.x, hero.y, hero.logic.facing), hero.logic.facing, true);
    }
    const waveBox = hitboxes.projectiles.x3_wave;
    for (const w of this.waves) this.hitAll(w.attack, toWorld(waveBox, w.sprite.x, w.sprite.y, w.dir), w.dir, false);
  }

  /** 攻擊框碰到的每隻小兵各接觸一次；dir 是擊退方向，single＝單段斬擊（造成傷害時命中停頓） */
  private hitAll(attack: AttackInstance, box: Box, dir: number, single: boolean) {
    for (const g of this.grunts) {
      if (g.logic.state === GruntState.Death || g.logic.state === GruntState.Gone) continue;
      if (!overlaps(box, g.hurtbox())) continue;
      const { result, mp } = strike(attack, g.logic, this.hero.logic.tick);
      if (result === 'none') continue;
      this.hero.logic.mp = addMp(this.hero.logic.mp, mp);
      hurtGrunt(g.logic, dir);
      g.flash();
      if (single && result === 'damage') this.hitstop = ticks(SLASH.hitstopMs);
      this.events.emit(HIT_EVENT, g, result satisfies HitResult, result === 'damage' ? attack.spec.damage : 0, attack);
    }
  }

  private spawnWave() {
    const dir = this.hero.logic.facing;
    const sprite = this.add
      .sprite(this.hero.x + dir * WAVE.spawnX, this.hero.y + WAVE.spawnY, 'art')
      .setFlipX(dir < 0)
      .play('effects/x3_wave');
    this.waves.push({ sprite, dir, age: 0, attack: newAttack(WAVE_SPEC) });
  }

  /** 劍氣等速往前飛，lifeMs 後消失 */
  private moveWaves() {
    const speed = WAVE.distance / ticks(WAVE.lifeMs);
    for (const w of this.waves) {
      w.sprite.x += w.dir * speed;
      if (++w.age < ticks(WAVE.lifeMs)) continue;
      w.sprite.destroy();
      w.attack.ended = true;
    }
    this.waves = this.waves.filter((w) => w.age < ticks(WAVE.lifeMs));
  }

  /** 程式畫的背景：遠山以半速捲動，地面每 240 px 一格，看得出鏡頭在動 */
  private drawBackground() {
    const { height } = this.scale;
    const far = this.add.graphics().setScrollFactor(0.5);
    far.fillStyle(0xa9c8d8);
    for (let x = 0; x < WORLD_WIDTH; x += 360) far.fillEllipse(x + 180, GROUND_Y, 520, 360 + ((x / 360) % 3) * 80);

    const g = this.add.graphics();
    for (let x = 0; x < WORLD_WIDTH; x += 240) {
      g.fillStyle((x / 240) % 2 ? 0x3b4a3f : 0x45574a);
      g.fillRect(x, GROUND_Y, 240, height - GROUND_Y);
    }
    g.lineStyle(4, 0x1b1b1b);
    g.lineBetween(0, GROUND_Y, WORLD_WIDTH, GROUND_Y);
    // 兩端的牆
    g.fillStyle(0x2a2f2b);
    g.fillRect(0, 0, WALL, GROUND_Y);
    g.fillRect(WORLD_WIDTH - WALL, 0, WALL, GROUND_Y);
  }
}
