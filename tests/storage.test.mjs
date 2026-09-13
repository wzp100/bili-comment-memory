import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, record } from './helpers.mjs';
const legacy = readFileSync(new URL('./fixtures/v1.sql', import.meta.url), 'utf8');
test('升级 v1 保留评论、统计、游标 ID 并重建精简索引', async () => {
  const { db, repo } = database(':memory:', legacy);
  try {
    repo.ingest([
      await record(),
      await record({ rpid: '2', body: '连续中文字符串与 emoji 😊🧡✨' }),
    ]);
    const before = db.prepare('SELECT * FROM comments ORDER BY id').all();
    const stats = repo.stats();
    repo.init();
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(db.prepare('SELECT * FROM comments ORDER BY id').all(), before);
    assert.equal(repo.stats().comments, stats.comments);
    assert.equal(repo.search({ keyword: '连续中文字符串' }).items.length, 1);
    assert.equal(repo.search({ keyword: '😊🧡✨' }).items.length, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='comment_fts_docsize'").get().n,
      0,
    );
    repo.ingest([await record({ rpid: '2', body: '更新后的连续中文字符串' })]);
    assert.equal(repo.search({ keyword: '😊🧡✨' }).items.length, 0);
    repo.deleteUser('12345');
    assert.equal(repo.search({ keyword: '连续中文字符串' }).items.length, 0);
  } finally {
    db.close();
  }
});
test('升级中断会回滚到原版本和原索引', async () => {
  const { db, repo, adapter } = database(':memory:', legacy);
  try {
    repo.ingest([await record()]);
    const exec = adapter.exec;
    adapter.exec = (sql) => {
      if (sql.includes("VALUES('rebuild')")) throw new Error('模拟重建失败');
      return exec(sql);
    };
    assert.throws(() => repo.init(), /模拟重建失败/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM comments').get().n, 1);
    assert.equal(
      db.prepare('SELECT count(*) n FROM comment_fts WHERE comment_fts MATCH ?').get('"中文评论"')
        .n,
      1,
    );
    adapter.exec = exec;
    repo.init();
    assert.equal(repo.search({ keyword: '中文评论' }).items.length, 1);
  } finally {
    db.close();
  }
});
test('精简 trigram 索引过滤乱序、重复片段等候选误命中', async () => {
  const { db, repo } = database();
  try {
    const bodies = [
      'abc---bcd',
      'abcd',
      'aaa',
      'aaaa',
      '甲乙丙--乙丙丁',
      '甲乙丙丁',
      '他说 "100%" 好评',
      'emoji 😊🧡✨',
    ];
    repo.ingest(await Promise.all(bodies.map((body, i) => record({ body, rpid: String(i + 1) }))));
    for (const term of ['abcd', 'aaaa', '甲乙丙丁', '"100%"', '😊🧡✨'])
      assert.deepEqual(
        repo.search({ keyword: term }).items.map((r) => r.body),
        bodies.filter((body) => body.includes(term)).reverse(),
      );
  } finally {
    db.close();
  }
});
test('压缩回收删除后的空闲页并保留剩余评论及搜索', async () => {
  const { db, repo } = database();
  try {
    const rows = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        record({ uid: '999', rpid: String(i + 1), body: '测试存储空间回收。'.repeat(150) + i }),
      ),
    );
    repo.ingest(rows);
    repo.ingest([await record({ uid: '12345', rpid: '10000' })]);
    repo.deleteUser('999');
    assert.ok(repo.stats().freeBytes > 0);
    const remaining = repo.history({ uid: '12345' }).items;
    const result = repo.compact();
    assert.ok(result.savedBytes > 0);
    assert.equal(repo.stats().freeBytes, 0);
    assert.deepEqual(repo.history({ uid: '12345' }).items, remaining);
    assert.equal(repo.search({ keyword: '中文评论' }).items.length, 1);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally {
    db.close();
  }
});
