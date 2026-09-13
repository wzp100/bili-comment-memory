import { rpc, videoUrl, pageBV } from './shared.mjs';
import { extract, summaryAnchor } from './adapter';
import { element } from './ui';
import { summaryClient, summaryError } from './summary-client.mjs';

type Summary = { uid: string; count: number; bvid: string | null; title: string | null };
export function inlineSummaries(comments: () => Iterable<Element>) {
  const query = summaryClient(rpc);
  const cache = new Map<string, { row: Summary; expires: number }>();
  const views = new Map<Element, { host: HTMLElement; root: ShadowRoot; key: string }>();
  let timer = 0,
    busy = false,
    revision = 0,
    retryAt = 0;
  let lastError: ReturnType<typeof summaryError> | undefined;
  let currentVideo = pageBV(location.href);
  function remove(comment: Element) {
    views.get(comment)?.host.remove();
    views.delete(comment);
  }
  function draw(
    comment: Element,
    uid: string,
    row?: Summary,
    error?: ReturnType<typeof summaryError>,
  ) {
    const anchor = summaryAnchor(comment);
    if (!anchor?.isConnected) {
      remove(comment);
      return;
    }
    let view = views.get(comment);
    if (!view || view.host.previousElementSibling !== anchor) {
      remove(comment);
      const host = element('span');
      host.dataset.biliMemorySummary = '';
      host.style.cssText =
        'display:inline-flex;vertical-align:middle;max-width:min(360px,65vw);margin-left:6px;';
      const root = host.attachShadow({ mode: 'open' });
      anchor.after(host);
      view = { host, root, key: '' };
      views.set(comment, view);
    }
    const key = JSON.stringify([uid, row, error]);
    if (view.key === key) return;
    view.key = key;
    const style = element(
      'style',
      `:host{font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#7a8699}span{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%}b{font-weight:normal;white-space:nowrap;color:#488b86}a{color:#4089a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;min-width:0}a:hover{text-decoration:underline}a:focus-visible{outline:2px solid #4089a3}`,
    );
    const line = element('span');
    line.title = error
      ? `${error.label}：${error.detail}。在扩展管理页重新加载后刷新 B 站页面；无需卸载扩展。`
      : '本机已记录的其他视频评论，排除当前视频；最近记录按首次记录时间排序，不代表最新发表时间。';
    line.append(
      element(
        'b',
        row
          ? `其他视频 ${row.count} 条${error ? '（暂未更新）' : ''}`
          : error
            ? error.label
            : '本地查询中…',
      ),
    );
    if (row?.bvid) {
      const link = element('a', `最近记录：${row.title || row.bvid}`);
      link.href = videoUrl(row.bvid);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = `最近记录的视频：${row.title || row.bvid}（${row.bvid}）`;
      line.append(link);
    }
    view.root.replaceChildren(style, line);
  }
  function refresh() {
    if (!timer)
      timer = window.setTimeout(() => {
        timer = 0;
        void run();
      }, 200);
  }
  async function run() {
    if (document.visibilityState !== 'visible') return;
    const video = pageBV(location.href);
    if (!video) return;
    if (video !== currentVideo) {
      currentVideo = video;
      revision++;
      cache.clear();
      for (const comment of views.keys()) remove(comment);
    }
    const groups = new Map<string, Element[]>(),
      now = Date.now();
    for (const comment of comments()) {
      if (!comment.isConnected) continue;
      const data = extract(comment);
      if (!data) {
        remove(comment);
        continue;
      }
      if (groups.size >= 300 && !groups.has(data.uid)) continue;
      const rect = data.bodyEl.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth ||
        !(data.bodyEl as HTMLElement).checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      )
        continue;
      const group = groups.get(data.uid) || [];
      group.push(comment);
      groups.set(data.uid, group);
    }
    for (const comment of views.keys()) if (!comment.isConnected) remove(comment);
    const missing: string[] = [];
    for (const [uid, group] of groups) {
      const entry = cache.get(uid);
      if (!entry || entry.expires <= now) missing.push(uid);
      for (const comment of group)
        draw(comment, uid, entry?.row, !entry || entry.expires <= now ? lastError : undefined);
    }
    if (busy || !missing.length || retryAt > now) return;
    busy = true;
    const generation = revision,
      uids = missing.slice(0, 50);
    try {
      const result = await query(uids, video);
      if (generation !== revision || video !== pageBV(location.href)) return;
      for (const row of result.items as Summary[]) {
        cache.delete(row.uid);
        cache.set(row.uid, { row, expires: Date.now() + 30000 });
      }
      while (cache.size > 300) cache.delete(cache.keys().next().value!);
      retryAt = 0;
      lastError = undefined;
    } catch (error) {
      lastError = summaryError(error);
      retryAt = Date.now() + 5000;
    } finally {
      busy = false;
      refresh();
    }
  }
  return {
    refresh,
    invalidate(uids: string[]) {
      revision++;
      for (const uid of uids) cache.delete(uid);
      retryAt = 0;
      refresh();
    },
    reset() {
      revision++;
      for (const comment of views.keys()) remove(comment);
      cache.clear();
      retryAt = 0;
      refresh();
    },
  };
}
