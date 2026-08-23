/**
 * 指标提取单元测试（P1）
 * 直接 import 纯函数模块，验证：双策略抽取、体系识别、温度抽取、时间排序、
 * 文献基准、fields 形态兼容（数组/对象）、无匹配返回空。
 */
import { buildMetricsSeries, extractLiteratureBaseline, filterSeries } from '../src-server/server/metrics.ts';
import { assert, assertFinish, assertSummary } from './helpers/assert.mjs';

const worklog = [
  // SnSe：fields 数组 + 双指标(ZT/PF) + 温度
  {
    id: 'w1',
    system: 'SnSe',
    sampleId: 'S-1',
    date: '2026-01-10',
    createdAt: '2026-01-10T10:00:00.000Z',
    content: '合成了 SnSe 薄膜',
    data: 'ZT=0.6 @ 823K\n功率因子=1.1',
    fields: [{ k: 'ZT', v: '0.6 @ 823K' }, { k: '功率因子', v: '1.1' }],
  },
  // SnSe：后续点
  {
    id: 'w2',
    system: 'SnSe',
    sampleId: 'S-2',
    date: '2026-02-10',
    createdAt: '2026-02-10T10:00:00.000Z',
    content: 'SnSe 第二次合成',
    data: 'ZT=0.9 @ 823K',
    fields: [{ k: 'ZT', v: '0.9 @ 823K' }],
  },
  // Bi₂Te₃：key 命中「热电优值」
  {
    id: 'w3',
    system: 'Bi₂Te₃',
    sampleId: 'B-1',
    date: '2026-01-20',
    createdAt: '2026-01-20T10:00:00.000Z',
    content: 'Bi2Te3 器件组装',
    data: '热电优值=1.2 @ 300K',
    fields: [{ k: '热电优值', v: '1.2 @ 300K' }],
  },
  // 无指标记录：不应进任何序列
  { id: 'w4', date: '2026-03-01', createdAt: '2026-03-01T10:00:00.000Z', content: '买了试剂', data: '' },
  // 数值正则兜底（无 fields）+ SnS 识别（非 SnS2）
  {
    id: 'wF',
    system: 'SnS',
    sampleId: 'SS-1',
    date: '2026-04-01',
    createdAt: '2026-04-01T10:00:00.000Z',
    content: 'SnS 样品测试',
    data: 'ZT=0.7 @ 823K',
    fields: [],
  },
  // fields 对象形态（兼容旧写入）
  {
    id: 'wE',
    system: 'SnSe',
    sampleId: 'S-3',
    date: '2026-05-01',
    createdAt: '2026-05-01T10:00:00.000Z',
    content: 'SnSe 第三次',
    data: '',
    fields: { ZT: '0.85 @ 823K' },
  },
];

const literature = [
  { title: 'High ZT in SnSe', abstract: 'We achieved a record ZT of 2.5 at 823 K in SnSe single crystal.' },
  { title: 'PF record', abstract: '功率因子 达到 2.0，创纪录水平。' },
  { title: '无关文献', abstract: 'This paper studies something else with ZT=0.3 only.' },
];

console.log('== 指标提取测试 ==');
const r = buildMetricsSeries(worklog, literature);

// 1. 指标集合
assert(r.ok === true, '返回 ok');
assert(r.order.includes('zt') && r.order.includes('pf'), 'order 含 zt 与 pf');
assert(!r.metrics.temp, '无温度键/值时不应生成 temp 序列');
assert(!r.metrics.sigma, '无电导率数据不应生成 sigma 序列');

// 2. ZT 跨体系分组
const zt = r.metrics.zt;
assert(zt && zt.systems['SnSe'] && zt.systems['Bi₂Te₃'] && zt.systems['SnS'], 'ZT 分成 SnSe / Bi₂Te₃ / SnS 三体系');
assert(zt.systems['SnSe'].length === 3, 'SnSe 的 ZT 有 3 个点(w1,w2,wE)');
assert(zt.systems['Bi₂Te₃'][0].value === 1.2, 'Bi₂Te₃ ZT=1.2');
assert(zt.systems['Bi₂Te₃'][0].temp === 300 && zt.systems['Bi₂Te₃'][0].tempUnit === 'K', 'Bi₂Te₃ 温度 300K 抽取');

// 3. 时间升序（按记录时间，非数值大小：Jan 0.6 → Feb 0.9 → May 0.85）
const snse = zt.systems['SnSe'];
assert(snse[0].value === 0.6 && snse[1].value === 0.9 && snse[2].value === 0.85, 'SnSe ZT 按记录时间升序 0.6(1月)→0.9(2月)→0.85(5月)');
assert(snse[0].ts < snse[1].ts && snse[1].ts < snse[2].ts, 'SnSe ZT 时间戳递增');
assert(snse[0].temp === 823 && snse[0].tempUnit === 'K', 'SnSe 温度 823K 抽取');

// 4. PF 抽取
assert(r.metrics.pf && r.metrics.pf.systems['SnSe'][0].value === 1.1, 'PF=1.1 从 SnSe 抽取');

// 5. 无指标记录不计入
assert(r.totals.withMetrics === 5, 'withMetrics=5 (w1,w2,w3,wF,wE)');

// 6. 文献基准
assert(r.baseline.zt.value === 2.5, '文献基准 ZT=2.5（record 语境）');
assert(r.baseline.pf.value === 2.0, '文献基准 PF=2.0（创纪录语境）');
assert(r.baseline.sigma == null, '无 record 语境的 sigma 基准为 null');

// 7. 空输入
const empty = buildMetricsSeries([], []);
assert(empty.order.length === 0 && empty.totals.withMetrics === 0, '空记录返回空序列');
assert(empty.baseline.zt == null, '空文献基准 zt 为 null');

// 8. 对象形态 fields 归一化已覆盖（wE 进入 SnSe）
assert(snse.some((p) => p.value === 0.85), '对象形态 fields 被正确归一化抽取');

// 9. 独立测试 extractLiteratureBaseline 取最大值
const base = extractLiteratureBaseline(literature);
assert(base.zt.value === 2.5, 'extractLiteratureBaseline: 取 record 最大值 2.5');

// —— 新增断言组（任务 1 深化：单位归一化 / 黑名单 / 多温度全抽 / 体系字段优先 / unrecognized / 基线温度）——

// 1. 单位归一化：Seebeck 0.38 mV/K → 380（基准 μV/K）
{
  const r = buildMetricsSeries([{ id: 'w1', createdAt: '2026-08-06T10:00:00Z', system: 'SnSe',
    fields: [{ k: 'Seebeck系数', v: '0.38 mV/K' }] }], []);
  assert.equal(r.metrics.seebeck.systems['SnSe'][0].value, 380, 'mV/K ×1000');
  assert.equal(r.metrics.seebeck.systems['SnSe'][0].unit, 'mV/K', '换算成功 unit 保留原始单位串（可溯源；null 仅表示单位未标注）');
  assert.ok(String(r.metrics.seebeck.systems['SnSe'][0].raw).includes('0.38 mV/K'), 'raw 保留原文');
}
// 2. 工艺黑名单：退火温度/保温时间不进任何指标；「功率因子」字段不被误杀
{
  const r = buildMetricsSeries([{ id: 'w2', createdAt: '2026-08-06T11:00:00Z', system: 'Bi₂Te₃',
    fields: [{ k: '退火温度', v: '780' }, { k: '保温时间', v: '720' }, { k: '功率因子', v: '1.2' }] }], []);
  assert.equal(r.metrics.temp, undefined, 'temp 指标已移除');
  assert.equal(r.metrics.zt, undefined, '无 ZT 数据');
  assert.equal(r.metrics.pf.systems['Bi₂Te₃'][0].value, 1.2, '功率因子字段正常收');
}
// 3. 多温度点全抽：一条记录两个 ZT 点
{
  const r = buildMetricsSeries([{ id: 'w3', createdAt: '2026-08-06T12:00:00Z', system: 'SnSe',
    data: 'ZT=0.9 @ 823K，ZT=0.5 @ 300K' }], []);
  const pts = r.metrics.zt.systems['SnSe'];
  assert.equal(pts.length, 2, '两个温度点全抽');
  assert.deepEqual(pts.map(p => p.temp), [823, 300], '温度上下文正确');
}
// 4. 体系：显式字段优先；content 含「与 SnSe 文献对比」不误判；识别不到进 unrecognized
{
  const r = buildMetricsSeries([
    { id: 'w4', createdAt: '2026-08-06T13:00:00Z', system: 'PbSe', fields: [{ k: 'ZT', v: '1.1' }] },
    { id: 'w5', createdAt: '2026-08-06T14:00:00Z', data: '电导率=320 S/m',
      content: '与 SnSe 文献对比，本炉失败' },
  ], []);
  assert.ok(r.metrics.zt.systems['PbSe'], '显式体系字段生效');
  assert.equal(r.metrics.sigma?.systems?.['SnSe'], undefined, 'content 提及不误判体系');
  assert.equal(r.metrics.sigma?.systems?.['未标注'], undefined, '未识别体系不进图');
  assert.equal(r.totals.unrecognized.length, 1, '未识别记录进 unrecognized 列表');
  assert.equal(r.totals.unrecognized[0].entryId, 'w5');
}
// 4b. content 体系识别：动作语境句采信，引用语境句排除
{
  const r = buildMetricsSeries([
    { id: 'w4b1', createdAt: '2026-08-06T13:30:00Z', data: '',
      fields: [{ k: 'ZT', v: '0.8 @ 823K' }],
      content: '配置Bi2Te3单晶生长。室温720min升至780℃，保温720min，随后13200min降温至560℃' },
    { id: 'w4b2', createdAt: '2026-08-06T13:40:00Z', data: '',
      fields: [{ k: 'ZT', v: '0.7 @ 823K' }],
      content: '与 SnSe 文献对比，本炉失败' },
    { id: 'w4b3', createdAt: '2026-08-06T13:50:00Z', data: '',
      fields: [{ k: 'ZT', v: '0.9 @ 823K' }],
      content: '合成了 SnSe 样品并测了 XRD' },
  ], []);
  const ids = r.totals.unrecognized.map((u) => u.entryId);
  assert.deepEqual(ids, ['w4b2'], 'content 动作语境（配置/合成）识别成功，仅引用语境句未识别');
  assert.equal(r.totals.unrecognized.length, 1, '引用语境句仍进 unrecognized');
}
// 5. 兜底不扫 content：「3 炉都失败了」不产出数据点
{
  const r = buildMetricsSeries([{ id: 'w6', createdAt: '2026-08-06T15:00:00Z', system: 'SnSe',
    content: '今天 3 炉都失败了' }], []);
  assert.equal(r.metrics.zt, undefined);
  assert.equal(r.metrics.pf, undefined);
}
// 6. 电导率单位换算：320 S/m → 3.2 S/cm
{
  const r = buildMetricsSeries([{ id: 'w7', createdAt: '2026-08-06T16:00:00Z', system: 'SnSe',
    fields: [{ k: '电导率', v: '320 S/m' }] }], []);
  assert.equal(r.metrics.sigma.systems['SnSe'][0].value, 3.2, 'S/m ×0.01');
}
// 7. 科学计数法载流子浓度：1.2e19
{
  const r = buildMetricsSeries([{ id: 'w8', createdAt: '2026-08-06T17:00:00Z', system: 'SnSe',
    fields: [{ k: '载流子浓度', v: '1.2e19 cm⁻³' }] }], []);
  assert.equal(r.metrics.n.systems['SnSe'][0].value, 1.2e19);
}
// 8. 基线温度抽取（record 语境）
{
  const lit = [{ title: 'xxx', abstractNote: 'record ZT of 2.5 at 823 K was achieved' }];
  const b = extractLiteratureBaseline(lit);
  assert.equal(b.zt.value, 2.5);
  assert.equal(b.zt.temp, 823);
}

// 9. PF 单位换算：1.2 mW/mK² → 12（1 mW/mK² = 10 μW/cmK²，SnSe 经典 PF≈10 μW/cmK² ≈ 1 mW/mK² 可对照）
{
  const r = buildMetricsSeries([{ id: 'w9', createdAt: '2026-08-06T18:00:00Z', system: 'SnSe',
    fields: [{ k: '功率因子', v: '1.2 mW/mK²' }] }], []);
  assert.equal(r.metrics.pf.systems['SnSe'][0].value, 12, 'mW/mK² ×10');
  assert.equal(r.metrics.pf.systems['SnSe'][0].unit, 'mW/mK²', '原始单位串保留');
}

// 10. kappa 单位换算：2 mW/(cm·K) → 0.2（基准 W/(m·K)，×0.1）
{
  const r = buildMetricsSeries([{ id: 'w10', createdAt: '2026-08-06T19:00:00Z', system: 'SnSe',
    fields: [{ k: '热导率', v: '2 mW/(cm·K)' }] }], []);
  assert.equal(r.metrics.kappa.systems['SnSe'][0].value, 0.2, 'mW/(cm·K) ×0.1（IEEE754 长尾已规范化）');
}

// 12. kappa 常见写法 W/mK / mW/cmK（用户数据最常用 ASCII 形态）
{
  const r = buildMetricsSeries([{ id: 'w12', createdAt: '2026-08-06T21:00:00Z', system: 'SnSe',
    fields: [{ k: '热导率', v: '0.42 W/mK' }, { k: '热导率', v: '0.3 mW/cmK' }] }], []);
  const pts = r.metrics.kappa.systems['SnSe'];
  assert.equal(pts.length, 2, '两个点均解析');
  assert.equal(pts[0].value, 0.42, 'W/mK ×1');
  assert.equal(pts[0].unit, 'W/mK', 'W/mK 命中换算非空心');
  assert.equal(pts[1].value, 0.03, 'mW/cmK ×0.1');
  assert.equal(pts[1].unit, 'mW/cmK', 'mW/cmK 命中换算非空心');
}
// 13. fields 键名带温度（巡检「ZT@823K=0.7」）+ data 同值去重：键名温度被利用，双抽合并为 1 点
{
  const r = buildMetricsSeries([{ id: 'w13', createdAt: '2026-08-06T22:00:00Z', system: 'SnSe',
    fields: [{ k: 'ZT@823K', v: '0.7' }],
    data: 'ZT=0.7@823K\n载流子浓度=3.2e18 cm-3' }], []);
  const pts = r.metrics.zt.systems['SnSe'];
  assert.equal(pts.length, 1, 'fields 与 data 双抽去重为 1 点');
  assert.equal(pts[0].temp, 823, '键名温度被提取');
  assert.equal(pts[0].tempUnit, 'K');
}
// 14. data 多行跨行温度不串扰：电导率不误取上一行 ZT 的 823K
{
  const r = buildMetricsSeries([{ id: 'w14', createdAt: '2026-08-06T23:00:00Z', system: 'SnSe',
    fields: [], data: 'ZT=0.7@823K\n电导率=620 S/m' }], []);
  const s = r.metrics.sigma.systems['SnSe'][0];
  assert.equal(s.value, 6.2, 'S/m ×0.01');
  assert.equal(s.temp, null, '跨行温度不串扰');
  const z = r.metrics.zt.systems['SnSe'][0];
  assert.equal(z.temp, 823, '同行温度正常');
}
// 15. 同行窗口值后优先仍生效：逗号连接的多温度点
{
  const r = buildMetricsSeries([{ id: 'w15', createdAt: '2026-08-06T23:30:00Z', system: 'SnSe',
    fields: [], data: 'ZT=0.9@823K，ZT=0.5@300K' }], []);
  const pts = r.metrics.zt.systems['SnSe'];
  assert.equal(pts.length, 2, '两点全抽');
  assert.equal(pts[0].temp, 823, '第一点温度 823');
  assert.equal(pts[1].temp, 300, '第二点温度 300（值后窗口优先）');
}
// 16. mu 单位换算：0.01 m²/(V·s) → 100（基准 cm²/(V·s)，×1e4）
{
  const r = buildMetricsSeries([{ id: 'w11', createdAt: '2026-08-06T20:00:00Z', system: 'SnSe',
    fields: [{ k: '迁移率', v: '0.01 m²/(V·s)' }] }], []);
  assert.equal(r.metrics.mu.systems['SnSe'][0].value, 100, 'm²/(V·s) ×1e4');
}

// 12. 记录级温度：字段精确键「测试温度」优先；「烧结温度」不收（含温度但不是测试条件）
{
  const r = buildMetricsSeries([{ id: 'w12', createdAt: '2026-08-06T21:00:00Z', system: 'SnSe',
    fields: [{ k: '测试温度', v: '823 K' }, { k: 'ZT', v: '0.9' }] }], []);
  assert.equal(r.metrics.zt.systems['SnSe'][0].temp, 823, '记录级测试温度优先');
}
{
  const r = buildMetricsSeries([{ id: 'w13', createdAt: '2026-08-06T22:00:00Z', system: 'SnSe',
    fields: [{ k: '烧结温度', v: '550°C' }, { k: 'ZT', v: '0.9 @ 823K' }] }], []);
  assert.equal(r.metrics.zt.systems['SnSe'][0].temp, 823, '烧结温度不覆盖值附近温度');
}

// 13. 单位缺失 → unit null（空心点数据）；ZT 无量纲无单位是合法态（unit 非 null）
{
  const r = buildMetricsSeries([{ id: 'w14', createdAt: '2026-08-06T23:00:00Z', system: 'SnSe',
    fields: [{ k: 'Seebeck系数', v: '380' }] }], []);
  assert.equal(r.metrics.seebeck.systems['SnSe'][0].unit, null, '有单位指标无单位 → unit null');
}
{
  const r = buildMetricsSeries([{ id: 'w14b', createdAt: '2026-08-06T23:05:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '0.9 @ 823K' }] }], []);
  assert.equal(r.metrics.zt.systems['SnSe'][0].unit, '', 'ZT 无量纲无单位 → unit 空串（实心点）');
}

// 14. 去重：同记录同指标同温度同值只收一个（fields 与 data 双抽）
{
  const r = buildMetricsSeries([{ id: 'w15', createdAt: '2026-08-06T23:30:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '0.9 @ 823K' }], data: 'ZT=0.9 @ 823K' }], []);
  assert.equal(r.metrics.zt.systems['SnSe'].length, 1, 'fields/data 双抽去重');
}

// 15. fields 同 key 多值不覆盖（多温度全抽的 fields 形态）
{
  const r = buildMetricsSeries([{ id: 'w16', createdAt: '2026-08-06T23:45:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '0.9 @ 823K' }, { k: 'ZT', v: '0.5 @ 300K' }] }], []);
  const pts = r.metrics.zt.systems['SnSe'];
  assert.equal(pts.length, 2, 'fields 同 key 两个温度点都收');
  assert.deepEqual(pts.map((p) => p.temp), [823, 300], '两个点温度正确');
}

// 16. data 兜底单位提取：数字与单位之间有空格（'1.2 mW/mK²'）不丢单位
{
  const r = buildMetricsSeries([{ id: 'w17', createdAt: '2026-08-06T23:50:00Z', system: 'SnSe',
    data: '功率因子=1.2 mW/mK²' }], []);
  const p = r.metrics.pf.systems['SnSe'][0];
  assert.equal(p.value, 12, 'data 兜底带空格单位 ×10');
  assert.equal(p.unit, 'mW/mK²', '单位 token 正确提取');
}

// 17. 变化量词排除：字段名含衰减率/变化率等 → 不提取为指标值
{
  const r = buildMetricsSeries([{ id: 'w18', createdAt: '2026-08-07T00:00:00Z', system: 'Bi₂Te₃',
    fields: [
      { k: '弯折前Seebeck系数', v: '152 μV/K' },
      { k: '弯折后Seebeck系数', v: '148 μV/K' },
      { k: 'Seebeck系数衰减率', v: '2.6%' },
    ] }], []);
  const pts = r.metrics.seebeck?.systems?.['Bi₂Te₃'] ?? [];
  assert.equal(pts.length, 2, '衰减率字段不提取，仅前后两个值点');
  assert.ok(!pts.some((p) => p.value === 2.6), '2.6% 不被当作 Seebeck 值');
}

// 18. unrecognized 收窄：无指标点且体系未识别的记录不警告（纯引用/文献阅读记录）
{
  const r = buildMetricsSeries([
    { id: 'w19a', createdAt: '2026-08-07T01:00:00Z', system: '',
      content: '阅读了 SnSe 热电文献，与文献相比我们采用丝网印刷路线的优势是柔性化程度更高' },
    { id: 'w19b', createdAt: '2026-08-07T02:00:00Z', system: '',
      fields: [{ k: 'ZT', v: '0.7 @ 823K' }] },
  ], []);
  const ids = r.totals.unrecognized.map((u) => u.entryId);
  assert.ok(!ids.includes('w19a'), '无指标点且体系空 → 不进 unrecognized（纯引用记录不警告）');
  assert.ok(ids.includes('w19b'), '有指标点且体系空 → 进 unrecognized（需补标注）');
}

// 19. P0-2 锚定回归：fields 值串含描述性前缀时，优先取字段名（锚）之后紧邻的数值
{
  const r = buildMetricsSeries([{ id: 'w20', createdAt: '2026-08-07T03:00:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '样品3 的 ZT 2.1' }] }], []);
  assert.equal(r.metrics.zt.systems['SnSe'][0].value, 2.1, '锚（字段名）命中：取 2.1（旧行为会取 3）');
}
{
  const r = buildMetricsSeries([{ id: 'w20b', createdAt: '2026-08-07T03:05:00Z', system: 'Bi₂Te₃',
    fields: [{ k: 'ZT', v: 'ZT 从 0.5 提升到 0.9' }] }], []);
  assert.equal(r.metrics.zt.systems['Bi₂Te₃'][0].value, 0.5, '锚命中取紧邻首个值 0.5');
}
// 20. 锚未命中回退：先剔温度结构再取第一个数字（823K 不再被当作指标值）
{
  const r = buildMetricsSeries([{ id: 'w21', createdAt: '2026-08-07T03:10:00Z', system: 'SnSe',
    fields: [{ k: '功率因子', v: '823K 时测得 1.2' }] }], []);
  assert.equal(r.metrics.pf.systems['SnSe'][0].value, 1.2, '温度剔除后取 1.2（旧行为取 823）');
}
{
  const r = buildMetricsSeries([{ id: 'w21b', createdAt: '2026-08-07T03:15:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '0.5（ZT 提升后）' }] }], []);
  assert.equal(r.metrics.zt.systems['SnSe'][0].value, 0.5, '无温度时回退第一个数字，行为不变');
}
// 21. 键名带温度（ZT@823K）作锚：@ 转义正确，紧邻数值被取
{
  const r = buildMetricsSeries([{ id: 'w23', createdAt: '2026-08-07T03:30:00Z', system: 'SnSe',
    fields: [{ k: 'ZT@823K', v: '升温后 0.7' }] }], []);
  const p = r.metrics.zt.systems['SnSe'][0];
  assert.equal(p.value, 0.7, '@ 锚转义后取 0.7');
  assert.equal(p.temp, 823, '键名温度仍被提取');
}

// —— 温度标度归一（2026-08-07）：K/°C 统一换算为整数 K ——

// 22. °C → K：550°C 归一为 823K，tempUnit 恒 'K'
{
  const r = buildMetricsSeries([{ id: 't1', createdAt: '2026-08-07T04:00:00Z', system: 'SnSe',
    fields: [{ k: 'ZT', v: '0.6 @ 550°C' }] }], []);
  const p = r.metrics.zt.systems['SnSe'][0];
  assert.equal(p.temp, 823, '550°C → 823K（round(550+273.15)）');
  assert.equal(p.tempUnit, 'K', 'tempUnit 恒为 K');
}

// 23. 同温合并筛选：823K 与 550°C 两条记录，temp=823 同时命中
{
  const r = buildMetricsSeries([
    { id: 't2a', createdAt: '2026-08-07T04:10:00Z', system: 'SnSe',
      fields: [{ k: 'ZT', v: '0.9 @ 823K' }] },
    { id: 't2b', createdAt: '2026-08-07T04:20:00Z', system: 'SnSe',
      fields: [{ k: 'ZT', v: '0.8 @ 550°C' }] },
  ], []);
  const f = filterSeries(r, { metric: 'zt', temp: 823 });
  const pts = f.metrics.zt.systems['SnSe'];
  assert.equal(pts.length, 2, 'temp=823 同时命中 K 与 °C 来源的两点');
  assert.ok(pts.every((p) => p.temp === 823 && p.tempUnit === 'K'), '归一后温度与单位一致');
}

// 24. 记录级温度字段归一：{k:'温度', v:'550°C'} → 823K
{
  const r = buildMetricsSeries([{ id: 't3', createdAt: '2026-08-07T04:30:00Z', system: 'Bi₂Te₃',
    fields: [{ k: '温度', v: '550°C' }, { k: 'ZT', v: '0.7' }] }], []);
  assert.equal(r.metrics.zt.systems['Bi₂Te₃'][0].temp, 823, '记录级 550°C → 823K');
}

// 25. ℃ 单字符变体 + 负温：-20℃ → 253K（低温热电场景）
{
  const r = buildMetricsSeries([{ id: 't4', createdAt: '2026-08-07T04:40:00Z', system: 'BiSb',
    fields: [{ k: 'ZT', v: '0.4 @ -20℃' }] }], []);
  const p = r.metrics.zt.systems['BiSb'][0];
  assert.equal(p.temp, 253, '-20℃ → 253K');
  assert.equal(p.tempUnit, 'K');
}

// 26. 归一后去重：同记录 K/°C 双写同值同温 → 合并为 1 点
{
  const r = buildMetricsSeries([{ id: 't5', createdAt: '2026-08-07T04:50:00Z', system: 'SnSe',
    data: 'ZT=0.9 @ 823K，ZT=0.9 @ 550°C' }], []);
  assert.equal(r.metrics.zt.systems['SnSe'].length, 1, '归一后同值同温去重为 1 点');
}

// 27. 文献基线 °C 语境：'at 650 °C' → 923K
{
  const lit = [{ title: 'xxx', abstractNote: 'record ZT of 2.5 at 650 °C was achieved in polycrystalline SnSe' }];
  const b = extractLiteratureBaseline(lit);
  assert.equal(b.zt.value, 2.5);
  assert.equal(b.zt.temp, 923, '650°C → 923K');
  assert.equal(b.zt.tempUnit, 'K');
}

console.log(`\n结果: ${assertSummary()} `);
assertFinish();
