import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Stage } from './scenes/Stage';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#cfe3ef',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
  physics: { default: 'arcade' },
  scene: [Boot, Stage],
});
