import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { boxesOf, contains, drag, fieldsOf, handlesOf, hitTest, setField, toLocal } from './public/edit.js';

const rect = { type: 'rect', x: 20, y: -250, w: 190, h: 250 };
const circle = { type: 'circle', cx: 0, cy: -128, r: 210, arc: [-90, 180] };
const p0 = { x: 0, y: 0 };
// 扇形圓心為準、距離 100、角度 deg 的點（0＝正前方、90＝正上方）
const at = (deg) => ({ x: 100 * Math.cos((deg * Math.PI) / 180), y: -128 - 100 * Math.sin((deg * Math.PI) / 180) });

describe('滑鼠位置換算', () => {
  test('換算成面向右、1x、相對腳底的座標；放大時除以倍率', () => {
    expect(toLocal([384 * 2 + 40, 492 * 2 - 100], { pivot: [384, 492], zoom: 2, flipped: false })).toEqual({ x: 20, y: -50 });
  });

  test('面向左時左右鏡射', () => {
    expect(toLocal([384 - 30, 492], { pivot: [384, 492], zoom: 1, flipped: true })).toEqual({ x: 30, y: 0 });
  });
});

describe('控制點與點選', () => {
  const boxes = [
    { role: 'body', shape: { type: 'rect', x: -30, y: -200, w: 60, h: 200 } },
    { role: 'hurtbox', shape: { type: 'rect', x: -34, y: -222, w: 68, h: 222 } },
    { role: 'attack', shape: rect },
  ];

  test('控制點：矩形四角；扇形的半徑點在中間的角度，另有起、迄', () => {
    expect(handlesOf(rect).map((h) => [h.id, h.x, h.y])).toEqual([['nw', 20, -250], ['ne', 210, -250], ['sw', 20, 0], ['se', 210, 0]]);
    const [r, from, to] = handlesOf(circle);
    expect([r.id, from.id, to.id]).toEqual(['r', 'from', 'to']);
    expect(r.x).toBeCloseTo(210 * Math.SQRT1_2);
    expect(r.y).toBeCloseTo(-128 - 210 * Math.SQRT1_2);
    expect([from.x, from.y]).toEqual([expect.closeTo(0), expect.closeTo(82)]);
    expect([to.x, to.y]).toEqual([expect.closeTo(-210), expect.closeTo(-128)]);
    expect(handlesOf({ type: 'circle', cx: 0, cy: 0, r: 150 }).map((h) => [h.id, h.x, h.y])).toEqual([['r', 150, 0]]);
  });

  test('框重疊時選面積最小的；沒有框包住就是 null', () => {
    expect(hitTest(boxes, { x: 0, y: -100 })).toEqual({ role: 'body', handle: 'move' });
    expect(hitTest(boxes, { x: 0, y: -210 })).toEqual({ role: 'hurtbox', handle: 'move' });
    expect(hitTest(boxes, { x: 150, y: -100 })).toEqual({ role: 'attack', handle: 'move' });
    expect(hitTest(boxes, { x: 300, y: -100 })).toBeNull();
  });

  test('已選框的控制點優先，抓最近的那個；沒選的框，角落只算框內', () => {
    expect(hitTest(boxes, { x: 208, y: -248 }, { selected: 'attack', tolerance: 6 })).toEqual({ role: 'attack', handle: 'ne' });
    expect(hitTest(boxes, { x: 208, y: -248 }, { tolerance: 6 })).toEqual({ role: 'attack', handle: 'move' });
    expect(hitTest(boxes, { x: 30, y: -248 }, { selected: 'attack', tolerance: 20 })).toEqual({ role: 'attack', handle: 'nw' });
  });

  test('扇形缺的那一塊不算框內', () => {
    expect(contains(circle, { x: -100, y: 0 })).toBe(false);
    expect(contains(circle, { x: 100, y: 0 })).toBe(true);
    expect(contains(circle, { x: 0, y: -128 })).toBe(true);
    expect(contains(circle, { x: 0, y: -400 })).toBe(false);
  });
});

describe('拖拉', () => {
  test('拖框內：整個框跟著移動', () => {
    expect(drag(rect, 'move', p0, { x: 5, y: -3 })).toEqual({ ...rect, x: 25, y: -253 });
    expect(drag(circle, 'move', p0, { x: -10, y: 4 })).toEqual({ ...circle, cx: -10, cy: -124 });
  });

  test('拖矩形的角改大小，對角固定', () => {
    expect(drag(rect, 'ne', p0, { x: 20, y: -10 })).toEqual({ ...rect, y: -260, w: 210, h: 260 });
    expect(drag(rect, 'sw', p0, { x: 10, y: -50 })).toEqual({ ...rect, x: 30, w: 180, h: 200 });
    expect(drag(rect, 'nw', p0, { x: -5, y: 5 })).toEqual({ ...rect, x: 15, y: -245, w: 195, h: 245 });
    expect(drag(rect, 'se', p0, { x: 1, y: 2 })).toEqual({ ...rect, w: 191, h: 252 });
  });

  test('寬高最小 1：拖過對邊就停在 1', () => {
    expect(drag(rect, 'ne', p0, { x: -500, y: 500 })).toEqual({ ...rect, y: -1, w: 1, h: 1 });
  });

  test('拖圓周上的控制點改半徑，最小 1', () => {
    expect(drag(circle, 'r', p0, { x: 0, y: -128 - 150.4 })).toEqual({ ...circle, r: 150 });
    expect(drag(circle, 'r', p0, { x: 0, y: -128 })).toEqual({ ...circle, r: 1 });
  });

  test('拖扇形的起、迄：迄比起大，最多大 360 度；跨過 ±180 度也接得上', () => {
    expect(drag(circle, 'from', p0, at(-100)).arc).toEqual([-100, 180]);
    expect(drag(circle, 'from', p0, at(170)).arc).toEqual([170, 180]);
    expect(drag(circle, 'from', p0, at(-179)).arc).toEqual([-179, 180]);
    expect(drag(circle, 'to', p0, at(170)).arc).toEqual([-90, 170]);
    expect(drag(circle, 'to', p0, at(-179)).arc).toEqual([-90, 181]);
    expect(drag(circle, 'to', p0, at(-100)).arc).toEqual([-90, 260]);
    expect(drag(circle, 'to', p0, at(-90)).arc).toEqual([-90, 270]);
  });

  test('取整數：放大 4 倍時拖了不到 1 像素也存成整數', () => {
    expect(drag(rect, 'move', p0, { x: 0.75, y: -0.25 })).toEqual({ ...rect, x: 21, y: -250 });
  });

  test('面向左時往右拖，框往身後移（x 變小）', () => {
    const opts = { pivot: [384, 492], zoom: 1, flipped: true };
    expect(drag(rect, 'move', toLocal([500, 300], opts), toLocal([520, 300], opts))).toEqual({ ...rect, x: 0 });
  });
});

describe('數字欄', () => {
  test('矩形是 x、y、w、h；圓是 cx、cy、r，扇形再加起、迄', () => {
    expect(fieldsOf(rect).map(([f]) => f)).toEqual(['x', 'y', 'w', 'h']);
    expect(fieldsOf(circle)).toEqual([['cx', 'cx'], ['cy', 'cy'], ['r', 'r'], ['arc0', '起'], ['arc1', '迄']]);
  });

  test('整數才套用；w、h、r 至少 1；扇形範圍不對就不套用', () => {
    expect(setField(rect, 'w', 200)).toEqual({ ...rect, w: 200 });
    expect(setField(rect, 'x', -5)).toEqual({ ...rect, x: -5 });
    expect(setField(rect, 'w', 0)).toBeNull();
    expect(setField(rect, 'x', 1.5)).toBeNull();
    expect(setField(rect, 'x', NaN)).toBeNull();
    expect(setField(circle, 'arc1', 200)).toEqual({ ...circle, arc: [-90, 200] });
    expect(setField(circle, 'arc0', 180)).toBeNull();
    expect(setField(circle, 'arc1', 271)).toBeNull();
  });
});

describe('一格畫出哪些框', () => {
  const hb = JSON.parse(readFileSync('src/data/hitboxes.json', 'utf8'));
  const roles = (group) => boxesOf(hb, group).map((b) => `${b.role}:${b.path.join('.')}`);

  test('主角：body、hurtbox、這招的攻擊框；a_slash 另有長條劍氣', () => {
    expect(roles('hero/x1')).toEqual(['body:body', 'hurtbox:hurtbox', 'attack:attacks.x_slash']);
    expect(roles('hero/idle')).toEqual(['body:body', 'hurtbox:hurtbox']);
    expect(roles('hero/a_slash')).toEqual(['body:body', 'hurtbox:hurtbox', 'attack:attacks.a_slash', 'beam:attacks.a_beam']);
  });

  test('特效：發射物的框；沒有框的特效、立繪什麼都不畫', () => {
    expect(roles('effects/x3_wave')).toEqual(['projectile:projectiles.x3_wave']);
    expect(roles('effects/a_beam')).toEqual([]);
    expect(roles('portrait')).toEqual([]);
  });

  test('框的資料就是判定框檔裡的那一個物件', () => {
    expect(boxesOf(hb, 'hero/x1')[2].shape).toBe(hb.attacks.x_slash);
  });
});
