// 1920×1080 的遊戲畫面、對話畫面、cut-in 示意，縮小畫在預覽畫布上；座標都是 1x 像素

// 地面高度和遊戲 src/data/tuning.ts 的 GROUND_Y 一致；那邊改了這裡也要改
const SCREEN = { w: 1920, h: 1080, ground: 900 };

/** 判定框：座標相對 (ox, oy)；style：line＝實線框、fill＝實線框加半透明填色、dash＝虛線框 */
export function drawShape(ctx, s, ox, oy, color, style) {
  ctx.beginPath();
  if (s.type === 'circle') {
    ctx.arc(ox + s.cx, oy + s.cy, s.r, s.upperHalf ? Math.PI : 0, 2 * Math.PI);
    ctx.closePath();
  } else {
    ctx.rect(ox + s.x, oy + s.y, s.w, s.h);
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

function screen(ctx, scale, sky) {
  const c = ctx.canvas;
  [c.width, c.height] = [SCREEN.w * scale, SCREEN.h * scale];
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
}

/** 遊戲畫面：地面、實際大小的主角，以及一個前緣剛好碰到攻擊判定框的雜兵方塊 */
export function drawGame(ctx, scale, { img, canvas: [W, H], pivot: [px, py], flipped, boxes, reach }) {
  screen(ctx, scale, '#cfe3ef');
  ctx.fillStyle = '#3b4a3f';
  ctx.fillRect(0, SCREEN.ground, SCREEN.w, SCREEN.h - SCREEN.ground);
  const x = 760;
  const dir = flipped ? -1 : 1;
  ctx.fillStyle = '#8e6fb0';
  ctx.fillRect(x + dir * reach - (flipped ? 100 : 0), SCREEN.ground - 180, 100, 180);
  ctx.save();
  ctx.translate(x, SCREEN.ground);
  ctx.scale(dir, 1);
  if (img) ctx.drawImage(img, -px, -py, W, H);
  for (const b of boxes) drawShape(ctx, b.shape, 0, 0, b.color, b.style);
  ctx.restore();
}

/** 對話畫面：立繪的錨點（底部中央）站在畫面下緣，下方是對話框 */
export function drawDialog(ctx, scale, { layers, canvas: [W, H], anchor: [ax, ay] }) {
  screen(ctx, scale, '#d8d2c4');
  const x = 430;
  for (const img of layers) if (img) ctx.drawImage(img, x - ax, SCREEN.h - ay, W, H);
  ctx.fillStyle = 'rgba(24, 28, 38, 0.85)';
  ctx.fillRect(120, 790, 1680, 260);
  ctx.fillStyle = '#fff';
  ctx.font = '44px sans-serif';
  ctx.fillText('（對話框）', 760, 930);
  ctx.fillStyle = '#e0218a';
  ctx.fillRect(x - 14, SCREEN.h - 4, 28, 4);
  ctx.fillRect(x - 2, SCREEN.h - 30, 4, 30);
}

/** cut-in：畫面變暗，中間一條和 cut-in 圖同高的帶狀區域，圖的錨點放在畫面中央 */
export function drawCutin(ctx, scale, { img, canvas: [W, H], anchor: [ax, ay] }) {
  screen(ctx, scale, '#cfe3ef');
  ctx.fillStyle = '#3b4a3f';
  ctx.fillRect(0, SCREEN.ground, SCREEN.w, SCREEN.h - SCREEN.ground);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
  const cx = SCREEN.w / 2;
  const cy = SCREEN.h / 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(0, cy - H / 2, SCREEN.w, H);
  if (img) ctx.drawImage(img, cx - ax, cy - ay, W, H);
}
