// 小兵的決策：不 import phaser；數值從 tuning 來，薄殼只負責套用結果
import { GRUNT } from '../data/tuning';

export enum GruntState {
  Idle,
  Walk,
}

export interface GruntLogic {
  state: GruntState;
  /** 腳底的 x，薄殼每個 tick 寫入 */
  x: number;
  /** 1＝面向右、−1＝面向左 */
  facing: 1 | -1;
}

export const newGrunt = (x: number): GruntLogic => ({ state: GruntState.Idle, x, facing: -1 });

/** 主角在水平 chaseRange 內就朝主角走，否則待機；回傳水平速度 */
export function tickGrunt(g: GruntLogic, heroX: number): number {
  switch (g.state) {
    case GruntState.Idle:
    case GruntState.Walk: {
      const dx = heroX - g.x;
      g.state = Math.abs(dx) <= GRUNT.chaseRange ? GruntState.Walk : GruntState.Idle;
      if (g.state === GruntState.Idle || dx === 0) return 0;
      g.facing = dx > 0 ? 1 : -1;
      return g.facing * GRUNT.speed;
    }
  }
}
