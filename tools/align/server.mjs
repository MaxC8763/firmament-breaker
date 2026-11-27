#!/usr/bin/env node
/**
 * 美術對齊工具：npm run art:align [-- --export <資料夾>] → http://localhost:5199
 *
 * 同一個 process 跑美術管線的監看（同 art:watch）和這個只用 Node 內建模組的小伺服器。
 * 網頁讀管線輸出的 manifest 與 1x 圖、佔位圖、判定框資料；只聽本機，不對外。
 * 判定框可以在網頁上改完存回：PUT /hitboxes.json，只收這個工具網頁自己送的，只准改數字與逐格框。
 * 另有 --build <資料夾>、--hitboxes <檔>、--port <埠>，讓瀏覽器測試用暫存資料夾跑，不動到 art/build 與真的判定框檔。
 */
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliDirs } from '../art/pipeline.mjs';
import { watchArt } from '../art/watch.mjs';
import { checkEdit, formatHitboxes } from './hitboxes.mjs';

const HITBOXES = 'src/data/hitboxes.json';
const LIMIT = 64 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/** 網址 → 檔案路徑；不在允許的資料夾裡（例如用 ../ 往外跑）就回 null */
export function resolveUrl(url, { buildDir, placeholderDir, hitboxesFile = HITBOXES }) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  if (pathname === '/hitboxes.json') return path.resolve(hitboxesFile);
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

// 伺服器開著時，瀏覽器裡任何網頁都能對它送請求；瀏覽器送 PUT 一定附上 Origin，只收從本機打開的這個工具
const fromThisTool = (origin, port) => ['localhost', '127.0.0.1', '[::1]'].some((host) => origin === `http://${host}:${port}`);

/** PUT /hitboxes.json，內容 { base: 工具讀到的原文, data: 改好的資料 }；檢查都過才寫，回 { text: 新內容 } 或 { error } */
function saveHitboxes(req, res, file) {
  const reply = (status, body) =>
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  if (!fromThisTool(req.headers.origin, req.socket.localPort)) return reply(403, { error: '只收對齊工具網頁自己送的存檔' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reply(415, { error: '內容要是 JSON' });
  const chunks = [];
  let size = 0;
  req.on('error', () => {}); // 送到一半斷線：不回應，也不能讓伺服器跟著掛掉
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= LIMIT) chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > LIMIT) return reply(413, { error: `內容超過 ${LIMIT / 1024} KB` });
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(400, { error: '不是合法的 JSON' });
    }
    try {
      const text = readFileSync(file, 'utf8');
      if (body?.base !== text) return reply(409, { error: '檔案在工具外被改過：請放棄修改、重新讀檔後再改' });
      const problem = checkEdit(JSON.parse(text), body.data);
      if (problem) return reply(400, { error: problem });
      const out = formatHitboxes(body.data);
      writeFileSync(file, out);
      reply(200, { text: out });
    } catch (e) {
      reply(500, { error: `存檔失敗：${e.message}` });
    }
  });
}

export function createServer(dirs) {
  return http.createServer((req, res) => {
    if (req.method === 'PUT' && req.url === '/hitboxes.json') return saveHitboxes(req, res, dirs.hitboxesFile ?? HITBOXES);
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
  const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const port = Number(opt('--port', 5199));
  const dirs = { ...cliDirs(argv), hitboxesFile: opt('--hitboxes', HITBOXES) };
  watchArt(dirs);
  createServer(dirs).listen(port, 'localhost', () => console.log(`對齊工具：http://localhost:${port}`));
}
