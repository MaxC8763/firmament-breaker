import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ALIGN_HITBOXES, ALIGN_PORT, ALIGN_TMP, ALIGN_URL } from './e2e/env';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // headless Chromium 沒有 GPU，用軟體算繪的 WebGL
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      // 先清空暫存資料夾：上一次測試留下的 manifest 會讓網頁在第一次重建完成前讀到舊結果。
      // 判定框檔每次從 src/data 複製一份新的，存檔的測試只改這一份

      command:
        `node -e "const fs = require('node:fs'); fs.rmSync(process.argv[1], { recursive: true, force: true }); fs.mkdirSync(process.argv[1]); fs.copyFileSync('src/data/hitboxes.json', process.argv[2])" "${ALIGN_TMP}" "${ALIGN_HITBOXES}" && ` +
        `node tools/align/server.mjs --port ${ALIGN_PORT} --export "${path.join(ALIGN_TMP, 'export')}" --build "${path.join(ALIGN_TMP, 'build')}" --hitboxes "${ALIGN_HITBOXES}"`,
      url: ALIGN_URL,
      reuseExistingServer: false,
    },
  ],
});
