/**
 * analyze_metrics 工具过滤纯函数测试（任务 3）
 * 直接 import filterSeries 纯函数，验证：metric/system/temp/from/to 过滤、
 * 空匹配、空入参原样返回、空数据源空态返回。
 * 测试数据用 buildMetricsSeries 构造：两条 SnSe（ZT 823K / 300K）、一条 Bi₂Te₃（ZT 400K）。
 */
import { buildMetricsSeries, filterSeries } from '../src-server/server/metrics.js';
import { assert, assertFinish, assertSummary } from './helpers/assert.mjs';

// 构造测试数据：两条 SnSe（ZT 823K / 300K）、一条 Bi₂Te₃（ZT 400K），日期 08-05 / 08-06
// createdAt 用 UTC 毫秒（store.now() 即 toISOString），数值取本地日期对应的 UTC 凌晨时刻，
// 使「本地日期零点（new Date('YYYY-MM-DD') 本地解析）」与点 ts 的比较语义自洽（UTC+8 环境）
const entries = [
  { id: 'a1', system: 'SnSe', sampleId: 'S-1', createdAt: '2026-08-05T02:00:00Z',
    fields: [{ k: 'ZT', v: '0.9 @ 823K' }] },
  { id: 'a2', system: 'SnSe', sampleId: 'S-2', createdAt: '2026-08-06T02:00:00Z',
    fields: [{ k: 'ZT', v: '0.5 @ 300K' }] },
  { id: 'a3', system: 'Bi₂Te₃', sampleId: 'B-1', createdAt: '2026-08-06T03:00:00Z',
    fields: [{ k: 'ZT', v: '1.2 @ 400K' }] },
];
const data = buildMetricsSeries(entries, []);

function collectPoints(filtered) {
  const all = [];
  for (const m of Object.values(filtered.metrics || {})) {
    for (const pts of Object.values(m.systems || {})) all.push(...pts);
  }
  return all;
}

console.log('== analyze_metrics 过滤测试 ==');
assert.equal(data.metrics.zt.systems['SnSe'].length, 2, '前置：SnSe 两个 ZT 点');
assert.equal(data.metrics.zt.systems['Bi₂Te₃'].length, 1, '前置：Bi₂Te₃ 一个 ZT 点');

// 1. metric + system 过滤：只含 SnSe 的 zt 数据
{
  const f = filterSeries(data, { metric: 'zt', system: 'SnSe' });
  assert.deepEqual(Object.keys(f.metrics), ['zt'], '只保留 zt 指标');
  assert.deepEqual(Object.keys(f.metrics.zt.systems), ['SnSe'], '只保留 SnSe 体系');
  assert.equal(f.metrics.zt.systems['SnSe'].length, 2, 'SnSe 两个 ZT 点保留');
  assert.equal(f.metrics.zt.systems['Bi₂Te₃'], undefined, 'Bi₂Te₃ 被滤除');
}

// 2. temp 过滤：精确匹配（p.temp !== Number(temp) 跳过）
{
  const f = filterSeries(data, { metric: 'zt', temp: 823 });
  const pts = collectPoints(f);
  assert.equal(pts.length, 1, 'temp=823 只剩 1 个点');
  assert.equal(pts[0].temp, 823, '点温度 823');
  assert.equal(pts[0].entryId, 'a1', '命中 08-05 的 SnSe 点');
}

// 2b. temp 过滤命中 °C 来源点（温度标度归一后精确匹配生效）
{
  const r = buildMetricsSeries([{ id: 'a2b', system: 'SnSe', createdAt: '2026-08-06T04:00:00Z',
    fields: [{ k: 'ZT', v: '0.8 @ 550°C' }] }], []);
  const f = filterSeries(r, { metric: 'zt', temp: 823 });
  const pts = collectPoints(f);
  assert.equal(pts.length, 1, 'temp=823 命中 550°C 来源点');
  assert.equal(pts[0].temp, 823, '归一为 823K');
  assert.equal(pts[0].tempUnit, 'K', 'tempUnit 为 K');
}

// 3. from 过滤：只含 08-06 及之后的点（按点 ts 毫秒比较）
{
  const f = filterSeries(data, { from: '2026-08-06' });
  const pts = collectPoints(f);
  assert.equal(pts.length, 2, '08-06 起只剩 2 个点');
  const t0 = new Date('2026-08-06').getTime();
  assert.ok(pts.every((p) => p.ts >= t0), '所有点 ts ≥ from 零点');
  assert.deepEqual(pts.map((p) => p.entryId).sort(), ['a2', 'a3'], '命中 08-06 的 SnSe 与 Bi₂Te₃ 点');
}

// 4. to 过滤：截止到 08-06 零点之前（按点 ts 毫秒比较，new Date('2026-08-06') 本地解析）
{
  const f = filterSeries(data, { to: '2026-08-06' });
  const pts = collectPoints(f);
  assert.equal(pts.length, 1, '08-06 零点前只剩 1 个点');
  assert.equal(pts[0].entryId, 'a1', '只留 08-05 的 SnSe 点');
}

// 5. 无匹配：metrics 空对象 + totals 保留
{
  const f = filterSeries(data, { metric: 'zt', system: 'PbSe' });
  assert.deepEqual(f.metrics, {}, '无匹配 → metrics 空对象');
  assert.equal(f.totals.entries, 3, 'totals.entries 保留');
  assert.equal(f.totals.withMetrics, 3, 'totals.withMetrics 保留');
  assert.deepEqual(f.totals.unrecognized, [], 'totals.unrecognized 保留');
}

// 6. 空入参：数据内容原样返回（metrics/order/baseline/totals 四字段与 build 输出一致；ok 是 build 层包装，不在 filter 契约内）
{
  const f = filterSeries(data);
  const core = { metrics: data.metrics, order: data.order, baseline: data.baseline, totals: data.totals };
  assert.deepEqual(
    { metrics: f.metrics, order: f.order, baseline: f.baseline, totals: f.totals },
    core,
    '空入参 → 数据内容原样返回'
  );
}

// 7. 空数据源：空态返回
{
  const empty = buildMetricsSeries([], []);
  const f = filterSeries(empty, { metric: 'zt' });
  assert.deepEqual(f.metrics, {}, '空数据源 → metrics 空对象');
  assert.equal(f.totals.entries, 0, '空数据源 → totals 保留');
  assert.deepEqual(f.order, [], '空数据源 → order 空数组');
}

// 8. count 与过滤后点数一致（审查 P1：过滤后 count 失真会误导「样本不足」判断）
{
  const f = filterSeries(data, { metric: 'zt', system: 'SnSe' });
  assert.equal(f.metrics.zt.count, 2, 'SnSe 过滤后 count = 2（非 build 全量 3）');
  const g = filterSeries(data, { metric: 'zt', temp: 823 });
  assert.equal(g.metrics.zt.count, 1, 'temp=823 过滤后 count = 1');
}

// 9. execute 层契约（审查 P0：裸对象返回会被宿主 String 化为 "[object Object]"，
//    必须 content 文本包装；sessionPermission 声明只读）
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-exec-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'worklog.json'),
      JSON.stringify({ version: 1, entries: [{ id: 'e1', system: 'SnSe', createdAt: '2026-08-05T02:00:00Z', fields: [{ k: 'ZT', v: '0.9 @ 823K' }] }] })
    );
    const { execute, sessionPermission } = await import('../src-server/tools/analyze-metrics.js');
    const res = await execute({ metric: 'zt' }, { dataDir: dir });
    assert.ok(Array.isArray(res?.content) && res.content.length > 0, 'execute 返回 content 文本包装（宿主契约）');
    const text = res.content[0]?.text;
    assert.equal(typeof text, 'string', 'content[0].text 是字符串');
    const parsed = JSON.parse(text);
    assert.equal(parsed.metrics.zt.systems.SnSe.length, 1, 'JSON 可解析且含 zt 序列');
    assert.equal(sessionPermission?.kind, 'read', 'sessionPermission 声明 read（只读工具）');
    assert.equal(parsed.totals.entries, 1, 'totals 随 JSON 返回');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n结果: ${assertSummary()} `);
assertFinish();
