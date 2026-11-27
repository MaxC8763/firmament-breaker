import Phaser from 'phaser';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GRAVITY, GROUND_Y } from '../data/tuning';
import { GruntState, newGrunt, tickGrunt, type GruntLogic } from './gruntLogic';

// 小兵的薄殼：物理 body、動畫、翻面；決策都在 gruntLogic
export class Grunt extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly logic: GruntLogic;

  constructor(scene: Phaser.Scene, manifest: Manifest, x: number) {
    const idle = manifest.groups['enemies/grunt/idle'];
    super(scene, x, GROUND_Y, 'art', `enemies/grunt/idle/${idle.frames?.[0]?.file}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.logic = newGrunt(x);

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
  }

  show() {
    this.setFlipX(this.logic.facing < 0);
    this.play(this.logic.state === GruntState.Walk ? 'enemies/grunt/move' : 'enemies/grunt/idle', true);
  }
}
