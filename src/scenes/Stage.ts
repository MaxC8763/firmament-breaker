import Phaser from 'phaser';
import { GROUND_Y } from '../data/tuning';

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

    // smoke 與 e2e 靠這個旗標判斷遊戲已經起來
    document.body.dataset.game = 'ready';
  }
}
