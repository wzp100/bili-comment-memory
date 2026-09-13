import { build } from 'esbuild';
import { mkdir, copyFile, cp, rm, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version)
  throw new Error('manifest.json 与 package.json 的版本必须一致');

// 固定到本项目的 dist；拒绝符号链接，避免清理到其他目录。
const dist = path.resolve(root, 'dist');
if (path.dirname(dist) !== path.resolve(root) || path.basename(dist) !== 'dist')
  throw new Error('构建输出路径无效');
const stat = await lstat(dist).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (stat?.isSymbolicLink()) throw new Error('dist 不能是符号链接');
await rm(dist, { recursive: true, force: true });
await mkdir('dist/vendor', { recursive: true });
await build({
  entryPoints: {
    background: 'src/background.ts',
    offscreen: 'src/offscreen.ts',
    'database-worker': 'src/database-worker.ts',
    options: 'src/options.ts',
    popup: 'src/popup.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: true,
  external: ['./vendor/sqlite3.mjs'],
});
// Content scripts are classic scripts; no module exports are allowed.
await build({
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: true,
});
await copyFile('manifest.json', 'dist/manifest.json');
await cp('public', 'dist', { recursive: true });
await copyFile('node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs', 'dist/vendor/sqlite3.mjs');
await copyFile(
  'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm',
  'dist/vendor/sqlite3.wasm',
);
await copyFile('docs/INSTALL.md', 'dist/README.md');
await copyFile('LICENSE', 'dist/LICENSE');
await copyFile('PRIVACY.md', 'dist/PRIVACY.md');
console.log(`已构建 BiliMemo ${manifest.version}；在 Chrome / Edge 中加载 dist 即可安装。`);
