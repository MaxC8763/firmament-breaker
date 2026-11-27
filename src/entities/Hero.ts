import Phaser from 'phaser';
import hitboxes from '../data/hitboxes.json';
import type { Manifest } from '../data/manifest';
import { GROUND_Y, HERO, TICK_HZ, ticks } from '../data/tuning';
import type { InputFrame } from '../input/input';
import { HeroState, heroView, newHero, tickHero, type HeroMoves } from './heroLogic';

// 主角的薄殼：物理 body、動畫、翻面；決策都在 heroLogic
export class Hero extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly logic: ReturnType<typeof newHero>;
  /** 打盹時頭上的 Zzz */
  private zzz: Phaser.GameObjects.Text;

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
    this.zzz = scene.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#ffffff', stroke: '#1b1b1b', strokeThickness: 6 })
      .setOrigin(0, 1);
  }

  /** 跑一個邏輯 tick，把結果交給物理；回傳邏輯的結果，讓場景處理生成劍氣這類事件 */
  step(frame: InputFrame) {
    const { blocked, velocity } = this.body;
    const out = tickHero(this.logic, {
      frame,
      onGround: blocked.down,
      // 能站的只有地面與單向平台：腳底比地面高就是踩在平台上
      onPlatform: blocked.down && this.body.bottom < GROUND_Y - 1,
      vy: velocity.y,
      blocked: { left: blocked.left, right: blocked.right },
    });
    this.body.setVelocityX(out.vx);
    if (out.vy !== null) this.body.setVelocityY(out.vy);
    this.body.setAllowGravity(out.gravity);
    return out;
  }

  /** 每幀一次：照邏輯的狀態換動畫與面向；受擊閃白，之後無敵期間閃爍 */
  show() {
    const h = this.logic;
    this.setFlipX(h.facing < 0);
    if (h.state === HeroState.Hurt && h.stateTicks < ticks(HERO.flashMs)) this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.clearTint();
    this.setAlpha(h.invulnTicks > 0 && h.state !== HeroState.Hurt && Math.floor(h.invulnTicks / 4) % 2 ? 0.35 : 1);
    // 待機時以腳底為基準上下伸縮，像在呼吸（定位點就是腳底，scaleY 不會讓腳離地）
    const breathing = h.state === HeroState.Idle && h.landTicks === 0;
    this.setScale(1, breathing ? 1 + HERO.breathScale * Math.sin((h.tick * 2 * Math.PI) / ticks(HERO.breathMs)) : 1);
    // 打盹：頭上的 Z 一個一個冒出來
    const dozing = h.state === HeroState.Doze;
    this.zzz.setVisible(dozing);
    if (dozing) this.zzz.setPosition(this.x + h.facing * 40, this.y - 230).setText('Zzz'.slice(0, 1 + (Math.floor(h.stateTicks / (TICK_HZ / 2)) % 3)));
    const { anim, frame } = heroView(this.logic);
    if (frame === undefined) this.play(anim, true);
    else {
      this.anims.stop();
      this.setFrame(`${anim}/${frame}`);
    }
  }
}
