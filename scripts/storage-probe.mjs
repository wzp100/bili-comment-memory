import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './browser-helper.mjs';
const target = process.env.BILI_BENCH_EXTENSION,
  profile = process.env.BILI_BENCH_PROFILE;
if (!target || !profile)
  throw new Error('请指定专用测试库 BILI_BENCH_EXTENSION 与 BILI_BENCH_PROFILE');
await build({
  entryPoints: ['scripts/storage-probe-worker.ts'],
  outfile: path.join(target, 'storage-probe-worker.js'),
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  external: ['./vendor/sqlite3.mjs'],
});
const context = await launchExtension(profile, target);
try {
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker')),
    id = new URL(sw.url()).hostname,
    page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const result = await page.evaluate(
    (op) =>
      new Promise((resolve, reject) => {
        const worker = new Worker('storage-probe-worker.js', { type: 'module' });
        const timer = setTimeout(() => reject(new Error('测试超时')), 600000);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.onmessage = (e) => {
          clearTimeout(timer);
          e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.data);
        };
        worker.postMessage({ id: 1, op });
      }),
    process.env.BILI_STORAGE_APPLY ? 'apply' : 'probe',
  );
  await writeFile(
    'output/benchmark/' +
      (process.env.BILI_STORAGE_APPLY ? 'storage-applied.json' : 'storage-probe.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
}
