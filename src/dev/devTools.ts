import Phaser from 'phaser';
import type { AttackInstance, HitResult } from '../combat/attack';
import type { Box } from '../combat/hitbox';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, HERO } from '../data/tuning';
import type { Grunt } from '../entities/Grunt';
import { GruntState } from '../entities/gruntLogic';
import { heroView, HeroState } from '../entities/heroLogic';
import { HIT_EVENT, type Stage } from '../scenes/Stage';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const COLOR = { hurtbox: 0x2f7bff, attack: 0xff3040, wave: 0xff9a1f, cross: 0xe0218a };

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
  enemies: { x: number; y: number; state: string; facing: number; hp: number }[];
  /** 飛行中的劍氣，x 是世界座標，fromX 是生成時的 x */
  waves: { x: number; y: number; fromX: number }[];
  /** 這一局生成過幾道劍氣 */
  wavesSpawned: number;
  /** 判定框、傷害數字這些開發用的顯示開著沒 */
  devShown: boolean;
  cameraX: number;
  /** 邏輯跑過的 tick 數 */
  tick: number;
}

declare global {
  interface Window {
    __game?: {
      getState(): GameState;
      /** 暫停與繼續關卡場景（畫面照樣算繪）：瀏覽器測試用來定格截圖 */
      pause(): void;
      resume(): void;
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
    for (const g of scene.grunts) rect(g.hurtbox(), COLOR.hurtbox);
    const attack = scene.heroAttackBox();
    if (attack) rect(attack, COLOR.attack, true);
    for (const w of scene.waves) rect(scene.waveBox(w), COLOR.wave, true);
    boxes.lineStyle(2, COLOR.cross);
    boxes.lineBetween(hero.x - 14, hero.y, hero.x + 14, hero.y);
    boxes.lineBetween(hero.x, hero.y - 14, hero.x, hero.y + 14);
  };
  // 傷害數字與「已造成段數／上限」：飄起來再淡出
  const onHit = (g: Grunt, result: HitResult, damage: number, attack: AttackInstance) => {
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

  // 作弊鍵：1＝MP 全滿、2＝HP 全滿、3＝無敵切換、`＝切換上面的顯示。按鍵在場景關閉時連同監聽一起移除。
  // 鍵盤外掛在同一幀裡收到下一個按鍵時，會把這一幀已經處理過的按鍵事件從頭再處理一次，DOWN 會重複觸發；
  // 切換類的鍵按一下只能切一次，所以用事件物件去重
  const keys = scene.input.keyboard!;
  const handled = new WeakSet<KeyboardEvent>();
  const cheat = (code: number, fn: () => void) =>
    keys.addKey(code).on(Phaser.Input.Keyboard.Events.DOWN, (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
      if (handled.has(event)) return;
      handled.add(event);
      fn();
    });
  cheat(KEY.ONE, () => (hero.logic.mp = HERO.mpMax));
  cheat(KEY.TWO, () => (hero.logic.hp = HERO.hpMax));
  cheat(KEY.THREE, () => (hero.logic.invincible = !hero.logic.invincible));
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
        enemies: scene.grunts.map((g) => ({ x: g.x, y: g.y, state: GruntState[g.logic.state], facing: g.logic.facing, hp: g.logic.hp })),
        waves: scene.waves.map((w) => ({ x: w.sprite.x, y: w.sprite.y, fromX: w.fromX })),
        wavesSpawned: scene.wavesSpawned,
        devShown: shown,
        cameraX: scene.cameras.main.scrollX,
        tick: hero.logic.tick,
      };
    },
    pause: () => scene.scene.pause(),
    resume: () => scene.scene.resume(),
  };
}
