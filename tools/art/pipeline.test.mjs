import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { pack } from './atlas.mjs';
import { buildArt, measure } from './pipeline.mjs';

// 測試用的小畫布：1x 16×32、腳底 y＝20；檔案一律 2x（32×64）
const META = {
  canvas: [16, 32], pivot: [8, 20], scale: 2, fps: 12, loop: true,
  frames: [{ file: 'a_00', hold: 2, grounded: true }, { file: 'a_01', hold: 1, grounded: true }],
};

let tmp, dirs, errors;
const quiet = { log() {}, error: (m) => errors.push(m) };
const build = () => buildArt({ ...dirs, log: quiet });

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'art-test-'));
  dirs = { placeholderDir: path.join(tmp, 'placeholder'), exportDir: path.join(tmp, 'export'), buildDir: path.join(tmp, 'build') };
  errors = [];
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function json(rel, obj) {
  const file = path.join(tmp, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj));
}

/** 寫一張 2x PNG：不透明的方塊佔 [left, right) × [top, bottom)，預設下緣剛好貼在 2x 的地平線（y＝40） */
async function png(rel, { w = 32, h = 64, left = 8, right = 24, top = 10, bottom = 40 } = {}) {
  const file = path.join(tmp, rel);
  const data = Buffer.alloc(w * h * 4);
  for (let y = top; y < bottom; y++) data.fill(255, (y * w + left) * 4, (y * w + right) * 4);
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
}

async function placeholderAction() {
  json('placeholder/hero/act/meta.json', META);
  await png('placeholder/hero/act/a_00.png');
  await png('placeholder/hero/act/a_01.png');
}

describe('合併 export 與佔位圖', () => {
  test('只有佔位圖：每張的來源都是 placeholder，貼地距離是 0', async () => {
    await placeholderAction();
    const m = await build();
    expect(Object.keys(m.images)).toEqual(['hero/act/a_00', 'hero/act/a_01']);
    for (const img of Object.values(m.images)) expect(img).toMatchObject({ source: 'placeholder', ground: 0 });
    expect(m.errors).toEqual([]);
  });

  test('以單張為單位覆蓋：export 有同路徑同檔名的圖，只換那一張', async () => {
    await placeholderAction();
    await png('export/hero/act/a_01.png');
    const m = await build();
    expect(m.images['hero/act/a_00'].source).toBe('placeholder');
    expect(m.images['hero/act/a_01'].source).toBe('export');
    expect(m.groups['hero/act'].metaFrom).toBe('placeholder');
  });

  test('meta.json 整份覆蓋：export 有 meta.json 就整份用它的', async () => {
    await placeholderAction();
    json('export/hero/act/meta.json', { ...META, loop: false, frames: [{ file: 'a_00', hold: 5, grounded: true }] });
    const m = await build();
    expect(m.groups['hero/act']).toMatchObject({ metaFrom: 'export', loop: false, frames: [{ file: 'a_00', hold: 5 }] });
    expect(Object.keys(m.images)).toEqual(['hero/act/a_00']);
  });

  test('export 的 meta 多畫的檔名以 export 為準', async () => {
    await placeholderAction();
    json('export/hero/act/meta.json', { ...META, frames: [...META.frames, { file: 'a_02', hold: 1, grounded: true }] });
    await png('export/hero/act/a_02.png');
    const m = await build();
    expect(m.images['hero/act/a_02']).toMatchObject({ source: 'export', ground: 0 });
    expect(m.images['hero/act/a_00'].source).toBe('placeholder');
  });

  test('export 的圖尺寸不對：印出錯誤、那張退回佔位圖，其他照常', async () => {
    await placeholderAction();
    await png('export/hero/act/a_00.png', { w: 20, h: 20, right: 10, top: 0, bottom: 10 });
    const m = await build();
    expect(m.images['hero/act/a_00'].source).toBe('placeholder');
    expect(m.errors).toEqual([{ image: 'hero/act/a_00', message: expect.stringContaining('20×20') }]);
    expect(errors.join('\n')).toContain('hero/act/a_00');
  });

  test('_ 開頭的檔案與資料夾一律略過', async () => {
    await placeholderAction();
    json('placeholder/_preview/meta.json', META);
    json('placeholder/hero/_wip/meta.json', META);
    json('placeholder/icon/meta.json', { canvas: [16, 32], scale: 2 });
    await png('placeholder/icon/map_icon.png');
    await png('placeholder/icon/_draft.png');
    const m = await build();
    expect(Object.keys(m.groups)).toEqual(['hero/act', 'icon']);
    expect(Object.keys(m.images)).not.toContain('icon/_draft');
    expect(m.images['icon/map_icon'].source).toBe('placeholder');
  });

  test('往下移 20 px（2x）的手繪：顯示比地平線低 10 px（1x）', async () => {
    await placeholderAction();
    await png('export/hero/act/a_00.png', { top: 30, bottom: 60 });
    const m = await build();
    expect(m.images['hero/act/a_00']).toMatchObject({ source: 'export', ground: 10 });
  });

  test('縮成 1x 寫進 build/1x，並寫出 manifest.json', async () => {
    await placeholderAction();
    await build();
    const meta = await sharp(path.join(dirs.buildDir, '1x/hero/act/a_00.png')).metadata();
    expect([meta.width, meta.height]).toEqual([16, 32]);
    expect(existsSync(path.join(dirs.buildDir, 'manifest.json'))).toBe(true);
  });
});

describe('貼地距離與不透明範圍', () => {
  /** 1x RGBA，指定的格子 alpha 設成給定值 */
  function raw(w, h, cells) {
    const data = new Uint8Array(w * h * 4);
    for (const [x, y, a] of cells) data[(y * w + x) * 4 + 3] = a;
    return data;
  }

  test('最下緣（alpha ≥ 128）和地平線的距離、不透明範圍；裁切範圍連半透明也算', () => {
    const data = raw(10, 10, [[3, 2, 255], [6, 5, 200], [4, 7, 127]]);
    expect(measure(data, 10, 10, 6)).toEqual({ bounds: [3, 2, 7, 6], trim: [3, 2, 7, 8], edge: false, ground: 0 });
    expect(measure(data, 10, 10, 4).ground).toBe(2);
    expect(measure(data, 10, 10, 8).ground).toBe(-2);
  });

  test('碰到畫布邊緣就標出來', () => {
    expect(measure(raw(10, 10, [[0, 5, 255]]), 10, 10, 6).edge).toBe(true);
    expect(measure(raw(10, 10, [[5, 9, 255]]), 10, 10, 6).edge).toBe(true);
    expect(measure(raw(10, 10, [[9, 0, 255]]), 10, 10, 6).edge).toBe(true);
  });

  test('全透明的圖沒有範圍', () => {
    expect(measure(raw(4, 4, []), 4, 4, 2)).toEqual({ bounds: null, trim: null, edge: false, ground: null });
  });
});

describe('atlas', () => {
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test('一列一列排：格子不重疊、不超出寬度', () => {
    let seed = 7;
    const rnd = (n) => 1 + ((seed = (seed * 48271) % 2147483647) % n);
    const sizes = Array.from({ length: 60 }, () => ({ w: rnd(300), h: rnd(300) }));
    const { pos, height } = pack(sizes, 1024);
    const rects = sizes.map((s, i) => ({ ...pos[i], ...s }));
    for (const r of rects) expect(r.x + r.w <= 1024 && r.y + r.h <= height).toBe(true);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
  });

  test('格數和 manifest 相同、格子不重疊、原始尺寸等於畫布尺寸、像素和 1x 單張相同', async () => {
    json('placeholder/hero/act/meta.json', {
      ...META,
      frames: [...META.frames, { file: 'a_02', hold: 1, grounded: false, fx: 'a_fx_02' }],
    });
    await png('placeholder/hero/act/a_00.png');
    await png('placeholder/hero/act/a_01.png', { left: 0, right: 30 });
    await png('placeholder/hero/act/a_02.png', { top: 0, bottom: 20 });
    await png('placeholder/hero/act/fx/a_fx_02.png', { left: 2, right: 6, top: 2, bottom: 6 });
    json('placeholder/icon/meta.json', { canvas: [8, 8], scale: 2 });
    await png('placeholder/icon/map_icon.png', { w: 16, h: 16, left: 0, right: 16, top: 0, bottom: 16 });
    const m = await build();

    const game = (f) => path.join(dirs.buildDir, 'game', f);
    const atlas = JSON.parse(readFileSync(game('atlas.json'), 'utf8'));
    expect(Object.keys(atlas.frames).sort()).toEqual(Object.keys(m.images).sort());
    expect(JSON.parse(readFileSync(game('manifest.json'), 'utf8'))).toEqual(m);

    const frames = Object.entries(atlas.frames);
    for (const [key, f] of frames) {
      expect([f.sourceSize.w, f.sourceSize.h]).toEqual(m.images[key].canvas);
      expect(f.frame.x + f.frame.w <= atlas.meta.size.w && f.frame.y + f.frame.h <= atlas.meta.size.h).toBe(true);
    }
    for (let i = 0; i < frames.length; i++)
      for (let j = i + 1; j < frames.length; j++) expect(overlaps(frames[i][1].frame, frames[j][1].frame)).toBe(false);

    const { frame, spriteSourceSize: s } = atlas.frames['hero/act/a_01'];
    const region = (file, r) => sharp(file).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).raw().toBuffer();
    const fromAtlas = await region(game('atlas.png'), frame);
    const from1x = await region(path.join(dirs.buildDir, '1x/hero/act/a_01.png'), s);
    expect(fromAtlas.equals(from1x)).toBe(true);
  });
});
