import Phaser from 'phaser';
import { LEVEL_START } from '../data/maps';
import { onKey } from './Stage';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const OPTIONS = ['繼續', '從關卡開頭重來'];

// 暫停選單：疊在關卡場景上面；關卡場景停住，邏輯、物理、動畫都不前進
export class Pause extends Phaser.Scene {
  private selected: number;
  private options: Phaser.GameObjects.Text[];

  constructor() {
    super('Pause');
  }

  init() {
    this.selected = 0;
  }

  create() {
    const { width, height } = this.scale;
    const text = (y: number, s: string, size: number) =>
      this.add
        .text(width / 2, y, s, { fontFamily: 'sans-serif', fontSize: `${size}px`, color: '#ffffff', stroke: '#1b1b1b', strokeThickness: 8 })
        .setOrigin(0.5);
    this.add.graphics().fillStyle(0x000000, 0.55).fillRect(0, 0, width, height);
    text(height / 2 - 170, '暫停', 96);
    this.options = OPTIONS.map((s, i) => text(height / 2 + i * 90, s, 48));
    this.highlight();

    onKey(this, KEY.UP, () => this.move(-1));
    onKey(this, KEY.DOWN, () => this.move(1));
    onKey(this, KEY.Z, () => this.choose());
    onKey(this, KEY.ENTER, () => this.choose());
    onKey(this, KEY.ESC, () => this.resumeStage());
  }

  private move(d: number) {
    this.selected = (this.selected + d + OPTIONS.length) % OPTIONS.length;
    this.highlight();
  }

  private highlight() {
    this.options.forEach((t, i) => t.setColor(i === this.selected ? '#ffe14d' : '#ffffff').setText(i === this.selected ? `▶ ${OPTIONS[i]}` : OPTIONS[i]));
  }

  private choose() {
    if (this.selected === 0) this.resumeStage();
    // 從關卡開頭重來：關掉選單、重開關卡場景（第 1 張、HP 全滿、MP 0）
    else this.scene.start('Stage', { ...LEVEL_START });
  }

  private resumeStage() {
    this.scene.resume('Stage');
    this.scene.stop();
  }
}
