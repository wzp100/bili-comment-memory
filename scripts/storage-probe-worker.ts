// Storage experiment against the dedicated synthetic benchmark profile only.
// @ts-ignore local bundled vendor
import init from './vendor/sqlite3.mjs';
import { Repository } from '../src/database/core.mjs';
const scope = self as any,
  queue: MessageEvent[] = [];
scope.onmessage = (e: MessageEvent) => queue.push(e);
scope.sqlite3ApiConfig = {
  disable: { vfs: { opfs: true, 'opfs-wl': true, 'opfs-vfs': true, kvvfs: true } },
};
const sqlite: any = await init({
  locateFile: (p: string) => new URL('./vendor/' + p, import.meta.url).href,
});
const pool = await sqlite.installOpfsSAHPoolVfs({ name: 'benchmark' }),
  db = new pool.OpfsSAHPoolDb('/benchmark.sqlite3');
const stats = () => ({
  bytes: db.selectValue('PRAGMA page_count') * db.selectValue('PRAGMA page_size'),
  freeBytes: db.selectValue('PRAGMA freelist_count') * db.selectValue('PRAGMA page_size'),
  tables: db.selectObjects(
    'SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC',
  ),
});
function query(term: string) {
  const c = [...term],
    grams = [...new Set(c.slice(0, -2).map((_, i) => c.slice(i, i + 3).join('')))];
  return grams.map((x) => '"' + x.replaceAll('"', '""') + '"').join(' AND ');
}
scope.onmessage = async (e: MessageEvent) => {
  const { id, op } = e.data;
  try {
    if (op === 'apply') {
      db.exec('DROP TABLE IF EXISTS probe_fts');
      const adapter = {
        exec: (s: string) => db.exec(s),
        all: (s: string, p: any[] = []) => db.selectObjects(s, p),
        run: (s: string, p: any[] = []) => db.exec({ sql: s, bind: p }),
      };
      const invariant = () =>
        db.selectObjects(
          'SELECT count(*) n,sum(id) idsum,sum(length(body)) chars,sum(length(context)) contextchars,min(first_seen_at) first,max(first_seen_at) last FROM comments',
        )[0];
      const before = stats(),
        original = invariant(),
        repo = new Repository(adapter),
        start = performance.now();
      repo.init();
      const migrationMs = performance.now() - start;
      const migrated = stats(),
        compactStart = performance.now(),
        compact = repo.compact(),
        compactMs = performance.now() - compactStart,
        after = stats();
      if (JSON.stringify(original) !== JSON.stringify(invariant()))
        throw new Error('评论校验不一致');
      const timings: any = {};
      for (const [name, fn] of Object.entries({
        history: () => {
          repo.invalidate();
          return repo.history({ uid: '42', exclude: 'BV0000000500' });
        },
        skew: () => {
          repo.invalidate();
          return repo.history({ uid: '1001', exclude: 'BV0000000500' });
        },
        search: () => repo.search({ keyword: '中文评论', uid: '42' }),
      })) {
        const times = [];
        for (let i = 0; i < 100; i++) {
          const t = performance.now();
          fn();
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        timings[name] = { p50: times[50], p95: times[95] };
      }
      const searchCheck = db.selectValue(
        'SELECT count(*) FROM comments WHERE id IN(SELECT rowid FROM comment_fts WHERE comment_fts MATCH ?) AND instr(body,?)>0',
        [query('中文评论'), '中文评论'],
      );
      scope.postMessage({
        id,
        data: {
          before,
          migrated,
          after,
          migrationMs,
          compactMs,
          compact,
          original,
          searchCheck,
          timings,
          integrity: db.selectValue('PRAGMA quick_check'),
        },
      });
      return;
    }
    const before = stats(),
      start = performance.now();
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(body,content='comments',content_rowid='id',tokenize='trigram',detail=none,columnsize=0)",
    );
    db.exec("INSERT INTO probe_fts(probe_fts) VALUES('rebuild')");
    const rebuildMs = performance.now() - start,
      after = stats(),
      checks = [];
    for (const term of ['中文评论', '视频讲得很清楚', '不存在的发言', '本地记录 😊', '序号 1234']) {
      const q = query(term),
        t = performance.now();
      const lean = db.selectValue(
        'SELECT count(*) FROM comments WHERE id IN(SELECT rowid FROM probe_fts WHERE probe_fts MATCH ?) AND instr(body,?)>0',
        [q, term],
      );
      const leanMs = performance.now() - t;
      const old = db.selectValue(
        'SELECT count(*) FROM comments WHERE id IN(SELECT rowid FROM comment_fts WHERE comment_fts MATCH ?) AND instr(body,?)>0',
        ['"' + term + '"', term],
      );
      checks.push({ term, lean, old, leanMs });
      if (lean !== old) throw new Error('搜索结果不一致');
    }
    scope.postMessage({ id, data: { before, after, rebuildMs, checks } });
  } catch (e: any) {
    scope.postMessage({ id, error: e.stack });
  }
};
for (const e of queue) void scope.onmessage(e);
