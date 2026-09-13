# 安装 BiliMemo（B 站评论记忆）

适用于桌面 Chrome / Edge。浏览器扩展商店链接尚未发布，目前通过 GitHub Releases 安装。

## 首次安装

1. 打开 [最新版本](https://github.com/wzp100/bili-comment-memory/releases/latest)，下载 Assets 下的 `bili-comment-memory-版本号.zip`。不要选 GitHub 自动提供的 Source code，它是需要构建的源码。
2. 解压到准备长期保留的固定目录。该目录下应直接有 `manifest.json`、`background.js` 和 `vendor` 等文件。
3. Edge 地址栏输入 `edge://extensions`；Chrome 输入 `chrome://extensions`。
4. 开启「开发者模式」，点击「加载解压缩的扩展」或「加载已解压的扩展程序」，选择刚才包含 `manifest.json` 的目录。
5. 打开或刷新 B 站普通 BV 视频页，滚动到评论区。右下角显示记录状态，悬浮评论头像可查看本机已记录的其他视频评论。
6. 点击扩展图标，再点击「打开本地评论库」，可以搜索、暂停、导入导出及清理。

安装后无需 Node.js、Python 或数据库服务。源码开发者则运行 `npm ci` 和 `npm run build`，加载构建出的 `dist`。

## 更新与迁移

先在旧扩展的数据管理页导出 SQLite 备份。退出正在使用扩展的页面，把新包解压覆盖到原安装目录，然后在扩展管理页点击「重新加载」，再刷新视频页。不要先卸载旧扩展，也不要随意移动安装目录。

从本地开发版换到另一个目录或未来的商店版本时，扩展 ID 可能变化，本地数据库不会自动共享。先从旧版导出，再安装新版并导入，确认恢复后再处理旧版。

当前单次导入导出上限为 **256 MiB**。超过上限的数据库不能通过当前导出功能完成整库迁移；请保持原安装路径，不要先卸载。

## 使用边界

只记录本机正常浏览时进入视口的评论，不代表用户的完整历史。当前支持普通 BV 视频页，不支持番剧、直播、动态、移动版和无痕窗口。点击历史视频标题打开原视频，暂不定位具体评论。

详细用法与已知限制见 [项目使用说明](https://github.com/wzp100/bili-comment-memory/blob/main/docs/USAGE.md)。数据处理见 [隐私说明](https://github.com/wzp100/bili-comment-memory/blob/main/PRIVACY.md)。
