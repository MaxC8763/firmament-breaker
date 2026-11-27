import { expect, test } from 'vitest';
import { bodyWarning, checkFrame, worst } from './public/checks.js';

const manifest = (img, errors = []) => ({ images: img ? { 'hero/a/a_00': img } : {}, errors });
const frame = { file: 'a_00', grounded: true };

test('貼地的格離地平線超過 ±1 px 標黃；不貼地的格不檢查', () => {
  expect(checkFrame(manifest({ ground: 0, edge: false }), 'hero/a', frame)).toEqual([]);
  expect(checkFrame(manifest({ ground: -1, edge: false }), 'hero/a', frame)).toEqual([]);
  expect(checkFrame(manifest({ ground: 10, edge: false }), 'hero/a', frame)).toEqual([{ level: 'warn', text: '腳底低於地平線 10 px' }]);
  expect(checkFrame(manifest({ ground: -3, edge: false }), 'hero/a', frame)).toEqual([{ level: 'warn', text: '腳底高於地平線 3 px' }]);
  expect(checkFrame(manifest({ ground: 10, edge: false }), 'hero/a', { ...frame, grounded: false })).toEqual([]);
});

test('碰到畫布邊緣標紅、管線的錯誤（含這格的特效圖）照列', () => {
  expect(checkFrame(manifest({ ground: 0, edge: true }), 'hero/a', frame)).toEqual([{ level: 'edge', text: '圖碰到畫布邊緣，可能被切掉' }]);
  const errors = [{ image: 'hero/a/a_00', message: '尺寸不對' }, { image: 'hero/a/fx/a_fx_00', message: '讀不到' }, { image: 'hero/b/b_00', message: '別格' }];
  const got = checkFrame(manifest(undefined, errors), 'hero/a', { ...frame, fx: 'a_fx_00' });
  expect(got.map((w) => w.level)).toEqual(['error', 'error']);
  expect(worst(got)).toBe('bad');
  expect(worst([{ level: 'warn', text: '' }])).toBe('warn');
  expect(worst([])).toBeNull();
});

test('body 下緣不在腳底時警告：主角在遊戲裡會陷進地面或浮空', () => {
  const hb = (y, h) => ({ body: { type: 'rect', x: -30, y, w: 60, h } });
  expect(bodyWarning(hb(-200, 200))).toBeNull();
  expect(bodyWarning(hb(-200, 195))).toBe('body 下緣在腳底上方 5 px：主角在遊戲裡會陷進地面');
  expect(bodyWarning(hb(-200, 203))).toBe('body 下緣在腳底下方 3 px：主角在遊戲裡會浮空');
  expect(bodyWarning({})).toBeNull();
});
