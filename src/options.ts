import { rpc, bytesToBase64, base64ToBytes, UID } from './shared.mjs';
import { recordCard, element } from './ui';
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const state = $('search-state'),
  results = $('results'),
  more = $('more') as HTMLButtonElement,
  operation = $('operation-state');
const format = (n: number) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + ' MiB' : (n / 1024).toFixed(0) + ' KiB';
let cursor: any = null,
  filters: any = {},
  generation = 0,
  count = 0;
function message(el: HTMLElement, text: string, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
}
async function stats() {
  const s = await rpc('stats');
  for (const key of ['comments', 'users', 'videos'])
    $('total-' + key).textContent = s[key].toLocaleString('zh-CN');
  $('total-bytes').textContent = format(s.bytes);
  $('free-bytes').textContent = '其中整页空闲 ' + format(s.freeBytes);
  $('engine').textContent = 'SQLite ' + s.sqlite;
  $('quota').textContent = '当前存储配额 ' + format(s.storage.quota || 0);
}
async function search(reset = false) {
  const request = ++generation;
  more.disabled = true;
  if (reset) {
    cursor = null;
    count = 0;
    results.replaceChildren();
    filters = {};
    for (const k of ['uid', 'name', 'bvid', 'keyword']) filters[k] = input(k).value.trim();
    for (const k of ['from', 'to'])
      if (input(k).value)
        filters[k] = new Date(
          input(k).value + (k === 'from' ? 'T00:00:00' : 'T23:59:59.999'),
        ).getTime();
  }
  message(state, '正在查询本地记录…');
  try {
    const r = await rpc('search', { ...filters, cursor });
    if (request !== generation) return;
    for (const row of r.items) results.append(recordCard(row));
    count += r.items.length;
    cursor = r.next;
    more.hidden = !cursor;
    more.textContent = r.partialScan ? '继续检索下一批' : '加载更多';
    message(
      state,
      `已展示 ${count} 条` +
        (r.partialScan ? ' · 按批检索，可继续加载' : '') +
        (cursor ? '' : ' · 已到末尾'),
    );
    if (!count && !cursor)
      results.append(
        element('div', '还没有匹配的记录。\n浏览 B 站评论区后，记录会出现在这里。', 'empty'),
      );
  } catch (e: any) {
    if (request === generation) message(state, e.message, true);
  } finally {
    if (request === generation) more.disabled = false;
  }
}
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  void search(true);
});
more.onclick = () => void search();
input('enabled').onchange = () =>
  rpc('setEnabled', { enabled: input('enabled').checked }).catch((e) =>
    message(operation, e.message, true),
  );
async function run(action: () => Promise<void>) {
  const controls = [...document.querySelectorAll<HTMLButtonElement>('#data button')],
    file = input('import');
  controls.forEach((b) => (b.disabled = true));
  file.disabled = true;
  try {
    await action();
    await stats();
    await search(true);
  } catch (e: any) {
    message(operation, e.message, true);
  } finally {
    controls.forEach((b) => (b.disabled = false));
    file.disabled = false;
  }
}
$('export').onclick = () =>
  void run(async () => {
    const meta = await rpc('exportStart');
    const chunks: Uint8Array[] = [];
    try {
      for (let offset = 0; offset < meta.size;) {
        const part = base64ToBytes((await rpc('exportChunk', { id: meta.id, offset })).data);
        if (!part.length) throw new Error('备份分块为空');
        chunks.push(part);
        offset += part.length;
        message(operation, '正在导出 ' + Math.round((offset / meta.size) * 100) + '%');
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.sqlite3' }),
        url = URL.createObjectURL(blob),
        a = element('a');
      a.href = url;
      a.download = 'bili-comments-' + new Date().toISOString().slice(0, 10) + '.sqlite3';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      message(operation, '备份已生成，请保留下载的 SQLite 文件。');
    } finally {
      await rpc('exportEnd', { id: meta.id });
    }
  });
input('import').onchange = () => {
  const file = input('import').files?.[0];
  if (!file) return;
  void run(async () => {
    const meta = await rpc('importStart', { size: file.size });
    try {
      for (let offset = 0; offset < file.size;) {
        const part = new Uint8Array(await file.slice(offset, offset + 192 * 1024).arrayBuffer());
        await rpc('importChunk', { id: meta.id, offset, data: bytesToBase64(part) });
        offset += part.length;
        message(operation, '正在上传备份 ' + Math.round((offset / file.size) * 100) + '%');
      }
      message(operation, '正在校验并去重合并，请保持此页开启…');
      const r = await rpc('importFinish', { id: meta.id });
      message(operation, `合并完成：读取 ${r.received} 条，新增 ${r.inserted} 条。`);
    } finally {
      await rpc('importCancel', { id: meta.id });
      input('import').value = '';
    }
  });
};
$('delete-user').onclick = () => {
  const uid = prompt('输入要删除记录的用户 UID：', input('uid').value);
  if (!uid) return;
  if (!UID.test(uid)) {
    message(operation, 'UID 格式无效', true);
    return;
  }
  if (!confirm('确定删除 UID ' + uid + ' 的全部本机记录？')) return;
  void run(async () => {
    await rpc('deleteUser', { uid });
    message(operation, '已删除该用户的本机记录；以后再次浏览到时仍会记录。');
  });
};
$('clear').onclick = () => {
  if (!confirm('确定清空全部本机评论记录？建议先导出备份。')) return;
  void run(async () => {
    await rpc('clear');
    message(operation, '全部记录已清空。');
  });
};
$('compact').onclick = () =>
  void run(async () => {
    message(
      operation,
      '正在压缩数据库，不删除评论。大数据库可能需要数十秒，请保持页面开启；期间查询和写入会等待。',
    );
    const r = await rpc('compact');
    message(
      operation,
      `压缩完成：${format(r.before)} → ${format(r.after)}，释放 ${format(r.savedBytes)}。`,
    );
  });
rpc('settings')
  .then((s) => (input('enabled').checked = s.enabled))
  .catch((e) => message(operation, e.message, true));
stats()
  .then(() => search(true))
  .catch((e) => message(state, e.message, true));
