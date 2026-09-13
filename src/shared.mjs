export const BV = /^BV[0-9A-Za-z]{10}$/;
export const UID = /^[1-9]\d{0,23}$/;
export const videoUrl = (bvid) => (BV.test(bvid) ? `https://www.bilibili.com/video/${bvid}/` : '');
export function pageBV(url) {
  try {
    const u = new URL(url);
    return u.origin === 'https://www.bilibili.com'
      ? (u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1] ?? null)
      : null;
  } catch {
    return null;
  }
}
export function cleanText(s, max = 32768) {
  return typeof s === 'string' ? s.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}
export function parseDate(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}+08:00`;
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return null;
  return new Date(value + 8 * 3600000).toISOString().slice(0, 19) === iso.slice(0, 19)
    ? value
    : null;
}
export function validateRecord(r) {
  if (
    !r ||
    !UID.test(r.uid) ||
    !BV.test(r.bvid) ||
    typeof r.body !== 'string' ||
    !r.body.trim() ||
    r.body.length > 32768
  )
    throw new Error('评论字段无效');
  const id = (x) =>
    x == null || x === ''
      ? null
      : /^\d{1,24}$/.test(x)
        ? String(x)
        : (() => {
            throw new Error('评论 ID 无效');
          })();
  const now = Date.now();
  const time = (x) => (Number.isSafeInteger(x) && x > 0 && x <= now + 86400000 ? x : now);
  return {
    uid: r.uid,
    bvid: r.bvid,
    name: cleanText(r.name, 200) || r.uid,
    title: cleanText(r.title, 500) || r.bvid,
    body: cleanText(r.body),
    rpid: id(r.rpid),
    parent: id(r.parent),
    root: id(r.root),
    context: cleanText(r.context, 2048),
    timeText: cleanText(r.timeText, 100),
    publishedAt: parseDate(cleanText(r.timeText, 100)),
    firstSeen: time(r.firstSeen),
    lastSeen: time(r.lastSeen),
    complete: r.complete === true ? 1 : 0,
  };
}
export async function fingerprint(r) {
  // Display dates may transition from “刚刚” to an absolute date. Do not let that
  // transition create another fallback record for the same observed text.
  const canonical = JSON.stringify([r.uid, r.body.normalize('NFC'), r.parent, r.root, r.context]);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function rpc(op, payload = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'background', op, payload });
  if (!result?.ok) throw new Error(result?.error || '扩展连接已断开，请刷新页面');
  return result.data;
}
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function base64ToBytes(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
