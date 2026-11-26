import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ALIGN_PORT, ALIGN_TMP, ALIGN_URL } from './e2e/env';

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
      // 先清空暫存資料夾：上一次測試留下的 manifest 會讓網頁在第一次重建完成前讀到舊結果
      command:
        `node -e "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })" "${ALIGN_TMP}" && ` +
        `node tools/align/server.mjs --port ${ALIGN_PORT} --export "${path.join(ALIGN_TMP, 'export')}" --build "${path.join(ALIGN_TMP, 'build')}"`,
      url: ALIGN_URL,
      reuseExistingServer: false,
    },
  ],
});
