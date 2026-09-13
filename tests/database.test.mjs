import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, record } from './helpers.mjs';
import { pageBV, parseDate } from '../src/shared.mjs';
test('跨视频历史、同名不同 UID、原视频标题关联', async () => {
  const { repo, db } = database();
  try {
    repo.ingest([
      await record(),
      await record({ uid: '999', rpid: '2' }),
      await record({ bvid: 'BV1xx411c7mD', title: '视频乙', rpid: '3' }),
    ]);
    const result = repo.history({ uid: '12345', exclude: 'BV1xx411c7mD' });
    assert.equal(result.count, 1);
    assert.equal(result.videos, 1);
    assert.equal(result.items[0].title, '视频甲');
    assert.equal(result.items[0].rpid, '987654321012345678');
  } finally {
    db.close();
  }
});
test('重试幂等、正文完整性、昵称变更清理缓存', async () => {
  const { repo, db } = database();
  try {
    const r = await record();
    repo.ingest([r, r]);
    repo.history({ uid: r.uid });
    repo.ingest([await record({ name: '新昵称', body: '中文', complete: false })]);
    const h = repo.history({ uid: r.uid });
    assert.equal(h.count, 1);
    assert.equal(h.items[0].body, r.body);
    assert.equal(h.name, '新昵称');
  } finally {
    db.close();
  }
});
test('同时间游标分页不重复不遗漏', async () => {
  const { repo, db } = database();
  try {
    const rows = await Promise.all(
      Array.from({ length: 35 }, (_, i) => record({ rpid: String(i + 1) })),
    );
    repo.ingest(rows);
    let cursor = null,
      ids = [];
    do {
      const h = repo.history({ uid: '12345', cursor });
      ids.push(...h.items.map((x) => x.id));
      cursor = h.next;
    } while (cursor);
    assert.equal(ids.length, 35);
    assert.equal(new Set(ids).size, 35);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
  } finally {
    db.close();
  }
});
test('指纹去重忽略变化的相对时间并区分回复上下文', async () => {
  const { repo, db } = database();
  try {
    repo.ingest([
      await record({ rpid: null, timeText: '1分钟前' }),
      await record({ rpid: null, timeText: '2分钟前' }),
      await record({ rpid: null, timeText: '2024-01-02 03:04' }),
      await record({ rpid: null, timeText: '2分钟前', context: '其他楼层' }),
    ]);
    assert.equal(repo.stats().comments, 2);
  } finally {
    db.close();
  }
});
test('事务冲突回滚评论、统计与搜索索引', async () => {
  const { repo, db } = database();
  try {
    const original = await record();
    repo.ingest([original]);
    const fresh = await record({ rpid: '2', body: '应该回滚的新增评论' });
    assert.throws(() => repo.ingest([fresh, { ...original, uid: '3' }]), /冲突/);
    assert.equal(repo.stats().comments, 1);
    assert.equal(repo.search({ keyword: '回滚的' }).items.length, 0);
  } finally {
    db.close();
  }
});
test('中文长短词、字面引号和删除后全文索引一致', async () => {
  const { repo, db } = database();
  try {
    repo.ingest([await record(), await record({ rpid: '2', body: '他说 "100%" 好评' })]);
    assert.equal(repo.search({ keyword: '中文评论' }).items.length, 1);
    assert.equal(repo.search({ keyword: '中文' }).items.length, 1);
    assert.equal(repo.search({ keyword: '"100%"' }).items.length, 1);
    repo.deleteUser('12345');
    assert.equal(repo.search({ keyword: '中文评论' }).items.length, 0);
    assert.equal(repo.stats().comments, 0);
    assert.equal(repo.history({ uid: '12345' }).count, 0);
  } finally {
    db.close();
  }
});
test('短词扫描可继续分页直到命中深处记录', async () => {
  const { repo, db } = database();
  try {
    const rows = await Promise.all(
      Array.from({ length: 1100 }, (_, i) =>
        record({
          rpid: String(i + 1),
          body: i === 0 ? '稀有' : '普通文本',
          firstSeen: 1700000000000 + i,
        }),
      ),
    );
    repo.ingest(rows);
    const first = repo.search({ keyword: '稀有' });
    assert.equal(first.items.length, 0);
    assert.ok(first.next);
    const second = repo.search({ keyword: '稀有', cursor: first.next });
    assert.equal(second.items.length, 1);
  } finally {
    db.close();
  }
});
test('筛选和排序走联合索引', () => {
  const { db } = database();
  try {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id,first_seen_at FROM comments WHERE user_id=? AND video_id!=? ORDER BY first_seen_at DESC,id DESC LIMIT 11',
      )
      .all(1, 2);
    assert.match(JSON.stringify(plan), /comment_user_time/);
    assert.doesNotMatch(JSON.stringify(plan), /TEMP B-TREE/);
  } finally {
    db.close();
  }
});
test('全文索引与 UID 范围搜索保持相同的字面匹配语义', async () => {
  const { repo, db } = database();
  try {
    repo.ingest([await record({ body: 'ABC 中文内容' })]);
    for (const p of [{}, { uid: '12345' }]) {
      assert.equal(repo.search({ ...p, keyword: 'abc 中文' }).items.length, 0);
      assert.equal(repo.search({ ...p, keyword: 'ABC 中文' }).items.length, 1);
    }
  } finally {
    db.close();
  }
});
test('站点 URL 与时间解析不接受伪域名', () => {
  assert.equal(pageBV('https://www.bilibili.com.evil.test/video/BV1GJ411x7h7/'), null);
  assert.equal(parseDate('昨天'), null);
  assert.equal(parseDate('2024-01-02 03:04'), Date.parse('2024-01-02T03:04:00+08:00'));
});
