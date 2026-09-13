import { rpc, pageBV } from './shared.mjs';
import { COMMENT_SELECTOR, shadow, owner, extract } from './adapter';
import { element, recordCard, cardStyle } from './ui';
import { inlineSummaries } from './inline-summary';
const host = element('div');
host.id = 'bili-comment-memory';
document.documentElement.append(host);
const ui = host.attachShadow({ mode: 'open' });
const style = element('style', cardStyle);
ui.append(style);
const badge = element('button', '评论记忆 · 初始化', 'badge');
badge.title = '打开本地评论记录';
badge.onclick = () => void rpc('openOptions');
ui.append(badge);
let enabled = true,
  session = pageBV(location.href),
  recorded = 0,
  statusTimer = 0;
function status(text: string, error = false) {
  badge.textContent = '评论记忆 · ' + text;
  badge.classList.toggle('error', error);
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => void rpc('status', { text }).catch(() => {}), 300);
}
let panel: HTMLElement | null = null,
  active: Element | null = null,
  openTimer = 0,
  closeTimer = 0,
  queryGeneration = 0;
function close() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  queryGeneration++;
  panel?.remove();
  panel = null;
  active = null;
}
function closeLater() {
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(close, 350);
}
async function show(anchor: Element, comment: Element) {
  const data = extract(comment);
  if (!data) return;
  close();
  active = anchor;
  const generation = ++queryGeneration;
  panel = element('section', '', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '本机历史评论');
  const top = element('div', '', 'top'),
    quit = element('button', '×');
  quit.setAttribute('aria-label', '关闭');
  quit.onclick = close;
  top.append(element('strong', '本机评论记忆'), quit);
  const summary = element('div', data.name + ' · UID ' + data.uid, 'sub');
  const include = element('input');
  include.type = 'checkbox';
  const label = element('label');
  label.append(include, document.createTextNode(' 包含当前视频'));
  const list = element('div'),
    actions = element('div', '', 'actions'),
    more = element('button', '加载更多'),
    manage = element('button', '查看全部记录');
  more.hidden = true;
  manage.onclick = () => void rpc('openOptions');
  actions.append(more, manage);
  panel.append(top, summary, label, list, actions);
  ui.append(panel);
  panel.onmouseenter = () => clearTimeout(closeTimer);
  panel.onmouseleave = closeLater;
  panel.addEventListener('focusin', () => clearTimeout(closeTimer));
  let cursor: any = null,
    request = 0;
  async function load(reset = false) {
    const requestId = ++request;
    if (reset) {
      cursor = null;
      list.replaceChildren(element('div', '正在查询本地记录…', 'message'));
    }
    more.disabled = true;
    try {
      const result = await rpc('history', {
        uid: data!.uid,
        exclude: include.checked ? null : data!.bvid,
        cursor,
      });
      if (generation !== queryGeneration || requestId !== request) return;
      if (reset) list.replaceChildren();
      summary.textContent = `${data!.name} · UID ${data!.uid} · ${result.count} 条 / ${result.videos} 个视频`;
      for (const row of result.items) list.append(recordCard(row));
      if (!list.childElementCount)
        list.append(
          element(
            'div',
            '本机暂无该用户' + (include.checked ? '' : '在其他视频下') + '的记录',
            'message',
          ),
        );
      cursor = result.next;
      more.hidden = !cursor;
      position();
    } catch (e: any) {
      if (generation === queryGeneration)
        list.replaceChildren(element('div', e.message, 'message error'));
    } finally {
      more.disabled = false;
    }
  }
  include.onchange = () => void load(true);
  more.onclick = () => void load();
  position();
  await load(true);
}
function position() {
  if (!panel || !active) return;
  const r = active.getBoundingClientRect(),
    h = panel.offsetHeight;
  const top = r.top - h - 10 >= 8 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10);
  panel.style.left = Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8)) + 'px';
  panel.style.top = Math.max(8, top) + 'px';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});
window.addEventListener('resize', position);
const bound = new WeakSet<Element>();
function bindAvatar(comment: Element) {
  const data = extract(comment),
    a = data?.avatar;
  if (!a || bound.has(a)) return;
  bound.add(a);
  a.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = window.setTimeout(() => void show(a, comment), 300);
  });
  a.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    closeLater();
  });
  a.addEventListener('focus', () => void show(a, comment));
  a.addEventListener('blur', closeLater);
}
let seen = new WeakMap<Element, string>();
let stale = new WeakMap<Element, string>();
const identity = (d: any) => JSON.stringify([d.uid, d.rpid, d.body, d.context, d.complete]);
const tracked = new Set<Element>(),
  visible = new Set<Element>(),
  observers = new Map<Node, MutationObserver>(),
  pendingRoots = new Set<Element>();
const inline = inlineSummaries(() => visible);
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const c = owner(e.target);
      if (!c) continue;
      if (e.isIntersecting) {
        visible.add(c);
        capture(c);
      } else visible.delete(c);
    }
  },
  { threshold: 0.01 },
);
const observedBody = new WeakMap<Element, Element>();
function track(c: Element) {
  tracked.add(c);
  bindAvatar(c);
  const body = extract(c)?.bodyEl || c;
  if (observedBody.get(c) !== body) {
    const previous = observedBody.get(c);
    if (previous) io.unobserve(previous);
    io.observe(body);
    observedBody.set(c, body);
  }
  if (visible.has(c)) capture(c);
  inline.refresh();
}
const queue: any[] = [];
let flushing = false,
  flushTimer = 0,
  retryDelay = 1000;
function capture(c: Element) {
  inline.refresh();
  if (
    !enabled ||
    document.visibilityState !== 'visible' ||
    pageBV(location.href) !== session ||
    !c.isConnected
  )
    return;
  const data = extract(c);
  if (!data) return;
  const body = data.bodyEl as HTMLElement,
    rect = body.getBoundingClientRect();
  const previous = stale.get(c);
  if (previous === identity(data)) return;
  if (previous) stale.delete(c);
  if (
    !rect.width ||
    !rect.height ||
    rect.bottom <= 0 ||
    rect.top >= innerHeight ||
    rect.right <= 0 ||
    rect.left >= innerWidth ||
    !body.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return;
  const key = JSON.stringify([
    data.bvid,
    data.uid,
    data.rpid,
    data.body,
    data.context,
    data.complete,
  ]);
  if (seen.get(c) === key) return;
  if (queue.length >= 1000) {
    status('写入队列已满，请稍后继续浏览', true);
    return;
  }
  const { avatar, bodyEl, ...record } = data;
  queue.push({ ...record, firstSeen: Date.now(), lastSeen: Date.now() });
  seen.set(c, key);
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), queue.length >= 50 ? 0 : 500);
}
async function flush() {
  if (flushing || !queue.length || !enabled) return;
  flushing = true;
  const batch = queue.slice(0, 50);
  try {
    const result = await rpc('ingest', { requestId: crypto.randomUUID(), records: batch });
    const sent = new Set(batch);
    for (let i = queue.length - 1; i >= 0; i--) if (sent.has(queue[i])) queue.splice(i, 1);
    if (!result.paused && enabled) {
      inline.invalidate(batch.map((r) => r.uid));
      if (batch.every((r) => r.bvid === session)) recorded += result.inserted;
      status(`本页新增 ${recorded} 条`);
    }
    retryDelay = 1000;
  } catch (e: any) {
    status('保存失败：' + e.message, true);
    retryDelay = Math.min(30000, retryDelay * 2);
  } finally {
    flushing = false;
    if (queue.length) flushTimer = window.setTimeout(() => void flush(), retryDelay);
  }
}
function observe(root: Node) {
  if (observers.has(root)) return;
  const observer = new MutationObserver((records) => {
    if (pageBV(location.href) !== session) {
      reset();
      return;
    }
    const changed = new Set<Element>();
    for (const r of records) {
      if (
        r.type === 'childList' &&
        [...r.addedNodes, ...r.removedNodes].every(
          (n) => n instanceof Element && n.hasAttribute('data-bili-memory-summary'),
        )
      )
        continue;
      const c = owner(r.target);
      if (c) changed.add(c);
      for (const n of r.addedNodes) if (n instanceof Element) discover(n);
    }
    for (const c of changed) track(c);
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: root !== document.body,
    attributeFilter:
      root === document.body
        ? undefined
        : ['href', 'data-rpid', 'data-id', 'data-user-profile-id', 'class', 'style'],
  });
  observers.set(root, observer);
}
function discover(root: Element | ShadowRoot | Document) {
  if (root === host || root === ui) return;
  if (root instanceof Element && root.matches(COMMENT_SELECTOR)) track(root);
  for (const c of root.querySelectorAll(COMMENT_SELECTOR)) track(c);
  const candidates =
    root instanceof Element
      ? [
          root,
          ...root.querySelectorAll(
            'bili-comments,bili-comment-thread-renderer,bili-comment-renderer,bili-comment-reply-renderer,bili-comment-replies-renderer,bili-comment-user-info,bili-rich-text,bili-comment-action-buttons-renderer',
          ),
        ]
      : [
          ...root.querySelectorAll(
            'bili-comments,bili-comment-thread-renderer,bili-comment-renderer,bili-comment-reply-renderer,bili-comment-replies-renderer,bili-comment-user-info,bili-rich-text,bili-comment-action-buttons-renderer',
          ),
        ];
  for (const el of candidates) {
    const s = shadow(el);
    if (s && !observers.has(s)) {
      pendingRoots.delete(el);
      observe(s);
      discover(s);
    } else if (!s && el.localName.startsWith('bili-')) pendingRoots.add(el);
  }
}
function reset() {
  inline.reset();
  const changed = pageBV(location.href) !== session;
  stale = new WeakMap();
  if (changed)
    for (const c of tracked) {
      const data = extract(c);
      if (data) stale.set(c, identity(data));
    }
  for (const observer of observers.values()) observer.disconnect();
  observers.clear();
  pendingRoots.clear();
  io.disconnect();
  tracked.clear();
  visible.clear();
  seen = new WeakMap();
  session = pageBV(location.href);
  recorded = 0;
  close();
  observe(document.body);
  discover(document);
  status(enabled ? '等待可见评论' : '已暂停');
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      queue.length = 0;
      status('已暂停');
    } else {
      seen = new WeakMap();
      for (const c of visible) capture(c);
      status('记录已开启');
    }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') for (const c of visible) capture(c);
});
window.addEventListener(
  'scroll',
  () => {
    position();
    if (pageBV(location.href) !== session) reset();
  },
  { passive: true },
);
// Lightweight recovery for components attaching their shadow root after insertion and SPA URL changes.
setInterval(() => {
  if (pageBV(location.href) !== session) {
    reset();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  for (const [root, obs] of observers)
    if (root instanceof ShadowRoot && !root.host.isConnected) {
      obs.disconnect();
      observers.delete(root);
    }
  for (const c of tracked)
    if (!c.isConnected) {
      tracked.delete(c);
      visible.delete(c);
      const b = observedBody.get(c);
      if (b) io.unobserve(b);
    }
  for (const el of pendingRoots) {
    if (!el.isConnected) {
      pendingRoots.delete(el);
      continue;
    }
    const s = shadow(el);
    if (s) {
      pendingRoots.delete(el);
      observe(s);
      discover(s);
      const c = owner(el);
      if (c) track(c);
    }
  }
  for (const c of visible) capture(c);
}, 2000);
rpc('settings')
  .then((settings) => {
    enabled = settings.enabled;
    reset();
  })
  .catch((e) => status(e.message, true));
