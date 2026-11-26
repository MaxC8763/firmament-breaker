import Phaser from 'phaser';
import type { Manifest } from '../data/manifest';
import { GROUND_Y } from '../data/tuning';
import { installDevTools } from '../dev/devTools';

export class Stage extends Phaser.Scene {
  constructor() {
    super('Stage');
  }

  create() {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(0x3b4a3f);
    g.fillRect(0, GROUND_Y, width, height - GROUND_Y);
    g.lineStyle(4, 0x1b1b1b);
    g.lineBetween(0, GROUND_Y, width, GROUND_Y);

    // 主角的定位點是腳底：origin＝pivot ÷ 畫布，所以 y 直接放地平線
    const manifest: Manifest = this.cache.json.get('manifest');
    const idle = manifest.groups['hero/idle'];
    const [cw, ch] = idle.canvas;
    const [px, py] = idle.pivot ?? [cw / 2, ch];
    const hero = this.add
      .sprite(width / 2, GROUND_Y, 'art', `hero/idle/${idle.frames?.[0]?.file}`)
      .setOrigin(px / cw, py / ch)
      .play('hero/idle');

    if (import.meta.env.DEV) installDevTools(this, hero, manifest);

    // smoke 與 e2e 靠這個旗標判斷遊戲已經起來
    document.body.dataset.game = 'ready';
  }
}
