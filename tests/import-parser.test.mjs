/**
 * 批量导入解析器单元测试（2026-08-14）
 * 直接 import 纯函数模块，验证：TSV/CSV/全角逗号解析、表头识别、温度归一、
 * 表头单位拼接、键名带温度、同测量合并、错误行、科学计数法、未知列。
 */
import { parseMetricTable } from "../src-server/server/import-parser.js";
import { assert, assertFinish, assertSummary } from './helpers/assert.mjs';

console.log("== 批量导入解析测试 ==");

// 1. TSV 基础：同测量合并 + 键名带温度（K）
{
  const text = [
    "date\tsampleId\tsystem\t温度\tZT\tSeebeck",
    "2026-08-14\tS-1\tSnSe\t823\t0.9\t380",
    "2026-08-14\tS-1\tSnSe\t873\t0.7\t320",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 1, "同日期同样品合并为 1 条记录");
  assert.equal(r.records[0].date, "2026-08-14");
  assert.equal(r.records[0].sampleId, "S-1");
  assert.equal(r.records[0].system, "SnSe");
  assert.equal(r.records[0].fields.length, 4, "2 行 × 2 指标 = 4 个字段");
  assert.deepEqual(
    r.records[0].fields.map((f) => f.k),
    ["ZT@823K", "Seebeck@823K", "ZT@873K", "Seebeck@873K"],
    "键名带温度 K 形态"
  );
  assert.equal(r.errors.length, 0, "无错误行");
  assert.deepEqual(r.summary, { rows: 2, records: 1, points: 4, errorRows: 0 }, "summary 正确");
}

// 2. °C 归一：550°C → 823K 键名；裸数字按 T(°C) 表头归一
{
  const text = [
    "date\tsampleId\tsystem\tT(°C)\tZT",
    "2026-08-14\tS-2\tBi₂Te₃\t550\t0.8",
    "2026-08-14\tS-2\tBi₂Te₃\t600\t0.6",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.deepEqual(
    r.records[0].fields.map((f) => f.k),
    ["ZT@823K", "ZT@873K"],
    "T(°C) 裸数字归一为 K（550→823，600→873）"
  );
}

// 3. 单元格自带单位优先：温度列混写 823K / 550°C
{
  const text = [
    "温度\tZT",
    "823K\t0.9",
    "550°C\t0.5",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.deepEqual(
    r.records[0].fields.map((f) => f.k),
    ["ZT@823K", "ZT@823K"],
    "823K 与 550°C 归一为同一键名"
  );
  assert.equal(r.records[0].fields.length, 2, "两个点都保留（fields 保序）");
}

// 4. 表头单位拼接：Seebeck(μV/K) + 纯数字单元格 → '380 μV/K'
{
  const text = [
    "温度\tSeebeck(μV/K)",
    "823K\t380",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records[0].fields[0].v, "380 μV/K", "表头单位拼进值串（unitNorm 换算免费生效）");
}

// 5. 单元格值已带单位 → 不重复拼接
{
  const text = [
    "温度\tSeebeck(μV/K)",
    "823K\t0.38 mV/K",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records[0].fields[0].v, "0.38 mV/K", "单元格单位优先，表头单位不重复拼");
}

// 6. CSV 半角逗号 + 引号包裹
{
  const text = [
    "date,sampleId,温度,ZT",
    '"2026-08-14","S-3",823,1.2',
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].sampleId, "S-3", "引号被剥离");
  assert.equal(r.records[0].fields[0].v, "1.2");
}

// 7. 全角逗号 CSV（中文环境）
{
  const text = [
    "日期，样品，温度，ZT",
    "2026-08-14，S-4，823，0.9",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].sampleId, "S-4", "全角逗号分隔解析");
}

// 8. 错误行：坏日期整行跳过；指标值非数字进 errors 带行号
{
  const text = [
    "date\t温度\tZT",
    "2026-08-14\t823\t0.9",
    "08/14/2026\t873\t0.7",
    "2026-08-14\t923\tabc",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 1, "仅有效行成记录");
  assert.equal(r.records[0].fields.length, 1, "坏日期行与坏值行都未入 fields");
  assert.equal(r.errors.length, 2, "两个错误");
  const lines = r.errors.map((e) => e.line).sort();
  assert.deepEqual(lines, [3, 4], "错误物理行号 3（坏日期）与 4（非数字值）");
  assert.ok(r.errors.some((e) => e.reason.startsWith("日期")), "坏日期错误信息");
  assert.ok(r.errors.some((e) => e.reason.includes("ZT=abc")), "非数字值错误信息含字段名");
}

// 9. 科学计数法 + 未知列进 fields（工艺参数）
{
  const text = [
    "date\ttemp\t载流子浓度\t退火温度",
    "2026-08-14\t300K\t3.2e19\t650",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  const ks = r.records[0].fields.map((f) => f.k);
  assert.ok(ks.includes("载流子浓度@300K"), "科学计数法值正常入字段");
  assert.equal(r.records[0].fields.find((f) => f.k === "载流子浓度@300K").v, "3.2e19");
  assert.ok(ks.includes("退火温度"), "未知列（工艺参数）进 fields，metrics 黑名单会排除");
}

// 10. 无温度列 → 键名无温度；日期列空 → 缺省今天
{
  const text = [
    "date\tsampleId\tZT",
    "\tS-5\t0.7",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records[0].date, "2026-08-14", "日期缺省今天");
  assert.equal(r.records[0].fields[0].k, "ZT", "无温度列键名不带温度");
}

// 11. 空行与空单元格跳过；纯空白输入报错
{
  const text = ["date\tZT", "", "2026-08-14\t0.9", "   ", "2026-08-14\t"].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 1, "空行跳过");
  assert.equal(r.records[0].fields.length, 1, "空指标单元格跳过");
  const empty = parseMetricTable("", { today: "2026-08-14" });
  assert.equal(empty.records.length, 0, "空输入零记录");
  assert.equal(empty.errors.length, 1, "空输入报错");
}

// 12. 备注列拼接 contentParts；温度解析失败进 errors
{
  const text = [
    "date\t温度\tZT\t备注",
    "2026-08-14\t823\t0.9\tZEM-3 测量",
    "2026-08-14\tabc\t0.8\t第二次测量",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records[0].contentParts.length, 1, "备注进 contentParts");
  assert.equal(r.records[0].contentParts[0], "ZEM-3 测量");
  assert.equal(r.records[0].fields.length, 2, "温度解析失败的行，指标值仍以无温度键名入 fields");
  assert.ok(r.records[0].fields.some((f) => f.k === "ZT"), "无温度键名形态");
  assert.equal(r.errors.length, 1, "温度解析失败进 errors");
  assert.ok(r.errors[0].reason.includes("abc"), "错误信息含原始值");
}

// 13. 同日期不同样品号 → 两条记录
{
  const text = [
    "date\tsampleId\tZT",
    "2026-08-14\tA\t0.9",
    "2026-08-14\tB\t0.8",
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.records.length, 2, "不同样品分记录");
}

// 5. O-11 引号感知：字段内嵌逗号/转义引号不破坏切分（splitRow 不按引号内逗号切分）
{
  const text = [
    "样品\t内容\tZT",
    '"S-1"\t"做了A,做了B"\t0.9',
    '"S-2"\t"说了 ""hi"" 然后收尾"\t0.7',
  ].join("\n");
  const r = parseMetricTable(text, { today: "2026-08-14" });
  assert.equal(r.errors.length, 0, "包含引号/内嵌逗号/转义引号的行不应报错");
  assert.equal(r.records[0].sampleId, "S-1", "引号包裹的 sampleId 应去除引号");
  assert.equal(r.records[0].fields.length, 1, "ZT 列应作为指标抽取（内嵌逗号不破坏切分）");
  assert.equal(r.records[1].sampleId, "S-2", "第二条引号去引号");
}

console.log(`\n结果: ${assertSummary()} `);
assertFinish();
