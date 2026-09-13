import { videoUrl } from './shared.mjs';
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}
export function recordCard(row: any) {
  const article = element('article', '', 'record');
  const head = element('div', '', 'record-head');
  head.append(element('strong', row.name || row.uid), element('span', 'UID ' + row.uid));
  const body = element('p', row.body, 'body');
  const link = element('a', row.title || row.bvid, 'video');
  link.href = videoUrl(row.bvid);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const stamp = row.published_at
    ? new Date(row.published_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : row.time_text || '时间未显示';
  const meta = element(
    'div',
    `发表：${stamp} · 本机记录：${new Date(row.first_seen_at).toLocaleString('zh-CN')}`,
    'meta',
  );
  const tags = element('div', '', 'tags');
  if (!row.rpid) tags.append(element('span', '指纹去重'));
  if (!row.complete) tags.append(element('span', '可能为折叠正文'));
  article.append(head, body, link, meta, tags);
  return article;
}
export const cardStyle = `
:host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#243247;font-size:13px}
*{box-sizing:border-box}button,a{cursor:pointer}button{font:inherit;border:1px solid #d6deea;border-radius:8px;background:white;padding:7px 10px;color:#354359}button:hover{background:#f0f5fc}a{color:#1478aa;text-decoration:none}a:hover{text-decoration:underline}
.panel{position:fixed;width:400px;max-width:calc(100vw - 24px);max-height:min(540px,75vh);overflow:auto;background:#fff;border:1px solid #dae2ed;border-radius:16px;box-shadow:0 16px 56px #17253d30;padding:18px;z-index:2147483647;line-height:1.55}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.top strong{font-size:17px}.sub,.meta{font-size:11px;color:#768399}.sub{margin:5px 0 12px}.record{padding:12px 0;border-bottom:1px solid #e9eef5}.record-head{display:flex;gap:10px;align-items:baseline}.record-head span{color:#8590a1;font-size:11px}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.video{display:block;font-size:12px;margin-bottom:5px}.tags span{font-size:10px;color:#8c6c34;margin-right:8px}.message{padding:15px 0;color:#67748a}.actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px}.badge{position:fixed;bottom:18px;right:18px;z-index:2147483600;border-radius:99px;box-shadow:0 4px 20px #17253d18;background:#fff;padding:8px 13px;font-size:11px;max-width:280px}.error{color:#b33a47}
`;
