import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryClient, summaryError } from '../src/summary-client.mjs';

test('新版批量协议直接使用单次请求', async () => {
  const calls = [];
  const expected = { items: [{ uid: '12345', count: 0, bvid: null, title: null }] };
  const query = summaryClient(async (op, p) => {
    calls.push([op, p]);
    return expected;
  });
  assert.equal(await query(['12345']), expected);
  assert.deepEqual(calls, [['summaries', { uids: ['12345'], exclude: null }]]);
});
for (const message of ['操作未授权', '未知数据库操作'])
  test('新版页面遇到旧后台时兼容历史查询：' + message, async () => {
    let batches = 0,
      active = 0,
      maxActive = 0;
    const query = summaryClient(async (op, { uid }) => {
      if (op === 'summaries') {
        batches++;
        throw new Error(message);
      }
      assert.equal(op, 'history');
      maxActive = Math.max(maxActive, ++active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return uid === '99999'
        ? { count: 0, items: [] }
        : { count: 4, items: [{ bvid: 'BV1GJ411x7h7', title: '视频甲' }] };
    });
    const result = await query(['12345', '99999', '45678']);
    assert.deepEqual(result.items[0], {
      uid: '12345',
      count: 4,
      bvid: 'BV1GJ411x7h7',
      title: '视频甲',
    });
    assert.deepEqual(result.items[1], { uid: '99999', count: 0, bvid: null, title: null });
    await query(['12345']);
    assert.equal(batches, 1);
    assert.ok(maxActive <= 2);
  });
test('数据库实际故障和连接失效保留原因，不退回零记录或吞掉错误', async () => {
  let calls = 0;
  const query = summaryClient(async () => {
    calls++;
    throw new Error('database disk image is malformed');
  });
  await assert.rejects(() => query(['12345']), /malformed/);
  assert.equal(calls, 1);
  assert.equal(summaryError(new Error('Extension context invalidated.')).label, '请刷新 B 站页面');
  assert.equal(
    summaryError(new Error('数据库 Worker 启动失败，请重新加载扩展')).label,
    '请重新加载扩展',
  );
  assert.match(summaryError(new Error('SQLITE_BUSY')).detail, /SQLITE_BUSY/);
});

test('旧批量接口忽略排除视频时，改用支持排除的历史接口并去重 UID', async () => {
  const calls = [];
  const exclude = 'BV1AA411A7AA';
  const query = summaryClient(async (op, p) => {
    calls.push([op, p]);
    return op === 'summaries'
      ? { items: [{ uid: '12345', count: 99, bvid: exclude }] }
      : { count: 1, items: [{ bvid: 'BV1GJ411x7h7', title: '其他视频' }] };
  });
  const result = await query(['12345', '12345'], exclude);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].count, 1);
  assert.equal(result.items[0].bvid, 'BV1GJ411x7h7');
  assert.deepEqual(calls, [
    ['summaries', { uids: ['12345'], exclude }],
    ['history', { uid: '12345', exclude }],
  ]);
});
test('新版批量排除确认后不额外请求历史接口', async () => {
  const exclude = 'BV1AA411A7AA',
    expected = { items: [], exclude };
  let calls = 0;
  const query = summaryClient(async (op, p) => {
    calls++;
    assert.equal(op, 'summaries');
    assert.equal(p.exclude, exclude);
    return expected;
  });
  assert.equal(await query(['12345'], exclude), expected);
  assert.equal(calls, 1);
});
