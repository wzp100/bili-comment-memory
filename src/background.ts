import { pageBV } from './shared.mjs';
let creating: Promise<void> | undefined;
async function ensureDatabase() {
  if (creating) return creating;
  creating = (async () => {
    const found = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (!found.length)
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: '在单个 Worker 内运行本地 SQLite，持久化用户浏览到的评论。',
      });
  })();
  try {
    await creating;
  } finally {
    creating = undefined;
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'background') return;
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('消息来源无效');
    const page = pageBV(sender.url || '');
    const internal =
      !!sender.url &&
      ['options.html', 'popup.html'].some(
        (file) => sender.url!.split(/[?#]/)[0] === chrome.runtime.getURL(file),
      );
    if (!internal && (!page || sender.frameId !== 0)) throw new Error('不支持的页面');
    const { op, payload = {} } = message;
    const allowed = internal
      ? [
          'settings',
          'setEnabled',
          'stats',
          'summaries',
          'history',
          'search',
          'deleteUser',
          'clear',
          'compact',
          'exportStart',
          'exportChunk',
          'exportEnd',
          'importStart',
          'importChunk',
          'importFinish',
          'importCancel',
          'openOptions',
          'pageStatus',
          'status',
        ]
      : ['settings', 'ingest', 'summaries', 'history', 'status', 'openOptions'];
    if (!allowed.includes(op)) throw new Error('操作未授权');
    if (op === 'settings')
      return { enabled: (await chrome.storage.local.get('enabled')).enabled !== false };
    if (op === 'setEnabled') {
      if (typeof payload.enabled !== 'boolean') throw new Error('设置无效');
      await chrome.storage.local.set({ enabled: payload.enabled });
      return { enabled: payload.enabled };
    }
    if (op === 'openOptions') {
      await chrome.runtime.openOptionsPage();
      return {};
    }
    if (op === 'status') {
      if (sender.tab?.id)
        await chrome.storage.session.set({
          ['tab:' + sender.tab.id]: {
            text: String(payload.text || '').slice(0, 300),
            updated: Date.now(),
          },
        });
      return {};
    }
    if (op === 'pageStatus') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id
        ? (await chrome.storage.session.get('tab:' + tab.id))['tab:' + tab.id] || {}
        : {};
    }
    if (op === 'ingest') {
      if ((await chrome.storage.local.get('enabled')).enabled === false)
        return { paused: true, inserted: 0 };
      if (
        !Array.isArray(payload.records) ||
        payload.records.length > 50 ||
        JSON.stringify(payload).length > 1800000
      )
        throw new Error('采集批次过大');
      // The immutable page session may finish sending after a same-origin SPA navigation.
      if (payload.records.some((r: any) => !pageBV(`https://www.bilibili.com/video/${r.bvid}/`)))
        throw new Error('视频来源无效');
    }
    await ensureDatabase();
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', op, payload });
    if (!result?.ok) throw new Error(result?.error || '数据库暂无响应');
    return result.data;
  })().then(
    (data) => reply({ ok: true, data }),
    (error) => reply({ ok: false, error: String(error.message || error) }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener((id) => {
  void chrome.storage.session.remove('tab:' + id);
});
