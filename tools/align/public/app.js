// 美術對齊工具：畫出每一格和腳底、地平線、佔位圖、判定框的關係（Canvas 2D，不靠遊戲引擎）
const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');

const state = { manifest: null, text: '', hitboxes: null, group: null, index: 0, playing: false, flipped: false, zoom: 1, drawn: null };

const animGroups = () => Object.keys(state.manifest.groups).filter((g) => state.manifest.groups[g].frames);
const meta = () => state.manifest?.groups[state.group];
const frames = () => meta()?.frames ?? [];
const keyOf = (group, f) => `${group}/${f.file}`;
const sourceOf = (k) => state.manifest.images[k]?.source;

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

// ---------- 左欄：動作清單 ----------
function renderList() {
  const list = $('list');
  list.replaceChildren();
  for (const g of animGroups()) {
    const fs = state.manifest.groups[g].frames;
    const own = fs.filter((f) => sourceOf(keyOf(g, f)) === 'export').length;
    const details = document.createElement('details');
    details.open = g === state.group;
    const summary = document.createElement('summary');
    summary.dataset.group = g;
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: g });
    const count = Object.assign(document.createElement('span'), { className: 'count', textContent: `手繪 ${own}／${fs.length}` });
    summary.append(name, count);
    summary.onclick = () => select(g, 0);
    const box = Object.assign(document.createElement('div'), { className: 'frames' });
    fs.forEach((f, i) => {
      const b = Object.assign(document.createElement('button'), { textContent: f.file });
      b.dataset.group = g;
      b.dataset.index = i;
      b.classList.toggle('ph', sourceOf(keyOf(g, f)) !== 'export'); // 還是佔位圖的標灰
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

function select(group, index) {
  state.group = group;
  state.index = index;
  highlight();
  draw();
}

// ---------- 中央畫布 ----------
function draw() {
  const m = meta();
  const f = frames()[state.index];
  if (!m || !f) return;
  const [W, H] = m.canvas;
  const [px, py] = m.pivot ?? [W / 2, H / 2];
  const z = state.zoom;
  if (canvas.width !== W * z || canvas.height !== H * z) [canvas.width, canvas.height] = [W * z, H * z];
  ctx.setTransform(z, 0, 0, z, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#eef1f4';
  ctx.fillRect(0, 0, W, H);

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
  if ($('fx').checked && f.fx) layer(built(`${state.group}/fx/${f.fx}`), 1);
  ctx.globalAlpha = 1;
  if ($('boxes').checked) drawBoxes(f, px, py);
  ctx.restore();

  // 參考線：畫布邊框、地平線（腳底那條橫線的正下方）、中線、腳底十字；寬度固定 1 個螢幕像素
  const t = 1 / z;
  ctx.fillStyle = '#8a97a6';
  ctx.fillRect(0, py, W, t);
  ctx.fillRect(px, 0, t, H);
  ctx.strokeStyle = '#5b6573';
  ctx.lineWidth = t;
  ctx.strokeRect(t / 2, t / 2, W - t, H - t);
  ctx.fillStyle = '#e0218a';
  ctx.fillRect(px - 12, py, 24, 2 * t);
  ctx.fillRect(px, py - 12, 2 * t, 24);

  state.drawn = main ? k : null;
  const img = state.manifest.images[k];
  $('info').textContent =
    `${state.group}　第 ${state.index + 1}／${list.length} 格　${f.file}　來源 ${img?.source ?? '沒有圖'}　hold ${f.hold}` +
    `${f.phase ? '　' + f.phase : ''}${f.grounded ? '　貼地' : ''}${state.flipped ? '　面向左' : ''}`;
}

/** 判定框：hurtbox 藍框；攻擊判定紅框，active 的格實心、其他格虛線（座標相對腳底，1x） */
function drawBoxes(f, px, py) {
  const hb = state.hitboxes;
  if (!hb) return;
  const name = state.group.split('/').pop();
  const hero = state.group.startsWith('hero/');
  if (hero) shape(hb.hurtbox, px, py, '#2f6fde', 'line');
  const attack = hero ? hb.attacks[hb.byAction[name]] : hb.projectiles?.[name];
  if (attack) shape(attack, px, py, '#e5383b', !hero || f.phase === 'active' ? 'fill' : 'dash');
}

/** style：line＝實線框、fill＝實線框加半透明填色、dash＝虛線框 */
function shape(s, px, py, color, style) {
  ctx.beginPath();
  if (s.type === 'circle') {
    ctx.arc(px + s.cx, py + s.cy, s.r, s.upperHalf ? Math.PI : 0, 2 * Math.PI);
    ctx.closePath();
  } else {
    ctx.rect(px + s.x, py + s.y, s.w, s.h);
  }
  ctx.setLineDash(style === 'dash' ? [6, 4] : []);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (style === 'fill') {
    ctx.fillStyle = `${color}40`;
    ctx.fill();
  }
  ctx.setLineDash([]);
}

// ---------- 播放：照 hold 以 fps 播 ----------
let last = performance.now();
let acc = 0;
function loop(now) {
  const m = meta();
  if (state.playing && m && frames().length) {
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
  if (!state.manifest) return;
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
for (const el of document.querySelectorAll('#bar input')) el.oninput = draw;

// 給瀏覽器測試讀目前狀態
window.__align = {
  getState: () => ({ group: state.group, index: state.index, playing: state.playing, flipped: state.flipped, zoom: state.zoom, drawn: state.drawn }),
};

state.hitboxes = await (await fetch('hitboxes.json', { cache: 'no-store' })).json();
await refresh();
setInterval(refresh, 1000);
requestAnimationFrame(loop);
