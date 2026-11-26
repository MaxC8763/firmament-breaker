// 把 1x 單張打包成一張 atlas（Phaser 的 JSON Hash 格式）：每張先裁掉全透明的邊，記下裁切前的原始尺寸
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PAD = 2; // 格子之間留空，縮放取樣時才不會吃到隔壁格的顏色
const WIDTHS = [1024, 2048, 4096]; // 4096 是一般顯示卡都支援的貼圖邊長

/** 由高到矮一列一列排（shelf packing）；回傳每格的左上角與整張的高度 */
export function pack(sizes, width) {
  const order = sizes.map((s, i) => ({ ...s, i })).sort((a, b) => b.h - a.h || a.i - b.i);
  const pos = [];
  let x = PAD, y = PAD, rowH = 0;
  for (const s of order) {
    if (x + s.w + PAD > width) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    pos[s.i] = { x, y };
    x += s.w + PAD;
    rowH = Math.max(rowH, s.h);
  }
  return { pos, height: y + rowH + PAD };
}

/** 讀 manifest 列出的 1x 圖，寫出 <outDir>/atlas.png 與 atlas.json；key 和 manifest 的 images 相同 */
export async function packAtlas(manifest, oneXDir, outDir) {
  const keys = Object.keys(manifest.images);
  const rects = keys.map((k) => {
    const [x0, y0, x1, y1] = manifest.images[k].trim ?? [0, 0, 1, 1];
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
  const width = WIDTHS.find((w) => pack(rects, w).height <= w);
  if (!width) throw new Error(`圖太多，atlas 超過 ${WIDTHS.at(-1)}×${WIDTHS.at(-1)}；要拆成多張 atlas`);
  const { pos, height } = pack(rects, width);

  const frames = {};
  const layers = [];
  for (const [i, key] of keys.entries()) {
    const r = rects[i];
    const [cw, ch] = manifest.images[key].canvas;
    frames[key] = {
      frame: { x: pos[i].x, y: pos[i].y, w: r.w, h: r.h },
      rotated: false,
      trimmed: true,
      spriteSourceSize: r,
      sourceSize: { w: cw, h: ch },
    };
    const input = await sharp(path.join(oneXDir, `${key}.png`))
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
      .toBuffer();
    layers.push({ input, left: pos[i].x, top: pos[i].y });
  }

  mkdirSync(outDir, { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toFile(path.join(outDir, 'atlas.png'));
  const json = { frames, meta: { image: 'atlas.png', size: { w: width, h: height }, scale: '1' } };
  writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify(json, null, 1) + '\n');
  return json;
}
