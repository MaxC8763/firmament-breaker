// 決定每張圖、每份 meta.json 從哪一層來：export（手繪）有就用 export，否則用佔位圖
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LAYERS = ['export', 'placeholder'];
const skipped = (name) => name.startsWith('_');

/** 以單張為單位挑來源：export 有同路徑同檔名就用 export，否則用佔位圖；回傳依優先序排好的候選 */
export function candidates(rel, dirs, exists = existsSync) {
  return LAYERS.map((from) => ({ from, file: path.join(dirs[`${from}Dir`], rel) })).filter((c) => exists(c.file));
}

/** meta.json 整份覆蓋：export 的資料夾有 meta.json 就整份用它的 */
export function pickMeta(group, dirs) {
  const [hit] = candidates(path.join(group, 'meta.json'), dirs);
  return hit && { from: hit.from, meta: JSON.parse(readFileSync(hit.file, 'utf8')) };
}

/** 兩層裡所有含 meta.json 的資料夾（相對路徑、用 / 分隔），略過 _ 開頭的檔案與資料夾 */
export function listGroups(dirs) {
  const found = new Set();
  const walk = (root, rel) => {
    const dir = path.join(root, rel);
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skipped(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(root, child);
      else if (e.name === 'meta.json' && rel) found.add(rel);
    }
  };
  for (const from of LAYERS) walk(dirs[`${from}Dir`], '');
  return [...found].sort();
}

/**
 * 一個資料夾要處理哪些圖：key 是去掉 .png 的相對路徑，canvas／pivot 是 1x 的畫布與腳底（或錨點）。
 * meta 有 frames 就照 frames（含 fx/ 裡的特效圖），有 parts 就照 parts，都沒有就收兩層裡的所有 PNG。
 */
export function imagesOf(group, meta, dirs) {
  const own = { canvas: meta.canvas, pivot: meta.pivot };
  if (meta.frames) {
    return meta.frames.flatMap((f) => [
      { key: `${group}/${f.file}`, ...own },
      ...(f.fx ? [{ key: `${group}/fx/${f.fx}`, ...own }] : []),
    ]);
  }
  if (meta.parts) {
    return Object.values(meta.parts).map((p) => ({ key: `${group}/${p.file}`, canvas: p.canvas, pivot: p.pivot }));
  }
  const names = new Set();
  for (const from of LAYERS) {
    const dir = path.join(dirs[`${from}Dir`], group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.endsWith('.png') && !skipped(name)) names.add(name.slice(0, -4));
  }
  return [...names].sort().map((name) => ({ key: `${group}/${name}`, ...own }));
}
