import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
assert.equal(manifest.version, version, 'manifest 与 package 版本不一致');
assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Git 标签必须与包版本一致');
const changelog = await readFile('CHANGELOG.md', 'utf8');
const section = changelog
  .split(/^## /m)
  .find((text) => text.startsWith(`${version} `) || text.startsWith(`${version}\n`));
assert.ok(section, `CHANGELOG.md 缺少 ${version} 小节`);
const body = section.slice(section.indexOf('\n') + 1).trim();
await mkdir('output', { recursive: true });
await writeFile(
  'output/release-notes.md',
  `${body}\n\n### 安装\n\n下载下方的 \`bili-comment-memory-${version}.zip\`，解压后在 Chrome / Edge 扩展管理页开启开发者模式，加载包含 manifest.json 的目录。Source code 是开发源码，不是安装包。\n\n更新前先导出备份，并保留原安装路径。详见[安装说明](https://github.com/wzp100/bili-comment-memory/blob/v${version}/docs/INSTALL.md)。\n`,
  'utf8',
);
console.log(`已校验标签 v${version} 并生成发布说明。`);
