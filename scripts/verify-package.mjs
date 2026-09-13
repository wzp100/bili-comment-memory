import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `output/releases/bili-comment-memory-${pkg.version}.zip`;
const archive = await readFile(filename);
const files = unzipSync(archive);
const manifest = JSON.parse(strFromU8(files['manifest.json']));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest, JSON.parse(await readFile('manifest.json', 'utf8')));
const required = [
  'LICENSE',
  'README.md',
  'PRIVACY.md',
  'THIRD-PARTY-NOTICES.txt',
  'SQLITE-WASM-LICENSE.txt',
  'vendor/sqlite3.mjs',
  'vendor/sqlite3.wasm',
  'offscreen.html',
  'offscreen.js',
  'database-worker.js',
  'options.js',
  'popup.js',
  'app.css',
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((script) => script.js),
  ...Object.values(manifest.icons || {}),
];
for (const file of required) assert.ok(files[file]?.length, `缺少运行文件或许可证：${file}`);
for (const name of Object.keys(files)) {
  assert.ok(
    !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'),
    `不安全的 ZIP 路径：${name}`,
  );
  assert.ok(!/^(dist|node_modules|output|\.git|tests|src)\//.test(name), `不应打包的目录：${name}`);
  assert.ok(!/\.(map|sqlite3|db|pem|key)$/.test(name), `不应打包的文件：${name}`);
}
assert.deepEqual([...files['vendor/sqlite3.wasm'].slice(0, 4)], [0, 97, 115, 109]);
const checksum = (await readFile(`${filename}.sha256`, 'utf8')).split(/\s+/)[0];
assert.equal(checksum, createHash('sha256').update(archive).digest('hex'));
console.log(
  `发布包校验通过：${Object.keys(files).length} 个文件，版本 ${pkg.version}，SHA-256 一致。`,
);
