#!/usr/bin/env node
/**
 * 美術對齊工具：npm run art:align [-- --export <資料夾>] → http://localhost:5199
 *
 * 同一個 process 跑美術管線的監看（同 art:watch）和這個只用 Node 內建模組的小伺服器。
 * 網頁讀管線輸出的 manifest 與 1x 圖、佔位圖、判定框資料；只聽本機，不對外。
 * 另有 --build <資料夾>、--port <埠>，讓瀏覽器測試用暫存資料夾跑，不動到 art/build。
 */
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliDirs } from '../art/pipeline.mjs';
import { watchArt } from '../art/watch.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/** 網址 → 檔案路徑；不在允許的資料夾裡（例如用 ../ 往外跑）就回 null */
export function resolveUrl(url, { buildDir, placeholderDir }) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  if (pathname === '/hitboxes.json') return path.resolve('src/data/hitboxes.json');
  const routes = [
    ['/build/', buildDir],
    ['/placeholder/', placeholderDir],
    ['/', path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')],
  ];
  const [prefix, dir] = routes.find(([p]) => pathname.startsWith(p));
  const root = path.resolve(dir);
  const file = path.join(root, pathname.slice(prefix.length) || 'index.html');
  return file.startsWith(root + path.sep) ? file : null;
}

export function createServer(dirs) {
  return http.createServer((req, res) => {
    let file = null;
    try {
      file = resolveUrl(req.url, dirs);
    } catch {
      // 解不開的網址（例如壞掉的 %XX）當成找不到
    }
    if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('找不到');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const port = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : 5199;
  const dirs = cliDirs(argv);
  watchArt(dirs);
  createServer(dirs).listen(port, 'localhost', () => console.log(`對齊工具：http://localhost:${port}`));
}
