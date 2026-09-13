import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, record } from './helpers.mjs';

test('批量摘要去重、包含当前视频、未知 UID 返回零，最近记录按首次记录时间和 ID 排序', async () => {
  const { db, repo, adapter } = database();
  try {
    repo.ingest([
      await record(),
      await record({
        rpid: '2',
        bvid: 'BV1AA411A7AA',
        title: '较晚记录的视频',
        firstSeen: 1700000001000,
        lastSeen: 1700000001000,
      }),
    ]);
    repo.ingest([await record({ lastSeen: 1700000500000 })]);
    let sql = '',
      calls = 0;
    const all = adapter.all;
    adapter.all = (s, p) => {
      sql = s;
      calls++;
      return all(s, p);
    };
    const result = repo.summaries({ uids: ['12345', '99999', '12345'] });
    assert.equal(calls, 1);
    assert.deepEqual(
      result.items.map((row) => ({ ...row })),
      [
        { uid: '12345', count: 2, bvid: 'BV1AA411A7AA', title: '较晚记录的视频' },
        { uid: '99999', count: 0, bvid: null, title: null },
      ],
    );
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(null, JSON.stringify(['12345']));
    assert.ok(plan.some((r) => r.detail.includes('COVERING INDEX comment_user_time')));
    assert.ok(!plan.some((r) => /SCAN c\b|TEMP B-TREE/.test(r.detail)));
    adapter.all = all;
    repo.ingest([
      await record({
        rpid: '3',
        bvid: 'BV1BB411B7BB',
        title: '相同时间后的评论',
        firstSeen: 1700000001000,
        lastSeen: 1700000001000,
      }),
    ]);
    assert.equal(repo.summaries({ uids: ['12345'] }).items[0].bvid, 'BV1BB411B7BB');
    repo.deleteUser('12345');
    assert.equal(repo.summaries({ uids: ['12345'] }).items[0].count, 0);
  } finally {
    db.close();
  }
});
test('批量摘要限制输入与批次大小', () => {
  const { db, repo } = database();
  try {
    assert.deepEqual(repo.summaries({ uids: [] }), { items: [], exclude: null });
    for (const uids of [null, ['1 OR 1=1'], [12345], Array(51).fill('12345')])
      assert.throws(() => repo.summaries({ uids }), /UID/);
  } finally {
    db.close();
  }
});

test('摘要条数和最近视频均排除当前视频，重复采集不重复计数', async () => {
  const { db, repo } = database();
  try {
    const other = await record();
    repo.ingest([
      other,
      await record({
        rpid: '2',
        bvid: 'BV1AA411A7AA',
        firstSeen: 1700000001000,
        lastSeen: 1700000001000,
      }),
      await record({ uid: '77777', rpid: '3', bvid: 'BV1AA411A7AA' }),
    ]);
    repo.ingest([other]);
    let result = repo.summaries({ uids: ['12345', '12345', '77777'], exclude: 'BV1AA411A7AA' });
    assert.equal(result.exclude, 'BV1AA411A7AA');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].count, 1);
    assert.equal(result.items[0].bvid, 'BV1GJ411x7h7');
    assert.equal(result.items[1].count, 0);
    assert.equal(result.items[1].bvid, null);
    result = repo.summaries({ uids: ['12345'], exclude: 'BV1GJ411x7h7' });
    assert.equal(result.items[0].bvid, 'BV1AA411A7AA');
    assert.equal(repo.summaries({ uids: ['12345'], exclude: 'BV1BB411B7BB' }).items[0].count, 2);
    assert.throws(() => repo.summaries({ uids: ['12345'], exclude: 'invalid' }), /视频/);
  } finally {
    db.close();
  }
});
