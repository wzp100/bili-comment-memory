import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchExtension } from './browser-helper.mjs';
import { database, record } from '../tests/helpers.mjs';
await mkdir('output/playwright', { recursive: true });
const profile = await mkdtemp(path.resolve('output/playwright/profile-'));
const extension = path.resolve('dist');
const launch = () => launchExtension(profile, extension);
const report = { started: new Date().toISOString(), checks: [], errors: [] };
let context = await launch();
async function setup() {
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).hostname;
  return { sw, id };
}
let { sw, id } = await setup();
const manager = await context.newPage();
manager.on('pageerror', (e) => report.errors.push(e.message));
await manager.goto(`chrome-extension://${id}/options.html`);
const call = (op, payload = {}) =>
  manager.evaluate(
    async ({ op, payload }) => {
      const r = await chrome.runtime.sendMessage({ target: 'background', op, payload });
      if (!r?.ok) throw new Error(r?.error || 'no reply');
      return r.data;
    },
    { op, payload },
  );
function fixture(title) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><style>body{font:16px sans-serif;padding:30px}bili-comment-renderer{display:block;margin:25px;padding:15px;border:1px solid #ccc;width:600px}#user-avatar{display:inline-block;width:48px;height:48px;background:#d9e8ff;border-radius:24px}</style><h1 class="video-title" title="${title}">${title}</h1><bili-comments></bili-comments><script>
const root=document.querySelector('bili-comments').attachShadow({mode:'open'});
function add(id,uid,text,below=false){const c=document.createElement('bili-comment-renderer');c.dataset.rpid=id;if(below)c.style.marginTop='1800px';const r=c.attachShadow({mode:'open'});r.innerHTML='<style>:host{display:block;width:600px;padding:20px;margin-bottom:20px;border:1px solid #bbb}#user-avatar{display:inline-block;width:48px;height:48px;background:#b8d9d2;border-radius:24px}#body{display:block}</style><div id="body"><a id="user-avatar" href="https://space.bilibili.com/'+uid+'" data-user-profile-id="'+uid+'">头像</a><bili-comment-user-info></bili-comment-user-info><bili-rich-text></bili-rich-text><bili-comment-action-buttons-renderer></bili-comment-action-buttons-renderer></div>';r.querySelector('bili-comment-user-info').attachShadow({mode:'open'}).innerHTML='<div id="user-name"><a href="https://space.bilibili.com/'+uid+'">测试用户 '+uid+'</a><span id="user-level">LV6</span></div>';r.querySelector('bili-rich-text').attachShadow({mode:'closed'}).innerHTML='<p id="contents">'+text+'</p>';r.querySelector('bili-comment-action-buttons-renderer').attachShadow({mode:'open'}).innerHTML='<div id="pubdate">2024-01-02 03:04</div>';root.append(c);}
add('1','12345','这是一条关于中文评论的本地记录 😊');add('2','99999','另一个用户的评论');add('3','12345','这条在视口外，滚动后才记录',true);
</script></html>`;
}
try {
  const stats = await call('stats');
  assert.equal(stats.comments, 0);
  report.sqlite = stats.sqlite;
  report.checks.push('SQLite WASM + OPFS 初始化');
  await context.route('https://www.bilibili.com/video/BV1AA411A7AA/', (r) =>
    r.fulfill({ contentType: 'text/html', body: fixture('视频甲 · 浏览记录') }),
  );
  await context.route('https://www.bilibili.com/video/BV1BB411B7BB/', (r) =>
    r.fulfill({ contentType: 'text/html', body: fixture('视频乙 · 再次遇见') }),
  );
  const a = await context.newPage();
  await a.goto('https://www.bilibili.com/video/BV1AA411A7AA/');
  await a
    .locator('#bili-comment-memory')
    .getByRole('button')
    .filter({ hasText: '本页新增 2 条' })
    .waitFor({ timeout: 20000 });
  assert.equal((await call('stats')).comments, 2);
  report.checks.push('可见评论采集 + closed Shadow DOM + 视口外不采集');
  const b = await context.newPage();
  await b.goto('https://www.bilibili.com/video/BV1BB411B7BB/');
  await b
    .locator('#bili-comment-memory')
    .getByRole('button')
    .filter({ hasText: '本页新增 2 条' })
    .waitFor({ timeout: 20000 });
  const history = await call('history', { uid: '12345', exclude: 'BV1BB411B7BB' });
  assert.equal(history.count, 1);
  assert.equal(history.items[0].title, '视频甲 · 浏览记录');
  report.checks.push('多标签页共用数据库 + 跨视频历史');
  const inline = b.locator('bili-comment-renderer').first().locator('[data-bili-memory-summary]');
  await inline.getByText('其他视频 1 条', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await inline.evaluate((el) => el.previousElementSibling.id), 'user-level');
  assert.equal(
    await inline.getByRole('link').getAttribute('href'),
    'https://www.bilibili.com/video/BV1AA411A7AA/',
  );
  assert.equal(
    await b.locator('bili-comment-renderer').last().locator('[data-bili-memory-summary]').count(),
    0,
  );
  await b.screenshot({ path: 'output/playwright/inline-summary.png' });
  report.checks.push('LV 后本地条数 + 最近记录视频链接 + 视口外不查询');
  await b.locator('a#user-avatar').first().hover();
  const panel = b.getByRole('dialog', { name: '本机历史评论' });
  await panel.getByText('这是一条关于中文评论的本地记录 😊', { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('link').first().getAttribute('href'),
    'https://www.bilibili.com/video/BV1AA411A7AA/',
  );
  await b.screenshot({ path: 'output/playwright/hover.png' });
  report.checks.push('头像悬浮卡 + 原视频超链接');
  await b.keyboard.press('Escape');
  await b.locator('bili-comment-renderer').last().scrollIntoViewIfNeeded();
  await b
    .locator('#bili-comment-memory')
    .getByRole('button')
    .filter({ hasText: '本页新增 3 条' })
    .waitFor();
  assert.equal((await call('stats')).comments, 5);
  await b.reload();
  await b.waitForTimeout(1200);
  assert.equal((await call('stats')).comments, 5);
  report.checks.push('手动滚动增量采集 + 刷新去重');
  await call('setEnabled', { enabled: false });
  await b.locator('bili-comment-renderer').last().scrollIntoViewIfNeeded();
  await b.waitForTimeout(700);
  assert.equal((await call('stats')).comments, 5);
  await call('setEnabled', { enabled: true });
  report.checks.push('暂停开关');
  await manager.bringToFront();
  await manager.reload();
  await manager.getByText('已展示 5 条', { exact: false }).waitFor();
  await manager.screenshot({ path: 'output/playwright/options.png', fullPage: true });
  const meta = await call('exportStart'),
    chunks = [];
  for (let offset = 0; offset < meta.size;) {
    const bytes = Buffer.from((await call('exportChunk', { id: meta.id, offset })).data, 'base64');
    chunks.push(bytes);
    offset += bytes.length;
  }
  const backup = Buffer.concat(chunks);
  await writeFile('output/playwright/backup.sqlite3', backup);
  await call('exportEnd', { id: meta.id });
  await call('clear');
  assert.equal((await call('stats')).comments, 0);
  const incoming = await call('importStart', { size: backup.length });
  for (let offset = 0; offset < backup.length; offset += 192 * 1024)
    await call('importChunk', {
      id: incoming.id,
      offset,
      data: backup.subarray(offset, offset + 192 * 1024).toString('base64'),
    });
  const merged = await call('importFinish', { id: incoming.id });
  assert.equal(merged.inserted, 5);
  assert.equal((await call('search', { keyword: '中文评论' })).items.length, 2);
  report.checks.push('标准 SQLite 导出、清空、导入恢复、中文索引');
  const bad = await call('importStart', { size: 100 });
  await call('importChunk', { id: bad.id, offset: 0, data: Buffer.alloc(100).toString('base64') });
  await assert.rejects(() => call('importFinish', { id: bad.id }), /不是 SQLite/);
  assert.equal((await call('stats')).comments, 5);
  report.checks.push('损坏备份不影响原有记录');
  await b.bringToFront();
  await b.evaluate(() => {
    window.scrollTo(0, 0);
    history.pushState({}, '', '/video/BV1CC411C7CC/');
    document.querySelector('h1').textContent = '视频丙';
    document.querySelector('h1').setAttribute('title', '视频丙');
  });
  await b.waitForTimeout(2500);
  assert.equal((await call('search', { bvid: 'BV1CC411C7CC' })).items.length, 0);
  report.checks.push('SPA 切视频时保留的旧评论不串视频');
  await call('setEnabled', { enabled: false });
  await b.evaluate(() => {
    const c = document
      .querySelector('bili-comments')
      .shadowRoot.querySelector('bili-comment-renderer');
    c.dataset.rpid = '777';
    const r = c.shadowRoot;
    r.querySelector('#user-avatar').href = 'https://space.bilibili.com/55555';
    r.querySelector('#user-avatar').setAttribute('data-user-profile-id', '55555');
    const text = document.createElement('bili-rich-text');
    text.attachShadow({ mode: 'open' }).innerHTML = '<p id="contents">节点复用后的新评论</p>';
    r.querySelector('bili-rich-text').replaceWith(text);
  });
  await b.waitForTimeout(800);
  assert.equal((await call('history', { uid: '55555' })).count, 0);
  await inline.getByText('其他视频 0 条', { exact: true }).waitFor();
  assert.equal(await inline.getByRole('link').count(), 0);
  await call('setEnabled', { enabled: true });
  await b.waitForTimeout(1200);
  const reused = await call('history', { uid: '55555' });
  assert.equal(reused.count, 1);
  assert.equal(reused.items[0].bvid, 'BV1CC411C7CC');
  report.checks.push('暂停期间真实新增不采集 + 恢复记录 + 虚拟节点复用');
  await inline.getByText('其他视频 0 条', { exact: true }).waitFor();
  assert.equal(await inline.getByRole('link').count(), 0);
  report.checks.push('暂停仍可查本地 + UID 复用不串摘要 + 写入后即时更新');
  await call('deleteUser', { uid: '55555' });
  assert.equal((await call('stats')).comments, 5);
  await manager.bringToFront();
  await manager.getByRole('button', { name: '压缩数据库', exact: true }).click();
  await manager
    .locator('#operation-state')
    .filter({ hasText: '压缩完成' })
    .waitFor({ timeout: 30000 });
  assert.equal((await call('stats')).comments, 5);
  assert.equal((await call('search', { keyword: '中文评论' })).items.length, 2);
  report.checks.push('压缩数据库按钮 + 压缩后数据和全文搜索保留');
  const legacyPath = path.join(profile, 'legacy-backup.sqlite3'),
    legacy = database(legacyPath, await readFile('tests/fixtures/v1.sql', 'utf8'));
  legacy.repo.ingest([await record({ uid: '77777', rpid: '88888', body: '来自旧版本的中文评论' })]);
  legacy.db.close();
  const oldBytes = await readFile(legacyPath),
    oldTransfer = await call('importStart', { size: oldBytes.length });
  for (let offset = 0; offset < oldBytes.length; offset += 192 * 1024)
    await call('importChunk', {
      id: oldTransfer.id,
      offset,
      data: oldBytes.subarray(offset, offset + 192 * 1024).toString('base64'),
    });
  assert.equal((await call('importFinish', { id: oldTransfer.id })).inserted, 1);
  assert.equal((await call('search', { keyword: '来自旧版本' })).items.length, 1);
  await call('deleteUser', { uid: '77777' });
  report.checks.push('v1 SQLite 备份可导入新版本精简索引');
  await context.close();
  context = await launch();
  ({ sw, id } = await setup());
  const restarted = await context.newPage();
  await restarted.goto(`chrome-extension://${id}/options.html`);
  await restarted.getByText('已展示 5 条', { exact: false }).waitFor({ timeout: 20000 });
  report.checks.push('浏览器重启后 OPFS 数据恢复');
  report.chrome = context.browser()?.version();
  report.success = true;
} catch (e) {
  report.errors.push(e.stack);
  report.success = false;
  throw e;
} finally {
  await writeFile('output/playwright/report.json', JSON.stringify(report, null, 2), 'utf8');
  await context.close();
  console.log(JSON.stringify(report, null, 2));
}
