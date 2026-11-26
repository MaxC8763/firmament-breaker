import Phaser from 'phaser';
import type { Manifest } from '../data/manifest';
import { GROUND_Y } from '../data/tuning';

// 只在開發模式（npm run dev）載入：正式建置裡 import.meta.env.DEV 是 false，這段會被整個拿掉

export interface GameState {
  groundY: number;
  hero: {
    x: number;
    y: number;
    /** 主角圖看得到的部分（alpha ≥ 128）在畫面上的下緣；全透明的格是 null */
    bottom: number | null;
    anim: string | null;
    frame: string;
  };
}

declare global {
  interface Window {
    __game?: { getState(): GameState };
  }
}

export function installDevTools(scene: Phaser.Scene, hero: Phaser.GameObjects.Sprite, manifest: Manifest) {
  // 腳底十字：畫在定位點上，用來確認圖的腳底和程式的定位點重合
  const cross = scene.add.graphics().setDepth(1000);
  cross.lineStyle(2, 0xe0218a);
  cross.lineBetween(hero.x - 14, hero.y, hero.x + 14, hero.y);
  cross.lineBetween(hero.x, hero.y - 14, hero.x, hero.y + 14);

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
          anim: hero.anims.currentAnim?.key ?? null,
          frame: f.name,
        },
      };
    },
  };
}
