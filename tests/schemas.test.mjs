/**
 * zod 边界 schema 测试（方案 A）：请求体 schema 必须严格拒绝非法输入；
 * LLM/外部 API schema 必须接受合法形态（字段可缺省）。
 */
import { assert, assertFinish, assertSummary } from './helpers/assert.mjs';
import {
  TriageOutputSchema,
  ScheduleItemSchema,
  OpenAlexWorkSchema,
  WorklogImportBodySchema,
  LiteratureAppendBodySchema,
  SettingsMetricsBodySchema,
  BindingBodySchema,
  AutoTriageBodySchema,
  SearchWindowBodySchema,
} from '../src-server/server/schemas.ts';

console.log("== zod 边界 schema 测试 ==");

// ── 请求体：非法拒绝 / 合法接受 ──
{
  const ok = WorklogImportBodySchema.safeParse({ text: "做了实验", dryRun: true });
  assert(ok.success, "worklog/import：合法 body 应通过");
  const bad = WorklogImportBodySchema.safeParse({ text: 123 });
  assert(!bad.success, "worklog/import：text 非字符串应拒绝");
}

{
  const ok = LiteratureAppendBodySchema.safeParse({ entries: [{ title: "x", doi: "10.1/a" }] });
  assert(ok.success, "literature/append：entries 数组应通过");
  const bad = LiteratureAppendBodySchema.safeParse({ entries: "not-array" });
  assert(!bad.success, "literature/append：entries 非数组应拒绝");
}

{
  const ok = SettingsMetricsBodySchema.safeParse({ targets: { zt: 1.2, pf: null } });
  assert(ok.success, "settings/metrics：任意键值对象应通过");
  const bad = SettingsMetricsBodySchema.safeParse({ targets: "x" });
  assert(!bad.success, "settings/metrics：targets 非对象应拒绝");
}

{
  const ok = BindingBodySchema.safeParse({ sessionId: "s1", sessionPath: null, source: "manual" });
  assert(ok.success, "binding：合法 body 应通过");
  const bad = BindingBodySchema.safeParse({ sessionId: 42 });
  assert(!bad.success, "binding：sessionId 非字符串应拒绝");
  const missing = BindingBodySchema.safeParse({});
  assert(!missing.success, "binding：缺 sessionId 应拒绝");
}

{
  const ok = AutoTriageBodySchema.safeParse({ enabled: true });
  assert(ok.success, "auto-triage：合法 body 应通过");
  const bad = AutoTriageBodySchema.safeParse({ enabled: "yes" });
  assert(!bad.success, "auto-triage：enabled 非布尔应拒绝");
}

{
  const ok = SearchWindowBodySchema.safeParse({ years: 5 });
  assert(ok.success, "search-window：years 数字应通过（范围校验在路由内）");
  const bad = SearchWindowBodySchema.safeParse({ years: [] });
  assert(!bad.success, "search-window：years 数组应拒绝");
}

// ── LLM 输出：合法形态接受（字段可缺省） ──
{
  const full = TriageOutputSchema.safeParse({
    fields: [{ k: "ZT@823K", v: "0.9" }],
    citations: ["abc"],
    system: "SnSe",
    taskProgress: [{ taskId: "t1", progress: 50, reason: "完成一半" }],
    events: [{ title: "实验", date: "2026-08-23", startTime: "10:00", type: "experiment" }],
    durationHours: 2.5,
    startDate: null,
  });
  assert(full.success, "triage：完整输出应通过");
  const partial = TriageOutputSchema.safeParse({ fields: [] });
  assert(partial.success, "triage：仅 fields 的空输出应通过（缺省容忍）");
  const empty = TriageOutputSchema.safeParse({});
  assert(empty.success, "triage：空对象应通过（LLM 缺省容忍）");
  const badProgress = TriageOutputSchema.safeParse({ taskProgress: [{ taskId: null, progress: "x" }] });
  assert(!badProgress.success, "triage：taskProgress 字段类型错误应拒绝");
}

{
  const ok = ScheduleItemSchema.safeParse({ title: "写周报", due: "2026-08-25", type: "other" });
  assert(ok.success, "schedule item：合法形态应通过");
  const bad = ScheduleItemSchema.safeParse({ title: 1, due: "nope" });
  assert(!bad.success, "schedule item：title 非字符串应拒绝");
}

// ── 外部 API：OpenAlex ──
{
  const ok = OpenAlexWorkSchema.safeParse({ cited_by_count: 12 });
  assert(ok.success, "OpenAlex：数字引用数应通过");
  const okNull = OpenAlexWorkSchema.safeParse({});
  assert(okNull.success, "OpenAlex：缺字段应通过（观测不阻断）");
  const bad = OpenAlexWorkSchema.safeParse({ cited_by_count: { x: 1 } });
  assert(!bad.success, "OpenAlex：对象类型引用数应标记漂移");
}

console.log(`\n结果: ${assertSummary()} `);
assertFinish();
