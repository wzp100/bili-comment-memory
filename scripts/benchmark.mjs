import { chromium } from 'playwright';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchExtension } from './browser-helper.mjs';
await mkdir('output/benchmark', { recursive: true });
const target =
  process.env.BILI_BENCH_EXTENSION || (await mkdtemp(path.resolve('output/benchmark/extension-')));
await cp('dist', target, { recursive: true });
await build({
  entryPoints: ['scripts/benchmark-worker.ts'],
  outfile: path.join(target, 'benchmark-worker.js'),
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  external: ['./vendor/sqlite3.mjs'],
});
const profile =
  process.env.BILI_BENCH_PROFILE || (await mkdtemp(path.resolve('output/benchmark/profile-')));
const context = await launchExtension(profile, target);
try {
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker')),
    id = new URL(sw.url()).hostname,
    page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  page.on('console', (m) => console.log(m.text()));
  page.on('pageerror', (e) => console.log(e.stack));
  await page.evaluate(() => {
    window.benchWorker = new Worker('benchmark-worker.js', { type: 'module' });
    window.benchPending = new Map();
    window.benchWorker.onerror = (e) => {
      for (const r of window.benchPending.values()) r.reject(new Error(e.message));
      window.benchPending.clear();
    };
    window.benchWorker.onmessage = (e) => {
      if (e.data.progress) {
        console.log('seeded', e.data.progress);
        return;
      }
      const r = window.benchPending.get(e.data.id);
      if (r) {
        window.benchPending.delete(e.data.id);
        if (e.data.error) r.reject(new Error(e.data.error));
        else r.resolve(e.data);
      }
    };
    window.bench = (op, size) =>
      new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => reject(new Error('基准任务超时')), 600000);
        window.benchPending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        window.benchWorker.postMessage({ id, op, size });
      });
  });
  const report = {
    device: {
      cpu: os.cpus()[0].model,
      ramGiB: Math.round(os.totalmem() / 1073741824),
      platform: os.platform(),
      chrome: context.browser()?.version(),
    },
    runs: [],
  };
  for (const size of process.env.BILI_BENCH_PROFILE ? [1000000] : [100000, 1000000]) {
    const result = await page.evaluate((size) => window.bench('seed', size), size);
    const r = result.data;
    const roundTrips = await page.evaluate(async () => {
      const times = [];
      for (let i = 0; i < 100; i++) {
        const t = performance.now();
        await window.bench('history');
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return { p50: times[50], p95: times[95] };
    });
    r.workerRoundTrip = roundTrips;
    report.runs.push(r);
    console.log(JSON.stringify({ size, normal: r.normal, skew: r.skew, roundTrips }));
    await writeFile('output/benchmark/report.json', JSON.stringify(report, null, 2), 'utf8');
  }
  console.log('基准结果已写入 output/benchmark/report.json');
} finally {
  await context.close();
}
