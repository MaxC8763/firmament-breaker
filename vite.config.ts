/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

// 建置時寫出 dist/version.json，部署後的 smoke 用它確認正式站已換成這次的 commit
function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      const commit = process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString().trim();
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n',
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // 正式站在 GitHub Pages 的子路徑；開發時用根路徑
  base: command === 'build' || isPreview ? '/firmament-breaker/' : '/',
  // 美術管線輸出給遊戲的那一層（atlas、manifest）；1x 單張在 art/build/1x，不會進正式建置
  publicDir: 'art/build/game',
  plugins: [versionJson()],
  // Phaser 本身就有 1.3 MB，預設 500 kB 的警告每次都會出現，沒有參考價值
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
}));
