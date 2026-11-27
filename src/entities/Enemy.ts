import Phaser from 'phaser';
import { toWorld } from '../combat/hitbox';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { ENEMY, GRAVITY, GROUND_Y, ticks, type EnemyKind } from '../data/tuning';
import { attackFrame, EnemyState, holdTicks, newEnemy, tickEnemy, type EnemyLogic } from './enemyLogic';

/** 各狀態播哪個動作：動畫鍵是 enemies/<種類>/<動作> */
const ACTION: Record<EnemyState, string> = {
  [EnemyState.Idle]: 'idle',
  [EnemyState.Walk]: 'move',
  [EnemyState.Attack]: 'attack',
  [EnemyState.Hurt]: 'hurt',
  [EnemyState.Dying]: 'hurt',
  [EnemyState.Death]: 'death',
  [EnemyState.Gone]: 'death',
};

// 雜兵的薄殼：物理 body、動畫、翻面、閃白；決策都在 enemyLogic
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly logic: EnemyLogic;
  /** 閃白還剩幾個 tick */
  private flashTicks = 0;

  constructor(scene: Phaser.Scene, manifest: Manifest, kind: EnemyKind, x: number) {
    const idle = manifest.groups[`enemies/${kind}/idle`];
    super(scene, x, GROUND_Y, 'art', `enemies/${kind}/idle/${idle.frames?.[0]?.file}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const death = manifest.groups[`enemies/${kind}/death`];
    this.logic = newEnemy(kind, x, holdTicks((death.frames ?? []).map((f) => f.hold), death.fps), manifest.groups[`enemies/${kind}/attack`]);

    const [cw, ch] = idle.canvas;
    const [px, py] = idle.pivot ?? [cw / 2, ch];
    this.setOrigin(px / cw, py / ch);
    const box = hitboxes.enemies[kind].body;
    this.body.setSize(box.w, box.h, false).setOffset(px + box.x, py + box.y);
    this.body.setCollideWorldBounds(true);
    this.body.setGravityY(GRAVITY);
  }

  /** 跑一個邏輯 tick，把速度交給物理；回傳邏輯的結果，讓場景生成彈丸 */
  step(heroX: number) {
    this.logic.x = this.x;
    const out = tickEnemy(this.logic, heroX);
    this.body.setVelocityX(out.vx);
    if (this.flashTicks > 0) this.flashTicks--;
    return out;
  }

  /** 被打的範圍（世界座標） */
  hurtbox() {
    return toWorld(hitboxes.enemies[this.logic.kind].hurtbox, this.x, this.y, this.logic.facing);
  }

  flash() {
    this.flashTicks = ticks(ENEMY.flashMs);
  }

  show() {
    this.setFlipX(this.logic.facing < 0);
    // 出招的格由邏輯指定，其他動作循環播放
    const key = `enemies/${this.logic.kind}/${ACTION[this.logic.state]}`;
    const frame = attackFrame(this.logic);
    if (frame) {
      this.anims.stop();
      this.setFrame(`${key}/${frame.file}`);
    } else this.play(key, true);
    if (this.flashTicks > 0) this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.clearTint();
  }
}
