// 判定框的編輯：一格有哪些框、控制點、點選、拖拉。
// 座標一律先換算成「面向右、1x、相對腳底（特效是圖的 pivot）」再算，放大與翻面只在 toLocal 處理。
const DEG = 180 / Math.PI;
const int = (v) => Math.round(v) || 0; // 不留 -0
const wrap = (deg) => ((deg % 360) + 360) % 360;

/** 畫布上的滑鼠位置（CSS 像素，相對畫布左上）→ 面向右、1x、相對 pivot 的座標 */
export function toLocal([sx, sy], { pivot: [px, py], zoom, flipped }) {
  const x = sx / zoom - px;
  return { x: flipped ? -x : x, y: sy / zoom - py };
}

export const get = (hb, path) => path.reduce((o, k) => o?.[k], hb);

/** 一格要畫、能改的框：role＝框的角色（換格時選取跟著角色走），path＝它在判定框資料裡的位置 */
export function boxesOf(hb, group) {
  const name = group.split('/').pop();
  const out = [];
  if (group.startsWith('hero/')) {
    out.push({ role: 'body', path: ['body'] }, { role: 'hurtbox', path: ['hurtbox'] });
    const attack = hb.byAction?.[name];
    if (attack) out.push({ role: 'attack', path: ['attacks', attack] });
    // 長條劍氣在 A 的斬擊判定時生成，座標同樣相對主角腳底
    if (name === 'a_slash') out.push({ role: 'beam', path: ['attacks', 'a_beam'] });
  } else {
    out.push({ role: 'projectile', path: ['projectiles', name] });
  }
  return out.map((b) => ({ ...b, shape: get(hb, b.path) })).filter((b) => b.shape);
}

const point = (s, id, deg) => ({ id, x: s.cx + s.r * Math.cos(deg / DEG), y: s.cy - s.r * Math.sin(deg / DEG) });

/** 控制點：矩形四角；圓在圓周上的半徑點（扇形放在中間的角度），扇形另有起、迄 */
export function handlesOf(s) {
  if (s.type !== 'circle') {
    const { x, y, w, h } = s;
    return [{ id: 'nw', x, y }, { id: 'ne', x: x + w, y }, { id: 'sw', x, y: y + h }, { id: 'se', x: x + w, y: y + h }];
  }
  if (!s.arc) return [point(s, 'r', 0)];
  const [from, to] = s.arc;
  return [point(s, 'r', (from + to) / 2), point(s, 'from', from), point(s, 'to', to)];
}

/** 數字欄：[欄位, 標籤]；扇形的起、迄是 arc 的兩個值 */
export const fieldsOf = (s) => [
  ...(s.type === 'circle' ? ['cx', 'cy', 'r'] : ['x', 'y', 'w', 'h']).map((k) => [k, k]),
  ...(s.arc ? [['arc0', '起'], ['arc1', '迄']] : []),
];
export const fieldValue = (s, field) => (field.startsWith('arc') ? s.arc[Number(field[3])] : s[field]);

/** 數字欄打的值合格才套用（回傳新的框）：整數；w、h、r 至少 1；扇形 0 < 迄 − 起 ≤ 360。不合格是 null */
export function setField(s, field, v) {
  if (!Number.isInteger(v)) return null;
  if (field.startsWith('arc')) {
    const arc = [...s.arc];
    arc[Number(field[3])] = v;
    return arc[1] - arc[0] > 0 && arc[1] - arc[0] <= 360 ? { ...s, arc } : null;
  }
  return ['w', 'h', 'r'].includes(field) && v < 1 ? null : { ...s, [field]: v };
}

/** 從圓心看 p 的角度：0＝正前方、90＝正上方，範圍 (-180, 180] */
const angleOf = (s, p) => Math.atan2(s.cy - p.y, p.x - s.cx) * DEG;

export function contains(s, p) {
  if (s.type !== 'circle') return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  if (Math.hypot(p.x - s.cx, p.y - s.cy) > s.r) return false;
  if (!s.arc || (p.x === s.cx && p.y === s.cy)) return true;
  const [from, to] = s.arc;
  return wrap(angleOf(s, p) - from) <= to - from;
}

const area = (s) => (s.type !== 'circle' ? s.w * s.h : Math.PI * s.r * s.r * (s.arc ? (s.arc[1] - s.arc[0]) / 360 : 1));

/** 按下去抓到什麼：已選框最近的控制點優先，再來是包住這一點的框裡面積最小的；都沒有是 null */
export function hitTest(boxes, p, { selected = null, tolerance = 6 } = {}) {
  const sel = boxes.find((b) => b.role === selected);
  const [handle] = (sel ? handlesOf(sel.shape) : [])
    .map((h) => ({ id: h.id, d: Math.hypot(h.x - p.x, h.y - p.y) }))
    .filter((h) => h.d <= tolerance)
    .sort((a, b) => a.d - b.d);
  if (handle) return { role: sel.role, handle: handle.id };
  const [inside] = boxes.filter((b) => contains(b.shape, p)).sort((a, b) => area(a.shape) - area(b.shape));
  return inside ? { role: inside.role, handle: 'move' } : null;
}

/**
 * 從 start 拖到 now 之後的框（不改原本的物件）。一律取整數；w、h、r 最小 1；
 * 扇形維持「從起往角度變大的方向轉到迄」、0 < 迄 − 起 ≤ 360，拖到和另一端重疊就是整個圓。
 */
export function drag(s, handle, start, now) {
  const dx = now.x - start.x;
  const dy = now.y - start.y;
  if (handle === 'move') {
    return s.type === 'circle' ? { ...s, cx: int(s.cx + dx), cy: int(s.cy + dy) } : { ...s, x: int(s.x + dx), y: int(s.y + dy) };
  }
  if (handle === 'r') return { ...s, r: Math.max(1, int(Math.hypot(now.x - s.cx, now.y - s.cy))) };
  if (handle === 'from' || handle === 'to') {
    const a = int(angleOf(s, now));
    const [from, to] = s.arc;
    return { ...s, arc: handle === 'from' ? [a, a + (wrap(to - a) || 360)] : [from, from + (wrap(a - from) || 360)] };
  }
  let left = s.x;
  let top = s.y;
  let right = s.x + s.w;
  let bottom = s.y + s.h;
  if (handle.includes('w')) left = Math.min(int(left + dx), right - 1);
  if (handle.includes('e')) right = Math.max(int(right + dx), left + 1);
  if (handle.includes('n')) top = Math.min(int(top + dy), bottom - 1);
  if (handle.includes('s')) bottom = Math.max(int(bottom + dy), top + 1);
  return { ...s, x: left, y: top, w: right - left, h: bottom - top };
}
