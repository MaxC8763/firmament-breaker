import Phaser from 'phaser';
import type { Manifest } from '../data/manifest';

// 載入美術管線產出的 atlas 與 manifest，替每個有格的資料夾建好動畫
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // 正式站在子路徑底下，路徑要從 BASE_URL 開始
    this.load.setPath(import.meta.env.BASE_URL);
    this.load.atlas('art', 'atlas.png', 'atlas.json');
    this.load.json('manifest', 'manifest.json');
  }

  create() {
    const manifest: Manifest = this.cache.json.get('manifest');
    for (const [group, meta] of Object.entries(manifest.groups)) {
      if (!meta.frames) continue;
      this.anims.create({
        key: group,
        // 每格停 hold 格；v4 的每格 duration 是取代 frameRate 算出的時間，不是加上去
        frames: meta.frames
          .map((f) => ({ key: 'art', frame: `${group}/${f.file}`, duration: (f.hold * 1000) / meta.fps }))
          .filter((f) => f.frame in manifest.images),
        frameRate: meta.fps,
        repeat: meta.loop ? -1 : 0,
      });
    }
    this.scene.start('Stage');
  }
}
