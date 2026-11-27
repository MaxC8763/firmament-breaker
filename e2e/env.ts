import os from 'node:os';
import path from 'node:path';

// 截圖平常寫進 test-results/（不進 git）；SAVE_SCREENSHOTS=1 時寫進 screenshots/，留作進度紀錄
export const shotPath = (name: string) =>
  `${process.env.SAVE_SCREENSHOTS ? 'screenshots' : 'test-results'}/${name}.png`;

// 對齊工具在瀏覽器測試裡用另一個埠和暫存資料夾：不動到 art/build 與真的判定框檔，也不和開著的 art:align 搶埠
export const ALIGN_PORT = 5198;
export const ALIGN_URL = `http://localhost:${ALIGN_PORT}/`;
export const ALIGN_TMP = path.join(os.tmpdir(), 'firmament-breaker-align-e2e');
export const ALIGN_HITBOXES = path.join(ALIGN_TMP, 'hitboxes.json');
