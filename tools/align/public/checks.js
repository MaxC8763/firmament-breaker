// 對位檢查：每格自動算，資料來自美術管線的 manifest
// 回傳 [{ level, text }]：warn＝黃（貼地的格離地平線超過 ±1 px）、edge＝紅（碰到畫布邊緣，可能被切掉）、error＝紅（原檔尺寸不對、讀不到）
export function checkFrame(manifest, group, frame) {
  const key = `${group}/${frame.file}`;
  const keys = frame.fx ? [key, `${group}/fx/${frame.fx}`] : [key];
  const out = manifest.errors.filter((e) => keys.includes(e.image)).map((e) => ({ level: 'error', text: `${e.image}：${e.message}` }));
  const img = manifest.images[key];
  if (!img) return out;
  if (frame.grounded && img.ground !== null && Math.abs(img.ground) > 1)
    out.push({ level: 'warn', text: `腳底${img.ground > 0 ? '低於' : '高於'}地平線 ${Math.abs(img.ground)} px` });
  if (img.edge) out.push({ level: 'edge', text: '圖碰到畫布邊緣，可能被切掉' });
  return out;
}

/** body 的下緣要在腳底（y＋h＝0）：遊戲裡 body 踩在地上，下緣偏了，主角就會陷進地面或浮空；沒問題是 null */
export function bodyWarning(hb) {
  const b = hb?.body;
  const bottom = b ? b.y + b.h : 0;
  if (bottom === 0) return null;
  return bottom < 0
    ? `body 下緣在腳底上方 ${-bottom} px：主角在遊戲裡會陷進地面`
    : `body 下緣在腳底下方 ${bottom} px：主角在遊戲裡會浮空`;
}

/** 一組警告裡最嚴重的等級（給清單上色）；沒有警告是 null */
export const worst = (list) => (list.some((w) => w.level !== 'warn') ? 'bad' : list.length ? 'warn' : null);
