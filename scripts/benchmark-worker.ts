// Test-only worker. This file is never included in the release extension.
// @ts-ignore copied vendor asset
import init from './vendor/sqlite3.mjs';
import { Repository } from '../src/database/core.mjs';
const scope = self as any;
scope.sqlite3ApiConfig = {
  disable: { vfs: { opfs: true, 'opfs-wl': true, 'opfs-vfs': true, kvvfs: true } },
};
const incoming: MessageEvent[] = [];
scope.onmessage = (e: MessageEvent) => incoming.push(e);
const start = performance.now();
const sqlite: any = await init({
  locateFile: (p: string) => new URL('./vendor/' + p, import.meta.url).href,
});
const pool = await sqlite.installOpfsSAHPoolVfs({ name: 'benchmark' });
const db = new pool.OpfsSAHPoolDb('/benchmark.sqlite3');
const cache = new Map<string, any>();
const adapter = {
  exec: (s: string) => db.exec(s),
  all: (s: string, p: any[] = []) => {
    let st = cache.get(s);
    if (!st) {
      st = db.prepare(s);
      cache.set(s, st);
    }
    try {
      if (p.length) st.bind(p);
      const r: any[] = [];
      while (st.step()) r.push(st.get({}));
      return r;
    } finally {
      st.reset(true);
    }
  },
  run: (s: string, p: any[] = []) => {
    adapter.all(s, p);
  },
};
const repo = new Repository(adapter);
repo.init();
const initMs = performance.now() - start;
let current = db.selectValue('SELECT count(*) FROM comments');
const pct = (arr: number[], p: number) =>
  arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
function sample(fn: () => any) {
  const times = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  return { p50: pct(times, 0.5), p95: pct(times, 0.95) };
}
scope.onmessage = async (e: MessageEvent) => {
  const { id, op, size } = e.data;
  try {
    if (op === 'history') {
      repo.invalidate();
      const t = performance.now();
      const data = repo.history({ uid: '42', exclude: 'BV1BB411B7BB' });
      scope.postMessage({ id, data, sqlMs: performance.now() - t });
      return;
    }
    if (op === 'seed') {
      if (!current) {
        db.exec(`WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1001) INSERT INTO users(id,uid,name) SELECT x,cast(x as text),'用户 '||x FROM n;
    WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<500) INSERT INTO videos(id,bvid,title) SELECT x,'BV'||printf('%010d',x),'测试视频 '||x FROM n;`);
      }
      const begin = performance.now();
      while (current < size) {
        const end = Math.min(size, current + 10000);
        db.exec('BEGIN');
        db.exec(`WITH RECURSIVE n(x) AS(VALUES(${current + 1}) UNION ALL SELECT x+1 FROM n WHERE x<${end}) INSERT INTO comments(user_id,video_id,rpid,body,time_text,published_at,first_seen_at,last_seen_at,context,complete)
      SELECT CASE WHEN x%10=0 THEN 1001 ELSE x%1000+1 END,CASE WHEN x%10=0 THEN CASE WHEN x<101 THEN 499 ELSE 500 END ELSE cast(x/1000 as integer)%498+1 END,cast(x as text),
      CASE WHEN x%20=1 THEN '这是一条中文评论，关于视频内容的讨论，测试搜索与跨视频查询 😊，序号 '||x ELSE '日常浏览记录，视频讲得很清楚。这是一段用于检验存储与查询速度的合成内容。'||x END,
      '2024-01-02 03:04',1700000000000,1700000000000+x,1700000000000+x,'',1 FROM n;`);
        db.exec('COMMIT');
        current = end;
        if (current % 10000 === 0) {
          scope.postMessage({ progress: current });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      db.exec('PRAGMA optimize');
      repo.invalidate();
      const seededMs = performance.now() - begin;
      const raw = sample(() =>
        adapter.all(
          'SELECT id,first_seen_at FROM comments WHERE user_id=? AND video_id!=? ORDER BY first_seen_at DESC,id DESC LIMIT 11',
          [42, 500],
        ),
      );
      const normal = sample(() => {
        repo.invalidate();
        repo.history({ uid: '42', exclude: 'BV0000000500' });
      });
      const skew = sample(() => {
        repo.invalidate();
        repo.history({ uid: '1001', exclude: 'BV0000000500' });
      });
      const search = sample(() => repo.search({ keyword: '中文评论', uid: '42' }));
      const plan = adapter.all(
        'EXPLAIN QUERY PLAN SELECT id,first_seen_at FROM comments WHERE user_id=? AND video_id!=? ORDER BY first_seen_at DESC,id DESC LIMIT 11',
        [42, 500],
      );
      const dbstat = adapter.all(
        'SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC',
      );
      scope.postMessage({
        id,
        data: {
          size,
          initMs,
          seededMs,
          sqlite: sqlite.version.libVersion,
          raw,
          normal,
          skew,
          search,
          plan,
          dbstat,
          stats: repo.stats(),
          wasmHeapBytes: sqlite.wasm.heap8u().length,
        },
      });
      return;
    }
  } catch (e: any) {
    scope.postMessage({ id, error: e.stack });
  }
};
for (const e of incoming) void scope.onmessage(e);
