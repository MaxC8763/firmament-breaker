#!/usr/bin/env node
// npm run art:watch [-- --export <資料夾>]：監看佔位圖與手繪資料夾，有變動就（等 0.3 秒沒有新變動後）重跑美術管線。
// 每次都整批重跑（約 100 張圖要幾秒）；圖多到嫌慢時，再改成只重跑有變動的圖。
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArt, cliDirs, summary } from './pipeline.mjs';

export function watchArt(dirs, { delay = 300 } = {}) {
  let timer, running = false, again = false;
  const run = async () => {
    if (running) return void (again = true);
    running = true;
    try {
      console.log(summary(await buildArt(dirs), dirs.buildDir));
    } catch (e) {
      console.error(`美術管線失敗：${e.message}`);
    }
    running = false;
    if (again) {
      again = false;
      run();
    }
  };
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };

  // 手繪資料夾可能還不存在、也可能被刪掉：每秒看一次，出現了就開始監看
  const watchers = new Map();
  const attach = (atStart) => {
    for (const dir of [dirs.placeholderDir, dirs.exportDir]) {
      if (watchers.has(dir) || !existsSync(dir)) continue;
      const w = watch(dir, { recursive: true }, kick);
      w.on('error', () => {
        w.close();
        watchers.delete(dir);
        kick();
      });
      watchers.set(dir, w);
      if (!atStart) kick(); // 後來才出現的資料夾，裡面可能已經有圖
    }
  };
  attach(true);
  const poll = setInterval(attach, 1000);
  run();
  return () => {
    clearTimeout(timer);
    clearInterval(poll);
    for (const w of watchers.values()) w.close();
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const dirs = cliDirs();
  console.log(`監看 ${dirs.placeholderDir} 與 ${dirs.exportDir}（Ctrl+C 結束）`);
  watchArt(dirs);
}
