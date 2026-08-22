# 实验记录中心化改造 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把 materials-research-copilot 从「研究方案 + 提案确认 + 实验记录 + 文献」收敛为实验调度中心——甘特图/日历为可视化核心、实验记录为数据主线、文献收纳（仅 Zotero）与指标趋势为辅助，彻底移除研究方案、提案确认、在线检索、文献分析报告。

**架构：** 核心是「去提案化」：所有原 `createProposal()` 调用点改为直接写库（保留乐观锁 version 防并发覆盖），同时删除 plan/proposals/report/assessment 相关数据文件、路由、面板与工具；新增「文献动作日志化到 worklog」的辅助函数与触发点；甘特任务改为纯手动排期 + AI 在 `log_work` 时辅助更新进度。

**技术栈：** Node 22+（esbuild 打包 src-server → 插件根、Vite 构建 ui → assets、node 原生 test runner 跑 tests/*.mjs）、React 19、Hana plugin SDK（@hana/plugin-components / plugin-protocol / plugin-runtime / plugin-sdk）。

**环境约束（重要）：** 当前开发机 **未安装 node / npm，且项目无 node_modules**（依赖通过 `file:../openhanako/...` 本地路径引用）。因此所有 `npm run build:*` / `npm test` 步骤**必须在具备 node 与宿主 openhanako 包依赖的环境执行**。本计划中每个「运行验证」步骤都标注 `[需 node]`；在无 node 环境，这些步骤的有效交付物是「源码完成 + 静态逻辑自检」，动态验证由具备 node 的 CI/本地环境完成。不因此降低任何任务的交付标准。

---

## 文件结构（改造涉及的文件与职责）

### 删除
| 路径 | 职责 |
|---|---|
| `src-server/server/proposals.js` | 提案-确认层（整文件删除） |
| `src-server/server/evolution.js` | plan-evolution 演进史（整文件删除） |
| `src-server/server/milestone-schedule.js` | 里程碑派生甘特（整文件删除） |
| `src-server/server/schedule-rebalance.js` | 甘特再平衡 + 重做（整文件删除） |
| `src-server/tools/manage-plan.js` | 方案/实验记录读写工具（整文件删除） |
| `src-server/tools/assess-plan.js` | 文献对照评估工具（整文件删除） |
| `src-server/tools/review-research.js` | 审查报告工具（整文件删除，reviews.json 一并移除） |
| `src-server/tools/export-report.js` | 导出工具（改造：仅保留导出实验记录 worklog） |
| `src-server/routes/proposals.js` | 提案 API 路由（整文件删除） |
| `ui/panels/PlanPanel.tsx` | 方案面板（删除） |
| `ui/panels/ProposalsPanel.tsx` | 提案面板（删除） |
| `prompts/plan-milestones.md` / `assess-plan-against-literature.md` / `proposal-guide.md` / `rejected-feedback.md` | 依赖方案/提案的 prompt（删除） |
| `tests/store-proposals.test.mjs` / `assess-plan.test.mjs` / `milestone-schedule.test.mjs` / `schedule-rebalance.test.mjs` / `v3-proposal-integration.mjs` | 依赖被删模块的测试（删除） |

### 修改
| 路径 | 改动 |
|---|---|
| `src-server/server/store.js` | 移除 plan/proposals/rejected/report/assessment/plan-evolution 默认文档与 UPDATES_KEYS；新增 `appendLiteratureLog` 辅助或并入 sources |
| `src-server/server/llm.js` | 删除 `analyzeLiterature` / `assessPlanAgainstLiterature` / `deriveScheduleFromPlan` / `draftProposalFromGuide` / `sampleLiterature`（及 plan 依赖）；`reviewResearch` 去掉 plan 参数 |
| `src-server/server/sources.js` | 去在线源、只留 Zotero；新增 `appendLiteratureLog`；`syncZotero` 统计新增并触发日志化 |
| `src-server/server/literature-client.js` | 删在线三源，只留 Zotero（或整文件并回 sources，若 Zotero 逻辑已含） |
| `src-server/server/triage.js` | 去提案直接写库；去 plan 引用；去 rebalance/redo 调用 |
| `src-server/server/suggestions.js` | 若 review-research 移除则一并删除或保留空壳（见任务 4） |
| `src-server/tools/manage-schedule.js` | 去提案，直接写库 |
| `src-server/tools/collect-literature.js` | 去 online 分支与参数，只留 Zotero 扫描；触发日志化 |
| `src-server/tools/log-work.js` | 去提案直接写库；去 plan；去 rebalance/redo/排程建议；`nextStepAdvice` 保留但去 plan 依赖 |
| `src-server/routes/api.js` | 删 plan/report/proposals/guide/summary 相关路由；worklog 去提案直接写；保留 import 并触发巡检 |
| `src-server/index.js` | 去自动搜集的在线检索（改为绑定后同步 Zotero）；去 report/assessment 自动刷新；去 rebalance 定时 |
| `manifest.json` | 精简 network.allowedHosts（仅 localhost）、config、dev.scenarios |
| `ui/Panel.tsx` | 改 TAB 列表（默认甘特/日程）；移除 PlanPanel/ProposalsPanel import |
| `ui/api.ts` | 删 plan/report/proposals/assessment 相关方法 |
| `ui/panels/LiteraturePanel.tsx` | 删报告/分析部分，只留 Zotero 收纳与列表、日志化展示 |
| `ui/panels/WorklogPanel.tsx` | 去提案相关，保留手动录入（含批量导入入口）与巡检触发 |
| `ui/panels/SchedulePanel.tsx` | 去 rebalance/里程碑派生相关 UI，保留手动排期 + 进度 |
| `ui/settings/SettingsDrawer.tsx` | 删与方案/分析/在线检索相关配置项 |
| `ui/components/Dashboard.tsx` | 去 plan/report 汇总项 |
| `src-server/tools/analyze-metrics.js` | 保持只读（无需改，除非依赖被删字段） |

### 新建
| 路径 | 职责 |
|---|---|
| `src-server/server/literature-log.js` | `appendLiteratureLog(store, newEntries, scanId)` 文献动作日志化（结构 + 去重 + 归一） |
| `tests/literature-log.test.mjs` | `appendLiteratureLog` 去重/结构/增量测试 |

---

## 任务 1：精简数据层（store.js）

**文件：**
- 修改：`src-server/server/store.js`

- [ ] **步骤 1：从 `DEFAULT_DOC` 移除被删模块的默认文档**

删除以下键：`plan` / `plan-evolution` / `proposals` / `rejected` / `report` / `assessment`。保留 `gantt` / `calendar` / `worklog` / `literature` / `binding` / `updates` / `settings` / `collections`。

- [ ] **步骤 2：从 `UPDATES_KEYS` 移除被删模块**

删除 `plan` / `proposals` / `rejected` / `report` / `assessment` / `reviews`（review 功能已确认移除）。保留 `gantt` / `calendar` / `worklog` / `literature`。`DEFAULT_DOC` 中 `reviews` 键一并删除。

- [ ] **步骤 3：`store.js` 不引入对新模块的依赖**

`store.js` 保持纯数据层，不在其中实现 `appendLiteratureLog`（该函数放 `literature-log.js` 独立单元）。`store.append` / `store.update` / `store.upsertByKey` 原样保留。

- [ ] **步骤 4：运行数据层相关测试（保留的）**

运行：`node tests/sources.test.mjs` `[需 node]`
预期：无 `DEFAULT_DOC` 缺失导致的读取异常（sources.test 若引用了被删模块则同步调整见任务 7）。

- [ ] **步骤 5：Commit**

```bash
git add src-server/server/store.js
git commit -m "refactor(store): remove plan/proposals/report/assessment data docs"
```

---

## 任务 2：新增文献动作日志化单元

**文件：**
- 创建：`src-server/server/literature-log.js`
- 测试：`tests/literature-log.test.mjs`

- [ ] **步骤 1：编写失败测试**

```js
// tests/literature-log.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { appendLiteratureLog } from "../src-server/server/literature-log.js";
import { createStore } from "../src-server/server/store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litlog-"));
  return { store: createStore(dir), dir };
}

test("appendLiteratureLog writes one worklog entry for new items", () => {
  const { store, dir } = tempStore();
  const newEntries = [
    { title: "SnSe thermoelectric", year: 2024, authors: ["A"], source: "zotero" },
    { title: "PbTe doping", year: 2023, authors: ["B"], source: "zotero" },
  ];
  const res = appendLiteratureLog(store, newEntries, "scan-abc");
  const wl = store.read("worklog");
  assert.equal(res.appended, 1);
  assert.equal(wl.entries.length, 1);
  const rec = wl.entries[0];
  assert.ok(rec.content.includes("新增 2 篇"));
  assert.ok(rec.content.includes("SnSe thermoelectric"));
  assert.equal(rec.kind, "literature-log");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appendLiteratureLog is idempotent for same scanId", () => {
  const { store, dir } = tempStore();
  const newEntries = [{ title: "X", year: 2024, source: "zotero" }];
  appendLiteratureLog(store, newEntries, "scan-x");
  const res2 = appendLiteratureLog(store, newEntries, "scan-x");
  const wl = store.read("worklog");
  assert.equal(res2.appended, 0);
  assert.equal(wl.entries.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appendLiteratureLog skips empty newEntries", () => {
  const { store, dir } = tempStore();
  const res = appendLiteratureLog(store, [], "scan-none");
  assert.equal(res.appended, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node tests/literature-log.test.mjs` `[需 node]`
预期：FAIL，报 "Cannot find module ../src-server/server/literature-log.js"

- [ ] **步骤 3：编写最小实现**

```js
// src-server/server/literature-log.js
export function appendLiteratureLog(store, newEntries, scanId) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) return { ok: true, appended: 0 };
  // 去重：同一 scanId 已在 worklog 中记录过则跳过（幂等）
  const wl = store.read("worklog");
  const existing = (wl.entries || []).some((e) => e.kind === "literature-log" && e.scanId === scanId);
  if (existing) return { ok: true, appended: 0 };
  const lines = [`# 文献收纳`, `新增 ${newEntries.length} 篇`];
  for (const e of newEntries.slice(0, 20)) {
    lines.push(`- [${e.year || "?"}] ${e.title || "未命名"}${e.authors?.length ? "（" + e.authors.slice(0, 3).join(", ") + "）" : ""}`);
  }
  const entry = {
    id: `work_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "literature-log",
    scanId,
    date: store.now().slice(0, 10),
    content: lines.join("\n"),
    data: null,
    taskId: null,
    sampleId: null,
    fields: [],
    citations: [],
    planVersion: null,
    durationHours: null,
    startDate: null,
    createdAt: store.now(),
  };
  const result = store.append("worklog", [entry]);
  return { ok: true, appended: result.appended, entry };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node tests/literature-log.test.mjs` `[需 node]`
预期：PASS（3 个用例）

- [ ] **步骤 5：Commit**

```bash
git add src-server/server/literature-log.js tests/literature-log.test.mjs
git commit -m "feat(literature-log): add literature collection log action to worklog"
```

---

## 任务 3：精简 LLM 层（llm.js）

**文件：**
- 修改：`src-server/server/llm.js`

- [ ] **步骤 1：删除依赖方案/分析的报告函数**

删除：`analyzeLiterature` / `assessPlanAgainstLiterature` / `deriveScheduleFromPlan` / `draftProposalFromGuide` / `parsePlanAssessment` / `extractClusters` / `sampleLiterature`（及其 `plan.title` 依赖）。保留 `reviewResearch`（但见下步去 plan 参数）、`triageWorkEntry`、`nextStepAdvice`、`extractKeywords`、`summarizeFromFulltext`、`extractLiteratureKeywords`、`translateAbstract`、`sampleText`。

- [ ] **步骤 2：`reviewResearch` 去掉 plan 参数**

`reviewResearch(ctx, { worklog, gantt, literature, rejected, reviews, target })` 删去 `plan` 字段及其在 docs 中的注入。若 `review`/`rejected` 功能整体移除（见任务 4 决策），则 `reviewResearch` 也随之删除。

- [ ] **步骤 3：`nextStepAdvice` 去 plan 依赖**

`nextStepAdvice(ctx, worklog, gantt, calendar, today)`（删 plan 参数）。移除 `docs.plan` 注入。

- [ ] **步骤 4：移除对被删 prompt 的引用**

`readPrompt` 调用的 `literature-analysis.md` / `assess-plan-against-literature.md` / `proposal-guide.md` / `plan-milestones.md` / `plan-reviewer.md`（若 review 移除）相应清掉。

- [ ] **步骤 5：更新 llm-sampling 测试（若引用 sampleLiterature）**

`tests/llm-sampling.test.mjs` 若导入 `sampleLiterature`，删除该用例或改为测试保留函数。

- [ ] **步骤 6：运行 LLM 相关保留测试**

运行：`node tests/llm-sampling.test.mjs` `[需 node]`
预期：PASS（无导入错误）

- [ ] **步骤 7：Commit**

```bash
git add src-server/server/llm.js tests/llm-sampling.test.mjs
git commit -m "refactor(llm): remove plan/report-dependent functions"
```

---

## 任务 4：精简审查/建议层（triage.js + suggestions.js + review 决策）

**文件：**
- 修改：`src-server/server/triage.js`
- 修改：`src-server/server/suggestions.js`
- 决策点：`review_research` 工具 / `reviews.json` 是否保留

**决策说明（已确认）：** 设计确认"砍掉分析报告功能"，`review_research` 与 `reviews.json` 一并**移除**——实验记录的结构化审查已由 triage 巡检承担，无需独立审查报告。`reviews.json` 不保留。

- [ ] **步骤 1：`triage.js` 去提案直接写库**

所有 `createProposal(store, {...})` 改为直接 `store.update(target, baseVersion, mutator)`。如：
- worklog 富化 → `store.update("worklog", worklog.version, cur => ({ entries: cur.entries.map(e => e.id === entry.id ? { ...e, fields: out.fields, citations: out.citations, ...(systemChanged ? { system: out.system } : {}) } : e) }))`
- 时长 → 同 update worklog（`durationHours` / `startDate`）
- 甘特进度 → `store.update("gantt", gantt.version, cur => ({ tasks: cur.tasks.map(t => t.id === tp.taskId ? { ...t, progress: tp.progress } : t) }))`
- 日程 create → `store.append("calendar", [event])`（或 update 到 calendar.events）
- 去掉 `schedule-rebalance.js` / `proposeRedoTask` 引用与调用。

- [ ] **步骤 2：`triage.js` 去 plan 引用**

`store.read("plan")` 删除，`triageWorkEntry` 传入 `plan: null` 或移除该字段（`llm.js` 的 triage 已不再依赖 plan）。

- [ ] **步骤 3：`triage.js` 去 reviews 留痕**

删除向 `reviews` 追加 `planNote` 留痕的代码；`out.planNote` 字段若仍由 LLM 返回则忽略（不再写入）。

- [ ] **步骤 4：`suggestions.js` 删除或保留空壳**

`parseSuggestionBlock` / `filterReviewSuggestions` 依赖 review-research 与 index.js 的 `parseSuggestions`。若 `reviewResearch` 移除，则删 `suggestions.js` 并清掉 `index.js` 与 `llm.js` 的引用。

- [ ] **步骤 5：更新相关测试**

`sources.test.mjs` / `metrics.test.mjs` 中若引用被删函数（`parsePlanAssessment` 等）则同步移除对应用例。

- [ ] **步骤 6：运行保留测试**

运行：`node tests/sources.test.mjs` `[需 node]`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src-server/server/triage.js src-server/server/suggestions.js
git commit -m "refactor(triage): write-through without proposals, drop plan/reviews"
```

---

## 任务 5：精简文献源（sources.js + literature-client.js）

**文件：**
- 修改：`src-server/server/sources.js`
- 修改：`src-server/server/literature-client.js`
- 删除：`src-server/server/sources.js` 中在线扫描路径

- [ ] **步骤 1：`sources.js` 移除在线源**

`scanAllSources` 去掉 `syncZotero` 之外的在线/工作区文件扫描；保留 Zotero 全量镜像（`syncZotero` / `fetchZoteroItems` / `fetchZoteroCollections` / `enhanceZoteroPdfs` / `enrichCitationCounts` / `zoteroProbe` / `runEnhancementLoop`）。

- [ ] **步骤 2：`sources.js` 在 syncZotero 中触发文献日志化**

`syncZotero` 返回 `newEntries`（本次新增条目，定义为镜像替换后 `firstSeenAt === 本次` 或 `literature.version` 增量的条目）。若无显式增量标记，用一个临时方法：比较 `syncZotero` 前后 `store.read("literature").entries.length` 或本次 `merged` 中 `zoteroKey` 未在 `prev` 中出现的条目作为 `newEntries`。`newEntries.length > 0` 时调用 `appendLiteratureLog(store, newEntries, scanId)`，`scanId` 用 `zoteroSync-${store.now()}`。

- [ ] **步骤 3：`literature-client.js` 移除在线三源**

删除 `createLiteratureClient` / `searchAll` / `searchSemanticScholar` / `searchArxiv` / `searchCrossref`。若 Zotero 逻辑已在 `sources.js`，则 `literature-client.js` 整文件删除，并清掉 `index.js` / `collect-literature.js` 的引用。若仍需要本地扫描客户端，保留 `resolveYearRange` 但去在线参数（见下）。

- [ ] **步骤 4：`resolveYearRange` 去在线依赖**

若 `sources.js`/`literature-client.js` 仍引用 `resolveYearRange`，保留但明确仅用于 Zotero 年份过滤（或移除）。

- [ ] **步骤 5：更新 sources 测试（日志化断言）**

`tests/sources.test.mjs` 增加：`syncZotero`（mock）在新增条目时调用 `appendLiteratureLog` 的断言，或针对 `appendLiteratureLog` 的集成测试（已在任务 2 单测）。

- [ ] **步骤 6：运行 sources 测试**

运行：`node tests/sources.test.mjs` `[需 node]`
预期：PASS（Zotero 可用时）；无 Zotero 时 SKIP（沿用 zotero-sync 的 SKIP 约定）。

- [ ] **步骤 7：Commit**

```bash
git add src-server/server/sources.js src-server/server/literature-client.js
git commit -m "refactor(sources): zotero-only literature sync with worklog logging"
```

---

## 任务 6：精简 index.js 生命周期

**文件：**
- 修改：`src-server/index.js`

- [ ] **步骤 1：移除自动搜集的在线检索**

`_autoCollect` 改为：绑定会话后触发 `syncZotero`（本地同步），不再调用 `createLiteratureClient` / `extractKeywords` 检索在线源。保留节流（`AUTO_COLLECT_THROTTLE_MS`）与 `_onSessionEvent` 监听，但触发的是 `syncZotero`（见 §13 决策 2）。

- [ ] **步骤 2：移除 report 自动刷新**

删除 `_maybeAutoReport` 及其定时器（`_reportTimer`）。删除对 `analyzeLiterature` / `extractClusters` 的引用。

- [ ] **步骤 3：移除 assessment / rebalance 逻辑**

删除 `_maybeAutoReview` 中 `reviewResearch` 调用（若 review 移除）与 `_maybeRebalance`，删除 `rebalanceSchedule` 引用与 `_reviewTimer` 中相应部分。保留 triage 触发的定时（如需）或由模块内自触发。

- [ ] **步骤 4：调整定时器**

只保留 Zotero 同步定时（`_zoteroTimer`）。删除 report/review/rebalance 定时。

- [ ] **步骤 5：updates 语义**

`updates.json` 水位线仍用于面板轮询；`index.js` 不再负责 report/assessment 的 bump。

- [ ] **步骤 6：Commit**

```bash
git add src-server/index.js
git commit -m "refactor(index): zotero-only lifecycle, drop report/assessment/rebalance"
```

---

## 任务 7：精简工具层（manage-schedule / collect-literature / log-work）

**文件：**
- 修改：`src-server/tools/manage-schedule.js`
- 修改：`src-server/tools/collect-literature.js`
- 修改：`src-server/tools/log-work.js`
- 删除：`src-server/tools/manage-plan.js` / `assess-plan.js` / `review-research.js`
- 改造：`src-server/tools/export-report.js`（仅保留 worklog 导出）

- [ ] **步骤 1：`manage-schedule.js` 去提案直接写**

`create` / `update` / `delete` 改为直接 `store.append` / `store.update`（gantt 用 `tasks`，calendar 用 `events`）。保留 `ensureAutoBinding`。删 `createProposal` import 与 `sessionPermission` 的 plugin_output 描述（若宿主对直接写要求权限，仍保留描述）。

- [ ] **步骤 2：`collect-literature.js` 去 online 分支与参数**

删 `online` 分支、`query` / `limit` / `fromYear` / `toYear` 参数与 `createLiteratureClient` / `resolveYearRange` 引用。只保留 Zotero 扫描（`scanAllSources` 的 Zotero 部分），`autoApprove` 分支删除（直接 `store.append("literature", ...)`），并调用 `appendLiteratureLog`。

- [ ] **步骤 3：`log-work.js` 去提案直接写 + 去 plan + 去 rebalance/redo**

所有 `createProposal` 改 `store.update` / `store.append`。删 plan 引用（`store.read("plan")` 及 `planVersion`）。删 `rebalanceSchedule` / `proposeRedoTask` 调用。`nextStepAdvice` 调用改新签名 `(ctx, worklog, gantt, calendar, date)`。`autoTriage` 节流保留（导入/写入后触发 triage 巡检）。删 `scheduleCount`/`rebalanceCount` 汇总输出，保留「进度更新直接生效」提示。

- [ ] **步骤 4：删除 manage-plan / assess-plan / review-research；改造 export-report**

从 `tools/` 目录删除 `manage-plan.js` / `assess-plan.js` / `review-research.js` 三个文件。

`export-report.js` **保留**，但参数精简：`type` 仅保留 `worklog`（导出实验记录为 md 供周报/存档），删除 `review` / `report` / `bibtex` 分支。`sessionPermission` 描述改为「导出实验记录」。若保留 `manage_schedule` 等工具的 `sessionPermission` 属 `plugin_output` 无关（export-report 属 `session_file_output`），一并保留对应权限声明。

- [ ] **步骤 5：更新依赖这些工具的场景**

`manifest.json` 的 `dev.scenarios` 中 `smoke-manage-plan` 替换为非删除工具（如 `smoke-manage-schedule`）。见任务 10。

- [ ] **步骤 6：Commit**

```bash
git add src-server/tools/
git commit -m "refactor(tools): write-through schedule/collect/logwork, remove plan/assess/review/export"
```

---

## 任务 8：精简路由（api.js + 删 proposals.js）

**文件：**
- 修改：`src-server/routes/api.js`
- 删除：`src-server/routes/proposals.js`

- [ ] **步骤 1：`api.js` 移除 plan/report/assessment 路由**

删除 `/state` 中 `plan` / `plan-evolution` / `report` / `assessment` / `proposals` 字段；`WRITABLE` 减为 `["worklog", "gantt", "calendar", "literature"]`（plan 移除）。

- [ ] **步骤 2：移除 `/plan/*`、`/report/*`、`/guide/*`、`/summary/week`**

删除 `/plan/evolution*`、`/plan/assess`、`/report`、`/report/refresh`、`/guide/proposal-draft`、`/summary/week` 路由，及 `mergeMilestoneDiff`、`analyzeLiterature`、`assessPlanAgainstLiterature`、`parsePlanAssessment`、`extractClusters`、`appendPlanEvolution`、`draftProposalFromGuide` imports。

- [ ] **步骤 3：`worklog` 走直写（去 `createProposal`）**

`src-server/routes/api.js` 中 `app.put('/worklog')` 直接 `store.update("worklog", version, () => data)`（原本已直写，确认无 proposal 包装后保留）。删除 `createProposal` import（若不再被 routes 引用）。

- [ ] **步骤 4：保留 worklog/import 并触发巡检**

`/worklog/import` 保留，落库后按 `autoTriage` 触发 `triageWorklog`（已有实现，保留）。

- [ ] **步骤 5：删除 proposals.js 路由文件**

`src-server/routes/proposals.js` 整文件删除；`src-server/index.js` 中不再注册该路由（如在宿主组合路由处有引用则一并清理）。

- [ ] **步骤 6：Commit**

```bash
git add src-server/routes/api.js
git rm src-server/routes/proposals.js
git commit -m "refactor(routes): drop plan/report/proposals endpoints"
```

---

## 任务 9：精简 manifest.json

**文件：**
- 修改：`manifest.json`

- [ ] **步骤 1：精简 network.allowedHosts**

只保留 `localhost` / `127.0.0.1`（Zotero 本地 API）。删除 `api.semanticscholar.org` / `export.arxiv.org` / `api.crossref.org` / `api.openalex.org`。

- [ ] **步骤 2：精简 capabilities**

保留 `session` / `model.sample` / `network.fetch` / `resource.read` / `resource.search` / `resource.watch` / `resource.materialize`（Zotero 用 network.fetch 访问 localhost）。删不再需要的（若有在线检索专属 capability）。

- [ ] **步骤 3：精简 configuration**

保留 `zoteroPort` / `autoCollectEnabled`（改为"绑定后自动同步 Zotero"）/ `autoApproveLiterature`（若文献仍直入库则保留）/ `autoTriage`。删与在线检索/分析报告相关项（若有专属 config）。

- [ ] **步骤 4：更新 dev.scenarios**

`smoke-manage-plan` 改为 `smoke-manage-schedule`（调用 `manage_schedule` 的 read），校验文本含「甘特图任务」或「日历日程」。

- [ ] **步骤 5：Commit**

```bash
git add manifest.json
git commit -m "refactor(manifest): zotero-only network, update config/scenarios"
```

---

## 任务 10：精简前端基础（Panel.tsx + api.ts）

**文件：**
- 修改：`ui/Panel.tsx`
- 修改：`ui/api.ts`

- [ ] **步骤 1：`Panel.tsx` 改 TAB 列表**

`TABS` 改为：`[ { key:'schedule', label:'📅 日程' }, { key:'worklog', label:'🧪 实验记录' }, { key:'metrics', label:'📈 指标趋势' }, { key:'literature', label:'📚 文献库' } ]`。默认 `tab` 为 `'schedule'`。移除 `plan` / `proposals` Tab 及 `PlanPanel` / `ProposalsPanel` import。移除 `pendingProposals` / 提案浮标逻辑与其 `goTab('proposals')` 引用。

- [ ] **步骤 2：`Panel.tsx` 移除 plan/proposals 状态引用**

`state?.proposals` 的 pendingProposals 计算与 `mrc-proposal-float` 元素删除。`onGoProposals` 回调删除或改为 `goTab('schedule')`。

- [ ] **步骤 3：`api.ts` 删 plan/report/proposals/assessment 方法**

删除 `savePlan` / `getPlanSnapshot` / `rollbackTo` / `refreshReport` / `proposalDraft` / `acceptProposalBatch` / `acceptProposal` / `rejectProposal` / `acceptModifiedProposal` / `assessPlan` / `rollback`（snapshot rollback 若保留文献回退可留）。保留 `getState` / `getChanges` / `write` / `scan` / `zoteroStatus` / `probeZotero` / `binding` / `getMetrics` / `importWorklog` / `exportFile`（若保留导出）。

- [ ] **步骤 4：Commit**

```bash
git add ui/Panel.tsx ui/api.ts
git commit -m "refactor(ui): schedule-first tabs, drop plan/proposals/report API"
```

---

## 任务 11：精简前端面板（LiteraturePanel / SchedulePanel / SettingsDrawer / Dashboard）

**文件：**
- 修改：`ui/panels/LiteraturePanel.tsx`
- 修改：`ui/panels/SchedulePanel.tsx`
- 修改：`ui/settings/SettingsDrawer.tsx`
- 修改：`ui/components/Dashboard.tsx`

- [ ] **步骤 1：`LiteraturePanel.tsx` 删报告/分析部分**

删除「分析报告」「更新报告」「聚类 chips」等依赖 report/plan 的区块，只留 Zotero 收纳列表、来源筛选（zotero）、文献移除。删 `refreshReport` / `report` 状态引用。

- [ ] **步骤 2：`SchedulePanel.tsx` 去 rebalance/milestone 相关**

删除依赖 `rebalanceSchedule` / `milestone-schedule` / plan-milestones 的 UI（派生甘特按钮、自动顺延提示）。保留手动创建/拖拽任务、进度编辑、日历事件增删。`onGoProposals` 不再需要（总在 schedule 或 worklog 上下文）。

- [ ] **步骤 3：`SettingsDrawer.tsx` 删配置项**

移除与方案引导、分析报告、在线检索相关设置项（若有）。保留文献目录管理 / 会话绑定 / 拒绝记录（若 rejected 保留则保留，否则删）/ autoTriage / searchYearWindow（若 Zotero 用）。

- [ ] **步骤 4：`Dashboard.tsx` 去 plan/report 汇总**

删除方案、分析报告汇总卡片；保留实验记录条数、本周文献收纳数、甘特任务数与进度概览（若 summary/week 已删则从 `state` 计算或移除该卡）。

- [ ] **步骤 5：build UI（可选，需 node）**

运行：`npm run build:ui` `[需 node]`
预期：`assets/panel.js` / `panel.css` 重新生成，无类型错误。

- [ ] **步骤 6：Commit**

```bash
git add ui/
git commit -m "refactor(ui-panels): literature/schedule/settings/dashboard for record-centering"
```

---

## 任务 12：更新清单与构建产物

**文件：**
- 修改：`package.json`（scripts 若需调整）
- 修改：`docs/superpowers/specs/2026-08-22-experiment-record-centering-design.md`（如有实现偏离）
- 删除：被删模块的 tests

- [ ] **步骤 1：删除被删模块的测试文件**

删除 `tests/store-proposals.test.mjs` / `assess-plan.test.mjs` / `milestone-schedule.test.mjs` / `schedule-rebalance.test.mjs` / `v3-proposal-integration.mjs`。

- [ ] **步骤 2：确认 run-all.mjs 自动收集无误**

`run-all.mjs` 自动匹配 `*.test.mjs` / `*-verify.mjs` / `*-integration.mjs`，删除被测文件即自动排除，无需改动（验证 `zotero-sync` 仍排最后）。

- [ ] **步骤 3：运行完整测试套件（需 node）**

运行：`npm test` `[需 node]`
预期：全部 PASS（或外部依赖 SKIP）。断言：通过 + 跳过数符合，无失败。

- [ ] **步骤 4：构建（需 node）**

运行：`npm run build` `[需 node]`
预期：`src-server` esbuild 到插件根（index/routes/tools），`vite` 构建到 assets，无报错。

- [ ] **步骤 5：Commit**

```bash
git add tests/ package.json
git commit -m "chore(tests): remove plan/proposal tests, rebuild verification"
```

---

## 交付物 / 最终验收

1. **服务端**：`src-server/` 不再含 plan/proposals/report/assessment/rebalance/milestone/review 相关代码；`store.js` 无被删数据文档；`sources.js` 仅 Zotero 且触发文献日志化。
2. **工具**：仅保留 `manage_schedule` / `collect_literature` / `log_work` / `analyze_metrics`；全部写操作直写。
3. **路由**：仅保留 api / export（如需导出）/ ui；无 plan/report/proposals 端点。
4. **前端**：默认 Tab 为甘特/日程；Tab 列表仅 4 项；无 PlanPanel / ProposalsPanel / 分析报告区块。
5. **文献日志化**：新增 `appendLiteratureLog`，Zotero 同步/扫描时自动写入 worklog「# 文献收纳」记录，幂等去重。
6. **测试**：`tests/` 保留项全部通过（node 环境）；新增 `literature-log.test.mjs`。
7. **无 node 环境**：源码与静态逻辑自检完成，动态验证交由具备 node + openhanako 依赖的环境执行（在交付说明中注明）。

---

## 自检

- **规格覆盖度**：§3 移除清单 → 任务 1/3/4/5/6/7/8/9/10/11/12 全对应；§4 AI 写即生效 → 任务 4/7/8；§5 文献日志化 → 任务 2/5/6；§6 数据精简 → 任务 1；§7 API 精简 → 任务 8；§8 工具 → 任务 7；§9 manifest → 任务 9；§10 UI → 任务 10/11；§11 测试 → 任务 12；§12 构建 → 任务 12；§13 决策 → 任务 5/6/8（autoCollect 改为同步 Zotero、import 保留并巡检）。
- **占位符扫描**：无 "待定/TODO/后续实现" 残留。文献日志化的 `newEntries` 判定在任务 5 步骤 2 明确三种实现（version 增量 / 长度比较 / zoteroKey 不在 prev），选中最终稳定用「zoteroKey 不在 prev」并在任务 2 单测覆盖 `appendLiteratureLog`。
- **类型一致性**：`appendLiteratureLog(store, newEntries, scanId)` 在任务 2 定义、任务 5 调用、任务 2 测试，签名一致。`nextStepAdvice(ctx, worklog, gantt, calendar, date)` 在任务 3 改签名、任务 7 调用，一致。`triageWorkEntry` plan 字段移除后，`triage.js` 传 `plan:null` 或删字段，与 `llm.js` 对齐。
