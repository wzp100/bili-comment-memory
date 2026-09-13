// SQLite assets are bundled locally; this import is copied unchanged by the build.
// @ts-ignore runtime vendor module
import sqlite3InitModule from './vendor/sqlite3.mjs';
import { Repository } from './database/core.mjs';
import { VERSION, APPLICATION_ID } from './database/schema.mjs';
import { validateRecord, fingerprint, bytesToBase64, base64ToBytes, delay } from './shared.mjs';
const scope = self as any;
scope.sqlite3ApiConfig = {
  disable: { vfs: { opfs: true, 'opfs-wl': true, 'opfs-vfs': true, kvvfs: true } },
};
let sqlite: any, pool: any, db: any, repo: Repository;
const statements = new Map<string, any>();
const adapter = {
  exec: (sql: string) => db.exec(sql),
  all: (sql: string, args: any[] = []) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    try {
      if (args.length) st.bind(args);
      const rows: any[] = [];
      while (st.step()) rows.push(st.get({}));
      return rows;
    } finally {
      st.reset(true);
    }
  },
  run: (sql: string, args: any[] = []) => {
    adapter.all(sql, args);
  },
};
const ready = (async () => {
  sqlite = await sqlite3InitModule({
    locateFile: (p: string) => new URL('./vendor/' + p, import.meta.url).href,
  });
  pool = await sqlite.installOpfsSAHPoolVfs({
    name: 'bili-memory',
    directory: '.bili-memory',
    initialCapacity: 6,
  });
  db = new pool.OpfsSAHPoolDb('/comments.sqlite3');
  const version = db.selectValue('PRAGMA user_version');
  if (version > VERSION) throw new Error('数据库版本较新，请升级扩展');
  repo = new Repository(adapter);
  repo.init();
  // Prevent an unbounded search from monopolizing the sole DB worker.
  let deadline = 0;
  sqlite.capi.sqlite3_progress_handler(
    db.pointer,
    1000,
    () => (deadline && performance.now() > deadline ? 1 : 0),
    0,
  );
  return {
    deadline: (ms: number) => {
      deadline = ms ? performance.now() + ms : 0;
    },
  };
})();
type Transfer = { id: string; bytes: Uint8Array; offset: number; expires: number };
let exported: Transfer | undefined,
  imported: Transfer | undefined,
  importBusy = false;
const MAX_BACKUP = 256 * 1024 * 1024,
  CHUNK = 192 * 1024;
async function handle(op: string, p: any) {
  const control = await ready;
  if (exported && exported.expires < Date.now()) exported = undefined;
  if (imported && imported.expires < Date.now()) imported = undefined;
  if (
    importBusy &&
    [
      'ingest',
      'deleteUser',
      'clear',
      'compact',
      'importStart',
      'importFinish',
      'exportStart',
    ].includes(op)
  )
    throw new Error('正在合并备份，请稍后重试');
  switch (op) {
    case 'ingest': {
      const records = await Promise.all(
        p.records.map(async (r: any) => {
          const v = validateRecord(r);
          return { ...v, fingerprint: await fingerprint(v) };
        }),
      );
      return repo.ingest(records);
    }
    case 'summaries':
      control.deadline(500);
      try {
        return repo.summaries(p);
      } finally {
        control.deadline(0);
      }
    case 'history':
      control.deadline(500);
      try {
        return repo.history(p);
      } finally {
        control.deadline(0);
      }
    case 'search':
      control.deadline(500);
      try {
        return repo.search(p);
      } catch (e: any) {
        if (/interrupt/i.test(e.message))
          throw new Error('搜索范围过大，请增加 UID、视频或日期筛选');
        throw e;
      } finally {
        control.deadline(0);
      }
    case 'stats':
      return {
        ...repo.stats(),
        storage: await navigator.storage.estimate(),
        sqlite: sqlite.version.libVersion,
      };
    case 'deleteUser':
      return repo.deleteUser(p.uid);
    case 'clear':
      return repo.clear();
    case 'compact': {
      // Finalize inactive prepared handles before rewriting schema pages.
      for (const st of statements.values()) st.finalize();
      statements.clear();
      try {
        return repo.compact();
      } catch (e: any) {
        throw new Error('压缩未完成：' + e.message + '。记录未被删除，可在释放磁盘空间后重试。');
      }
    }
    case 'exportStart': {
      // Single connection and no outstanding transaction: export a consistent SQLite snapshot.
      const size =
        adapter.all('PRAGMA page_count')[0].page_count *
        adapter.all('PRAGMA page_size')[0].page_size;
      if (size > MAX_BACKUP)
        throw new Error(
          '当前版本单次备份上限为 256 MiB，数据库仍可正常查询；请保留扩展及其本地数据',
        );
      const bytes = sqlite.capi.sqlite3_js_db_export(db.pointer);
      exported = { id: crypto.randomUUID(), bytes, offset: 0, expires: Date.now() + 300000 };
      return { id: exported.id, size: bytes.length };
    }
    case 'exportChunk': {
      if (
        !exported ||
        exported.id !== p.id ||
        !Number.isSafeInteger(p.offset) ||
        p.offset < 0 ||
        p.offset > exported.bytes.length
      )
        throw new Error('备份会话已失效');
      exported.expires = Date.now() + 300000;
      return { data: bytesToBase64(exported.bytes.subarray(p.offset, p.offset + CHUNK)) };
    }
    case 'exportEnd':
      if (exported?.id === p.id) exported = undefined;
      return {};
    case 'importStart': {
      if (!Number.isSafeInteger(p.size) || p.size < 100 || p.size > MAX_BACKUP)
        throw new Error('备份大小需在 100 字节至 256 MiB 之间');
      if (imported) throw new Error('已有导入进行中');
      imported = {
        id: crypto.randomUUID(),
        bytes: new Uint8Array(p.size),
        offset: 0,
        expires: Date.now() + 300000,
      };
      return { id: imported.id };
    }
    case 'importChunk': {
      if (
        !imported ||
        imported.id !== p.id ||
        p.offset !== imported.offset ||
        typeof p.data !== 'string' ||
        p.data.length > CHUNK * 1.4
      )
        throw new Error('导入分块无效');
      const bytes = base64ToBytes(p.data);
      if (imported.offset + bytes.length > imported.bytes.length)
        throw new Error('导入超出声明大小');
      imported.bytes.set(bytes, imported.offset);
      imported.offset += bytes.length;
      imported.expires = Date.now() + 300000;
      return { offset: imported.offset };
    }
    case 'importCancel':
      if (imported?.id === p.id) imported = undefined;
      return {};
    case 'importFinish': {
      if (!imported || imported.id !== p.id || imported.offset !== imported.bytes.length)
        throw new Error('备份尚未完整上传');
      const transfer = imported;
      imported = undefined;
      importBusy = true;
      let stage: any;
      try {
        if (new TextDecoder().decode(transfer.bytes.subarray(0, 16)) !== 'SQLite format 3\0')
          throw new Error('不是 SQLite 数据库');
        await pool.importDb('/incoming.sqlite3', transfer.bytes);
        stage = new pool.OpfsSAHPoolDb('/incoming.sqlite3', 'r');
        stage.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
        if (
          stage.selectValue('PRAGMA application_id') !== APPLICATION_ID ||
          ![1, VERSION].includes(stage.selectValue('PRAGMA user_version'))
        )
          throw new Error('仅支持本扩展版本 1 或 2 的备份');
        if (stage.selectValue('PRAGMA quick_check') !== 'ok') throw new Error('备份完整性校验失败');
        const kinds = stage.selectObjects(
          "SELECT name,type FROM sqlite_schema WHERE name IN ('users','videos','comments')",
        );
        if (kinds.length !== 3 || kinds.some((x: any) => x.type !== 'table'))
          throw new Error('备份表结构无效');
        if (
          stage.selectValue(
            'SELECT count(*) FROM comments WHERE id<=0 OR id>9007199254740991 OR complete NOT IN (0,1)',
          ) !== 0
        )
          throw new Error('备份记录标识或完整性字段无效');
        const sql = `SELECT c.id,u.uid,u.name,v.bvid,v.title,c.body,c.rpid,c.parent,c.root,c.context,c.time_text AS timeText,c.first_seen_at AS firstSeen,c.last_seen_at AS lastSeen,c.complete FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN videos v ON v.id=c.video_id WHERE c.id>? ORDER BY c.id LIMIT 50`;
        // Validate every row before modifying the live database. No backup SQL or triggers are executed.
        for (let cursor = 0; ;) {
          const rows = stage.selectObjects(sql, [cursor]);
          if (!rows.length) break;
          for (const row of rows) validateRecord({ ...row, complete: row.complete === 1 });
          cursor = rows.at(-1).id;
          await delay(0);
        }
        let inserted = 0,
          received = 0;
        for (let cursor = 0; ;) {
          const rows = stage.selectObjects(sql, [cursor]);
          if (!rows.length) break;
          const records = await Promise.all(
            rows.map(async (row: any) => {
              const v = validateRecord({ ...row, complete: row.complete === 1 });
              return { ...v, fingerprint: await fingerprint(v) };
            }),
          );
          const result = repo.ingest(records);
          inserted += result.inserted;
          received += result.received;
          cursor = rows.at(-1).id;
          await delay(0);
        }
        adapter.exec('PRAGMA optimize');
        return { inserted, received };
      } catch (e: any) {
        throw new Error(
          '导入失败：' + e.message + '。原有记录保留；若合并阶段中断，可重新导入继续去重合并。',
        );
      } finally {
        stage?.close();
        try {
          pool.unlink('/incoming.sqlite3');
        } catch {}
        importBusy = false;
      }
    }
    default:
      throw new Error('未知数据库操作');
  }
}
// Each message runs synchronously in SQLite; async preprocessing never leaves an open transaction.
scope.onmessage = async (e: MessageEvent) => {
  const { id, op, payload } = e.data;
  try {
    const data = await handle(op, payload || {});
    scope.postMessage({ id, result: { ok: true, data } });
  } catch (error: any) {
    scope.postMessage({ id, result: { ok: false, error: String(error.message || error) } });
  }
};
