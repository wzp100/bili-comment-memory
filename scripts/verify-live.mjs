import { launchExtension } from './browser-helper.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('output/playwright', { recursive: true });
const profile = await mkdtemp(path.resolve('output/playwright/live-profile-'));
const context = await launchExtension(profile, path.resolve('dist'));
const report = {
  checkedAt: new Date().toISOString(),
  url: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
  extensionNetwork: [],
  errors: [],
};
try {
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker')),
    id = new URL(sw.url()).hostname;
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/options.html`);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    if (
      /^https?:/.test(e.request.url) &&
      JSON.stringify(e.initiator).includes(`chrome-extension://${id}/`)
    )
      report.extensionNetwork.push(e.request.url);
  });
  page.on('pageerror', (e) => {
    if (e.stack?.includes(id)) report.errors.push(e.stack);
  });
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.locator('bili-comments').scrollIntoViewIfNeeded();
  await page.locator('bili-comment-renderer').first().waitFor({ timeout: 20000 });
  await page.locator('bili-comment-renderer').first().scrollIntoViewIfNeeded();
  await page
    .locator('#bili-comment-memory')
    .getByRole('button')
    .filter({ hasText: /本页新增 [1-9]/ })
    .waitFor({ timeout: 20000 });
  const rows = await manager.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ target: 'background', op: 'search', payload: {} });
    if (!r.ok) throw new Error(r.error);
    return r.data.items;
  });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.uid && r.bvid === 'BV1GJ411x7h7' && !r.body.includes(':host')));
  report.records = rows.map((r) => ({
    uid: r.uid,
    bodyLength: r.body.length,
    rpidPresent: !!r.rpid,
    publishedAt: r.published_at,
    video: r.bvid,
  }));
  await page.locator('bili-comment-renderer a#user-avatar').first().hover();
  await page.getByRole('dialog', { name: '本机历史评论' }).waitFor();
  await page.screenshot({ path: 'output/playwright/live-hover.png' });
  assert.equal(report.extensionNetwork.length, 0);
  report.success = true;
} catch (e) {
  report.success = false;
  report.errors.push(e.stack);
  throw e;
} finally {
  await writeFile('output/playwright/live-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}
