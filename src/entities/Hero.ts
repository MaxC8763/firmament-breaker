import Phaser from 'phaser';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, HERO } from '../data/tuning';
import type { InputFrame } from '../input/input';
import { heroView, newHero, tickHero, type HeroMoves } from './heroLogic';

// 主角的薄殼：物理 body、動畫、翻面；決策都在 heroLogic
export class Hero extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly logic: ReturnType<typeof newHero>;

  constructor(scene: Phaser.Scene, manifest: Manifest) {
    const idle = manifest.groups['hero/idle'];
    super(scene, HERO.startX, GROUND_Y, 'art', `hero/idle/${idle.frames?.[0]?.file}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const moves: HeroMoves = Object.fromEntries(Object.entries(manifest.groups).filter(([k]) => k.startsWith('hero/')));
    this.logic = newHero(moves);

    // 定位點是腳底：origin＝pivot ÷ 畫布。body 的 offset 從畫布左上角算，所以框的座標加上 pivot
    const [cw, ch] = idle.canvas;
    const [px, py] = idle.pivot ?? [cw / 2, ch];
    this.setOrigin(px / cw, py / ch);
    const box = hitboxes.body;
    this.body.setSize(box.w, box.h, false).setOffset(px + box.x, py + box.y);
    this.body.setCollideWorldBounds(true);
    this.body.setGravityY(HERO.gravity).setMaxVelocityY(HERO.maxFallSpeed);
  }

  /** 跑一個邏輯 tick，把結果交給物理；回傳邏輯的結果，讓場景處理生成劍氣這類事件 */
  step(frame: InputFrame) {
    const out = tickHero(this.logic, { frame, onGround: this.body.blocked.down, vy: this.body.velocity.y });
    this.body.setVelocityX(out.vx);
    if (out.vy !== null) this.body.setVelocityY(out.vy);
    this.body.setAllowGravity(out.gravity);
    return out;
  }

  /** 每幀一次：照邏輯的狀態換動畫與面向 */
  show() {
    this.setFlipX(this.logic.facing < 0);
    const { anim, frame } = heroView(this.logic);
    if (frame === undefined) this.play(anim, true);
    else {
      this.anims.stop();
      this.setFrame(`${anim}/${frame}`);
    }
  }
}
