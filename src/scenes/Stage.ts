import Phaser from 'phaser';
import { addMp, newAttack, strike, type AttackInstance, type AttackSpec, type HitResult } from '../combat/attack';
import { attackShape, overlaps, toWorld, type Box, type HitboxData } from '../combat/hitbox';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, GRUNT, HERO, SLASH, TICK_HZ, WAVE, WORLD_WIDTH, ticks } from '../data/tuning';
import { installDevTools } from '../dev/devTools';
import { Grunt } from '../entities/Grunt';
import { gruntHarmful, GruntState, hurtGrunt } from '../entities/gruntLogic';
import { Hero } from '../entities/Hero';
import { activeFrame, hurtHero, type Attack } from '../entities/heroLogic';
import { noButtons, type Button, type InputFrame } from '../input/input';

const HITBOXES = hitboxes as unknown as HitboxData;
const SLASH_SPEC: AttackSpec = { maxHits: 1, intervalTicks: Infinity, damage: SLASH.damage, mp: SLASH.mp };
const WAVE_SPEC: AttackSpec = { maxHits: WAVE.maxHits, intervalTicks: ticks(WAVE.intervalMs), damage: WAVE.damage, mp: WAVE.mp };

/** HUD 的位置與大小（畫面座標） */
const HUD = { x: 48, hpY: 40, hpWidth: 480, mpY: 84, mpWidth: 360 };

/** 命中時發給開發模式的事件：(小兵, 結果, 這一段的傷害, 攻擊實例) */
export const HIT_EVENT = 'hit';

const TICK_MS = 1000 / TICK_HZ;
/** 卡頓後最多補多少時間，避免一次補跑太多 tick */
const MAX_DELTA_MS = 100;
/** 兩端牆的厚度 */
const WALL = 24;

/** 飛行中的劍氣 */
export interface Wave {
  sprite: Phaser.GameObjects.Sprite;
  /** 生成時的 x */
  fromX: number;
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
  /** 這一局生成過幾道劍氣 */
  wavesSpawned: number;
  /** 正在出的招和它的攻擊實例；換招時舊的實例結束 */
  private slash: { move: Attack; attack: AttackInstance } | null;
  /** 命中停頓還剩幾個 tick：期間邏輯與物理都不前進 */
  private hitstop: number;
  /** 已經要求重來，這一幀剩下的 tick 不再跑 */
  private restarting: boolean;
  private hud: Phaser.GameObjects.Graphics;
  private mpText: Phaser.GameObjects.Text;
  /** HUD 上次畫的 HP、MP；沒變就不重畫 */
  private hudShown: string;
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
    this.wavesSpawned = 0;
    this.slash = null;
    this.hitstop = 0;
    this.restarting = false;
    this.hudShown = '';
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

    // HUD 畫在關卡場景裡、不跟鏡頭捲動；死亡重來時跟著場景重畫
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(900);
    this.mpText = this.add
      .text(HUD.x + HUD.mpWidth + 16, HUD.mpY - 6, '', { fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff', stroke: '#1b1b1b', strokeThickness: 5 })
      .setScrollFactor(0)
      .setDepth(900);
    this.drawHud();

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
    while (this.elapsed >= TICK_MS && !this.restarting) {
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
    this.drawHud();
  }

  /** 一個邏輯 tick：決策 → 物理一步 → 發射物 → 命中 */
  private tick(frame: InputFrame) {
    const out = this.hero.step(frame);
    for (const g of this.grunts) g.step(this.hero.x);
    this.physics.world.singleStep();
    if (out.spawnWave) this.spawnWave();
    this.moveWaves();
    this.resolveHits();
    this.contactDamage();
    for (const g of this.grunts) if (g.logic.state === GruntState.Gone) g.destroy();
    this.grunts = this.grunts.filter((g) => g.logic.state !== GruntState.Gone);
    // 死亡動畫播完：整個場景重來，HP、MP 回到關卡開始的值，小兵也重置
    if (this.hero.logic.wantsRestart) {
      this.restarting = true;
      this.scene.restart();
    }
  }

  /** 小兵碰到主角的 hurtbox 就造成傷害；硬直中、待死亡的小兵不算 */
  private contactDamage() {
    const hero = this.hero;
    const box = this.heroHurtbox();
    for (const g of this.grunts) {
      if (!gruntHarmful(g.logic) || !overlaps(box, g.hurtbox())) continue;
      if (hurtHero(hero.logic, GRUNT.contactDamage, Math.sign(hero.x - g.x) || -hero.logic.facing)) break;
    }
  }

  /** 左上角的 HP 條（不顯示數字）與 MP 條（數字＋每 100 一條刻度） */
  private drawHud() {
    const { hp, mp } = this.hero.logic;
    const key = `${hp}/${mp}`;
    if (key === this.hudShown) return;
    this.hudShown = key;
    const g = this.hud.clear();
    const bar = (y: number, w: number, h: number, ratio: number, color: number) => {
      g.fillStyle(0x1b1b1b).fillRect(HUD.x - 4, y - 4, w + 8, h + 8);
      g.fillStyle(0x4a4a4a).fillRect(HUD.x, y, w, h);
      g.fillStyle(color).fillRect(HUD.x, y, w * ratio, h);
    };
    bar(HUD.hpY, HUD.hpWidth, 26, hp / HERO.hpMax, 0xe0464e);
    bar(HUD.mpY, HUD.mpWidth, 18, mp / HERO.mpMax, 0x3e8ef0);
    g.lineStyle(3, 0x1b1b1b);
    for (let v = 100; v < HERO.mpMax; v += 100) {
      const x = HUD.x + (HUD.mpWidth * v) / HERO.mpMax;
      g.lineBetween(x, HUD.mpY, x, HUD.mpY + 18);
    }
    this.mpText.setText(`${mp} / ${HERO.mpMax}`);
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

    const box = this.heroAttackBox();
    if (this.slash && box) this.hitAll(this.slash.attack, box, hero.logic.facing, true);
    for (const w of this.waves) this.hitAll(w.attack, this.waveBox(w), w.dir, false);
  }

  /** 主角在判定格的攻擊框（世界座標）；不在判定期間是 null */
  heroAttackBox(): Box | null {
    const hero = this.hero;
    const active = activeFrame(hero.logic);
    const shape = active && attackShape(HITBOXES, active.move, active.air, active.file);
    return shape?.type === 'rect' ? toWorld(shape, hero.x, hero.y, hero.logic.facing) : null;
  }

  heroHurtbox(): Box {
    return toWorld(hitboxes.hurtbox, this.hero.x, this.hero.y, this.hero.logic.facing);
  }

  waveBox(w: Wave): Box {
    return toWorld(hitboxes.projectiles.x3_wave, w.sprite.x, w.sprite.y, w.dir);
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
    this.waves.push({ sprite, fromX: sprite.x, dir, age: 0, attack: newAttack(WAVE_SPEC) });
    this.wavesSpawned++;
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
