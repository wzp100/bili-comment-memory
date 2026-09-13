# 架构与维护入口

BiliMemo 是 Manifest V3 扩展。所有运行脚本与 SQLite WASM 随包分发，数据保存在扩展自身源的 OPFS 中。

```text
B 站页面 → content / adapter → background → offscreen → database-worker
                  ↓               ↑                         ↓
            ui / inline-summary   popup / options       SQLite + OPFS
```

| 文件或目录                                        | 职责                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `manifest.json`                                   | 浏览器权限、脚本入口、版本和页面范围。                       |
| `src/adapter.ts`                                  | 解析页面评论、Shadow DOM 和字段。页面改版时优先检查这里。    |
| `src/content.ts`                                  | 可见性监听、采集队列、头像悬浮和页面状态。                   |
| `src/inline-summary.ts`、`src/summary-client.mjs` | 行内摘要、批量查询与旧后台兼容。                             |
| `src/background.ts`                               | 消息来源及操作授权，设置、离屏文档生命周期和数据库请求转发。 |
| `src/offscreen.ts`                                | 承载单个数据库 Worker，转发结果。                            |
| `src/database-worker.ts`                          | SQLite WASM / OPFS、查询调度、备份传输和整理。               |
| `src/database/core.mjs`                           | 可在 Node SQLite 与浏览器 SQLite 适配器上复用的数据库操作。  |
| `src/database/schema.mjs`                         | 表、索引、统计触发器和 schema 版本。                         |
| `src/shared.mjs`                                  | 记录校验、URL 校验、日期解析和指纹。                         |
| `public`、`src/options.ts`、`src/popup.ts`        | 管理页、弹窗与样式。                                         |
| `tests`                                           | 合成数据、旧版 schema 和 Node 单元测试。                     |
| `scripts`                                         | 构建、打包、浏览器集成验证与性能实验。                       |

## 需要保留的约束

多个标签页共享同一个数据库 Worker，避免争用 OPFS 存储池。数据库写入提交后才确认成功；重复采集依靠唯一索引去重。消息授权边界位于后台，管理操作只接受内部页面。

评论统计与增删在同一事务内维护。历史分页使用首次记录时间和 ID 的二元游标；最近记录不等于最近发表。全文索引是派生数据，数据库迁移必须保留原始评论及元数据。

内容脚本以 IIFE 构建，其余入口使用 ES 模块。`npm run build` 会清理并重建固定路径 `dist`，保留原加载路径。发布 ZIP 去掉 `.map`，保留运行文件、安装说明和许可证。

## 测试范围

- `npm test`：真实 Node SQLite 上的查询、迁移、统计、输入验证和兼容性测试。
- `npm run verify:package`：ZIP 根目录、manifest 版本、运行依赖、许可证、WASM 标识及校验和。
- `npm run verify:browser`：独立 Chromium 配置中模拟页面上的完整扩展流程，含 closed Shadow DOM、跨标签页、备份与重启恢复。
- `npm run verify:live`：访问真实 B 站样本页，适合页面适配后的人工验证；不进入公共 CI。

历史性能记录见 [PERFORMANCE.md](../PERFORMANCE.md)。最初设计草案保留在 [PLAN.md](../PLAN.md)，当前行为以代码和使用说明为准。
