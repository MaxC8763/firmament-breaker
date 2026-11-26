// 美術對齊工具：畫出每一格和腳底、地平線、佔位圖、判定框的關係（Canvas 2D，不靠遊戲引擎）
import { checkFrame, worst } from './checks.js';
import { drawCutin, drawDialog, drawGame, drawShape } from './preview.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const pctx = $('preview').getContext('2d');
const PREVIEW_SCALE = 0.4;

const state = {
  manifest: null, text: '', hitboxes: null,
  mode: 'action', expression: 'normal',
  group: null, index: 0, playing: false, flipped: false, zoom: 1, drawn: null,
};

const animGroups = () => Object.keys(state.manifest.groups).filter((g) => state.manifest.groups[g].frames);
const meta = (g = state.group) => state.manifest?.groups[g];
const frames = () => meta()?.frames ?? [];
const keyOf = (group, f) => `${group}/${f.file}`;
const sourceOf = (k) => state.manifest.images[k]?.source;
const errorsOf = (keys) => state.manifest.errors.filter((e) => keys.includes(e.image)).map((e) => ({ level: 'error', text: `${e.image}：${e.message}` }));

// ---------- 資料：每秒看一次 manifest，管線重跑後畫面自動換新 ----------
async function refresh() {
  try {
    const res = await fetch('build/manifest.json', { cache: 'no-store' });
    const text = res.ok ? await res.text() : '';
    if (!text || text === state.text) return;
    const manifest = JSON.parse(text);
    state.text = text;
    state.manifest = manifest;
  } catch {
    return; // 管線正在重寫 manifest，下一秒再試
  }
  if (!meta()?.frames) state.group = state.manifest.groups['hero/idle'] ? 'hero/idle' : animGroups()[0];
  state.index = Math.max(0, Math.min(state.index, frames().length - 1));
  renderList();
  renderExpressions();
  draw();
}

// ---------- 圖：網址帶修改時間，重新匯出後才會換新 ----------
const cache = new Map();
function image(url) {
  let img = cache.get(url);
  if (!img) {
    img = new Image();
    img.onload = draw;
    // 管線重跑到一半時可能讀不到：從快取拿掉，一秒後重畫時再要一次
    img.onerror = () => {
      cache.delete(url);
      setTimeout(draw, 1000);
    };
    img.src = url;
    cache.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
function built(k) {
  const i = state.manifest.images[k];
  return i ? image(`build/1x/${k}.png?v=${encodeURIComponent(i.source + i.mtime)}`) : null;
}
const placeholder = (k) => image(`placeholder/${k}.png`);

// ---------- 左欄：動作清單；還是佔位圖的格標灰，有警告的格標黃或紅 ----------
function renderList() {
  const list = $('list');
  list.replaceChildren();
  for (const g of animGroups()) {
    const fs = state.manifest.groups[g].frames;
    const own = fs.filter((f) => sourceOf(keyOf(g, f)) === 'export').length;
    const levels = fs.map((f) => worst(checkFrame(state.manifest, g, f)));
    const details = document.createElement('details');
    details.open = g === state.group;
    const summary = document.createElement('summary');
    summary.dataset.group = g;
    const badge = levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : null;
    summary.append(
      Object.assign(document.createElement('span'), { className: 'name', textContent: g }),
      Object.assign(document.createElement('span'), { className: `badge ${badge ?? ''}`, textContent: badge ? '⚠' : '' }),
      Object.assign(document.createElement('span'), { className: 'count', textContent: `手繪 ${own}／${fs.length}` }),
    );
    summary.onclick = () => select(g, 0);
    const box = Object.assign(document.createElement('div'), { className: 'frames' });
    fs.forEach((f, i) => {
      const b = Object.assign(document.createElement('button'), { textContent: f.file });
      b.dataset.group = g;
      b.dataset.index = i;
      b.classList.toggle('ph', sourceOf(keyOf(g, f)) !== 'export');
      if (levels[i]) b.classList.add(levels[i]);
      b.onclick = () => select(g, i);
      box.append(b);
    });
    details.append(summary, box);
    list.append(details);
  }
  highlight();
}

function highlight() {
  for (const el of document.querySelectorAll('#list summary')) el.classList.toggle('on', el.dataset.group === state.group);
  for (const el of document.querySelectorAll('#list .frames button'))
    el.classList.toggle('on', el.dataset.group === state.group && Number(el.dataset.index) === state.index);
}

function renderExpressions() {
  const box = $('exprs');
  box.replaceChildren();
  for (const name of Object.keys(meta('portrait')?.expressions ?? {})) {
    const b = Object.assign(document.createElement('button'), { textContent: name });
    b.dataset.expression = name;
    b.onclick = () => {
      state.expression = name;
      draw();
    };
    box.append(b);
  }
}

function select(group, index) {
  state.mode = 'action';
  state.group = group;
  state.index = index;
  highlight();
  draw();
}

// ---------- 畫布 ----------
function prepare([W, H]) {
  const z = state.zoom;
  if (canvas.width !== W * z || canvas.height !== H * z) [canvas.width, canvas.height] = [W * z, H * z];
  ctx.setTransform(z, 0, 0, z, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#eef1f4';
  ctx.fillRect(0, 0, W, H);
  return 1 / z; // 1 個螢幕像素
}

function cross(x, y, t) {
  ctx.fillStyle = '#e0218a';
  ctx.fillRect(x - 12, y, 24, 2 * t);
  ctx.fillRect(x, y - 12, 2 * t, 24);
}

function info(lines) {
  $('info').replaceChildren(
    ...lines.map((l) => Object.assign(document.createElement('div'), { className: l.level ?? '', textContent: l.text ?? l })),
  );
}

function draw() {
  if (!state.manifest) return;
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === state.mode);
  $('exprs').hidden = state.mode !== 'portrait';
  if (state.mode === 'portrait') drawPortraitMode();
  else if (state.mode === 'cutin') drawCutinMode();
  else drawActionMode();
}

function boxesFor(f) {
  const hb = state.hitboxes;
  if (!hb || !$('boxes').checked) return [];
  const name = state.group.split('/').pop();
  const hero = state.group.startsWith('hero/');
  const out = hero ? [{ shape: hb.hurtbox, color: '#2f6fde', style: 'line' }] : [];
  const attack = hero ? hb.attacks[hb.byAction[name]] : hb.projectiles?.[name];
  if (attack) out.push({ shape: attack, color: '#e5383b', style: !hero || f.phase === 'active' ? 'fill' : 'dash' });
  return out;
}

function drawActionMode() {
  const m = meta();
  const f = frames()[state.index];
  if (!m || !f) return;
  const [W, H] = m.canvas;
  const [px, py] = m.pivot ?? [W / 2, H / 2];
  const t = prepare(m.canvas);
  const k = keyOf(state.group, f);
  const list = frames();
  const layer = (img, alpha) => {
    if (!img || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0, W, H); // 佔位圖是 2x，一律縮成 1x 畫布大小
  };

  ctx.save();
  if (state.flipped) {
    // 以腳底為軸翻面，和遊戲的 flipX 一樣
    ctx.translate(2 * px, 0);
    ctx.scale(-1, 1);
  }
  if ($('onion').checked && list.length > 1) layer(built(keyOf(state.group, list[(state.index - 1 + list.length) % list.length])), 0.25);
  if ($('ph').checked) layer(placeholder(k), $('phAlpha').value / 100);
  const main = $('art').checked ? built(k) : null;
  layer(main, $('artAlpha').value / 100);
  const fx = f.fx && $('fx').checked ? built(`${state.group}/fx/${f.fx}`) : null;
  layer(fx, 1);
  ctx.globalAlpha = 1;
  const boxes = boxesFor(f);
  for (const b of boxes) drawShape(ctx, b.shape, px, py, b.color, b.style);
  ctx.restore();

  // 參考線：地平線（腳底那條橫線的正下方）、中線、畫布邊框、腳底十字；寬度固定 1 個螢幕像素
  ctx.fillStyle = '#8a97a6';
  ctx.fillRect(0, py, W, t);
  ctx.fillRect(px, 0, t, H);
  const warnings = checkFrame(state.manifest, state.group, f);
  const img = state.manifest.images[k];
  // 對位檢查：貼地的格離地平線太遠時，在圖實際的下緣畫黃線；碰到畫布邊緣時邊框標紅
  if (warnings.some((w) => w.level === 'warn')) {
    ctx.fillStyle = '#f2b705';
    ctx.fillRect(0, img.bounds[3], W, 2 * t);
  }
  const edge = warnings.some((w) => w.level === 'edge');
  ctx.strokeStyle = edge ? '#e5383b' : '#5b6573';
  ctx.lineWidth = edge ? 4 * t : t;
  ctx.strokeRect(t / 2, t / 2, W - t, H - t);
  cross(px, py, t);

  const attack = state.hitboxes && (state.hitboxes.attacks[state.hitboxes.byAction[state.group.split('/').pop()]] ?? state.hitboxes.attacks.x_slash);
  const reach = attack ? (attack.type === 'circle' ? attack.cx + attack.r : attack.x + attack.w) : 200;
  drawGame(pctx, PREVIEW_SCALE, { img: main, canvas: m.canvas, pivot: [px, py], flipped: state.flipped, boxes, reach });

  state.drawn = main && (!f.fx || fx || !$('fx').checked) ? k : null;
  info([
    `${state.group}　第 ${state.index + 1}／${list.length} 格　${f.file}　來源 ${img?.source ?? '沒有圖'}　hold ${f.hold}` +
      `${f.phase ? '　' + f.phase : ''}${f.grounded ? `　貼地（離地平線 ${img?.ground ?? '?'} px）` : ''}${state.flipped ? '　面向左' : ''}`,
    ...warnings.map((w) => ({ level: w.level === 'warn' ? 'warn' : 'bad', text: `⚠ ${w.text}` })),
  ]);
}

function drawPortraitMode() {
  const m = meta('portrait');
  const e = m?.expressions?.[state.expression];
  if (!e) return;
  const keys = ['portrait/body', `portrait/${e.eyes}`, `portrait/${e.mouth}`];
  const layers = keys.map(built);
  const t = prepare(m.canvas);
  for (const img of layers) if (img) ctx.drawImage(img, 0, 0, ...m.canvas);
  ctx.strokeStyle = '#5b6573';
  ctx.lineWidth = t;
  ctx.strokeRect(t / 2, t / 2, m.canvas[0] - t, m.canvas[1] - t);
  cross(m.anchor[0], m.anchor[1] - 2 * t, t);
  drawDialog(pctx, PREVIEW_SCALE, { layers, canvas: m.canvas, anchor: m.anchor });
  state.drawn = layers.every(Boolean) ? `portrait/${state.expression}` : null;
  info([
    `立繪 ${state.expression}：${keys.map((k) => `${k.split('/')[1]}（${sourceOf(k) ?? '沒有圖'}）`).join(' + ')}`,
    ...errorsOf(keys).map((w) => ({ level: 'bad', text: `⚠ ${w.text}` })),
  ]);
}

function drawCutinMode() {
  const m = meta('cutin');
  const k = Object.keys(state.manifest.images).find((key) => key.startsWith('cutin/'));
  if (!m || !k) return;
  const img = built(k);
  const t = prepare(m.canvas);
  if (img) ctx.drawImage(img, 0, 0, ...m.canvas);
  ctx.strokeStyle = '#5b6573';
  ctx.lineWidth = t;
  ctx.strokeRect(t / 2, t / 2, m.canvas[0] - t, m.canvas[1] - t);
  cross(m.anchor[0], m.anchor[1], t);
  drawCutin(pctx, PREVIEW_SCALE, { img, canvas: m.canvas, anchor: m.anchor });
  state.drawn = img ? k : null;
  info([`cut-in：${k}（${sourceOf(k)}）　帶狀區域高 ${m.canvas[1]} px`, ...errorsOf([k]).map((w) => ({ level: 'bad', text: `⚠ ${w.text}` }))]);
}

// ---------- 播放：照 hold 以 fps 播 ----------
let last = performance.now();
let acc = 0;
function loop(now) {
  const m = meta();
  if (state.playing && state.mode === 'action' && m && frames().length) {
    acc += now - last;
    const ms = () => (frames()[state.index].hold * 1000) / m.fps;
    while (acc >= ms()) {
      acc -= ms();
      state.index = (state.index + 1) % frames().length;
    }
    highlight();
    draw();
  }
  last = now;
  requestAnimationFrame(loop);
}

function step(d) {
  state.playing = false;
  state.index = (state.index + d + frames().length) % frames().length;
  highlight();
  draw();
}

function togglePlay() {
  state.playing = !state.playing;
  acc = 0;
}

addEventListener('keydown', (e) => {
  if (!state.manifest || state.mode !== 'action') return;
  if (e.code === 'Space') togglePlay();
  else if (e.code === 'ArrowRight') step(1);
  else if (e.code === 'ArrowLeft') step(-1);
  else if (e.code === 'KeyF') state.flipped = !state.flipped;
  else return;
  e.preventDefault(); // 焦點在核取方塊或滑桿上時，按鍵也只控制播放
  draw();
});
$('play').onclick = togglePlay;
for (const b of document.querySelectorAll('[data-zoom]'))
  b.onclick = () => {
    state.zoom = Number(b.dataset.zoom);
    draw();
  };
for (const b of document.querySelectorAll('[data-mode]'))
  b.onclick = () => {
    state.mode = b.dataset.mode;
    draw();
  };
for (const el of document.querySelectorAll('#bar input')) el.oninput = draw;

// 給瀏覽器測試讀目前狀態
window.__align = {
  getState() {
    const f = state.manifest && frames()[state.index];
    const img = f && state.manifest.images[keyOf(state.group, f)];
    let warningCount = 0;
    for (const g of state.manifest ? animGroups() : [])
      for (const fr of state.manifest.groups[g].frames) warningCount += checkFrame(state.manifest, g, fr).length;
    return {
      mode: state.mode, expression: state.expression, group: state.group, index: state.index,
      playing: state.playing, flipped: state.flipped, zoom: state.zoom, drawn: state.drawn,
      source: img?.source ?? null, ground: img?.ground ?? null,
      warnings: f ? checkFrame(state.manifest, state.group, f) : [], warningCount,
    };
  },
};

state.hitboxes = await (await fetch('hitboxes.json', { cache: 'no-store' })).json();
await refresh();
setInterval(refresh, 1000);
requestAnimationFrame(loop);
