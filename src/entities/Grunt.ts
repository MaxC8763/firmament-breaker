import Phaser from 'phaser';
import { toWorld } from '../combat/hitbox';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GRAVITY, GROUND_Y, GRUNT, ticks } from '../data/tuning';
import { GruntState, holdTicks, newGrunt, tickGrunt, type GruntLogic } from './gruntLogic';

const ANIM: Record<GruntState, string> = {
  [GruntState.Idle]: 'enemies/grunt/idle',
  [GruntState.Walk]: 'enemies/grunt/move',
  [GruntState.Hurt]: 'enemies/grunt/hurt',
  [GruntState.Dying]: 'enemies/grunt/hurt',
  [GruntState.Death]: 'enemies/grunt/death',
  [GruntState.Gone]: 'enemies/grunt/death',
};

// 小兵的薄殼：物理 body、動畫、翻面、閃白；決策都在 gruntLogic
export class Grunt extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly logic: GruntLogic;
  /** 閃白還剩幾個 tick */
  private flashTicks = 0;

  constructor(scene: Phaser.Scene, manifest: Manifest, x: number) {
    const idle = manifest.groups['enemies/grunt/idle'];
    super(scene, x, GROUND_Y, 'art', `enemies/grunt/idle/${idle.frames?.[0]?.file}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const death = manifest.groups['enemies/grunt/death'];
    this.logic = newGrunt(x, holdTicks((death.frames ?? []).map((f) => f.hold), death.fps));

    const [cw, ch] = idle.canvas;
    const [px, py] = idle.pivot ?? [cw / 2, ch];
    this.setOrigin(px / cw, py / ch);
    const box = hitboxes.enemies.grunt.body;
    this.body.setSize(box.w, box.h, false).setOffset(px + box.x, py + box.y);
    this.body.setCollideWorldBounds(true);
    this.body.setGravityY(GRAVITY);
  }

  step(heroX: number) {
    this.logic.x = this.x;
    this.body.setVelocityX(tickGrunt(this.logic, heroX));
    if (this.flashTicks > 0) this.flashTicks--;
  }

  /** 被打的範圍（世界座標） */
  hurtbox() {
    return toWorld(hitboxes.enemies.grunt.hurtbox, this.x, this.y, this.logic.facing);
  }

  flash() {
    this.flashTicks = ticks(GRUNT.flashMs);
  }

  show() {
    this.setFlipX(this.logic.facing < 0);
    this.play(ANIM[this.logic.state], true);
    if (this.flashTicks > 0) this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.clearTint();
  }
}
