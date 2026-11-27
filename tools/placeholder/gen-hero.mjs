#!/usr/bin/env node
/**
 * 佔位圖產生器（主角與雜兵）
 *
 * 用程式畫出 Q 版人類劍士的動作、特效、立繪、cut-in 與地圖圖示，以及雜兵的動作，手繪圖還沒畫好之前，遊戲照樣能開發與測試。
 * 手繪圖以「同路徑、同檔名」的 2x PNG 放進 art/export/，美術管線就會逐張改用手繪。
 *
 * 用法：
 *   npm run art:placeholder [-- --sheet]
 *   node tools/placeholder/gen-hero.mjs [輸出資料夾，預設 art/placeholder] [--sheet]
 *     --sheet  另外輸出 _preview/sheet_hero.png（每個動作一列，含 hurtbox／判定框）與 _preview/overview.png
 *
 * 規則：
 * - 主角動作畫布 1x 768×512、腳底 pivot (384, 492)；輸出 2x（1536×1024）。只畫面向右。
 * - 雜兵 A 小兵（enemies/grunt/）畫布 1x 256×256、腳底 pivot (128, 236)，同樣黑描邊平塗、只畫面向右。
 * - grounded 的格自動貼地：最下緣不透明像素（alpha ≥ 128）剛好碰到地平線。
 * - 每個資料夾一份 meta.json；hold＝這張停幾格（12 fps），phase＝startup／active／recovery。
 * - 輸出是產生物，不要手改；要改姿勢就改下面的 ACTIONS 再重跑。
 * - 只會清空帶有 .generated 標記的資料夾；路徑含 export 一律拒絕（那是手繪圖的資料夾）。
 * - 底線開頭的檔案或資料夾（例如 _preview/）是預覽用，管線應略過。
 */
import sharp from 'sharp';
import { mkdir, writeFile, rm, access, readFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const OUT = path.resolve(argv.find((a) => !a.startsWith('--')) ?? 'art/placeholder');
const WANT_SHEET = argv.includes('--sheet');
if (OUT.split(path.sep).includes('export')) {
  console.error(`拒絕輸出到 ${OUT}：art/export/ 是手繪圖的資料夾`);
  process.exit(1);
}

// ---------------- 規格常數（1x 座標，輸出時 ×SCALE） ----------------
const SCALE = 2;
const FPS = 12;
const HERO = { w: 768, h: 512, px: 384, py: 492 };
const OUTLINE = 3;
const ALPHA = 128;
const COL = {
  line: '#1b1b1b', body: '#ffffff', eye: '#86e3d6', dark: '#4a2626',
  blade: '#d7dce1', ridge: '#9aa4ad', guard: '#8b6b4e', guardDark: '#5b4331',
  gem: '#d12e2e', gemHi: '#ff9e9e', grip: '#6b4f3a',
  fx: '#f2feff', fxLine: '#6fd3e6', glow: '#bff1fa',
};

// ---------------- 幾何 ----------------
const rad = (d) => (d * Math.PI) / 180;
/** 角度慣例：0＝朝下、90＝朝前（面向方向）、180＝朝上、-90＝朝後 */
const dir = (a) => [Math.sin(rad(a)), Math.cos(rad(a))];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const perp = (v) => [-v[1], v[0]];
/** 繞 c 旋轉 a 度；正值＝畫面上順時針（上半身往前傾） */
const rot = (p, c, a) => {
  const s = Math.sin(rad(a)), k = Math.cos(rad(a));
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * k - y * s, c[1] + x * s + y * k];
};
const n = (v) => Math.round(v * 100) / 100;
const P = (p) => `${n(p[0])},${n(p[1])}`;
const poly = (pts, close = false) => 'M ' + pts.map(P).join(' L ') + (close ? ' Z' : '');

// ---------------- 形狀：同一組先畫黑色外擴、再填白，合成一個沒有內部接縫的剪影 ----------------
const circle = (c, r) => ({ t: 'circle', c, r });
const shape = (d) => ({ t: 'path', d });
const ellipse = (c, rx, ry, deg = 0) => ({ t: 'ellipse', c, rx, ry, deg });
const cap = (a, b, r) => ({ t: 'cap', a, b, r });

function shapeSVG(s, grow, color) {
  if (s.t === 'path')
    return grow
      ? `<path d="${s.d}" fill="${color}" stroke="${color}" stroke-width="${n(2 * grow)}" stroke-linejoin="round"/>`
      : `<path d="${s.d}" fill="${color}"/>`;
  if (s.t === 'circle') return `<circle cx="${n(s.c[0])}" cy="${n(s.c[1])}" r="${n(s.r + grow)}" fill="${color}"/>`;
  if (s.t === 'ellipse')
    return `<ellipse cx="${n(s.c[0])}" cy="${n(s.c[1])}" rx="${n(s.rx + grow)}" ry="${n(s.ry + grow)}" transform="rotate(${n(s.deg)} ${P(s.c)})" fill="${color}"/>`;
  return `<line x1="${n(s.a[0])}" y1="${n(s.a[1])}" x2="${n(s.b[0])}" y2="${n(s.b[1])}" stroke="${color}" stroke-width="${n(2 * (s.r + grow))}" stroke-linecap="round"/>`;
}
const group = (shapes, ow = OUTLINE, fill = COL.body) =>
  shapes.map((s) => shapeSVG(s, ow, COL.line)).join('') + shapes.map((s) => shapeSVG(s, 0, fill)).join('');

// ---------------- 劍：hand＝握把中心，angle＝劍尖方向，k＝縮放 ----------------
function swordSVG(hand, angle, k = 1) {
  const u = dir(angle), v = perp(u);
  const Q = (a, b = 0) => add(add(hand, u, a * k), v, b * k);
  const w = (x) => n(x * k);
  const seg = (a, b, width, color, lc = 'round') =>
    `<line x1="${n(Q(a)[0])}" y1="${n(Q(a)[1])}" x2="${n(Q(b)[0])}" y2="${n(Q(b)[1])}" stroke="${color}" stroke-width="${w(width)}" stroke-linecap="${lc}"/>`;
  const dot = (a, b, r, fill, stroke = 'none', sw = 0) =>
    `<circle cx="${n(Q(a, b)[0])}" cy="${n(Q(a, b)[1])}" r="${w(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${w(sw)}"/>`;
  return (
    seg(-12, 15, 10, COL.line) + seg(-12, 15, 5.5, COL.grip) +
    dot(-16, 0, 5, COL.guard, COL.line, 2) +
    `<path d="${poly([Q(25, 6.5), Q(123, 6.5), Q(140, 0), Q(123, -6.5), Q(25, -6.5)], true)}" fill="${COL.blade}" stroke="${COL.line}" stroke-width="${w(2.4)}" stroke-linejoin="round"/>` +
    seg(29, 120, 1.8, COL.ridge, 'butt') +
    `<path d="${poly([Q(17, -22), Q(25, -22), Q(23.5, -15), Q(23.5, 15), Q(25, 22), Q(17, 22), Q(18.5, 15), Q(18.5, -15)], true)}" fill="${COL.guard}" stroke="${COL.line}" stroke-width="${w(2)}" stroke-linejoin="round"/>` +
    dot(21, 0, 6, COL.guardDark, COL.line, 1.5) + dot(21, 0, 3.8, COL.gem) + dot(22.2, -1.3, 1.2, COL.gemHi)
  );
}

// ---------------- 斬擊軌跡（fx 圖層）：從 from 掃到 to，尾端細、前端粗 ----------------
function smearSVG(center, from, to, r1 = 176, width = 44) {
  const N = 32, outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = from + (to - from) * t;
    const wd = Math.max(0.6, width * Math.pow(Math.sin((Math.PI / 2) * t), 1.6));
    outer.push(add(center, dir(a), r1));
    inner.push(add(center, dir(a), r1 - wd));
  }
  const d = poly(outer) + ' L ' + inner.reverse().map(P).join(' L ') + ' Z';
  return `<path d="${d}" fill="${COL.fx}" fill-opacity="0.92" stroke="${COL.fxLine}" stroke-width="2.5" stroke-linejoin="round"/>`;
}

// ---------------- 臉 ----------------
/** slant：生氣眼皮往哪邊下斜（+1＝往 +x）；flip：hurt 的 > < 方向 */
function eyeSVG(kind, c, w, h, k = 1, slant = 1, flip = 1) {
  const [x, y] = c;
  const sw = (v) => n(v * k);
  const stroke = (d, width = 2.4) =>
    `<path d="${d}" fill="none" stroke="${COL.line}" stroke-width="${sw(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const box = (top, bottom) =>
    `<rect x="${n(x - w / 2)}" y="${n(top)}" width="${n(w)}" height="${n(bottom - top)}" rx="${n(Math.min(w / 2.2, 4 * k))}" fill="${COL.eye}" stroke="${COL.line}" stroke-width="${sw(1.6)}"/>`;
  const o = 2 * k;
  switch (kind) {
    case 'open':
      return box(y - h / 2, y + h / 2) + stroke(poly([[x - w / 2 - o, y - h / 2], [x + w / 2 + o, y - h / 2]]), 2.6);
    case 'half':
      return box(y - h / 6, y + h / 2) + stroke(poly([[x - w / 2 - o, y - h / 6], [x + w / 2 + o, y - h / 6]]), 2.6);
    case 'angry': {
      const d = 6 * k * slant;
      return box(y - h / 2 + Math.abs(d) * 0.7, y + h / 2) +
        stroke(poly([[x - w / 2 - o, y - h / 2 - d / 2], [x + w / 2 + o, y - h / 2 + d / 2]]), 2.8);
    }
    case 'wide':
      return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(w / 2 + k)}" ry="${n(h / 2 + 2 * k)}" fill="${COL.eye}" stroke="${COL.line}" stroke-width="${sw(1.6)}"/>` +
        `<circle cx="${n(x - w / 6)}" cy="${n(y - h / 5)}" r="${n(w / 6)}" fill="#ffffff"/>`;
    case 'closed':
      return stroke(`M ${P([x - w / 2 - k, y])} Q ${P([x, y + 5 * k])} ${P([x + w / 2 + k, y])}`);
    case 'happy':
      return stroke(`M ${P([x - w / 2 - k, y + 3 * k])} Q ${P([x, y - 7 * k])} ${P([x + w / 2 + k, y + 3 * k])}`);
    case 'hurt':
      return stroke(poly([[x - (w / 2) * flip, y - 5 * k], [x + (w / 2) * flip, y], [x - (w / 2) * flip, y + 5 * k]]));
    case 'ko':
      return stroke(poly([[x - 4 * k, y - 4 * k], [x + 4 * k, y + 4 * k]])) + stroke(poly([[x - 4 * k, y + 4 * k], [x + 4 * k, y - 4 * k]]));
  }
  return '';
}

function mouthSVG(kind, c, k = 1) {
  const [x, y] = c;
  const s = (v) => n(v * k);
  const line = (d) => `<path d="${d}" fill="none" stroke="${COL.line}" stroke-width="${s(2.2)}" stroke-linecap="round"/>`;
  switch (kind) {
    case 'smile': return line(`M ${P([x - 5 * k, y])} Q ${P([x, y + 4 * k])} ${P([x + 5 * k, y])}`);
    case 'frown': return line(`M ${P([x - 5 * k, y + 3 * k])} Q ${P([x, y - 2 * k])} ${P([x + 5 * k, y + 3 * k])}`);
    case 'flat': return line(`M ${P([x - 4 * k, y + k])} L ${P([x + 4 * k, y + k])}`);
    case 'open':
      return `<path d="M ${P([x - 5 * k, y])} L ${P([x + 5 * k, y])} Q ${P([x + 5 * k, y + 7 * k])} ${P([x, y + 7 * k])} Q ${P([x - 5 * k, y + 7 * k])} ${P([x - 5 * k, y])} Z" fill="${COL.dark}" stroke="${COL.line}" stroke-width="${s(1.6)}" stroke-linejoin="round"/>`;
    case 'o':
      return `<ellipse cx="${n(x)}" cy="${n(y + 2 * k)}" rx="${s(3.2)}" ry="${s(4)}" fill="${COL.dark}" stroke="${COL.line}" stroke-width="${s(1.6)}"/>`;
  }
  return '';
}

function ahogeSVG(top, k = 1) {
  const b = [top[0] - 2 * k, top[1] + 4 * k];
  return `<path d="M ${P(b)} C ${P([b[0] - 4 * k, b[1] - 20 * k])} ${P([b[0] + 18 * k, b[1] - 28 * k])} ${P([b[0] + 15 * k, b[1] - 13 * k])}" fill="none" stroke="${COL.line}" stroke-width="${n(2.6 * k)}" stroke-linecap="round"/>`;
}

// ---------------- 主角（側面、面向右；座標原點＝腳底 pivot，+x 前方、+y 向下） ----------------
const DEF = {
  hip: [0, -50],
  torso: { c: [0, -92], rx: 34, ry: 52 },
  head: { c: [6, -176], r: 46 },
  shF: [3, -128], shB: [-6, -126],
  arm: { len: 42, r: 13 },
  hipF: [7, -50], hipB: [-5, -50],
  leg: { len: 31, r: 16 },
  spin: [0, -110],
};
const BASE = {
  lean: 0, squash: 1, spin: 0, fall: 0, ox: 0, oy: 0, headTilt: 0, headY: 0,
  armF: 20, armB: -12, legF: 4, legB: -4,
  sword: 62, swordOn: true, swordBehind: false, armBack: false,
  eyes: 'open', mouth: 'smile', smear: null, grounded: true,
};

function heroParts(pose) {
  const p = { ...BASE, ...pose };
  const up = (q) => rot(q, DEF.hip, p.lean);
  const headC = up(add(DEF.head.c, [0, p.headY]));
  const torsoC = up(DEF.torso.c);
  const shF = up(DEF.shF), shB = up(DEF.shB);
  const handF = add(shF, dir(p.armF), DEF.arm.len);
  const handB = add(shB, dir(p.armB), DEF.arm.len);
  const footF = add(DEF.hipF, dir(p.legF), DEF.leg.len);
  const footB = add(DEF.hipB, dir(p.legB), DEF.leg.len);
  const [hx, hy] = headC;

  const face =
    `<g transform="rotate(${n(p.headTilt)} ${P(headC)})">` +
    ahogeSVG([hx, hy - DEF.head.r]) +
    eyeSVG(p.eyes, [hx + 8, hy - 4], 7, 18, 1, 1, 1) +
    eyeSVG(p.eyes, [hx + 26, hy - 4], 10, 18, 1, 1, -1) +
    mouthSVG(p.mouth, [hx + 27, hy + 19]) +
    '</g>';
  const sword = p.swordOn ? swordSVG(handF, p.sword) : '';
  const backLimbs = group([cap(shB, handB, DEF.arm.r)]) + group([cap(DEF.hipB, footB, DEF.leg.r)]);
  const core = group([
    ellipse(torsoC, DEF.torso.rx, DEF.torso.ry, p.lean),
    circle(headC, DEF.head.r),
    cap(DEF.hipF, footF, DEF.leg.r),
  ]);
  const frontArm = group([cap(shF, handF, DEF.arm.r)]);
  // armBack：手舉過頭時把前手（和劍）畫在頭與身體後面，避免擋住臉
  const body = p.armBack
    ? backLimbs + sword + frontArm + core + face
    : (p.swordBehind ? sword : '') + backLimbs + core + face + (p.swordBehind ? '' : sword) + frontArm;
  const bodyNoSword = p.armBack ? backLimbs + frontArm + core + face : backLimbs + core + face + frontArm;
  return {
    p, body, bodyNoSword,
    fx: p.smear ? smearSVG(shF, ...p.smear) : null,
  };
}

function heroTransform(p, oy) {
  const sy = p.squash, sx = 1 + (1 - p.squash) * 0.6;
  return `translate(${n(HERO.px + p.ox)} ${n(HERO.py + oy)}) rotate(${n(p.fall)}) rotate(${n(p.spin)} ${P(DEF.spin)}) scale(${n(sx)} ${n(sy)})`;
}
const svgDoc = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
const heroDoc = (inner, p, oy) => svgDoc(HERO.w, HERO.h, `<g transform="${heroTransform(p, oy)}">${inner}</g>`);
const toPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

async function lowestOpaqueRow(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) if (data[row + x * channels + 3] >= ALPHA) return y;
  }
  return -1;
}
const GROUND_ROW = HERO.py * SCALE - 1; // 2x 時地平線正上方那一列

async function renderHeroFrame(pose, label) {
  const { p, body, bodyNoSword, fx } = heroParts(pose);
  let oy = p.oy;
  if (p.grounded) {
    for (let i = 0; i < 5; i++) {
      const low = await lowestOpaqueRow(heroDoc(bodyNoSword, p, oy));
      if (low < 0 || low === GROUND_ROW) break;
      oy += (GROUND_ROW - low) / SCALE;
    }
  }
  const doc = heroDoc(body, p, oy);
  if (p.grounded) {
    const low = await lowestOpaqueRow(doc);
    if (low !== GROUND_ROW) console.warn(`⚠ ${label}：最下緣在第 ${low} 列（應為 ${GROUND_ROW}）`);
  }
  return { p, oy, png: await toPng(doc), fxPng: fx ? await toPng(heroDoc(fx, p, oy)) : null };
}

// ---------------- 動作資料：改姿勢就改這裡 ----------------
const A = (frames, opts = {}) => ({ loop: false, ...opts, frames });
const F = (hold, pose = {}, extra = {}) => ({ hold, pose, ...extra });
const ATK = { eyes: 'angry', mouth: 'flat' };
const S = 'startup', ACT = 'active', REC = 'recovery';

const ACTIONS = {
  idle: A([
    F(4, {}),
    F(4, { squash: 0.985, armF: 22, armB: -10, sword: 63, headY: 1 }),
    F(4, { squash: 0.975, armF: 24, armB: -8, sword: 64, headY: 2 }),
    F(4, { squash: 0.985, armF: 22, armB: -10, sword: 63, headY: 1 }),
  ], { loop: true }),
  doze_in: A([
    F(3, { eyes: 'half', headTilt: 8, squash: 0.985, armF: 14, sword: 58 }),
    F(3, { eyes: 'closed', headTilt: 16, squash: 0.97, armF: 8, sword: 56, lean: 4 }),
    F(4, { eyes: 'closed', mouth: 'o', headTilt: 22, squash: 0.96, armF: 4, sword: 55, lean: 6 }),
  ]),
  doze: A([
    F(8, { eyes: 'closed', mouth: 'o', headTilt: 22, squash: 0.96, armF: 4, sword: 55, lean: 6 }),
    F(8, { eyes: 'closed', mouth: 'o', headTilt: 25, squash: 0.95, armF: 3, sword: 56, lean: 7, headY: 2 }),
  ], { loop: true }),
  wake: A([
    F(1, { eyes: 'wide', mouth: 'o', squash: 1.06, armF: 45, armB: -35, sword: 85, headTilt: -6 }),
    F(1, {}),
  ]),
  walk: A(
    [25, 12, -10, -25, -12, 10].map((lf, i) =>
      F(1, { lean: 4, legF: lf, legB: -lf, armB: lf * 0.8 - 4, armF: 20 + (i % 3) * 2, sword: 62 + (i % 3) })),
    { loop: true },
  ),
  run: A(
    [40, 18, -22, -42, -18, 22].map((lf, i) =>
      F(1, { lean: 14, legF: lf, legB: -lf, armB: lf, armF: -25, sword: -58, headY: i % 3 === 0 ? 1 : 0 })),
    { loop: true },
  ),
  jump: A([
    F(1, { squash: 0.86, lean: 6, legF: 12, legB: -12, armF: 10, armB: -35, sword: 57 }, { role: 'takeoff' }),
    F(1, { squash: 1.08, legF: -10, legB: -28, armF: 70, armB: 130, sword: 105, grounded: false }, { role: 'rise' }),
    F(1, { legF: 35, legB: -15, armF: 80, armB: 150, sword: 115, grounded: false }, { role: 'apex' }),
    F(1, { armBack: true, squash: 1.04, legF: 8, legB: -2, armF: 125, armB: 160, sword: 140, mouth: 'o', grounded: false }, { role: 'fall' }),
    F(1, { squash: 0.86, lean: 8, legF: 16, legB: -16, armF: 22, armB: -22, sword: 60 }, { role: 'land' }),
  ], { select: 'by-velocity' }),
  double_jump: A(
    [0, 120, 240].map((s) =>
      F(1, { spin: s, oy: -90, legF: 60, legB: 40, armF: 95, armB: 120, sword: 100, squash: 0.95, grounded: false })),
  ),
  x1: A([
    F(1, { armBack: true, ...ATK, armF: 135, armB: -30, sword: 165, lean: -4 }, { phase: S }),
    F(1, { ...ATK, armF: 100, armB: -40, sword: 100, lean: 6, smear: [170, 100] }, { phase: ACT }),
    F(1, { ...ATK, armF: 60, armB: -40, sword: 48, lean: 10, smear: [135, 48] }, { phase: ACT }),
    F(2, { ...ATK, armF: 40, armB: -25, sword: 52, lean: 6 }, { phase: REC }),
  ]),
  x2: A([
    F(1, { ...ATK, squash: 0.95, armF: 20, armB: -30, sword: 57, lean: 4 }, { phase: S }),
    F(1, { ...ATK, armF: 100, armB: -40, sword: 110, smear: [57, 110] }, { phase: ACT }),
    F(1, { armBack: true, ...ATK, armF: 150, armB: -30, sword: 168, lean: -4, smear: [80, 168] }, { phase: ACT }),
    F(2, { armBack: true, ...ATK, armF: 130, armB: -20, sword: 145, lean: -2 }, { phase: REC }),
  ]),
  x3: A([
    F(2, { armBack: true, ...ATK, armF: 175, armB: -50, sword: 205, lean: -8, squash: 0.96, swordBehind: true }, { phase: S }),
    F(1, { ...ATK, armF: 120, armB: -60, sword: 120, lean: 14, smear: [215, 120, 182, 54] }, { phase: ACT }),
    F(1, { ...ATK, armF: 90, armB: -60, sword: 85, lean: 18, legF: 22, legB: -22, smear: [160, 85, 182, 54] }, { phase: ACT }),
    F(2, { ...ATK, armF: 80, armB: -50, sword: 75, lean: 16, legF: 22, legB: -22 }, { phase: REC }),
    F(2, { ...ATK, armF: 50, armB: -30, sword: 60, lean: 8, legF: 12, legB: -12 }, { phase: REC }),
  ]),
  c_dash: A([
    F(1, { ...ATK, squash: 0.92, lean: -10, armF: -40, armB: 40, sword: -80, swordBehind: true, legF: 20, legB: -20 }, { phase: S }),
    F(2, { ...ATK, lean: 28, armF: 90, armB: -70, sword: 90, legF: -25, legB: -55, grounded: false }, { phase: ACT }),
    F(2, { ...ATK, lean: 10, armF: 60, armB: -30, sword: 70, legF: 20, legB: -20, squash: 0.95 }, { phase: REC }),
  ]),
  a_slash: A([
    F(1, { armBack: true, ...ATK, armF: 170, armB: -20, sword: 180, squash: 1.04 }, { phase: S }),
    F(1, { armBack: true, ...ATK, armF: 200, armB: -10, sword: 222, lean: -10, squash: 0.96, swordBehind: true }, { phase: S }),
    F(1, { ...ATK, armF: 120, armB: -60, sword: 110, lean: 12, legF: 18, legB: -18, smear: [228, 110, 186, 62] }, { phase: ACT }),
    F(1, { ...ATK, armF: 75, armB: -60, sword: 62, lean: 20, legF: 24, legB: -24, smear: [170, 62, 186, 62] }, { phase: ACT }),
    F(2, { ...ATK, armF: 65, armB: -50, sword: 58, lean: 18, legF: 24, legB: -24, squash: 0.96 }, { phase: REC }),
  ]),
  s_throw: A([
    F(2, { armBack: true, ...ATK, armF: 200, armB: -20, sword: 225, lean: -8, swordBehind: true }),
    F(1, { ...ATK, armF: 100, armB: -60, sword: 95, lean: 12 }),
    F(2, { ...ATK, armF: 92, armB: -50, swordOn: false, lean: 10 }),
  ]),
  s_control: A([
    F(3, { ...ATK, mouth: 'smile', armF: 100, armB: 112, swordOn: false, lean: 4 }),
    F(3, { ...ATK, mouth: 'smile', armF: 106, armB: 118, swordOn: false, lean: 4, headY: 1 }),
  ], { loop: true }),
  s_catch: A([
    F(1, { armBack: true, eyes: 'wide', mouth: 'o', armF: 140, armB: -20, swordOn: false }),
    F(2, { armF: 30, sword: 62 }),
  ]),
  d_slash: A([
    F(1, { ...ATK, squash: 0.9, armF: 12, armB: -30, sword: 62, lean: 6 }, { phase: S }),
    F(1, { ...ATK, armF: 95, armB: -40, sword: 105, smear: [62, 105, 196, 58] }, { phase: ACT }),
    F(1, { armBack: true, ...ATK, squash: 1.04, armF: 182, armB: -20, sword: 205, lean: -4, smear: [75, 205, 196, 58] }, { phase: ACT }),
    F(2, { armBack: true, ...ATK, squash: 1.02, armF: 165, armB: -15, sword: 180, lean: -2 }, { phase: REC }),
  ]),
  hurt: A([
    F(2, { armBack: true, eyes: 'hurt', mouth: 'open', lean: -16, armF: 150, armB: 170, sword: 160, squash: 1.02, ox: -6 }),
    F(2, { eyes: 'hurt', mouth: 'open', lean: -8, armF: 105, armB: 140, sword: 118, squash: 0.98, ox: -3 }),
  ]),
  death: A([
    F(2, { armBack: true, eyes: 'hurt', mouth: 'open', lean: -18, armF: 150, armB: 165, sword: 165, ox: -6 }),
    F(2, { eyes: 'closed', mouth: 'o', squash: 0.85, lean: 16, headTilt: 15, armF: 10, armB: -10, sword: 62 }),
    F(2, { eyes: 'ko', mouth: 'o', fall: -50, armF: 120, armB: 150, sword: 140, legF: 20, legB: 10 }),
    F(6, { eyes: 'ko', mouth: 'o', fall: -90, armF: 150, armB: 170, sword: 160, legF: 10, legB: 0 }),
  ]),
};

// ---------------- 雜兵 A 小兵（側面、面向右；座標原點＝腳底 pivot，+x 前方、+y 向下） ----------------
const GRUNT = { w: 256, h: 256, px: 128, py: 236 };
const GRUNT_COL = { body: '#e9915f', belly: '#f7c9a4', horn: '#fff1d6' };

/** lean＝身體前後傾（度，負＝往後仰）；squash＝上下壓扁；feet＝兩腳前後位移；eyes＝open／hurt／dead */
function gruntSVG({ lean = 0, squash = 1, feet = [0, 0], eyes = 'open' }) {
  const h = 58 * squash, by = -12 - h;
  const body = [
    ellipse([-24 + feet[0], -10], 20, 10),
    ellipse([24 + feet[1], -10], 20, 10),
    ellipse([0, by], 66, h),
  ];
  const horn = [shape(poly([[-16, by - h + 8], [-2, by - h - 26], [12, by - h + 6]], true))];
  const ex = 30, ey = by - h * 0.25, k = squash;
  const stroke = (d) => `<path d="${d}" fill="none" stroke="${COL.line}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  let face;
  if (eyes === 'open') {
    face = [ex, ex + 24].map((x) =>
      `<ellipse cx="${x}" cy="${n(ey)}" rx="8" ry="${n(11 * k)}" fill="#ffffff" stroke="${COL.line}" stroke-width="3"/>` +
      `<circle cx="${x + 3}" cy="${n(ey + 2 * k)}" r="4.5" fill="${COL.line}"/>`).join('') +
      stroke(poly([[ex - 9, ey - 16 * k], [ex + 8, ey - 11 * k]])) + stroke(poly([[ex + 16, ey - 11 * k], [ex + 33, ey - 16 * k]]));
  } else if (eyes === 'hurt') {
    face = stroke(poly([[ex - 7, ey - 8], [ex + 5, ey], [ex - 7, ey + 8]])) + stroke(poly([[ex + 31, ey - 8], [ex + 19, ey], [ex + 31, ey + 8]]));
  } else {
    face = [ex, ex + 24].map((x) => stroke(`M ${x - 6},${n(ey - 6 * k)} L ${x + 6},${n(ey + 6 * k)} M ${x + 6},${n(ey - 6 * k)} L ${x - 6},${n(ey + 6 * k)}`)).join('');
  }
  const mouth = stroke(poly([[ex + 2, by + h * 0.25], [ex + 22, by + h * 0.25]]));
  const belly = `<ellipse cx="14" cy="${n(by + h * 0.35)}" rx="34" ry="${n(h * 0.45)}" fill="${GRUNT_COL.belly}"/>`;
  return {
    lean,
    inner: group(horn, OUTLINE, GRUNT_COL.horn) + group(body, OUTLINE, GRUNT_COL.body) + belly + face + mouth,
  };
}

const gruntDoc = ({ lean, inner }, oy) =>
  svgDoc(GRUNT.w, GRUNT.h, `<g transform="translate(${GRUNT.px} ${n(GRUNT.py + oy)}) rotate(${n(lean)} 0 -10)">${inner}</g>`);

/** 貼地：和主角一樣，最下緣不透明像素剛好碰到地平線 */
async function renderGruntFrame(pose, label) {
  const g = gruntSVG(pose);
  const groundRow = GRUNT.py * SCALE - 1;
  let oy = 0;
  for (let i = 0; i < 5; i++) {
    const low = await lowestOpaqueRow(gruntDoc(g, oy));
    if (low < 0 || low === groundRow) break;
    oy += (groundRow - low) / SCALE;
  }
  const doc = gruntDoc(g, oy);
  const low = await lowestOpaqueRow(doc);
  if (low !== groundRow) console.warn(`⚠ ${label}：最下緣在第 ${low} 列（應為 ${groundRow}）`);
  return toPng(doc);
}

const GRUNT_ACTIONS = {
  idle: A([F(6), F(6, { squash: 0.95 })], { loop: true }),
  move: A([F(2, { feet: [8, -8], lean: 4 }), F(2, { squash: 0.96 }), F(2, { feet: [-8, 8], lean: 4 }), F(2, { squash: 0.96 })], { loop: true }),
  hurt: A([F(2, { lean: -14, eyes: 'hurt' }), F(2, { lean: -7, eyes: 'hurt' })]),
  death: A([F(2, { lean: -14, eyes: 'hurt' }), F(2, { squash: 0.7, eyes: 'dead' }), F(4, { squash: 0.4, eyes: 'dead' })]),
};

// ---------------- 特效（各自的畫布與 pivot） ----------------
function waveSVG(k) {
  const W = 256, cy = 128, ox = 112 + k * 4, or = 100 + k * 3, ix = 84 - k * 3, ir = 98;
  const lines = [90, 128, 166].map((y, i) => {
    const x0 = 14 + k * 10 + (i === 1 ? 0 : 12);
    return `<line x1="${x0}" y1="${y}" x2="${x0 + 46}" y2="${y}" stroke="${COL.fxLine}" stroke-width="3" stroke-linecap="round" stroke-opacity="0.7"/>`;
  }).join('');
  return (
    `<defs><mask id="cut"><rect width="${W}" height="${W}" fill="#fff"/><circle cx="${ix}" cy="${cy}" r="${ir}" fill="#000"/></mask>` +
    `<clipPath id="outer"><circle cx="${ox}" cy="${cy}" r="${or}"/></clipPath></defs>` +
    lines +
    `<circle cx="${ox}" cy="${cy}" r="${or}" fill="${COL.fx}" stroke="${COL.fxLine}" stroke-width="3" mask="url(#cut)"/>` +
    `<circle cx="${ix}" cy="${cy}" r="${ir}" fill="none" stroke="${COL.fxLine}" stroke-width="3" clip-path="url(#outer)"/>`
  );
}

function stormSVG(angle) {
  const c = 160;
  let s = `<circle cx="${c}" cy="${c}" r="150" fill="${COL.glow}" fill-opacity="0.35" stroke="${COL.fxLine}" stroke-width="3"/>`;
  for (let i = 0; i < 3; i++) {
    const pts = [];
    for (let j = 0; j <= 24; j++) {
      const t = j / 24, r = 26 + 112 * t, a = rad(angle + i * 120 + 210 * t);
      pts.push([c + r * Math.cos(a), c + r * Math.sin(a)]);
    }
    const d = poly(pts);
    s += `<path d="${d}" fill="none" stroke="${COL.fxLine}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const a = rad(angle * 1.5 + i * 60 + 20);
    s += `<circle cx="${n(c + 128 * Math.cos(a))}" cy="${n(c + 128 * Math.sin(a))}" r="4" fill="${COL.fxLine}"/>`;
  }
  return s;
}

/** A 的長條劍氣：start（靠主角）＋ mid（可無縫重複）＋ end（遠端圓頭）；高 240，pivot＝左側中點 */
function beamSVG(part) {
  const W = part === 'mid' ? 256 : 128;
  const edges = `<line x1="0" y1="65" x2="${W}" y2="65" stroke="${COL.fxLine}" stroke-width="3"/><line x1="0" y1="175" x2="${W}" y2="175" stroke="${COL.fxLine}" stroke-width="3"/>`;
  const band = `<rect x="0" y="0" width="${W}" height="240" fill="${COL.glow}" fill-opacity="0.5"/><rect x="0" y="65" width="${W}" height="110" fill="#ffffff"/>`;
  if (part === 'mid') return band + edges;
  if (part === 'start')
    return `<defs><linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
      `<mask id="m"><rect width="${W}" height="240" fill="url(#fade)"/></mask></defs><g mask="url(#m)">${band}${edges}</g>`;
  return `<path d="M 0 0 L 8 0 A 120 120 0 0 1 8 240 L 0 240 Z" fill="${COL.glow}" fill-opacity="0.5"/>` +
    `<path d="M 0 65 L 10 65 A 70 55 0 0 1 10 175 L 0 175 Z" fill="#ffffff"/>` +
    `<path d="M 0 65 L 10 65 A 70 55 0 0 1 10 175 L 0 175" fill="none" stroke="${COL.fxLine}" stroke-width="3"/>`;
}

// ---------------- 立繪（正面，分層：body／eyes／mouth，同一張畫布） ----------------
const PORTRAIT = { w: 640, h: 960 };
const PT = { head: [318, 214], eyeL: [300, 240], eyeR: [392, 240], mouth: [344, 306], hand: [90, 596] };
function portraitBodySVG() {
  return (
    group([
      shape('M 250,300 C 214,380 196,520 198,650 C 200,760 250,802 322,802 C 394,802 446,760 446,650 C 448,520 430,380 394,300 Z'),
      circle(PT.head, 118),
      cap([230, 385], PT.hand, 46),
      cap([414, 385], [554, 596], 46),
      cap([268, 760], [256, 872], 60),
      cap([378, 760], [390, 872], 60),
    ], 5) +
    `<path d="M 300 98 C 290 52 350 28 374 52 C 384 62 386 76 380 86" fill="none" stroke="${COL.line}" stroke-width="5.5" stroke-linecap="round"/>` +
    swordSVG(PT.hand, 59.2, 3.0) +
    group([circle(PT.hand, 40)], 5)
  );
}
const PORTRAIT_EYES = ['open', 'happy', 'angry', 'wide'];
const PORTRAIT_MOUTHS = ['smile', 'open', 'frown', 'o'];
const portraitEyes = (k) => eyeSVG(k, PT.eyeL, 34, 58, 3.2, 1) + eyeSVG(k, PT.eyeR, 34, 58, 3.2, -1);
const portraitMouth = (k) => mouthSVG(k, PT.mouth, 2.2);
const EXPRESSIONS = {
  normal: { eyes: 'eyes_open', mouth: 'mouth_smile' },
  happy: { eyes: 'eyes_happy', mouth: 'mouth_open' },
  angry: { eyes: 'eyes_angry', mouth: 'mouth_frown' },
  surprised: { eyes: 'eyes_wide', mouth: 'mouth_o' },
};

function iconSVG() {
  const c = [32, 37], r = 20;
  return group([circle(c, r)], 2.5) + ahogeSVG([c[0], c[1] - r], 0.5) +
    eyeSVG('open', [c[0] - 4, c[1] + 1], 5, 9, 0.5, 1) + eyeSVG('open', [c[0] + 7, c[1] + 1], 5, 9, 0.5, -1) +
    mouthSVG('smile', [c[0] + 3, c[1] + 10], 0.55);
}

// ---------------- 輸出 ----------------
const MARKER = '.generated';
const exists = (p) => access(p).then(() => true, () => false);
async function prepareOut() {
  if (await exists(OUT)) {
    if (!(await exists(path.join(OUT, MARKER)))) {
      console.error(`${OUT} 已存在但不是產生器建立的（沒有 ${MARKER}），為了安全不清空；請換資料夾或手動處理`);
      process.exit(1);
    }
    await rm(OUT, { recursive: true, force: true });
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, MARKER), '由 tools/placeholder/gen-hero.mjs 產生；重跑時整個資料夾會被清空重建，不要把手繪放在這裡\n');
}
let count = 0;
async function put(rel, buf) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  if (rel.endsWith('.png') && !rel.startsWith('_')) count++;
}
const putJson = (rel, obj) => put(rel, JSON.stringify(obj, null, 2) + '\n');
const id2 = (i) => String(i).padStart(2, '0');

async function main() {
  await prepareOut();

  const rendered = {};
  for (const [name, act] of Object.entries(ACTIONS)) {
    const frames = [];
    rendered[name] = [];
    for (const [i, fr] of act.frames.entries()) {
      const file = `${name}_${id2(i)}`;
      const r = await renderHeroFrame(fr.pose, file);
      await put(`hero/${name}/${file}.png`, r.png);
      const meta = { file, hold: fr.hold, grounded: r.p.grounded };
      if (fr.phase) meta.phase = fr.phase;
      if (fr.role) meta.role = fr.role;
      if (r.fxPng) {
        meta.fx = `${name}_fx_${id2(i)}`;
        await put(`hero/${name}/fx/${meta.fx}.png`, r.fxPng);
      }
      frames.push(meta);
      rendered[name].push({ ...r, meta });
    }
    await putJson(`hero/${name}/meta.json`, {
      canvas: [HERO.w, HERO.h], pivot: [HERO.px, HERO.py], scale: SCALE, fps: FPS, loop: !!act.loop,
      ...(act.select ? { select: act.select } : {}), frames,
    });
  }

  for (const [name, act] of Object.entries(GRUNT_ACTIONS)) {
    const frames = [];
    for (const [i, fr] of act.frames.entries()) {
      const file = `${name}_${id2(i)}`;
      await put(`enemies/grunt/${name}/${file}.png`, await renderGruntFrame(fr.pose, `grunt/${file}`));
      frames.push({ file, hold: fr.hold, grounded: true });
    }
    await putJson(`enemies/grunt/${name}/meta.json`, {
      canvas: [GRUNT.w, GRUNT.h], pivot: [GRUNT.px, GRUNT.py], scale: SCALE, fps: FPS, loop: !!act.loop, frames,
    });
  }

  const effects = {
    x3_wave: { canvas: [256, 256], pivot: [128, 128], loop: true, frames: [waveSVG(0), waveSVG(1)] },
    d_storm: { canvas: [320, 320], pivot: [160, 160], loop: true, frames: [0, 40, 80].map(stormSVG) },
    s_sword: { canvas: [192, 48], pivot: [96, 24], loop: false, frames: [swordSVG([40, 24], 90)] },
  };
  const fxPngs = {};
  for (const [name, e] of Object.entries(effects)) {
    fxPngs[name] = [];
    for (const [i, svg] of e.frames.entries()) {
      const buf = await toPng(svgDoc(e.canvas[0], e.canvas[1], svg));
      await put(`effects/${name}/${name}_${id2(i)}.png`, buf);
      fxPngs[name].push(buf);
    }
    await putJson(`effects/${name}/meta.json`, {
      canvas: e.canvas, pivot: e.pivot, scale: SCALE, fps: FPS, loop: e.loop,
      frames: e.frames.map((_, i) => ({ file: `${name}_${id2(i)}`, hold: 1 })),
    });
  }
  const beam = {};
  for (const part of ['start', 'mid', 'end']) {
    const w = part === 'mid' ? 256 : 128;
    beam[part] = await toPng(svgDoc(w, 240, beamSVG(part)));
    await put(`effects/a_beam/a_beam_${part}.png`, beam[part]);
  }
  await putJson('effects/a_beam/meta.json', {
    scale: SCALE, note: 'start＋mid×N＋end 由左到右排；mid 可無縫重複；全部 pivot＝左側中點',
    parts: {
      start: { file: 'a_beam_start', canvas: [128, 240], pivot: [0, 120] },
      mid: { file: 'a_beam_mid', canvas: [256, 240], pivot: [0, 120] },
      end: { file: 'a_beam_end', canvas: [128, 240], pivot: [0, 120] },
    },
  });

  const portrait = { body: await toPng(svgDoc(PORTRAIT.w, PORTRAIT.h, portraitBodySVG())) };
  await put('portrait/body.png', portrait.body);
  for (const k of PORTRAIT_EYES) {
    portrait[`eyes_${k}`] = await toPng(svgDoc(PORTRAIT.w, PORTRAIT.h, portraitEyes(k)));
    await put(`portrait/eyes_${k}.png`, portrait[`eyes_${k}`]);
  }
  for (const k of PORTRAIT_MOUTHS) {
    portrait[`mouth_${k}`] = await toPng(svgDoc(PORTRAIT.w, PORTRAIT.h, portraitMouth(k)));
    await put(`portrait/mouth_${k}.png`, portrait[`mouth_${k}`]);
  }
  await putJson('portrait/meta.json', {
    canvas: [PORTRAIT.w, PORTRAIT.h], anchor: [320, 960], scale: SCALE,
    note: '所有圖層同一張畫布，直接疊：body → eyes → mouth', expressions: EXPRESSIONS,
  });

  const cutin = await toPng(svgDoc(960, 480,
    `<g transform="translate(80 -20) scale(1.25)">${portraitBodySVG()}${portraitEyes('angry')}${portraitMouth('open')}</g>`));
  await put('cutin/cutin_00.png', cutin);
  await putJson('cutin/meta.json', { canvas: [960, 480], anchor: [480, 240], scale: SCALE });

  const icon = await toPng(svgDoc(64, 64, iconSVG()));
  await put('icon/map_icon.png', icon);
  await putJson('icon/meta.json', { canvas: [64, 64], pivot: [32, 32], scale: SCALE });

  if (WANT_SHEET) await sheets(rendered, fxPngs, beam, portrait, cutin);
  console.log(`完成：${count} 張 PNG → ${OUT}`);
}

// ---------------- 預覽總表（--sheet）；判定框直接讀遊戲用的 src/data/hitboxes.json ----------------
const HB = JSON.parse(await readFile(new URL('../../src/data/hitboxes.json', import.meta.url), 'utf8'));
function boxSVG(b, stroke, fill, sw) {
  const paint = `fill="${fill}" fill-opacity="0.15" stroke="${stroke}" stroke-width="${sw}"`;
  if (b.type === 'rect') return `<rect x="${HERO.px + b.x}" y="${HERO.py + b.y}" width="${b.w}" height="${b.h}" ${paint}/>`;
  const cx = HERO.px + b.cx, cy = HERO.py + b.cy;
  if (!b.arc) return `<circle cx="${cx}" cy="${cy}" r="${b.r}" ${paint}/>`;
  // arc＝[起, 迄] 度：0＝正前方、90＝正上方；SVG 的 y 朝下
  const pt = (d) => `${cx + b.r * Math.cos((d * Math.PI) / 180)} ${cy - b.r * Math.sin((d * Math.PI) / 180)}`;
  const large = b.arc[1] - b.arc[0] > 180 ? 1 : 0;
  return `<path d="M ${cx} ${cy} L ${pt(b.arc[0])} A ${b.r} ${b.r} 0 ${large} 0 ${pt(b.arc[1])} Z" ${paint}/>`;
}
function overlayDoc(action, meta) {
  const attack = meta.phase === 'active' && HB.attacks[HB.byAction[action]];
  let s = `<line x1="0" y1="${HERO.py}" x2="${HERO.w}" y2="${HERO.py}" stroke="#8a97a6" stroke-width="1.2"/>` +
    `<path d="M ${HERO.px - 9} ${HERO.py} H ${HERO.px + 9} M ${HERO.px} ${HERO.py - 9} V ${HERO.py + 9}" stroke="#e0218a" stroke-width="2"/>` +
    boxSVG(HB.hurtbox, '#2f6fde', 'none', 1.4);
  if (attack) s += boxSVG(attack, '#e5383b', '#e5383b', 2);
  return svgDoc(HERO.w, HERO.h, s);
}
const CROP = { x: 124, y: 162, w: 520, h: 350 };
async function heroCell(fr, action, outW, overlay = true) {
  const layers = [{ input: fr.png }];
  if (fr.fxPng) layers.push({ input: fr.fxPng });
  if (overlay) layers.push({ input: Buffer.from(overlayDoc(action, fr.meta)) });
  const full = await sharp({ create: { width: HERO.w * SCALE, height: HERO.h * SCALE, channels: 4, background: '#eef1f4' } })
    .composite(layers).png().toBuffer();
  return sharp(full)
    .extract({ left: CROP.x * SCALE, top: CROP.y * SCALE, width: CROP.w * SCALE, height: CROP.h * SCALE })
    .resize({ width: outW }).png().toBuffer();
}
const text = (x, y, s, size = 14, color = '#333', weight = 'normal') =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${s}</text>`;
const textLayer = (w, h, body) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`), left: 0, top: 0 });
const onBg = (buf, bg = '#eef1f4') => sharp(buf).flatten({ background: bg }).png().toBuffer();

async function sheets(rendered, fxPngs, beam, portrait, cutin) {
  // 全部動作總表
  {
    const cw = 260, ch = Math.round((cw * CROP.h) / CROP.w), gap = 8, labelW = 140;
    const names = Object.keys(rendered);
    const cols = Math.max(...names.map((k) => rendered[k].length));
    const W = labelW + gap + cols * (cw + gap), H = gap + names.length * (ch + gap);
    const comps = [];
    let t = '';
    for (const [row, name] of names.entries()) {
      const y = gap + row * (ch + gap);
      t += text(10, y + ch / 2 + 6, name, 17, '#222', 'bold');
      for (const [i, fr] of rendered[name].entries()) {
        const x = labelW + gap + i * (cw + gap);
        comps.push({ input: await heroCell(fr, name, cw), left: x, top: y });
        t += text(x + 6, y + 16, `${fr.meta.file}${fr.meta.phase ? ' ' + fr.meta.phase : ''} x${fr.meta.hold}`, 12, '#555');
      }
    }
    comps.push(textLayer(W, H, t));
    await mkdir(path.join(OUT, '_preview'), { recursive: true });
    await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
      .composite(comps).png().toFile(path.join(OUT, '_preview', 'sheet_hero.png'));
  }
  // 精選一覽
  {
    const pick = [
      ['idle', 0], ['walk', 0], ['run', 2], ['jump', 1], ['double_jump', 1], ['doze', 0],
      ['x1', 0], ['x1', 1], ['x2', 2], ['x3', 2], ['c_dash', 1], ['hurt', 0],
      ['a_slash', 1], ['a_slash', 2], ['s_throw', 0], ['s_control', 0], ['d_slash', 2], ['death', 3],
    ];
    const cw = 280, ch = Math.round((cw * CROP.h) / CROP.w), gap = 10, lab = 20, cols = 6;
    const W = gap + cols * (cw + gap);
    const ph = 330, pw = Math.round((ph * PORTRAIT.w) / PORTRAIT.h);
    const rowsY = (r) => gap + r * (ch + lab + gap);
    const H = rowsY(3) + ph + lab + gap;
    const comps = [];
    let t = '';
    for (const [i, [name, f]] of pick.entries()) {
      const x = gap + (i % cols) * (cw + gap), y = rowsY(Math.floor(i / cols));
      const fr = rendered[name][f];
      comps.push({ input: await heroCell(fr, name, cw), left: x, top: y });
      t += text(x + 4, y + ch + 15, `${fr.meta.file}${fr.meta.phase === 'active' ? '（判定幀）' : ''}`, 13, '#333');
    }
    const y4 = rowsY(3);
    for (const [i, [label, e]] of Object.entries(EXPRESSIONS).entries()) {
      const full = await sharp({ create: { width: PORTRAIT.w * SCALE, height: PORTRAIT.h * SCALE, channels: 4, background: '#eef1f4' } })
        .composite([{ input: portrait.body }, { input: portrait[e.eyes] }, { input: portrait[e.mouth] }]).png().toBuffer();
      const x = gap + i * (pw + gap);
      comps.push({ input: await sharp(full).resize({ height: ph }).png().toBuffer(), left: x, top: y4 });
      t += text(x + 4, y4 + ph + 15, `portrait ${label}`, 13, '#333');
    }
    let ex = gap + 4 * (pw + gap) + 10;
    comps.push({ input: await sharp(await onBg(cutin)).resize({ width: 420 }).png().toBuffer(), left: ex, top: y4 });
    t += text(ex + 4, y4 + 210 + 15, 'cutin', 13, '#333');
    const ex2 = ex + 430;
    comps.push({ input: await sharp(await onBg(fxPngs.x3_wave[0])).resize({ width: 140 }).png().toBuffer(), left: ex2, top: y4 });
    comps.push({ input: await sharp(await onBg(fxPngs.d_storm[0])).resize({ width: 140 }).png().toBuffer(), left: ex2 + 150, top: y4 });
    t += text(ex2 + 4, y4 + 155, 'x3_wave', 13, '#333') + text(ex2 + 154, y4 + 155, 'd_storm', 13, '#333');
    const beamRow = await sharp({ create: { width: 1536, height: 480, channels: 4, background: '#eef1f4' } })
      .composite([{ input: beam.start, left: 0, top: 0 }, { input: beam.mid, left: 256, top: 0 }, { input: beam.mid, left: 768, top: 0 }, { input: beam.end, left: 1280, top: 0 }])
      .png().toBuffer();
    comps.push({ input: await sharp(beamRow).resize({ width: 290 }).png().toBuffer(), left: ex2, top: y4 + 170 });
    t += text(ex2 + 4, y4 + 270, 'a_beam start+mid+mid+end', 13, '#333');
    comps.push({ input: await sharp(await onBg(fxPngs.s_sword[0])).resize({ width: 190 }).png().toBuffer(), left: ex, top: y4 + 240 });
    t += text(ex + 4, y4 + 300, 's_sword', 13, '#333');
    comps.push(textLayer(W, H, t));
    await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
      .composite(comps).png().toFile(path.join(OUT, '_preview', 'overview.png'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
