const worker = new Worker('database-worker.js', { type: 'module' });
const pending = new Map<string, (r: any) => void>();
worker.onmessage = (e) => {
  const resolve = pending.get(e.data.id);
  if (resolve) {
    pending.delete(e.data.id);
    resolve(e.data.result);
  }
};
worker.onerror = () => {
  for (const resolve of pending.values())
    resolve({ ok: false, error: '数据库 Worker 启动失败，请重新加载扩展' });
  pending.clear();
};
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
  const id = crypto.randomUUID();
  pending.set(id, reply);
  worker.postMessage({ id, op: m.op, payload: m.payload });
  return true;
});
