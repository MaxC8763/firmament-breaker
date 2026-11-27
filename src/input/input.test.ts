import { describe, expect, test } from 'vitest';
import { bufferPresses, frameOf, newRunTracker, takeBuffered, trackRun, type Buffered } from './input';

describe('雙擊跑步', () => {
  test('250 ms 內連按兩下同一個方向，按著就是跑', () => {
    const r = newRunTracker();
    trackRun(r, frameOf([], ['right']), 0);
    trackRun(r, frameOf(), 5);
    trackRun(r, frameOf([], ['right']), 15);
    expect(r.runDir).toBe(1);
    trackRun(r, frameOf(['right']), 40);
    expect(r.runDir).toBe(1);
  });

  test('兩下間隔超過 250 ms 就是走', () => {
    const r = newRunTracker();
    trackRun(r, frameOf([], ['left']), 0);
    trackRun(r, frameOf([], ['left']), 16);
    expect(r.runDir).toBe(0);
  });

  test('兩下方向不同不算', () => {
    const r = newRunTracker();
    trackRun(r, frameOf([], ['left']), 0);
    trackRun(r, frameOf([], ['right']), 5);
    expect(r.runDir).toBe(0);
  });

  test('放開跑的方向就停止跑', () => {
    const r = newRunTracker();
    trackRun(r, frameOf([], ['right']), 0);
    trackRun(r, frameOf([], ['right']), 10);
    trackRun(r, frameOf(), 11);
    expect(r.runDir).toBe(0);
    trackRun(r, frameOf(['right']), 12);
    expect(r.runDir).toBe(0);
  });
});

describe('預先輸入', () => {
  test('150 ms 內取得到按下的鍵，取一次就沒了', () => {
    const buf: Buffered[] = [];
    bufferPresses(buf, frameOf([], ['attack']), 100);
    expect(takeBuffered(buf, 'attack', 109)).toBe(true);
    expect(takeBuffered(buf, 'attack', 109)).toBe(false);
  });

  test('超過 150 ms 就丟掉', () => {
    const buf: Buffered[] = [];
    bufferPresses(buf, frameOf([], ['jump']), 100);
    bufferPresses(buf, frameOf(), 110);
    expect(buf).toEqual([]);
    expect(takeBuffered(buf, 'jump', 110)).toBe(false);
  });
});
