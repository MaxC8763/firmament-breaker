import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveUrl } from './server.mjs';

const dirs = { buildDir: 'art/build', placeholderDir: 'art/placeholder' };

describe('對齊工具伺服器的網址對應', () => {
  test('各資料夾的檔案', () => {
    expect(resolveUrl('/build/manifest.json', dirs)).toBe(path.resolve('art/build/manifest.json'));
    expect(resolveUrl('/placeholder/hero/idle/idle_00.png', dirs)).toBe(path.resolve('art/placeholder/hero/idle/idle_00.png'));
    expect(resolveUrl('/hitboxes.json', dirs)).toBe(path.resolve('src/data/hitboxes.json'));
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
