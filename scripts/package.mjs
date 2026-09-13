import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const files = {};
async function collect(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`发布包不允许符号链接：${name}`);
    if (entry.isDirectory()) await collect(`${directory}/${entry.name}`, `${name}/`);
    else if (entry.isFile() && !name.endsWith('.map')) {
      let content = await readFile(`${directory}/${entry.name}`);
      if (name.endsWith('.js'))
        content = Buffer.from(
          content.toString('utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, ''),
          'utf8',
        );
      files[name] = [content, { mtime: new Date(2020, 0, 1) }];
    }
  }
}
await collect('dist');
await mkdir('output/releases', { recursive: true });
const name = `bili-comment-memory-${version}.zip`;
const archive = zipSync(files, { level: 9 });
await writeFile(`output/releases/${name}`, archive);
await writeFile(
  `output/releases/${name}.sha256`,
  `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`,
  'utf8',
);
console.log(`已生成 output/releases/${name}（manifest.json 位于根目录）`);
