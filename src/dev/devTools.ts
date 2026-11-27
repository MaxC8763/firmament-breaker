import Phaser from 'phaser';
import type { Manifest } from '../data/manifest';
import { GROUND_Y } from '../data/tuning';
import { GruntState } from '../entities/gruntLogic';
import { heroView, HeroState } from '../entities/heroLogic';
import type { Stage } from '../scenes/Stage';

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
  cameraX: number;
  /** 邏輯跑過的 tick 數 */
  tick: number;
}

declare global {
  interface Window {
    __game?: { getState(): GameState };
  }
}

export function installDevTools(scene: Stage, manifest: Manifest) {
  const hero = scene.hero;
  // 腳底十字：畫在定位點上，用來確認圖的腳底和程式的定位點重合
  const cross = scene.add.graphics().setDepth(1000);
  cross.lineStyle(2, 0xe0218a);
  cross.lineBetween(-14, 0, 14, 0);
  cross.lineBetween(0, -14, 0, 14);
  const follow = () => cross.setPosition(hero.x, hero.y);
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, follow);
  // 場景的事件監聽在重來時不會自動移除
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow));

  // 作弊鍵 3：無敵切換。按鍵在場景關閉時連同監聽一起移除
  const keys = scene.input.keyboard!;
  keys.addKey(Phaser.Input.Keyboard.KeyCodes.THREE).on(Phaser.Input.Keyboard.Events.DOWN, () => (hero.logic.invincible = !hero.logic.invincible));

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
        cameraX: scene.cameras.main.scrollX,
        tick: hero.logic.tick,
      };
    },
  };
}
