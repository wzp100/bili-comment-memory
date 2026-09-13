import { SCHEMA, VERSION } from './schema.mjs';
import { UID, BV } from '../shared.mjs';
const SELECT = `SELECT c.*,u.uid,u.name,v.bvid,v.title FROM comments c JOIN users u ON u.id=c.user_id JOIN videos v ON v.id=c.video_id`;
export class Repository {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    this.cacheBytes = 0;
  }
  init() {
    const version = this.db.all('PRAGMA user_version')[0].user_version;
    if (version > VERSION) throw new Error('数据库版本较新，请升级扩展');
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192;');
    if (version === 1) {
      // Only derived FTS data changes. DDL + rebuild + version update commit atomically.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(
          'DROP TRIGGER comments_ai; DROP TRIGGER comments_ad; DROP TRIGGER comments_au; DROP TABLE comment_fts;',
        );
        this.db.exec(SCHEMA);
        this.db.exec("INSERT INTO comment_fts(comment_fts) VALUES('rebuild'); COMMIT;");
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    } else this.db.exec(SCHEMA);
    this.db.exec('PRAGMA optimize;');
  }
  invalidate() {
    this.cache.clear();
    this.cacheBytes = 0;
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      this.invalidate();
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  ingest(records) {
    return this.transaction(() => {
      let inserted = 0;
      const users = new Map(),
        videos = new Map();
      for (const r of records) {
        const uk = r.uid + '\0' + r.name,
          vk = r.bvid + '\0' + r.title;
        let user = users.get(uk),
          video = videos.get(vk);
        if (!user) {
          this.db.run(
            'INSERT INTO users(uid,name) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name WHERE name!=excluded.name',
            [r.uid, r.name],
          );
          user = this.db.all('SELECT id FROM users WHERE uid=?', [r.uid])[0].id;
          users.set(uk, user);
        }
        if (!video) {
          this.db.run(
            'INSERT INTO videos(bvid,title) VALUES(?,?) ON CONFLICT(bvid) DO UPDATE SET title=excluded.title WHERE title!=excluded.title',
            [r.bvid, r.title],
          );
          video = this.db.all('SELECT id FROM videos WHERE bvid=?', [r.bvid])[0].id;
          videos.set(vk, video);
        }
        const old = r.rpid
          ? this.db.all('SELECT * FROM comments WHERE video_id=? AND rpid=?', [video, r.rpid])[0]
          : this.db.all(
              'SELECT * FROM comments WHERE video_id=? AND rpid IS NULL AND fallback_fingerprint=?',
              [video, r.fingerprint],
            )[0];
        if (old) {
          if (
            old.user_id !== user ||
            (!r.rpid && (old.body !== r.body || old.context !== r.context))
          )
            throw new Error('评论标识冲突，已回滚此批记录');
          const body = old.complete && !r.complete ? old.body : r.body;
          this.db.run(
            `UPDATE comments SET body=?,complete=MAX(complete,?),last_seen_at=MAX(last_seen_at,?),first_seen_at=MIN(first_seen_at,?) WHERE id=? AND (body!=? OR complete<? OR last_seen_at<? OR first_seen_at>?)`,
            [
              body,
              r.complete,
              r.lastSeen,
              r.firstSeen,
              old.id,
              body,
              r.complete,
              r.lastSeen - 60000,
              r.firstSeen,
            ],
          );
          if (old.published_at == null && r.publishedAt != null)
            this.db.run('UPDATE comments SET published_at=?,time_text=? WHERE id=?', [
              r.publishedAt,
              r.timeText,
              old.id,
            ]);
        } else {
          this.db.run(
            `INSERT INTO comments(user_id,video_id,rpid,fallback_fingerprint,body,time_text,published_at,first_seen_at,last_seen_at,parent,root,context,complete) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              user,
              video,
              r.rpid,
              r.rpid ? null : r.fingerprint,
              r.body,
              r.timeText,
              r.publishedAt,
              r.firstSeen,
              r.lastSeen,
              r.parent,
              r.root,
              r.context,
              r.complete,
            ],
          );
          inserted++;
        }
      }
      return { inserted, received: records.length };
    });
  }
  summaries(p) {
    if (
      !Array.isArray(p.uids) ||
      p.uids.length > 50 ||
      p.uids.some((uid) => typeof uid !== 'string' || !UID.test(uid))
    )
      throw new Error('批量 UID 无效（最多 50 个）');
    if (p.exclude && !BV.test(p.exclude)) throw new Error('视频编号无效');
    const exclude = p.exclude || null,
      uids = [...new Set(p.uids)];
    if (!uids.length) return { items: [], exclude };
    // One fixed prepared statement: stats lookup and one covering-index seek per user.
    const rows = this.db.all(
      `SELECT u.uid,COALESCE(s.comment_count,0)-COALESCE(current.comment_count,0) AS count,v.bvid,v.title
      FROM users u LEFT JOIN user_stats s ON s.user_id=u.id
      LEFT JOIN videos excluded ON excluded.bvid=?
      LEFT JOIN user_video_stats current ON current.user_id=u.id AND current.video_id=excluded.id
      LEFT JOIN videos v ON v.id=CASE WHEN COALESCE(s.comment_count,0)>COALESCE(current.comment_count,0) THEN
        (SELECT c.video_id FROM comments c WHERE c.user_id=u.id AND (excluded.id IS NULL OR c.video_id!=excluded.id) ORDER BY c.first_seen_at DESC,c.id DESC LIMIT 1) END
      WHERE u.uid IN (SELECT value FROM json_each(?))`,
      [exclude, JSON.stringify(uids)],
    );
    const found = new Map(rows.map((row) => [row.uid, row]));
    return {
      items: uids.map((uid) => found.get(uid) || { uid, count: 0, bvid: null, title: null }),
      exclude,
    };
  }
  history(p) {
    if (!UID.test(p.uid)) throw new Error('UID 无效');
    if (p.exclude && !BV.test(p.exclude)) throw new Error('视频编号无效');
    const key = JSON.stringify(p),
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.data;
    }
    const user = this.db.all('SELECT id,name FROM users WHERE uid=?', [p.uid])[0];
    if (!user) return { items: [], count: 0, videos: 0, next: null };
    const excluded = p.exclude
      ? this.db.all('SELECT id FROM videos WHERE bvid=?', [p.exclude])[0]?.id
      : undefined;
    const totals = this.db.all('SELECT * FROM user_stats WHERE user_id=?', [user.id])[0];
    const current = excluded
      ? this.db.all('SELECT comment_count FROM user_video_stats WHERE user_id=? AND video_id=?', [
          user.id,
          excluded,
        ])[0]?.comment_count || 0
      : 0;
    const count = (totals?.comment_count || 0) - current;
    let where = 'user_id=?',
      args = [user.id];
    if (excluded) {
      where += ' AND video_id!=?';
      args.push(excluded);
    }
    if (p.cursor) {
      checkCursor(p.cursor);
      where += ' AND (first_seen_at,id)<(?,?)';
      args.push(...p.cursor);
    }
    const candidates = count
      ? this.db.all(
          `SELECT id,first_seen_at FROM comments WHERE ${where} ORDER BY first_seen_at DESC,id DESC LIMIT 11`,
          args,
        )
      : [];
    const ids = candidates.slice(0, 10).map((x) => x.id);
    const items = ids.length
      ? this.db.all(
          `${SELECT} WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.first_seen_at DESC,c.id DESC`,
          ids,
        )
      : [];
    const last = items.at(-1);
    const data = {
      items,
      count,
      videos: (totals?.video_count || 0) - (current ? 1 : 0),
      name: user.name,
      next: candidates.length > 10 ? [last.first_seen_at, last.id] : null,
    };
    const size = JSON.stringify(data).length * 2;
    if (size < 8 * 1024 * 1024) {
      while (
        this.cache.size &&
        (this.cache.size >= 200 || this.cacheBytes + size > 8 * 1024 * 1024)
      ) {
        const k = this.cache.keys().next().value;
        this.cacheBytes -= this.cache.get(k).size;
        this.cache.delete(k);
      }
      this.cache.set(key, { data, size });
      this.cacheBytes += size;
    }
    return data;
  }
  search(p = {}) {
    const where = [],
      args = [];
    if (p.uid) {
      if (!UID.test(p.uid)) throw new Error('UID 无效');
      where.push('c.user_id=(SELECT id FROM users WHERE uid=?)');
      args.push(p.uid);
    }
    if (p.bvid) {
      if (!BV.test(p.bvid)) throw new Error('BV 号无效');
      where.push('c.video_id=(SELECT id FROM videos WHERE bvid=?)');
      args.push(p.bvid);
    }
    if (p.name) {
      where.push('c.user_id IN (SELECT id FROM users WHERE instr(name,?)>0)');
      args.push(String(p.name).slice(0, 200));
    }
    for (const [k, sign] of [
      ['from', '>='],
      ['to', '<='],
    ])
      if (p[k]) {
        if (!Number.isSafeInteger(p[k])) throw new Error('时间范围无效');
        where.push(`c.first_seen_at${sign}?`);
        args.push(p[k]);
      }
    if (p.cursor) {
      checkCursor(p.cursor);
      where.push('(c.first_seen_at,c.id)<(?,?)');
      args.push(...p.cursor);
    }
    const term = typeof p.keyword === 'string' ? p.keyword.trim().slice(0, 200) : '';
    const short = term && [...term].length < 3;
    // A precise UID/BV filter is much more selective than common global trigrams.
    // Bound the candidate scan instead of materializing all matching FTS rowids.
    const scan = term && (short || p.uid || p.bvid || term.includes('\0'));
    if (term && !scan) {
      where.push(
        'c.id IN (SELECT rowid FROM comment_fts WHERE comment_fts MATCH ?) AND instr(c.body,?)>0',
      );
      args.push(trigramQuery(term), term);
    }
    const limit = scan ? 1000 : 31;
    const query = scan
      ? 'SELECT c.id,c.first_seen_at,instr(c.body,?)>0 AS matched FROM comments c'
      : SELECT;
    const rows = this.db.all(
      `${query} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.first_seen_at DESC,c.id DESC LIMIT ${limit}`,
      scan ? [term, ...args] : args,
    );
    let items = [],
      last = null;
    for (const r of rows) {
      last = r;
      if (!scan || r.matched) items.push(r);
      if (items.length === 30) break;
    }
    const hasMore =
      items.length === 30
        ? rows.indexOf(last) < rows.length - 1 || rows.length === limit
        : rows.length === limit;
    if (scan && items.length) {
      const ids = items.map((r) => r.id);
      items = this.db.all(
        `${SELECT} WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.first_seen_at DESC,c.id DESC`,
        ids,
      );
    }
    return {
      items,
      next: hasMore && last ? [last.first_seen_at, last.id] : null,
      partialScan: !!scan && hasMore,
      scanned: rows.length,
    };
  }
  stats() {
    const pageSize = this.db.all('PRAGMA page_size')[0].page_size;
    const bytes = this.db.all('PRAGMA page_count')[0].page_count * pageSize;
    const freeBytes = this.db.all('PRAGMA freelist_count')[0].freelist_count * pageSize;
    return {
      ...this.db.all(
        `SELECT (SELECT count(*) FROM comments) comments,(SELECT count(*) FROM user_stats) users,(SELECT count(DISTINCT video_id) FROM user_video_stats) videos`,
      )[0],
      bytes,
      freeBytes,
      usedBytes: bytes - freeBytes,
    };
  }
  compact() {
    const before = this.stats();
    // No open transaction: VACUUM repacks pages and truncates the database file.
    this.db.exec(
      "INSERT INTO comment_fts(comment_fts) VALUES('optimize'); VACUUM; PRAGMA optimize;",
    );
    this.invalidate();
    const after = this.stats();
    return {
      before: before.bytes,
      after: after.bytes,
      savedBytes: Math.max(0, before.bytes - after.bytes),
    };
  }
  deleteUser(uid) {
    if (!UID.test(uid)) throw new Error('UID 无效');
    return this.transaction(() => {
      this.db.run('DELETE FROM comments WHERE user_id=(SELECT id FROM users WHERE uid=?)', [uid]);
      this.db.run('DELETE FROM users WHERE uid=?', [uid]);
      return { deleted: true };
    });
  }
  clear() {
    return this.transaction(() => {
      this.db.exec('DELETE FROM comments; DELETE FROM users; DELETE FROM videos;');
      return { cleared: true };
    });
  }
}
function checkCursor(c) {
  if (!Array.isArray(c) || c.length !== 2 || !c.every((x) => Number.isSafeInteger(x) && x > 0))
    throw new Error('分页游标无效');
}
export function trigramQuery(term) {
  const chars = [...term];
  const grams = new Set(chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join('')));
  // detail=none accepts individual 3-codepoint tokens, not longer phrase tokens.
  // AND yields candidates; instr(body,term) verifies exact order and multiplicity.
  return [...grams].map((g) => '"' + g.replaceAll('"', '""') + '"').join(' AND ');
}
