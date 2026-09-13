# 维护与发布

## 日常维护

默认分支为 `main`。外部贡献通过 Fork 和 Pull Request；维护者在合并前检查 CI、功能描述与隐私披露。自动依赖更新每月提出 PR，不会自动合并。

CI 在 Windows / Linux 上运行类型检查、单元测试、构建和包校验，并在 Linux Chromium 上运行模拟页面集成测试。真实 B 站访问与百万条基准按需在本地运行。

## 发布版本

1. 更新 `package.json`、`manifest.json` 中一致的版本号，运行 `npm install --package-lock-only` 同步锁文件。
2. 更新 `CHANGELOG.md`，必要时同步使用说明、隐私说明和第三方声明。
3. 执行检查并实际加载扩展验证功能：

   ```sh
   npm ci
   npm run check
   npm test
   npm run package
   npm run verify:package
   npx playwright install chromium
   npm run verify:browser
   ```

4. 提交变更并推送到 `main`，等待 CI 通过。
5. 创建与版本一致的标签，例如：

   ```sh
   git tag -a v0.3.3 -m "BiliMemo 0.3.3"
   git push origin v0.3.3
   ```

标签触发 Release 工作流，再次检查版本、运行测试、打包和浏览器验证，随后创建 GitHub Release 并上传 ZIP 与 SHA-256。发布说明读取 `CHANGELOG.md` 对应版本小节。工作流只需要仓库自带的 `GITHUB_TOKEN`，无需配置个人令牌。

工作流失败时先看 Actions 日志。未生成 Release 时可修复问题并重新运行；若版本代码需要修改，使用新版本号和新标签。已公开发布的版本不要覆盖安装包或移动标签。

## 分发文件

`npm run package` 生成 `output/releases/bili-comment-memory-版本号.zip` 和同名 `.sha256`。ZIP 根目录直接包含 `manifest.json`；不包含测试数据、源码映射、浏览器配置或开发依赖。GitHub 自动生成的 Source code 压缩包不是可直接加载的扩展。

当前没有发布到 Chrome / Edge 商店。提交商店前还需补齐应用图标、商店素材、账号注册和对应浏览器验证；按照 [微软官方发布步骤](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) 填写资料并提交审核。GitHub Release 不会自动发布到浏览器商店。
