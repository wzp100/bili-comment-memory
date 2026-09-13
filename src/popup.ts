import { rpc } from './shared.mjs';
const enabled = document.querySelector<HTMLInputElement>('#enabled')!,
  status = document.querySelector('#page-status')!;
rpc('settings')
  .then((s) => (enabled.checked = s.enabled))
  .catch((e) => (status.textContent = e.message));
rpc('pageStatus')
  .then((s) => (status.textContent = s.text || '请在 B 站普通视频页浏览评论区。'))
  .catch((e) => (status.textContent = e.message));
enabled.onchange = async () => {
  try {
    await rpc('setEnabled', { enabled: enabled.checked });
    status.textContent = enabled.checked ? '记录已开启' : '已暂停，历史记录仍可查询';
  } catch (e: any) {
    status.textContent = e.message;
  }
};
document
  .querySelector('#open')!
  .addEventListener('click', () => void chrome.runtime.openOptionsPage());
