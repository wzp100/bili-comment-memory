import { launchExtension } from './browser-helper.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(process.env.BILI_UPGRADE_PROFILE || '');
if (
  !profile.startsWith(path.resolve('output/playwright') + path.sep) ||
  !/^profile-[A-Za-z0-9]+$/.test(path.basename(profile))
)
  throw new Error('仅可使用此前建立的专用 v1 测试配置');
const context = await launchExtension(profile, path.resolve('dist'));
try {
  const extensions = await context.newPage();
  await extensions.goto('chrome://extensions');
  const devMode = extensions.locator('extensions-toolbar #devMode');
  if ((await devMode.getAttribute('aria-pressed')) !== 'true') await devMode.click();
  const card = extensions.locator('extensions-item').filter({ hasText: 'B 站评论记忆' });
  const id = await card.getAttribute('id');
  assert.ok(id);
  // 真正点击扩展管理页的更新按钮，避免 CDP 加载后旧后台仍驻留。
  await card.locator('#dev-reload-button').click();
  const page = await context.newPage();
  const start = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`chrome-extension://${id}/options.html`, { timeout: 2000 });
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const call = (op, payload = {}) =>
    page.evaluate(
      async ({ op, payload }) => {
        const r = await chrome.runtime.sendMessage({ target: 'background', op, payload });
        if (!r.ok) throw new Error(r.error);
        return r.data;
      },
      { op, payload },
    );
  const stats = await call('stats');
  assert.equal(stats.comments, 5);
  assert.equal((await call('search', { keyword: '中文评论' })).items.length, 2);
  const meta = await call('exportStart'),
    head = Buffer.from((await call('exportChunk', { id: meta.id, offset: 0 })).data, 'base64');
  await call('exportEnd', { id: meta.id });
  assert.equal(head.readUInt32BE(60), 2);
  const compact = await call('compact');
  assert.equal((await call('stats')).comments, 5);
  const report = {
    success: true,
    comments: stats.comments,
    schemaVersion: 2,
    elapsedMs: performance.now() - start,
    compact,
  };
  await writeFile('output/playwright/upgrade-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
