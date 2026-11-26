#!/usr/bin/env node
/**
 * 對部署好的網站做冒煙測試：npm run smoke -- <網址> [--sha <commit>]
 *
 * 1. 有 --sha 時，輪詢 <網址>version.json 直到 commit 對上（最多 15 分鐘），確認測到的是這次的版本
 * 2. 用 Chromium 開網頁，等遊戲設好 data-game="ready"
 * 3. 不能有 console error；截圖存到 test-results/smoke.png
 */
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const target = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sha');
const shaAt = argv.indexOf('--sha');
const sha = shaAt >= 0 ? argv[shaAt + 1] : undefined;
if (!target || (shaAt >= 0 && !sha)) {
  console.error('用法：npm run smoke -- <網址> [--sha <commit>]');
  process.exit(2);
}
const base = target.endsWith('/') ? target : `${target}/`;

const WAIT_MS = 15 * 60_000;
const POLL_MS = 5_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCommit() {
  try {
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return `HTTP ${res.status}`;
    return (await res.json()).commit;
  } catch (e) {
    return `連不上（${e.cause?.code ?? e.message}）`;
  }
}

async function waitForVersion() {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const got = await fetchCommit();
    if (!sha) return console.log(`version.json：${got}`);
    if (got === sha) return console.log(`version.json 已是 ${sha}`);
    if (Date.now() > deadline) throw new Error(`等了 15 分鐘，version.json 還是 ${got}，不是 ${sha}`);
    console.log(`等新版本上線：目前 ${got}`);
    await sleep(POLL_MS);
  }
}

async function main() {
  await waitForVersion();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.game === 'ready', null, { timeout: 60_000 });
    await page.screenshot({ path: 'test-results/smoke.png' });
    if (errors.length) throw new Error(`console error：\n${errors.join('\n')}`);
  } finally {
    await browser.close();
  }
  console.log(`smoke 通過：${base}`);
}

main().catch((e) => {
  console.error(`smoke 失敗：${e.message}`);
  process.exit(1);
});
