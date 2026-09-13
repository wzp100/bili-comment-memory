import { cleanText, parseDate, UID, pageBV } from './shared.mjs';
export const COMMENT_SELECTOR =
  'bili-comment-renderer,bili-comment-reply-renderer,.reply-item,.sub-reply-item,.reply-wrap';
export function shadow(el: Element): ShadowRoot | null {
  try {
    return el.shadowRoot || (chrome as any).dom?.openOrClosedShadowRoot(el) || null;
  } catch {
    return null;
  }
}
export function parent(el: Node): Node | null {
  return el.parentNode || (el instanceof ShadowRoot ? el.host : null);
}
export function owner(node: Node): Element | null {
  let n: Node | null = node;
  while (n) {
    if (n instanceof Element && n.matches(COMMENT_SELECTOR)) return n;
    n = parent(n);
  }
  return null;
}
function ownedQuery(el: Element, selector: string): Element | null {
  const queue: (Element | ShadowRoot)[] = [shadow(el) || el];
  while (queue.length) {
    const r = queue.shift()!;
    for (const match of r.querySelectorAll(selector)) if (owner(match) === el) return match;
    for (const child of r.querySelectorAll('*')) {
      if (child.matches(COMMENT_SELECTOR)) continue;
      const s = shadow(child);
      if (s && owner(child) === el) queue.push(s);
    }
  }
  return null;
}
export function textOnly(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return root.textContent || '';
  if (root instanceof Element) {
    if (root.matches('style,script,button,[hidden],[data-bili-memory-summary]')) return '';
    if (root.tagName === 'IMG') return root.getAttribute('alt') || '';
    if (root.tagName === 'BR') return '\n';
  }
  return Array.from(root.childNodes).map(textOnly).join('');
}
export function summaryAnchor(comment: Element): Element | null {
  const level = ownedQuery(comment, '#user-level,.user-level,.level-link,.level');
  if (level) return level;
  const name = ownedQuery(comment, '#user-name,.user-name,.name');
  return name;
}
export function extract(el: Element) {
  const avatar = ownedQuery(
    el,
    '#user-avatar,a.user-face,.sub-user-face,.user-face a,a[data-user-profile-id]',
  );
  const nameEl = ownedQuery(el, '#user-name a,.user-name,.name');
  const profile =
    (avatar?.matches('a') ? avatar : avatar?.querySelector('a')) ||
    ownedQuery(el, 'a[href*="space.bilibili.com/"]');
  let uid = profile?.getAttribute('data-user-profile-id') || '';
  if (!UID.test(uid)) {
    try {
      const u = new URL(profile?.getAttribute('href') || '', location.href);
      if (u.hostname === 'space.bilibili.com')
        uid = u.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1] || '';
    } catch {}
  }
  const rich = ownedQuery(el, 'bili-rich-text');
  const richRoot = rich ? shadow(rich) || rich : null;
  const bodyEl =
    richRoot?.querySelector('#contents') || ownedQuery(el, '.reply-content,.reply-text,.text');
  if (!UID.test(uid) || !bodyEl) return null;
  const body = cleanText(textOnly(bodyEl));
  if (!body) return null;
  const dateEl = ownedQuery(el, '#pubdate,.reply-time,.sub-reply-time,.time');
  const timeText = cleanText(dateEl?.getAttribute('title') || dateEl?.textContent || '', 100);
  const rpid = el.getAttribute('data-rpid') || el.getAttribute('data-id');
  const id = rpid && /^\d+$/.test(rpid) ? rpid : null;
  const bvid = pageBV(location.href);
  if (!bvid) return null;
  let context = '';
  if (el.matches('bili-comment-reply-renderer,.sub-reply-item')) {
    let n: Node | null = parent(el);
    while (n) {
      if (
        n instanceof Element &&
        n.matches('bili-comment-thread-renderer,.reply-item,.reply-wrap')
      ) {
        const root = shadow(n) || n;
        const top = root.querySelector('bili-comment-renderer');
        // Parent text is context only. It is never enqueued without its own visibility check.
        const data = top ? extract(top) : null;
        context = data
          ? JSON.stringify([data.uid, data.rpid || data.body.slice(0, 1200)])
          : cleanText(n.getAttribute('data-rpid') || '', 100);
        break;
      }
      n = parent(n);
    }
  }
  const complete =
    !ownedQuery(el, '#view-more,.view-more,.expand-btn,.reply-content .show-more') &&
    !(
      bodyEl instanceof HTMLElement &&
      bodyEl.scrollHeight > bodyEl.clientHeight + 4 &&
      getComputedStyle(bodyEl).overflow === 'hidden'
    );
  return {
    uid,
    bvid,
    name: cleanText(nameEl?.textContent || '', 200) || uid,
    body,
    timeText,
    publishedAt: parseDate(timeText),
    rpid: id,
    parent: null,
    root: null,
    context,
    complete,
    title: cleanText(
      document.querySelector('h1.video-title,h1[title]')?.getAttribute('title') ||
        document.querySelector('h1')?.textContent ||
        document.title.replace(/_哔哩哔哩_bilibili$/, ''),
      500,
    ),
    avatar,
    bodyEl,
  };
}
