import Phaser from 'phaser';
import { addMp, newAttack, strike, type AttackInstance, type AttackSpec, type HitResult } from '../combat/attack';
import { stepProjectile, type Projectile } from '../combat/projectile';
import { attackShape, overlaps, toWorld, type Box, type HitboxData } from '../combat/hitbox';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { DOOR, doorOpen, LEVEL_START, MAPS, nextEntry, PLATFORM_THICKNESS, type Entry, type MapData } from '../data/maps';
import { ENEMIES, ENEMY, GROUND_Y, HERO, SLASH, TICK_HZ, WAVE, WORLD_WIDTH, ticks } from '../data/tuning';
import { installDevTools } from '../dev/devTools';
import { Enemy } from '../entities/Enemy';
import { enemyHarmful, EnemyState, hurtEnemy } from '../entities/enemyLogic';
import { Hero } from '../entities/Hero';
import { activeFrame, eatItem, HeroState, hurtHero, type Attack } from '../entities/heroLogic';
import { noButtons, type Button, type InputFrame } from '../input/input';

const HITBOXES = hitboxes as unknown as HitboxData;
const SLASH_SPEC: AttackSpec = { maxHits: 1, intervalTicks: Infinity, damage: SLASH.damage, mp: SLASH.mp };
const WAVE_SPEC: AttackSpec = { maxHits: WAVE.maxHits, intervalTicks: ticks(WAVE.intervalMs), damage: WAVE.damage, mp: WAVE.mp };

/** 道具被吃到的範圍（相對腳底）：和藥瓶的圖差不多大 */
const ITEM_BOX = { x: -32, y: -88, w: 64, h: 88 };

/** HUD 的位置與大小（畫面座標） */
const HUD = { x: 48, hpY: 40, hpWidth: 480, mpY: 84, mpWidth: 360 };

/** 命中時發給開發模式的事件：(雜兵, 結果, 這一段的傷害, 攻擊實例) */
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
  up: Phaser.Input.Keyboard.KeyCodes.UP,
  down: Phaser.Input.Keyboard.KeyCodes.DOWN,
  jump: Phaser.Input.Keyboard.KeyCodes.Z,
  attack: Phaser.Input.Keyboard.KeyCodes.X,
};

/**
 * 按一下 code 就呼叫 fn，同一個按鍵事件只處理一次：Phaser 4.2.1 的鍵盤外掛在同一幀收到下一個按鍵時，
 * 會把這一幀已經處理過的按鍵事件從頭重播。開關暫停選單的 Esc、選單的鍵、作弊鍵共用這份記錄，一次按鍵不會被處理兩次。
 * 按鍵在場景關閉時連同監聽一起移除
 */
const handledKeys = new WeakSet<KeyboardEvent>();
export function onKey(scene: Phaser.Scene, code: number, fn: () => void) {
  scene.input.keyboard!.addKey(code).on(Phaser.Input.Keyboard.Events.DOWN, (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
    if (handledKeys.has(event)) return;
    handledKeys.add(event);
    fn();
  });
}

export class Stage extends Phaser.Scene {
  /** 這張地圖和進入時的 HP／MP（死亡重來用） */
  entry: Entry;
  /** 走進第 3 張的門：關卡停住，等按 Z 再玩一次 */
  complete: boolean;
  hero: Hero;
  enemies: Enemy[];
  /** 地圖上還沒被吃掉的道具 */
  items: { kind: 'hp' | 'mp'; sprite: Phaser.GameObjects.Sprite }[];
  waves: Wave[];
  /** 這一局生成過幾道劍氣 */
  wavesSpawned: number;
  /** 飛行中的敵方彈丸 */
  bullets: { p: Projectile; sprite: Phaser.GameObjects.Sprite }[];
  /** 正在出的招和它的攻擊實例；換招時舊的實例結束 */
  private slash: { move: Attack; attack: AttackInstance } | null;
  /** 命中停頓還剩幾個 tick：期間邏輯與物理都不前進 */
  private hitstop: number;
  /** 已經要求重來，這一幀剩下的 tick 不再跑 */
  private restarting: boolean;
  /** ↓＋Z 往下穿時腳底的 y：腳底掉過平台的厚度之前，上緣在這個高度的平台都不擋 */
  private dropY: number | null;
  private door: Phaser.GameObjects.Graphics;
  private doorHint: Phaser.GameObjects.Text;
  /** 門上次畫成開著還是關著；沒變就不重畫 */
  private doorShown: boolean | null;
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

  /** 換地圖、死亡重來、從關卡開頭重來都用 scene.restart 帶進入口的值；開機沒帶值就是關卡開頭 */
  init(data?: Partial<Entry>) {
    this.entry = data?.map === undefined ? { ...LEVEL_START } : (data as Entry);
    this.complete = false;
    this.doorShown = null;
    this.elapsed = 0;
    this.pressed = noButtons();
    this.waves = [];
    this.wavesSpawned = 0;
    this.bullets = [];
    this.slash = null;
    this.hitstop = 0;
    this.restarting = false;
    this.dropY = null;
    this.hudShown = '';
  }

  create() {
    const map = MAPS[this.entry.map];
    this.drawBackground(map);
    this.physics.world.setBounds(WALL, 0, WORLD_WIDTH - WALL * 2, GROUND_Y, true, true, false, true);
    // 物理不自己跟著幀跑：每個邏輯 tick 跑一步，邏輯讀到的永遠是上一步的結果（場景重來會重新連上，所以每次都關）
    this.physics.disableUpdate();

    const manifest: Manifest = this.cache.json.get('manifest');
    // 門畫在角色後面
    this.door = this.add.graphics();
    this.doorHint = this.add
      .text(DOOR.x, GROUND_Y - DOOR.h - 56, '↑', { fontFamily: 'sans-serif', fontSize: '72px', color: '#ffffff', stroke: '#1b1b1b', strokeThickness: 8 })
      .setOrigin(0.5);
    this.items = map.items.map(({ kind, x, y }) => {
      const g = manifest.groups[`items/${kind}`];
      const [cw, ch] = g.canvas;
      const [px, py] = g.pivot ?? [cw / 2, ch];
      return { kind, sprite: this.add.sprite(x, y, 'art', `items/${kind}/${g.frames?.[0]?.file}`).setOrigin(px / cw, py / ch) };
    });
    this.enemies = map.enemies.map((e) => new Enemy(this, manifest, e.kind, e.x));
    this.hero = new Hero(this, manifest);
    this.hero.logic.hp = this.entry.hp;
    this.hero.logic.mp = this.entry.mp;
    this.hero.show();

    // 單向平台：static body 只開上緣的碰撞，從下面與側面都穿得過；只有主角會踩，敵人只走地面
    const platforms = map.platforms.map((p) => {
      const body = this.physics.add.staticBody(p.x, p.top, p.w, PLATFORM_THICKNESS);
      body.checkCollision.down = body.checkCollision.left = body.checkCollision.right = false;
      return body;
    });
    this.physics.add.collider(this.hero, platforms, undefined, (_hero, p) => this.dropY === null || Math.abs((p as Phaser.Physics.Arcade.StaticBody).y - this.dropY) > 1);

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

    // Esc：暫停選單疊在關卡上面、關卡停住。關卡停住時鍵盤外掛會把按著的鍵都放開；恢復時丟掉累積的時間與剛按下的鍵，不會一次補跑好幾個 tick
    onKey(this, Phaser.Input.Keyboard.KeyCodes.ESC, () => {
      if (this.complete || this.restarting) return;
      this.scene.launch('Pause');
      this.scene.pause();
    });
    const onResume = () => {
      this.elapsed = 0;
      this.pressed = noButtons();
    };
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.RESUME, onResume));

    if (import.meta.env.DEV) installDevTools(this, manifest);

    // smoke 與 e2e 靠這個旗標判斷遊戲已經起來
    document.body.dataset.game = 'ready';
  }

  update(_time: number, delta: number) {
    // 關卡完成：關卡停住，按 Z 從關卡開頭再玩一次
    if (this.complete) {
      if (this.pressed.jump && !this.restarting) this.leave({ ...LEVEL_START });
      return;
    }
    // 每幀只在這裡讀一次鍵盤；剛按下的鍵存到被 tick 讀到為止
    const held = noButtons();
    for (const b of Object.keys(KEYS) as Button[]) held[b] = this.keys[b].isDown;

    this.elapsed += Math.min(delta, MAX_DELTA_MS);
    while (this.elapsed >= TICK_MS && !this.restarting && !this.complete) {
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
    for (const e of this.enemies) e.show();
    this.drawHud();
    const open = this.isDoorOpen();
    if (open !== this.doorShown) this.drawDoor(open);
  }

  /** 一個邏輯 tick：決策 → 物理一步 → 發射物 → 命中 */
  private tick(frame: InputFrame) {
    const out = this.hero.step(frame);
    if (out.dropThrough) this.dropY = this.hero.body.bottom;
    const shooters = this.enemies.filter((e) => e.step(this.hero.x).shoot);
    this.physics.world.singleStep();
    // 腳底掉過平台的下緣，那個平台的上緣已經離得夠遠，物理不會再把主角推回上面
    if (this.dropY !== null && this.hero.body.bottom > this.dropY + PLATFORM_THICKNESS) this.dropY = null;
    if (out.spawnWave) this.spawnWave();
    for (const e of shooters) this.spawnBullet(e);
    this.moveWaves();
    this.resolveHits();
    this.moveBullets();
    this.contactDamage();
    this.pickItems();
    for (const e of this.enemies) if (e.logic.state === EnemyState.Gone) e.destroy();
    this.enemies = this.enemies.filter((e) => e.logic.state !== EnemyState.Gone);
    // 站在開著的門前按 ↑：進下一張的入口；最後一張的門是關卡完成。打盹中按 ↑ 只會驚醒
    const hero = this.hero;
    const awake = ![HeroState.Dead, HeroState.Doze, HeroState.Wake].includes(hero.logic.state);
    if (frame.pressed.up && awake && hero.body.blocked.down && Math.abs(hero.x - DOOR.x) <= DOOR.w / 2 && this.isDoorOpen()) {
      const next = nextEntry('door', this.entry, hero.logic);
      if (next) this.leave(next);
      else this.finish();
    }
    // 死亡動畫播完：從這張的入口重來，HP、MP 回到進入這張時的值，敵人也重置
    if (hero.logic.wantsRestart) this.leave(nextEntry('death', this.entry, hero.logic)!);
  }

  /** 用 entry 的值重開關卡場景；這一幀剩下的 tick 不再跑 */
  private leave(entry: Entry) {
    this.restarting = true;
    this.scene.restart(entry);
  }

  /** 這張地圖的敵人全部 HP 歸零就開門 */
  isDoorOpen() {
    return doorOpen(this.enemies.map((e) => e.logic.hp));
  }

  /** 門：關著是木門，開著是黑色的門洞，上面顯示「↑」 */
  private drawDoor(open: boolean) {
    this.doorShown = open;
    const left = DOOR.x - DOOR.w / 2;
    const top = GROUND_Y - DOOR.h;
    this.door.clear().fillStyle(open ? 0x1b1b1b : 0x7a4a2a).fillRect(left, top, DOOR.w, DOOR.h);
    this.door.lineStyle(8, 0x1b1b1b).strokeRect(left, top, DOOR.w, DOOR.h);
    this.doorHint.setVisible(open);
  }

  /** 關卡完成：關卡停住，畫面中央顯示完成與再玩一次的提示 */
  private finish() {
    this.complete = true;
    const { width, height } = this.scale;
    this.add.graphics().setScrollFactor(0).setDepth(950).fillStyle(0x000000, 0.55).fillRect(0, 0, width, height);
    const text = (y: number, s: string, size: number) =>
      this.add
        .text(width / 2, y, s, { fontFamily: 'sans-serif', fontSize: `${size}px`, color: '#ffffff', stroke: '#1b1b1b', strokeThickness: 8 })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(951);
    text(height / 2 - 60, '關卡完成', 112);
    text(height / 2 + 70, '按 Z 再玩一次', 44);
  }

  /** 主角的 hurtbox 碰到道具就吃掉；平台上的道具要站上去（或從上面經過）才吃得到，從平台底下走過不算 */
  private pickItems() {
    const box = this.heroHurtbox();
    const hero = this.hero;
    this.items = this.items.filter(({ kind, sprite }) => {
      if (hero.y > sprite.y + 1 || !overlaps(box, toWorld(ITEM_BOX, sprite.x, sprite.y, 1)) || !eatItem(hero.logic, kind)) return true;
      sprite.destroy();
      return false;
    });
  }

  /** 雜兵碰到主角的 hurtbox 就造成傷害；硬直中、待死亡的不算 */
  private contactDamage() {
    const hero = this.hero;
    const box = this.heroHurtbox();
    for (const e of this.enemies) {
      if (!enemyHarmful(e.logic) || !overlaps(box, e.hurtbox())) continue;
      if (hurtHero(hero.logic, ENEMY.contactDamage, Math.sign(hero.x - e.x) || -hero.logic.facing)) break;
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

  /** 斬擊在判定格打雜兵；劍氣整段飛行都會打 */
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

  /** 攻擊框碰到的每隻雜兵各接觸一次；dir 是擊退方向，single＝單段斬擊（造成傷害時命中停頓） */
  private hitAll(attack: AttackInstance, box: Box, dir: number, single: boolean) {
    for (const e of this.enemies) {
      if (e.logic.state === EnemyState.Death || e.logic.state === EnemyState.Gone) continue;
      if (!overlaps(box, e.hurtbox())) continue;
      const { result, mp } = strike(attack, e.logic, this.hero.logic.tick);
      if (result === 'none') continue;
      this.hero.logic.mp = addMp(this.hero.logic.mp, mp);
      hurtEnemy(e.logic, dir);
      e.flash();
      if (single && result === 'damage') this.hitstop = ticks(SLASH.hitstopMs);
      this.events.emit(HIT_EVENT, e, result satisfies HitResult, result === 'damage' ? attack.spec.damage : 0, attack);
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

  /** 砲手射擊動作的發射格：彈丸從腳底前方、上方出來，朝面向的方向水平飛 */
  private spawnBullet(e: Enemy) {
    const { muzzleX, muzzleY, bulletSpeed } = ENEMIES.gunner;
    const dir = e.logic.facing;
    const p: Projectile = { x: e.x + dir * muzzleX, y: e.y - muzzleY, vx: (dir * bulletSpeed) / TICK_HZ };
    this.bullets.push({ p, sprite: this.add.sprite(p.x, p.y, 'art').play('enemies/gunner/bullet') });
  }

  /**
   * 彈丸往前飛：撞到地圖兩端的牆就消失；主角的斬擊（判定格）與劍氣碰到就消除（不回 MP、不停頓，劍氣照樣往前飛）；
   * 打中主角照一般受擊、彈丸消失，主角無敵中就穿過去
   */
  private moveBullets() {
    const heroBox = this.heroHurtbox();
    const slash = this.heroAttackBox();
    const attacks = [...(slash ? [slash] : []), ...this.waves.map((w) => this.waveBox(w))];
    const bounds = { left: WALL, right: WORLD_WIDTH - WALL };
    this.bullets = this.bullets.filter(({ p, sprite }) => {
      const result = stepProjectile(p, hitboxes.enemies.gunner.bullet, bounds, heroBox, attacks);
      if (result === 'fly' || (result === 'hero' && !hurtHero(this.hero.logic, ENEMIES.gunner.bulletDamage, Math.sign(p.vx)))) {
        sprite.x = p.x;
        return true;
      }
      sprite.destroy();
      return false;
    });
  }

  bulletBox(p: Projectile): Box {
    return toWorld(hitboxes.enemies.gunner.bullet, p.x, p.y, Math.sign(p.vx) || 1);
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

  /** 程式畫的背景：每張地圖換顏色；遠山以半速捲動，地面每 240 px 一格，看得出鏡頭在動 */
  private drawBackground(map: MapData) {
    const { height } = this.scale;
    this.cameras.main.setBackgroundColor(map.colors.sky);
    const far = this.add.graphics().setScrollFactor(0.5);
    far.fillStyle(map.colors.hills);
    for (let x = 0; x < WORLD_WIDTH; x += 360) far.fillEllipse(x + 180, GROUND_Y, 520, 360 + ((x / 360) % 3) * 80);

    const g = this.add.graphics();
    for (let x = 0; x < WORLD_WIDTH; x += 240) {
      g.fillStyle(map.colors.ground[(x / 240) % 2]);
      g.fillRect(x, GROUND_Y, 240, height - GROUND_Y);
    }
    g.lineStyle(4, 0x1b1b1b);
    g.lineBetween(0, GROUND_Y, WORLD_WIDTH, GROUND_Y);
    // 兩端的牆
    g.fillStyle(0x2a2f2b);
    g.fillRect(0, 0, WALL, GROUND_Y);
    g.fillRect(WORLD_WIDTH - WALL, 0, WALL, GROUND_Y);
    for (const p of map.platforms) {
      g.fillStyle(0x7a6248).fillRect(p.x, p.top, p.w, PLATFORM_THICKNESS);
      g.lineStyle(4, 0x1b1b1b).strokeRect(p.x, p.top, p.w, PLATFORM_THICKNESS);
    }
  }
}
