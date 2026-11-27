// 判定框檔（src/data/hitboxes.json）的排版與存檔前的檢查；對齊工具的伺服器存檔時用
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const join = (at, k) => (at ? `${at}.${k}` : k);

/** 值裡沒有物件的物件（一個框、byAction、空的 perFrame）排成一行；陣列也排成一行 */
const oneLine = (v) => !isObj(v) || Object.values(v).every((x) => !isObj(x));

function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (!isObj(v)) return JSON.stringify(v);
  const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

function block(obj, indent) {
  const pad = ' '.repeat(indent + 2);
  const entries = Object.entries(obj);
  const lines = [];
  for (let i = 0; i < entries.length; ) {
    // 同一段連續的單行項目，鍵補空白對齊
    let end = i + 1;
    if (oneLine(entries[i][1])) while (end < entries.length && oneLine(entries[end][1])) end++;
    const width = Math.max(...entries.slice(i, end).map(([k]) => JSON.stringify(k).length));
    for (; i < end; i++) {
      const [k, v] = entries[i];
      const key = `${JSON.stringify(k)}:`.padEnd(width + 2);
      lines.push(pad + key + (oneLine(v) ? inline(v) : block(v, indent + 2)));
    }
  }
  return `{\n${lines.join(',\n')}\n${' '.repeat(indent)}}`;
}

/** 一個框一行、同一段的鍵對齊：沒改東西就排出一模一樣的檔案，git diff 只看得到改過的行 */
export const formatHitboxes = (data) => `${block(data, 0)}\n`;

const POSITIVE = new Set(['w', 'h', 'r']);

/** next 要和 template 同結構：同樣的欄位、同樣的字串、陣列一樣長，只有數字（整數）可以不同 */
function sameShape(template, next, at) {
  if (typeof template === 'number') {
    if (!Number.isInteger(next)) return `${at} 要是整數`;
    if (POSITIVE.has(at.split('.').pop()) && next <= 0) return `${at} 要大於 0`;
    return null;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(next) || next.length !== template.length) return `${at} 要是 ${template.length} 個值的陣列`;
    for (let i = 0; i < template.length; i++) {
      const problem = sameShape(template[i], next[i], `${at}[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (isObj(template)) {
    if (!isObj(next)) return `${at || '資料'} 要是物件`;
    const changed = [
      ...Object.keys(template).filter((k) => !Object.hasOwn(next, k)).map((k) => `少了 ${join(at, k)}`),
      ...Object.keys(next).filter((k) => !Object.hasOwn(template, k)).map((k) => `多了 ${join(at, k)}`),
    ];
    if (changed.length) return `欄位不能增刪：${changed.join('、')}`;
    for (const k of Object.keys(template)) {
      const problem = sameShape(template[k], next[k], join(at, k));
      if (problem) return problem;
    }
    if (Array.isArray(next.arc)) {
      const [from, to] = next.arc;
      if (!(to - from > 0 && to - from <= 360)) return `${join(at, 'arc')} 要從起轉到迄：迄比起大，最多大 360 度`;
    }
    return null;
  }
  return next === template ? null : `${at} 不能改`;
}

/** perFrame[動作][格]：動作要在 byAction 裡；新的格和它取代的共用框同結構，原本就有的格和原本同結構 */
function checkPerFrame(current, next) {
  if (!isObj(next.perFrame)) return 'perFrame 要是物件';
  for (const [action, frames] of Object.entries(next.perFrame)) {
    const at = `perFrame.${action}`;
    if (!Object.hasOwn(next.byAction ?? {}, action)) return `${at}：byAction 裡沒有這個動作`;
    if (!isObj(frames)) return `${at} 要是物件`;
    for (const [file, shape] of Object.entries(frames)) {
      if (!/^[\w-]+$/.test(file)) return `${at}：格的名稱只能有英數、底線、連字號（${file}）`;
      const template = own(own(current.perFrame, action), file) ?? own(current.attacks, own(current.byAction, action));
      if (!template) return `${at}.${file}：找不到它取代的共用框`;
      const problem = sameShape(template, shape, `${at}.${file}`);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * 工具送來的資料能不能存：除了 perFrame 可以增刪格，其他部分要和現在的檔案同結構、只有數字不同，
 * 數字都是整數，w、h、r 大於 0。回傳第一個問題的說明，沒問題是 null。
 */
export function checkEdit(current, next) {
  if (!isObj(next)) return '資料要是物件';
  // perFrame 另外檢查；先換成同一個值，只比較兩邊是不是都有這個欄位
  const outside = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'perFrame' ? null : v]));
  return sameShape(outside(current), outside(next), '') ?? (Object.hasOwn(next, 'perFrame') ? checkPerFrame(current, next) : null);
}
