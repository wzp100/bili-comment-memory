// Older background/offscreen scripts may remain alive after unpacked files change.
// Fall back only when the older protocol does not support the new read operation.
export function summaryClient(send) {
  let legacy = false;
  return async (requested, exclude = /** @type {string|null} */ (null)) => {
    const uids = [...new Set(requested)];
    if (!legacy) {
      try {
        const result = await send('summaries', { uids, exclude });
        if (!Array.isArray(result?.items))
          throw new Error('批量查询响应无效，请重新加载扩展后刷新页面');
        // v0.3.0/0.3.1 silently ignore exclude. Require acknowledgement before using totals.
        if (!exclude || result.exclude === exclude) return result;
        legacy = true;
      } catch (error) {
        if (!/^(操作未授权|未知数据库操作)$/.test(error?.message || '')) throw error;
        legacy = true;
      }
    }
    const items = new Array(uids.length);
    let next = 0;
    async function consume() {
      while (next < uids.length) {
        const index = next++,
          uid = uids[index];
        const history = await send('history', { uid, exclude });
        if (!Array.isArray(history?.items) || !Number.isSafeInteger(history.count))
          throw new Error('历史查询响应无效，请重新加载扩展后刷新页面');
        const latest = history.items[0];
        items[index] = {
          uid,
          count: history.count,
          bvid: latest?.bvid || null,
          title: latest?.title || null,
        };
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, uids.length) }, consume));
    return { items, exclude };
  };
}
export function summaryError(error) {
  const detail = String(error?.message || error || '未知错误').slice(0, 300);
  if (
    /context invalidated|receiving end does not exist|message port closed|连接已断开|Extension context/i.test(
      detail,
    )
  )
    return { label: '请刷新 B 站页面', detail };
  if (/重新加载扩展|Worker 启动失败|未知数据库操作|操作未授权/.test(detail))
    return { label: '请重新加载扩展', detail };
  return { label: '本地查询失败（悬停查看）', detail };
}
