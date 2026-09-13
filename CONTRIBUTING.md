# 参与 BiliMemo

欢迎提交问题、页面适配、测试和文档改进。讨论与文档默认使用中文，文件统一 UTF-8。

## 本地开发

使用 Node.js 22.18+，推荐 Node.js 24 LTS。浏览器安装发布包不需要 Node.js。

```sh
git clone https://github.com/wzp100/bili-comment-memory.git
cd bili-comment-memory
npm ci
npm run check
npm test
npm run package
npm run verify:package
```

在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `dist`。修改后运行 `npm run build`，再在扩展管理页重新加载并刷新视频页。保持加载路径不变；需要更换路径或卸载时先导出备份。

## 修改与验证

运行 `npm run format` 统一排版，`npm run format:check` 只检查而不修改。CI 会校验格式，避免贡献者反复处理无关的排版差异。

- 单次 PR 聚焦一个问题，说明具体触发条件、修改后的行为和验证结果。
- 修改页面采集逻辑时，添加或更新模拟页面用例，确保只采集可见评论、节点复用不串用户或视频。
- 修改数据库时，保留备份兼容性，验证迁移、重复采集、删除和统计一致性。
- 不添加自动翻页、用户空间抓取、Cookie 读取、遥测或远程执行代码。涉及功能范围或新权限时，先通过 Issue 讨论。
- 提交源码、测试、文档及 `package-lock.json`；不提交 `dist`、依赖目录、浏览器配置、评论数据库或真实用户截图。

浏览器集成测试使用独立临时配置及模拟评论，无需 B 站账号：

```sh
npx playwright install chromium
npm run build
npm run verify:browser
```

Windows 下也可指定已安装的 Chrome（使用支持扩展调试接口的版本）：

```powershell
$env:BILI_TEST_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run verify:browser
```

`npm run verify:live` 会访问真实 B 站样本页，不属于每次 PR 的自动检查；结果和截图留在本地 `output`。公开反馈前先去除个人信息。

## 代码导航

见 [架构说明](docs/ARCHITECTURE.md)。发布者操作见 [维护与发布](docs/RELEASING.md)。新贡献者可以先处理标有 `good first issue` 的问题（如果有）。

## 许可证

提交贡献表示你有权提供相应代码，并同意贡献按本项目 MIT 许可证分发。第三方代码必须保留其原许可证与来源说明。
