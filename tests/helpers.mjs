import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/database/core.mjs';
import { validateRecord, fingerprint } from '../src/shared.mjs';
export function database(path = ':memory:', schema = null) {
  const db = new DatabaseSync(path),
    statements = new Map();
  const statement = (sql) => {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  };
  const adapter = {
    exec: (sql) => db.exec(sql),
    all: (sql, p = []) => statement(sql).all(...p),
    run: (sql, p = []) => statement(sql).run(...p),
  };
  const repo = new Repository(adapter);
  if (schema) db.exec(schema);
  else repo.init();
  return { db, adapter, repo };
}
export async function record(overrides = {}) {
  const r = validateRecord({
    uid: '12345',
    bvid: 'BV1GJ411x7h7',
    rpid: '987654321012345678',
    name: '测试用户',
    title: '视频甲',
    body: '中文评论与 emoji 😊',
    timeText: '2024-01-02 03:04',
    complete: true,
    firstSeen: 1700000000000,
    lastSeen: 1700000000000,
    ...overrides,
  });
  return { ...r, fingerprint: await fingerprint(r) };
}
