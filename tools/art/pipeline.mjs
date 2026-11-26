#!/usr/bin/env node
/**
 * 美術管線：npm run art [-- --export <資料夾>]
 *
 * art/export（手繪）與 art/placeholder（佔位圖）以單張為單位合併 → 用 lanczos3 縮成 1x 寫進 art/build/1x/
 * → 算每張圖的不透明範圍與貼地距離 → 寫 art/build/manifest.json。
 * export 的圖尺寸不是「meta 的畫布 × scale」時，印出錯誤並改用佔位圖，遊戲不會因此壞掉。
 *
 * manifest.json：
 *   groups[資料夾]：那個資料夾的 meta.json（metaFrom＝它來自哪一層）
 *   images[key]：key＝去掉 .png 的相對路徑（動作的格是 <資料夾>/<file>，特效是 <資料夾>/fx/<fx>）；
 *     source、mtime、canvas（1x）、bounds（alpha ≥ 128 的範圍 [左, 上, 右, 下)）、edge（碰到畫布邊緣）、
 *     ground（最下緣和地平線的距離，1x，正＝低於地平線；沒有腳底 pivot 的圖是 null）
 *   errors：[{ image, message }]
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { candidates, imagesOf, listGroups, pickMeta } from './sources.mjs';

const ALPHA = 128; // 不透明的門檻，和佔位圖產生器一致

/** 1x 的 RGBA：不透明範圍、是否碰到畫布邊緣、最下緣和地平線（groundY）的距離 */
export function measure(data, width, height, groundY) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < ALPHA) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (bottom < 0) return { bounds: null, edge: false, ground: null };
  return {
    bounds: [left, top, right + 1, bottom + 1],
    edge: left === 0 || top === 0 || right === width - 1 || bottom === height - 1,
    ground: groundY === undefined ? null : bottom + 1 - groundY,
  };
}

const sizeOf = (file) =>
  sharp(file).metadata().then(({ width, height }) => `${width}×${height}`, () => '讀不到的檔案');

export async function buildArt({ placeholderDir, exportDir, buildDir, log = console }) {
  const dirs = { placeholderDir, exportDir };
  const manifest = { groups: {}, images: {}, errors: [] };
  rmSync(path.join(buildDir, '1x'), { recursive: true, force: true });

  for (const group of listGroups(dirs)) {
    const { from, meta } = pickMeta(group, dirs);
    const scale = meta.scale ?? 2;
    manifest.groups[group] = { metaFrom: from, ...meta };

    for (const { key, canvas, pivot } of imagesOf(group, meta, dirs)) {
      const [w, h] = canvas;
      const want = `${w * scale}×${h * scale}`;
      const problems = [];
      let chosen;
      for (const c of candidates(`${key}.png`, dirs)) {
        const size = await sizeOf(c.file);
        if (size === want) {
          chosen = c;
          break;
        }
        problems.push(`${c.from} 的圖是 ${size}，應該是 ${want}`);
      }
      if (problems.length || !chosen) {
        const message = [...problems, chosen ? `改用 ${chosen.from}` : '沒有可用的圖'].join('；');
        manifest.errors.push({ image: key, message });
        log.error(`✗ ${key}：${message}`);
      }
      if (!chosen) continue;

      const { data } = await sharp(chosen.file)
        .resize(w, h, { kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const out = path.join(buildDir, '1x', `${key}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
      manifest.images[key] = {
        group,
        source: chosen.from,
        mtime: statSync(chosen.file).mtime.toISOString(),
        canvas: [w, h],
        ...measure(data, w, h, pivot?.[1]),
      };
    }
  }

  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** 命令列參數：--export <資料夾>（預設 art/export） */
export function cliDirs(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--export');
  return { placeholderDir: 'art/placeholder', exportDir: at >= 0 ? argv[at + 1] : 'art/export', buildDir: 'art/build' };
}

export function summary(m) {
  const all = Object.values(m.images);
  const own = all.filter((i) => i.source === 'export').length;
  return `美術管線：${all.length} 張圖 → art/build（手繪 ${own}、錯誤 ${m.errors.length}）`;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  console.log(summary(await buildArt(cliDirs())));
}
