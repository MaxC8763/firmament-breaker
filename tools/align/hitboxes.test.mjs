import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { checkEdit, formatHitboxes } from './hitboxes.mjs';

const text = readFileSync('src/data/hitboxes.json', 'utf8');
const current = () => JSON.parse(text);
const rect = { type: 'rect', x: 1, y: -2, w: 3, h: 4 };

describe('判定框檔的排版', () => {
  test('現在的檔案讀進來再排版，和原檔一模一樣', () => {
    expect(formatHitboxes(JSON.parse(text))).toBe(text);
  });

  test('空的逐格是 {}，排在同一段的單行項目鍵對齊', () => {
    expect(formatHitboxes({ byAction: { x1: 'x_slash' }, perFrame: {} })).toBe(
      '{\n  "byAction": { "x1": "x_slash" },\n  "perFrame": {}\n}\n',
    );
  });

  test('逐格框一個一行', () => {
    const perFrame = { x1: { x1_01: rect, x1_02: { type: 'circle', cx: 0, cy: 0, r: 5, arc: [-90, 180] } } };
    expect(formatHitboxes({ byAction: { x1: 'x_slash' }, perFrame })).toBe(
      '{\n' +
        '  "byAction": { "x1": "x_slash" },\n' +
        '  "perFrame": {\n' +
        '    "x1": {\n' +
        '      "x1_01": { "type": "rect", "x": 1, "y": -2, "w": 3, "h": 4 },\n' +
        '      "x1_02": { "type": "circle", "cx": 0, "cy": 0, "r": 5, "arc": [-90, 180] }\n' +
        '    }\n' +
        '  }\n' +
        '}\n',
    );
  });
});

describe('存檔前的結構檢查', () => {
  test('只改數字可以存', () => {
    const next = current();
    next.attacks.x_slash.w = 210;
    next.body.y = -190;
    next.attacks.d_slash.arc = [-100, 200];
    expect(checkEdit(current(), next)).toBeNull();
  });

  test('逐格框可以新增，也可以刪掉', () => {
    const next = current();
    next.perFrame = { x1: { x1_01: { ...next.attacks.x_slash, w: 180 } } };
    expect(checkEdit(current(), next)).toBeNull();
    expect(checkEdit(next, current())).toBeNull();
  });

  test('資料要是物件', () => {
    expect(checkEdit(current(), null)).toEqual(expect.any(String));
    expect(checkEdit(current(), [])).toEqual(expect.any(String));
  });

  test('欄位不能增刪', () => {
    const missing = current();
    delete missing.body;
    const extraBox = current();
    extraBox.attacks.new_slash = { ...extraBox.attacks.x_slash };
    const extraField = current();
    extraField.hurtbox.z = 1;
    const noPerFrame = current();
    delete noPerFrame.perFrame;
    expect(checkEdit(current(), missing)).toMatch('body');
    expect(checkEdit(current(), extraBox)).toMatch('new_slash');
    expect(checkEdit(current(), extraField)).toMatch('hurtbox');
    expect(checkEdit(current(), noPerFrame)).toMatch('perFrame');
  });

  test('類型和 byAction 不能改', () => {
    const type = current();
    type.body.type = 'circle';
    const mapping = current();
    mapping.byAction.x1 = 'c_dash';
    expect(checkEdit(current(), type)).toMatch('body.type');
    expect(checkEdit(current(), mapping)).toMatch('byAction.x1');
  });

  test('數字要是整數', () => {
    for (const bad of [20.5, null, '20']) {
      const next = current();
      next.attacks.x_slash.x = bad;
      expect(checkEdit(current(), next)).toMatch('attacks.x_slash.x');
    }
  });

  test('寬、高、半徑要大於 0', () => {
    const w = current();
    w.attacks.x_slash.w = 0;
    const h = current();
    h.body.h = -5;
    const r = current();
    r.projectiles.d_storm.r = 0;
    expect(checkEdit(current(), w)).toMatch('attacks.x_slash.w');
    expect(checkEdit(current(), h)).toMatch('body.h');
    expect(checkEdit(current(), r)).toMatch('projectiles.d_storm.r');
  });

  test('扇形從起轉到迄：迄比起大，最多大 360 度；陣列長度不能改', () => {
    const arc = (a) => {
      const next = current();
      next.attacks.d_slash.arc = a;
      return checkEdit(current(), next);
    };
    expect(arc([-90, 270])).toBeNull();
    expect(arc([180, -90])).toMatch('attacks.d_slash.arc');
    expect(arc([0, 0])).toMatch('attacks.d_slash.arc');
    expect(arc([-90, 271])).toMatch('attacks.d_slash.arc');
    expect(arc([-90])).toMatch('attacks.d_slash.arc');
  });

  test('逐格框的動作要在 byAction 裡，格的名稱只能有英數、底線、連字號', () => {
    const action = current();
    action.perFrame = { nope: { nope_01: rect } };
    const file = current();
    file.perFrame = { x1: { 'x1 01': { ...file.attacks.x_slash } } };
    expect(checkEdit(current(), action)).toMatch('perFrame.nope');
    expect(checkEdit(current(), file)).toMatch('perFrame.x1');
  });

  test('新增的逐格框要和它取代的共用框同結構', () => {
    const type = current();
    type.perFrame = { d_slash: { d_slash_01: { ...rect } } };
    const field = current();
    field.perFrame = { x1: { x1_01: { ...field.attacks.x_slash, z: 1 } } };
    expect(checkEdit(current(), type)).toMatch('perFrame.d_slash.d_slash_01');
    expect(checkEdit(current(), field)).toMatch('perFrame.x1.x1_01');
  });

  test('檔案裡原本就有的逐格框，照它原本的結構比', () => {
    const before = current();
    before.perFrame = { x1: { x1_01: { type: 'circle', cx: 0, cy: -100, r: 50 } } };
    const resized = structuredClone(before);
    resized.perFrame.x1.x1_01.r = 60;
    const swapped = structuredClone(before);
    swapped.perFrame.x1.x1_01 = { ...before.attacks.x_slash };
    expect(checkEdit(before, resized)).toBeNull();
    expect(checkEdit(before, swapped)).toMatch('perFrame.x1.x1_01');
  });
});
