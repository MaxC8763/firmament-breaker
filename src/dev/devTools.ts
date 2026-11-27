import Phaser from 'phaser';
import type { AttackInstance, HitResult } from '../combat/attack';
import type { Box } from '../combat/hitbox';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, HERO } from '../data/tuning';
import type { Enemy } from '../entities/Enemy';
import { EnemyState, hurtEnemy } from '../entities/enemyLogic';
import { heroView, HeroState } from '../entities/heroLogic';
import { HIT_EVENT, onKey, type Stage } from '../scenes/Stage';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const COLOR = { hurtbox: 0x2f7bff, attack: 0xff3040, wave: 0xff9a1f, enemyAttack: 0x9b30ff, cross: 0xe0218a };

// 只在開發模式（npm run dev）載入：正式建置裡 import.meta.env.DEV 是 false，這段會被整個拿掉

export interface GameState {
  groundY: number;
  hero: {
    x: number;
    y: number;
    /** 主角圖看得到的部分（alpha ≥ 128）在畫面上的下緣；全透明的格是 null */
    bottom: number | null;
    /** 邏輯目前的動作 */
    anim: string;
    frame: string;
    state: string;
    facing: number;
    vx: number;
    vy: number;
    /** 正在出的招（x1／x2／x3），沒有是 null */
    move: string | null;
    hp: number;
    mp: number;
    /** 作弊鍵 3 的無敵 */
    invincible: boolean;
  };
  enemies: { kind: string; x: number; y: number; state: string; facing: number; hp: number }[];
  /** 地圖上還沒被吃掉的道具 */
  items: { kind: string; x: number; y: number }[];
  /** 這張地圖打中敵人回了多少 MP（不含自然回復與道具；超過上限捨去的也算） */
  mpFromHits: number;
  /** 飛行中的敵方彈丸（中心） */
  bullets: { x: number; y: number }[];
  /** 飛行中的劍氣，x 是世界座標，fromX 是生成時的 x */
  waves: { x: number; y: number; fromX: number }[];
  /** 這一局生成過幾道劍氣 */
  wavesSpawned: number;
  /** 判定框、傷害數字這些開發用的顯示開著沒 */
  devShown: boolean;
  cameraX: number;
  /** 邏輯跑過的 tick 數 */
  tick: number;
  /** 第幾張地圖（0 起算） */
  map: number;
  /** 進入這張地圖時的 HP／MP：死亡重來用 */
  entry: { hp: number; mp: number };
  doorOpen: boolean;
  /** 關卡完成畫面 */
  complete: boolean;
  /** 暫停選單開著，關卡停住 */
  paused: boolean;
}

declare global {
  interface Window {
    __game?: {
      getState(): GameState;
      /** 暫停與繼續關卡場景（畫面照樣算繪）：瀏覽器測試用來定格截圖 */
      pause(): void;
      resume(): void;
      /** 設定主角的 HP：不用等被打很久 */
      setHp(hp: number): void;
      /** 直接進第 map 張地圖（0 起算）的入口，HP／MP 沒給就照目前的 */
      enter(map: number, hp?: number, mp?: number): void;
      /** 把主角放到 x（腳底，地面上） */
      placeHero(x: number): void;
    };
  }
}

/** 開發模式的顯示要不要開；跨場景重來保留（` 切換） */
let shown = true;

export function installDevTools(scene: Stage, manifest: Manifest) {
  const hero = scene.hero;
  // 判定框與腳底十字：每幀重畫。十字畫在定位點上，用來確認圖的腳底和程式的定位點重合
  const boxes = scene.add.graphics().setDepth(1000);
  const world = scene.physics.world;
  world.createDebugGraphic();
  const draw = () => {
    boxes.clear().setVisible(shown);
    world.debugGraphic.setVisible(shown);
    world.drawDebug = shown;
    if (!shown) return;
    const rect = (b: Box, color: number, fill = false) => {
      boxes.lineStyle(2, color).strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      if (fill) boxes.fillStyle(color, 0.25).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    };
    rect(scene.heroHurtbox(), COLOR.hurtbox);
    for (const e of scene.enemies) rect(e.hurtbox(), COLOR.hurtbox);
    const attack = scene.heroAttackBox();
    if (attack) rect(attack, COLOR.attack, true);
    for (const w of scene.waves) rect(scene.waveBox(w), COLOR.wave, true);
    for (const b of scene.bullets) rect(scene.bulletBox(b.p), COLOR.enemyAttack, true);
    boxes.lineStyle(2, COLOR.cross);
    boxes.lineBetween(hero.x - 14, hero.y, hero.x + 14, hero.y);
    boxes.lineBetween(hero.x, hero.y - 14, hero.x, hero.y + 14);
  };
  // 傷害數字與「已造成段數／上限」：飄起來再淡出。命中回復的 MP 不管顯示開著沒都要記
  let mpFromHits = 0;
  const onHit = (g: Enemy, result: HitResult, damage: number, attack: AttackInstance) => {
    if (result === 'damage') mpFromHits += attack.spec.mp;
    if (!shown) return;
    const count = attack.contacts.get(g.logic)?.count ?? 0;
    const label = `${result === 'damage' ? damage : '—'}  ${count}/${attack.spec.maxHits}`;
    const text = scene.add
      .text(g.x, g.y - 170, label, { fontFamily: 'sans-serif', fontSize: '28px', color: result === 'damage' ? '#ffe14d' : '#cfcfcf', stroke: '#1b1b1b', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(1001);
    scene.tweens.add({ targets: text, y: text.y - 60, alpha: 0, duration: 700, onComplete: () => text.destroy() });
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, draw);
  scene.events.on(HIT_EVENT, onHit);
  // 場景的事件監聽在重來時不會自動移除
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, draw);
    scene.events.off(HIT_EVENT, onHit);
  });

  // 作弊鍵：1＝MP 全滿、2＝HP 全滿、3＝無敵切換、4＝這張地圖的敵人 HP 全部歸零（開門用）、`＝切換上面的顯示。
  // 切換類的鍵按一下只能切一次：onKey 用事件物件去重
  const cheat = (code: number, fn: () => void) => onKey(scene, code, fn);
  cheat(KEY.ONE, () => (hero.logic.mp = HERO.mpMax));
  cheat(KEY.TWO, () => (hero.logic.hp = HERO.hpMax));
  cheat(KEY.THREE, () => (hero.logic.invincible = !hero.logic.invincible));
  cheat(KEY.FOUR, () => {
    for (const e of scene.enemies) {
      e.logic.hp = 0;
      e.logic.dying = true;
      hurtEnemy(e.logic, 0);
    }
  });
  cheat(KEY.BACKTICK, () => (shown = !shown));

  window.__game = {
    getState: () => {
      const f = hero.frame;
      const box = manifest.images[f.name]?.bounds;
      return {
        groundY: GROUND_Y,
        hero: {
          x: hero.x,
          y: hero.y,
          // atlas 的格裁掉了透明邊，但 origin 以裁切前的畫布計算：畫布的上緣在 y − displayOriginY
          bottom: box ? hero.y + (box[3] - hero.displayOriginY) * hero.scaleY : null,
          anim: heroView(hero.logic).anim,
          frame: f.name,
          state: HeroState[hero.logic.state],
          facing: hero.logic.facing,
          vx: hero.body.velocity.x,
          vy: hero.body.velocity.y,
          move: hero.logic.attack?.move ?? null,
          hp: hero.logic.hp,
          mp: hero.logic.mp,
          invincible: hero.logic.invincible,
        },
        enemies: scene.enemies.map((e) => ({ kind: e.logic.kind, x: e.x, y: e.y, state: EnemyState[e.logic.state], facing: e.logic.facing, hp: e.logic.hp })),
        items: scene.items.map((i) => ({ kind: i.kind, x: i.sprite.x, y: i.sprite.y })),
        mpFromHits,
        bullets: scene.bullets.map((b) => ({ x: b.p.x, y: b.p.y })),
        waves: scene.waves.map((w) => ({ x: w.sprite.x, y: w.sprite.y, fromX: w.fromX })),
        wavesSpawned: scene.wavesSpawned,
        devShown: shown,
        cameraX: scene.cameras.main.scrollX,
        tick: hero.logic.tick,
        map: scene.entry.map,
        entry: { hp: scene.entry.hp, mp: scene.entry.mp },
        doorOpen: scene.isDoorOpen(),
        complete: scene.complete,
        paused: scene.scene.isPaused(),
      };
    },
    // 除錯函式都不回傳值：Playwright 會把 evaluate 的回傳值序列化傳回測試，ScenePlugin 這種大物件要花好幾秒，期間遊戲照跑
    pause: () => void scene.scene.pause(),
    resume: () => void scene.scene.resume(),
    setHp: (hp) => void (hero.logic.hp = hp),
    enter: (map, hp = hero.logic.hp, mp = hero.logic.mp) => void scene.scene.restart({ map, hp, mp }),
    placeHero: (x) => hero.body.reset(x, GROUND_Y),
  };
}
