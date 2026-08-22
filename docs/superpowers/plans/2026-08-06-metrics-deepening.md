# 指标趋势深化 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。本项目非 git 仓库，无 commit 步骤；每任务收尾以「单测 + tsc」为验证闸门，最终任务做浏览器实测与正式目录同步。

**目标：** 指标趋势模块数据治理深化：纳入/排除规则（指标白名单、工艺黑名单、单位归一化、多温度点全抽、体系字段优先）+ 温度筛选面板 + analyze_metrics 对话工具。

**架构：** 数据层 `src-server/server/metrics.js` 纯函数改造（无 LLM），路由 `/metrics/series` 透传 unrecognized；新增只读工具 `tools/analyze-metrics.js`（薄封装，过滤逻辑为纯函数可单测）；面板 `MetricsPanel/MetricsChart` 增加温度维度与提示；巡检链路（llm.js triageWorkEntry → triage.js/log-work.js）提取材料体系进提案/落库。

**技术栈：** Node ESM、esbuild、React + TSX（@hana 外部化）、node:test 单测。

**规格：** `docs/superpowers/specs/2026-08-06-metrics-deepening-design.md`

---

### 任务 1：metrics.js 数据治理核心（白名单 / 黑名单 / 单位归一化 / 多温度全抽 / 体系字段优先 / unrecognized / 基线温度）

**文件：**
- 修改：`src-server/server/metrics.js`（全文件重构，保留 `METRIC_DEFS` 导出结构兼容、`buildMetricsSeries` / `extractLiteratureBaseline` 签名）
- 测试：`tests/metrics.test.mjs`（扩展，保留原 20 条断言）

- [ ] **步骤 1：编写失败测试（追加到 tests/metrics.test.mjs）**

```js
import { buildMetricsSeries, extractLiteratureBaseline } from '../src-server/server/metrics.js';
// —— 新增断言组（追加在既有断言之后）——

// 1. 单位归一化：Seebeck 0.38 mV/K → 380（基准 μV/K）
{
  const r = buildMetricsSeries([{ id: 'w1', createdAt: '2026-08-06T10:00:00Z', system: 'SnSe',
    fields: [{ k: 'Seebeck系数', v: '0.38 mV/K' }] }], []);
  assert.equal(r.metrics.seebeck.systems['SnSe'][0].value, 380, 'mV/K ×1000');
  assert.equal(r.metrics.seebeck.systems['SnSe'][0].unit, null, '归一化后 unit 置 null（单位已换算）');
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
  assert.equal(r.metrics.sigma.systems['SnSe'], undefined, 'content 提及不误判体系');
  assert.equal(r.metrics.sigma.systems['未标注'], undefined, '未识别体系不进图');
  assert.equal(r.totals.unrecognized.length, 1, '未识别记录进 unrecognized 列表');
  assert.equal(r.totals.unrecognized[0].entryId, 'w5');
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
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node tests/metrics.test.mjs`
预期：FAIL（新断言报 undefined / 值不匹配）

- [ ] **步骤 3：重构 metrics.js**

核心改动：
- `METRIC_DEFS` 移除 temp 项，保留 7 项；每项加 `unitNorm: { base, variants: { 单位串: 系数 } }`
- 新增 `BLACKLIST_KEYS`（15 词完全匹配数组：退火温度/生长温度/保温温度/升温速率/降温速率/保温时间/升温时间/降温时间/压力/气氛/电流/电压/转速/加热功率/射频功率/升温/保温/冷却）
- 新增 `parseValueUnit(str)`：从值字符串提取数值 + 单位 token，查 variants 换算，无单位 → `{ value, unit: null, raw }`
- `buildCorpus` 拆分：fields 逐字段判定（白名单 keyRe → 取数换算；黑名单 → 跳过；其余跳过），`entry.data` 走 valueRe 全局匹配（`exec` 循环取全部匹配），**content 不参与**
- `detectSystem(entry, fieldsObj)`：`entry.system` 非空优先；否则扫 fields 值 + data（不扫 content）
- 多温度去重：同 entryId+metric+temp+value 只收一个
- `extractLiteratureBaseline`：record 语境取最大，顺带 `@(\d+)\s*K|at (\d+) K` 抽 temp
- 返回加 `totals: { entries, withMetrics, unrecognized: [{entryId, date, sampleId, content}] }`

- [ ] **步骤 4：运行测试确认通过**

运行：`node tests/metrics.test.mjs`
预期：PASS（新旧断言全绿）

- [ ] **步骤 5：tsc 闸门**

运行：`npx tsc --noEmit`
预期：EXIT 0，无新错误

---

### 任务 2：API 路由透传 unrecognized

**文件：**
- 修改：`src-server/routes/api.js`（`GET /metrics/series` 处理器）

- [ ] **步骤 1：修改路由透传 totals**

现有处理器调用 `buildMetricsSeries` 后返回 `{ metrics, order, baseline }`；改为返回 `{ metrics, order, baseline, totals }`（totals 直接来自 buildMetricsSeries 返回值，已含 unrecognized 列表）。

- [ ] **步骤 2：验证**

运行：`node tests/metrics.test.mjs`（不涉及路由，作为回归）+ `npx tsc --noEmit`
预期：全绿、EXIT 0

---

### 任务 3：analyze_metrics 工具（过滤纯函数 + 薄封装）

**文件：**
- 修改：`src-server/server/metrics.js`（新增导出 `filterSeries(data, opts)` 纯函数）
- 创建：`src-server/tools/analyze-metrics.js`
- 测试：`tests/analyze-metrics.test.mjs`（新建）

- [ ] **步骤 1：编写失败测试**

```js
import { buildMetricsSeries, filterSeries } from '../src-server/server/metrics.js';
// 构造：SnSe 两条记录（ZT 823K / 300K）、Bi₂Te₃ 一条（ZT 400K），日期 08-05/08-06
// 断言：
// 1. { metric: 'zt', system: 'SnSe' } → 只含 SnSe 的 zt 数据
// 2. { metric: 'zt', temp: 823 } → 只含 temp===823 的点
// 3. { from: '2026-08-06' } → 只含 08-06 及之后的点（按 ts 过滤）
// 4. 无匹配 → metrics 空对象 + totals 保留
// 5. 空入参 → 原样返回
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node tests/analyze-metrics.test.mjs`
预期：FAIL（filterSeries 未导出）

- [ ] **步骤 3：实现 filterSeries**

```js
export function filterSeries(data, opts = {}) {
  const { metric, system, temp, from, to } = opts || {};
  const metrics = {};
  for (const [mk, m] of Object.entries(data?.metrics || {})) {
    if (metric && mk !== metric) continue;
    const systems = {};
    for (const [sk, pts] of Object.entries(m.systems || {})) {
      if (system && sk !== system) continue;
      const filtered = pts.filter((p) => {
        if (temp != null && p.temp !== Number(temp)) return false;
        if (from) { const t = new Date(from).getTime(); if (!Number.isNaN(t) && p.ts < t) return false; }
        if (to) { const t = new Date(to).getTime(); if (!Number.isNaN(t) && p.ts > t) return false; }
        return true;
      });
      if (filtered.length) systems[sk] = filtered;
    }
    if (Object.keys(systems).length) metrics[mk] = { ...m, systems };
  }
  return { metrics, order: data?.order || [], baseline: data?.baseline || {}, totals: data?.totals || {} };
}
```

- [ ] **步骤 4：创建 tools/analyze-metrics.js（沿用现有工具导出模式）**

```js
/**
 * analyze_metrics：指标数据查询（只读）
 * 从实验记录提炼的性能指标序列，按体系/测试温度/日期过滤后返回结构化数据；
 * 不做趋势结论（点数 < 3 时由调用方明示样本不足）。
 */
import { createStore } from "../server/store.js";
import { buildMetricsSeries, filterSeries } from "../server/metrics.js";

export const name = "analyze_metrics";
export const description =
  "查询实验记录中提炼的材料性能指标数据（ZT/功率因子/电导率/Seebeck/热导率/载流子浓度/迁移率），可按材料体系、测试温度、日期范围过滤，返回结构化时间序列、文献基准与统计；只读，不写库。";
export const parameters = {
  type: "object",
  properties: {
    metric: { type: "string", enum: ["zt", "pf", "sigma", "seebeck", "kappa", "n", "mu"], description: "指标 key，缺省全部" },
    system: { type: "string", description: "材料体系名（如 SnSe、Bi₂Te₃），缺省全部" },
    temp: { type: "number", description: "测试温度筛选（如 823），缺省不筛" },
    from: { type: "string", description: "起始日期 YYYY-MM-DD" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD" },
  },
};

export default async function analyzeMetrics(toolCtx, input) {
  const store = createStore(toolCtx.dataDir);
  const worklog = store.read("worklog");
  const literature = store.read("literature");
  const data = buildMetricsSeries(worklog.entries || [], literature.entries || []);
  const filtered = filterSeries(data, {
    metric: input?.metric, system: input?.system,
    temp: input?.temp, from: input?.from, to: input?.to,
  });
  return { ok: true, data: filtered };
}
```

- [ ] **步骤 5：运行测试 + tsc**

运行：`node tests/analyze-metrics.test.mjs`、`node tests/metrics.test.mjs`、`npx tsc --noEmit`
预期：全绿、EXIT 0

---

### 任务 4：巡检链路提取材料体系

**文件：**
- 修改：`src-server/server/llm.js`（`triageWorkEntry` 提示词与返回解析）
- 修改：`src-server/server/triage.js`（提案 diff 加 system）
- 修改：`src-server/tools/log-work.js`（富化落库加 system）

- [ ] **步骤 1：llm.js triageWorkEntry 提示词加体系提取**

在提取 fields 的 JSON schema 指令中追加：`"system": 材料体系（记录能明确判断时填标准名之一：SnSe/SnS₂/SnS/Bi₂Te₃/PbSe/MnTe/Cu₂Se/Ag₂Se/PEDOT/导电聚合物/碳材料/无机/有机复合；无法判断填空字符串）`。解析返回 `out.system`（字符串，默认 `''`，限长 50）。

- [ ] **步骤 2：triage.js 提案 diff 加 system**

`triageWorklog` 的 worklog 富化提案处（`diff: { id, fields, citations }`）改为：`out.system` 非空时并入 `system: out.system`。无 system 的旧记录同样进提案（覆盖「旧记录回填」场景，规格 4.3）。

- [ ] **步骤 3：log-work.js 富化落库加 system**

`if (out.fields?.length) worklogEntry.fields = out.fields;` 之后加 `if (out.system) worklogEntry.system = out.system;`（同处 triage 富化直接落库路径）。

- [ ] **步骤 4：验证**

运行：`npx tsc --noEmit`、`node tests/metrics.test.mjs`
预期：EXIT 0、全绿（本任务无新单测，巡检提示词为 LLM 行为，浏览器实测阶段验证）

---

### 任务 5：面板温度维度与提示（MetricsPanel / MetricsChart）

**文件：**
- 修改：`ui/components/MetricsChart.tsx`
- 修改：`ui/panels/MetricsPanel.tsx`
- 修改：`ui/panel.css`

- [ ] **步骤 1：MetricsChart 支持温度语义**

- 序列点渲染：`unit === null` → 空心圆（fill 透明，仅 stroke）；正常 → 实心
- 连线：相邻两点 `temp` 不同 → 断开线段（只连 temp 相同或均为 null 的相邻点）
- 未筛选温度时同体系点按 temp 映射明度（temp 越高越深，`stroke` 用 HSL 亮度插值；筛选后统一原色）
- tooltip 增补：`value + 基准单位`、`raw`（原记录值）、`temp + tempUnit`（无则「温度未标注」）、`sampleId`、`date`、内容前 40 字（entry 摘要需从 state.worklog 反查，或由父组件传 lookup 函数）

- [ ] **步骤 2：MetricsPanel 温度筛选器与警告条**

- 从 `data.metrics` 各点提取 `temp` 去重集合，chips：「全部温度」+ 各温度（格式 `823K` / `150°C`，按 tempUnit 分组）
- 选中温度 → 传给 MetricsChart（连线恢复、同色）；「全部」→ 深浅 + 断线
- `totals.unrecognized.length > 0` → 面板顶部警告条「⚠️ N 条实验记录未识别材料体系」，点击展开列表（date + sampleId + content 摘要），每条右侧「✏️ 补标注」按钮 → 调 props 新增回调 `onEditWorklog(entryId)`
- 基线提示（规格 3.5）：选中指标存在 baseline.temp 且体系内存在 |Δtemp|≤50K 的点 → 提示可比；否则提示温度差异；baseline 无 temp 不提示
- 目标值输入与保存逻辑保持不变

- [ ] **步骤 3：panel.css 样式**

新增：警告条（`.mrc-metrics-warn`）、温度 chips 选中态、空心点图例说明（可选）。

- [ ] **步骤 4：tsc + 构建**

运行：`npx tsc --noEmit`、`npm run build:ui`
预期：EXIT 0（两项）

---

### 任务 6：表单联动（体系字段 / 提案 label / 跨 tab 补标注）

**文件：**
- 修改：`ui/panels/WorklogPanel.tsx`
- 修改：`ui/panels/ProposalsPanel.tsx`
- 修改：`ui/Panel.tsx`（tab 状态）

- [ ] **步骤 1：WorklogPanel 表单加「材料体系」**

- 新建/编辑表单加输入：`<input list="mrc-system-preset" ...>` + `<datalist id="mrc-system-preset">`（预设 11 项，规格 4.2），state 字段 `system`，save/saveEdit 写入
- 列表条目显示体系 chip（有则显示 `chip`，样式复用 `.mrc-chip`）

- [ ] **步骤 2：ProposalsPanel label**

`FIELD_LABELS.worklog` 补 `system: '材料体系'`（巡检提案渲染直接生效）。

- [ ] **步骤 3：Panel.tsx 跨 tab 跳转补标注**

- Panel.tsx 新增 state `pendingEditEntryId`；MetricsPanel 传 `onEditWorklog={setPendingEditEntryId + setTab('worklog')}`
- WorklogPanel 新增可选 prop `editEntryId`；`useEffect` 监听：非空时找到该条目打开编辑弹窗并 `onConsumeEditEntryId()` 清空（避免重复触发）

- [ ] **步骤 4：tsc + 构建**

运行：`npx tsc --noEmit`、`npm run build:ui`
预期：EXIT 0（两项）

---

### 任务 7：集成验证与交付

**文件：**
- 修改：`plugin-test/test-log.md`（追加记录）

- [ ] **步骤 1：全量回归**

运行：`node tests/metrics.test.mjs`、`node tests/analyze-metrics.test.mjs`、`node tests/schedule-rebalance.test.mjs`、`npx tsc --noEmit`、`npm run build:ui`
预期：全绿、EXIT 0

- [ ] **步骤 2：dev 槽重装 + 注入样例数据**

`plugin_dev_reload` 重装；向 dev 槽 `worklog.json` 注入 3 条样例（验证后清理还原）：
1. `{ system: 'SnSe', fields: [{k:'ZT', v:'0.9 @ 823K'}, {k:'ZT', v:'0.5 @ 300K'}], data: '功率因子=1.2 mW/mK²' }`（多温度 + 单位换算）
2. `{ fields: [{k:'退火温度', v:'780'}], data: '电导率=320 S/m' }`（工艺词排除 + S/m 换算 + 体系缺失 → unrecognized）
3. `{ fields: [{k:'Seebeck系数', v:'0.38 mV/K'}], content: '与 SnSe 文献对比' }`（content 不误判 → unrecognized + mV/K 换算）

- [ ] **步骤 3：浏览器实测（iframe-ticket 流程）**

- 指标趋势 tab：ZT 图 SnSe 两条线（823K 深 / 300K 浅，断线）；切换「823K」筛选后单线连续
- 电导率图：320 S/m 显示 3.2 S·cm⁻¹，tooltip 显示原记录「320 S/m」
- Seebeck 图：380 μV·K⁻¹ 空心点？——不，380 有单位换算成功，是实心；验证 unit null 需再注入一条无单位记录（可选）
- 警告条出现（2 条 unrecognized），点「✏️ 补标注」跳转实验记录 tab 并打开对应编辑弹窗
- 表单出现「材料体系」输入；新建一条带体系记录落库 system 字段

- [ ] **步骤 4：清理 + 同步正式目录 + 记录**

- 清理 dev 槽注入数据（worklog 还原、proposals 无 [loop] 残留）
- robocopy 同步正式目录；panel.js SHA256 与 src 一致
- `plugin-test/test-log.md` 追加「指标趋势深化」记录（含决策、验证结果）

---

## 自检

**1. 规格覆盖度：**
- 1.1 白名单 7 指标 + 移除 temp → 任务 1 ✓
- 1.2 黑名单 → 任务 1 ✓
- 1.3 判定顺序 + content 不扫 → 任务 1（测试 5）✓
- 1.4 多温度全抽 + 去重 + 温度上下文 → 任务 1（测试 3）✓
- 1.5 单位归一化 + 科学计数法 + unit null → 任务 1（测试 1/6/7）✓
- 1.6 体系字段优先 + 兜底不扫 content + unrecognized → 任务 1（测试 4）✓
- 1.7 基线温度 → 任务 1（测试 8）✓
- 2 API 契约（totals.unrecognized）→ 任务 2 ✓
- 2 analyze_metrics 工具（入参/同构返回/不做判断）→ 任务 3 ✓
- 3.1 温度筛选器 → 任务 5 ✓
- 3.2 空心点 → 任务 5 ✓
- 3.3 tooltip 溯源 → 任务 5 ✓
- 3.4 警告条 + 补标注跳转 → 任务 5 + 6 ✓
- 3.5 基线可比提示 → 任务 5 ✓
- 4.1/4.2 字段结构 + 表单 → 任务 6 ✓
- 4.3 巡检提取 + 回填 + 提案 label → 任务 4 + 6 ✓
- 5 测试计划 → 任务 1/3/7 ✓
- 6 成功标准 → 任务 7 实测清单 ✓
- 7 范围外（YAGNI）→ 无任务 ✓

**2. 占位符扫描：** 无 TODO/待定；任务 5 步骤 1 的 tooltip 内容片段依赖「由父组件传 lookup 函数」——已明确由 MetricsPanel 从 state.worklog 建 Map 传入，无歧义。

**3. 类型一致性：** `filterSeries(data, opts)` 在任务 3 定义，任务 3 测试与工具文件同用；`totals.unrecognized` 结构任务 1 产出、任务 2 透传、任务 5 消费，字段名一致（entryId/date/sampleId/content）；`onEditWorklog(entryId)` 任务 5 定义、任务 6 消费，一致。
