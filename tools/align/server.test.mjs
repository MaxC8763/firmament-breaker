import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { formatHitboxes } from './hitboxes.mjs';
import { createServer, resolveUrl } from './server.mjs';

const dirs = { buildDir: 'art/build', placeholderDir: 'art/placeholder' };

describe('對齊工具伺服器的網址對應', () => {
  test('各資料夾的檔案', () => {
    expect(resolveUrl('/build/manifest.json', dirs)).toBe(path.resolve('art/build/manifest.json'));
    expect(resolveUrl('/placeholder/hero/idle/idle_00.png', dirs)).toBe(path.resolve('art/placeholder/hero/idle/idle_00.png'));
    expect(resolveUrl('/hitboxes.json', dirs)).toBe(path.resolve('src/data/hitboxes.json'));
    expect(resolveUrl('/hitboxes.json', { ...dirs, hitboxesFile: 'tmp/hb.json' })).toBe(path.resolve('tmp/hb.json'));
    expect(resolveUrl('/?t=1', dirs)).toBe(path.resolve('tools/align/public/index.html'));
  });

  test('用 ../ 跑不出允許的資料夾', () => {
    const allowed = ['art/build', 'art/placeholder', 'tools/align/public'].map((d) => path.resolve(d) + path.sep);
    const urls = ['/build/..%2f..%2fpackage.json', '/placeholder/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/build/../../package.json'];
    for (const url of urls) {
      const file = resolveUrl(url, dirs);
      expect(file === null || allowed.some((a) => file.startsWith(a)), url).toBe(true);
    }
    expect(resolveUrl('/build/..%2f..%2fpackage.json', dirs)).toBeNull();
  });
});

describe('存判定框', () => {
  const original = readFileSync('src/data/hitboxes.json', 'utf8');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'align-save-'));
  const file = path.join(tmp, 'hitboxes.json');
  let server;
  let port;

  beforeAll(async () => {
    server = createServer({ ...dirs, hitboxesFile: file });
    await new Promise((ok) => server.listen(0, 'localhost', ok));
    port = server.address().port;
  });
  afterAll(() => {
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => writeFileSync(file, original));

  // 用 node:http 送：Origin 這類標頭要照測試的需要設或不設
  function put(body, { origin = `http://localhost:${port}`, type = 'application/json' } = {}) {
    const headers = { 'Content-Type': type, ...(origin ? { Origin: origin } : {}) };
    return new Promise((resolve, reject) => {
      const req = http.request({ host: 'localhost', port, method: 'PUT', path: '/hitboxes.json', headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  const edited = () => {
    const data = JSON.parse(original);
    data.attacks.x_slash.w = 210;
    return data;
  };
  const unchanged = () => expect(readFileSync(file, 'utf8')).toBe(original);

  test('GET 讀的是指定的判定框檔', async () => {
    writeFileSync(file, original.replace('"w": 190', '"w": 191'));
    const text = await (await fetch(`http://localhost:${port}/hitboxes.json`)).text();
    expect(text).toContain('"w": 191');
  });

  test('合格的存檔寫入排版好的內容，並回傳新內容；本機的三種寫法都收', async () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      writeFileSync(file, original);
      const { status, body } = await put({ base: original, data: edited() }, { origin: `http://${host}:${port}` });
      expect(status, host).toBe(200);
      expect(body.text).toBe(formatHitboxes(edited()));
      expect(readFileSync(file, 'utf8')).toBe(body.text);
    }
    expect(readFileSync(file, 'utf8')).toContain('"x_slash": { "type": "rect", "x": 20, "y": -250, "w": 210, "h": 250 }');
  });

  test('別的網站送的、別的埠送的、沒有 Origin 的都拒絕，檔案不變', async () => {
    for (const origin of ['http://evil.example', `http://localhost:${port + 1}`, `https://localhost:${port}`, null]) {
      expect((await put({ base: original, data: edited() }, { origin })).status, String(origin)).toBe(403);
    }
    unchanged();
  });

  test('內容類型不是 JSON 就拒絕', async () => {
    expect((await put({ base: original, data: edited() }, { type: 'text/plain' })).status).toBe(415);
    unchanged();
  });

  test('超過 64 KB 就拒絕', async () => {
    expect((await put({ base: original, data: edited(), pad: 'x'.repeat(70 * 1024) })).status).toBe(413);
    unchanged();
  });

  test('不是合法的 JSON 就拒絕', async () => {
    expect((await put('{oops')).status).toBe(400);
    unchanged();
  });

  test('檔案在工具外被改過就拒絕', async () => {
    expect((await put({ base: `${original} `, data: edited() })).status).toBe(409);
    unchanged();
  });

  test('結構不合格就拒絕並說明原因', async () => {
    const data = edited();
    delete data.body;
    const { status, body } = await put({ base: original, data });
    expect(status).toBe(400);
    expect(body.error).toMatch('body');
    unchanged();
  });
});
