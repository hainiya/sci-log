# 实验记录中心化改造设计（2026-08-22）

> 目标：把 materials-research-copilot 从「研究方案 + 提案确认 + 实验记录 + 文献」三中心，
> 收敛为 **实验调度中心**：甘特图/日历为可视化核心，实验记录为数据主线，
> 文献收纳（仅 Zotero）与指标趋势为辅助，彻底移除研究方案、提案确认、在线检索、文献分析报告。

## 1. 背景与动机

用户实际使用数天后发现：**研究方案（plan）与提案确认（proposals）两个模块并不需要**。
现有插件围绕「AI 先生成提案、用户确认后落库」与「研究方案作为分析锚点」两条设计核心，
但用户的真实工作流是：**记录实验、可视化实验过程与计划、追踪性能参数、收纳文献**。

因此本次改造彻底移除这两条设计核心，并围绕真实工作流重组。

## 2. 目标产品形态

| 模块 | 定位 |
|---|---|
| 甘特图 + 日历（日程） | **核心可视化**：呈现实验过程与实验计划，默认首页 |
| 实验记录（worklog） | **数据主线**：时间线记录，AI 写即生效 |
| 指标趋势（metrics） | 辅助：从实验记录 `fields` 提取性能参数序列 |
| 文献收纳（仅 Zotero） | 辅助：本地扫描检索，动作自动日志化到 worklog |

## 3. 移除与实际删除

### 3.1 彻底移除的功能与代码

**研究方案（plan）**
- `ui/panels/PlanPanel.tsx`（前端面板）
- `src-server/tools/manage-plan.js` 的 plan 分支（工具删简，或整工具移除）
- `server/evolution.js`（plan-evolution 演进史）
- `server/milestone-schedule.js`（里程碑派生甘特任务）
- `src-server/tools/assess-plan.js`（文献对照评估工具）
- `llm.js` 中 `analyzeLiterature` / `assessPlanAgainstLiterature` / `deriveScheduleFromPlan` /
  `draftProposalFromGuide` / 对 `plan.title` 的一切依赖
- `prompts/plan-milestones.md` / `prompts/assess-plan-against-literature.md` / `prompts/proposal-guide.md`
- `store.js` 的 `plan` / `plan-evolution` / `assessment` 默认文档
- `api.js` 中 `/plan` / `/plan/assess` / `/plan/evolution` / `/guide/proposal-draft` / `/summary/week` 的 plan 引用
- `proposals.js` 内针对 `plan` 的 apply 分支

**提案确认（proposals）**
- `server/proposals.js`（整个提案-确认层，若彻底大重写则删除）
- `ui/panels/ProposalsPanel.tsx`
- `server/rejected`（拒绝归档）与 `prompts/rejected-feedback.md`
- 所有 `createProposal()` / `acceptProposal()` / `rejectProposal()` / `acceptModifiedProposal()` 调用点
- `api.js` 的 `/proposals/*` 路由
- `manifest.json` 中 `proposals` 相关 surface（若有）
- `store.js` 的 `proposals` / `rejected` 默认文档

**在线检索（Online）**
- `server/literature-client.js` 的 Semantic Scholar / arXiv / Crossref 三源
- `manifest.json` `network.allowedHosts` 中 `api.semanticscholar.org` / `export.arxiv.org` /
  `api.crossref.org` / `api.openalex.org`
- `collect_literature` 工具 online 分支与 `query` / `limit` / `fromYear` / `toYear` 参数
- `index.js` 自动搜集（autoCollect）中的在线检索逻辑（是否保留仅 Zotero 同步，见 §13 决策点）

**文献分析报告（report）**
- `prompts/literature-analysis.md`
- `llm.js` `analyzeLiterature` / `extractClusters` / `sampleLiterature`（若不再需要采样）
- `store.js` `report` 默认文档
- `api.js` `/report` / `/report/refresh`
- `ui/panels/LiteraturePanel.tsx` 的报告部分

**甘特自动逻辑（与手动建计划冲突）**
- `server/schedule-rebalance.js`（再平衡顺延）
- `server/milestone-schedule.js`（重复列出，纯自动派生）
- `log_work` 中 P0-1 排程 / P0-2 再平衡 / P0-3 重做任务逻辑

**工具**
- `manage_plan` / `assess_plan` / `review_research`（依赖分析与方案）
- `export_report` 改造：仅保留导出实验记录（worklog），移除 review/report/bibtex 分支

**测试**
- `store-proposals.test.mjs` / `assess-plan.test.mjs` / `milestone-schedule.test.mjs` /
  `v3-proposal-integration.mjs` / `schedule-rebalance.test.mjs`

### 3.2 保留但改造

**甘特图 + 日历（gantt/calendar）**
- 甘特任务由用户手动建立与拖拽排期；AI 在 `log_work` 时若传 `taskId` 则自动更新进度。
- AI 提取实验时长/开始日期投影实际时间线；不自动建任务、不自动顺延、不自动重做。
- 移除对 plan / milestone 的依赖，成为纯手动计划 + AI 进度记录工具。

**实验记录（worklog）**
- 主视图与数据主线。
- `log_work` / `triage.js` 巡检均直接写库（去提案）。
- `fields`（性能参数结构化）保留，供指标趋势模块使用。

**指标趋势（metrics）**
- 保持不变：`server/metrics.js` 纯函数序列提取，`analyze_metrics` 只读工具，
  `ui/panels/MetricsPanel.tsx` 可视化。
- 依赖实验记录 `fields`，巡检（triage）继续负责结构化工序。

**文献收纳（仅 Zotero）**
- `server/sources.js` 的 Zotero 全量镜像同步、fulltext 增强、collection 映射保留。
- 移除在线源与工作区文件扫描（用户确认仅 Zotero）。
- **新增日志化**：检测到新收录条目时自动向 worklog 追加一条记录。

## 4. 核心行为改造：AI 写即生效（去提案机制）

所有原 `createProposal()` 调用点改为**直接写库**。乐观锁 `version` 保留（防并发覆盖），
但不再有「生成待确认提案 → 用户确认 → 落库」这一状态。

| 改造前调用点 | 改造后行为 |
|---|---|
| `log_work` 写实验记录 | 直接 `store.update("worklog")` |
| `log_work` 甘特进度 | 直接 `store.update("gantt")` |
| `log_work` 日程 | 直接 `store.update("calendar")` |
| `triage.js` 巡检产出 | 直接写库 |
| `collect_literature`（Zotero） | 直接 `store.append("literature")` |
| `index.js` 自动搜集（若保留） | 直接写库 |

**注意**：`store.update()` 的乐观锁在「AI 直接写」下仍需处理 `version_conflict`，
否则并发（如巡检与手动编辑同时发生）会静默丢弃。保留 `store.update` 的冲突检测，
失败时由调用方读取最新版本重试或告警（策略见实现计划）。

## 5. 文献操作日志化（本次改造的新增行为）

### 5.1 触发时机
- 后台定时（原 30 分钟 Zotero 同步）与手动扫描时，检测到**新收录的文献条目**。
- 不再依赖在线检索；自动搜集（autoCollect）逻辑若保留则同样触发。

### 5.2 记录结构
每次有 `newCount > 0` 时，向 worklog 追加一条：

```
# 文献收纳 · YYYY-MM-DD
新增 N 篇
- [年份] 标题（作者/来源）
...
```

其 `structure` 与手写实验记录一致：含 `content` / `date` / `createdAt`，
`taskId` 与 `sampleId` 为空，`fields`/`citations` 为空（或标记 `kind: "literature-log"`）。

### 5.3 去重
- 记录带 `scanId`（Zotero 同步批次标识）+ 条目指纹。
- 同一批次重复扫描不重复写；`newCount` 基于 `literature.version` 或 `firstSeenAt` 增量判定。

### 5.4 实现落点
- `syncZotero` / `scanAllSources` 的 Zotero 路径中，计算出 `newEntries`，
  若 `> 0` 则 `store.append("worklog", [日志记录])`。
- 新增辅助函数（如 `appendLiteratureLog(store, newEntries)`）供同步与手动扫描复用。

## 6. 数据存储精简

**保留**：`binding.json` / `gantt.json` / `calendar.json` / `worklog.json` / `literature.json` /
`updates.json` / `settings.json` / `collections.json`

**移除**：`plan.json` / `proposals.json` / `rejected.json` / `report.json` / `assessment.json` /
`plan-evolution.json` / `reviews.json`

`store.js` 的 `DEFAULT_DOC` 与 `UPDATES_KEYS` 同步精简；快照目录跟随目标文件。

## 7. 接口（API）精简

**保留**：
- `GET /state`（去掉 plan/report/proposals/assessment 字段）
- `GET /changes`（水位线）
- `GET|PUT /worklog`、`/gantt`、`/calendar`、`/literature`
- `POST /scan`（仅 Zotero）
- `GET|POST /binding`
- `GET /sources/zotero`、`POST /sources/zotero/probe`
- `GET /metrics/series`
- `POST /literature/enhance-pdfs`、`POST /literature/enrich-cites`、`POST /literature/purge-gone`
- `DELETE /literature`

**移除**：
- `GET|PUT /plan`、`/plan/evolution*`、`/plan/assess`
- `POST /report/refresh`、`GET /report`
- `/proposals/*`、`/guide/proposal-draft`、`/summary/week`
- `POST /worklog/import`（若批量导入与实验记录冲突——保留与否见实现计划）

**新增**：
- `POST /worklog/append`（AI/工具直接写入实验记录，替代提案路径）
- （若 Zotero 扫描需手动触发日志化）`POST /literature/log-collection`

## 8. 工具（对话工具）精简

**保留改造**：
| 工具 | 改造 |
|---|---|
| `manage_schedule` | 去提案，直接写 gantt/calendar |
| `collect_literature` | 仅 Zotero 扫描，去 query/limit/fromYear/toYear 参数 |
| `log_work` | 去提案，直接写 worklog/gantt/calendar |
| `analyze_metrics` | 不变（只读） |

**移除**：`manage_plan` / `assess_plan` / `review_research` / `export_report`

## 9. manifest.json 精简

- `network.allowedHosts`：仅保留 `localhost` / `127.0.0.1`（Zotero 本地 API）。
- `capabilities`：`model.sample` / `resource.*` 保留（仍需 LLM 与资源）；去掉不再需要的。
- `contributes.configuration`：去掉与在线检索/分析报告相关项，保留 `zoteroPort` / `autoCollect` / `autoTriage`。
- `ui` / `widget` surface 按新导航调整。
- 更新 `dev.scenarios` 中的 smoke 测试（原 `smoke-manage-plan` 需替换）。

## 10. 导航与 UI 结构

**顶部 Tab（默认到甘特图/日程）**：
1. 📅 日程 / 甘特图（核心，默认首页）
2. 🧪 实验记录
3. 📈 指标趋势
4. 📚 文献库
5. ⚙️ 设置

**移除 Tab**：研究方案 / 提案确认。

`ui/Panel.tsx` 的 TAB 定义、`Dashboard` 汇总、`SettingsDrawer` 配置项同步精简。

## 11. 测试更新

- **移除**：`store-proposals.test.mjs` / `assess-plan.test.mjs` / `milestone-schedule.test.mjs` /
  `schedule-rebalance.test.mjs` / `v3-proposal-integration.mjs`。
- **更新**：`sources.test`（Zotero 扫描日志化断言）、`metrics.test` / `analyze-metrics.test`（若引用 plan）、
  `import-parser.test`（若保留批量导入）、`llm-sampling.test`（若引用 `sampleLiterature`）。
- **新增**：文献收纳日志化测试（`appendLiteratureLog` 去重与结构校验）。
- `parsers-verify.mjs` 保留（RIS/BibTeX 解析仍用于 Zotero 导入路径）。
- `run-all.mjs` 自动收集测试文件，删除后无需改动。

## 12. 构建说明

- 源码在 `src-server/`，构建产物在插件根（`index.js` / `routes/*.js` / `tools/*.js` / `assets/*`）。
- 改造需同时更新 `src-server/` 并重新运行：
  ```
  npm run build:server   # esbuild src-server → 插件根
  npm run build:ui       # vite → assets
  ```
- 环境当前无 node/npm（见交付记录），构建需在具备 Node 的环境执行。

## 13. 已确认的功能决策

规格主体与以下两项均已在用户审查关卡确认，无未分叉的待定项：

1. **`POST /worklog/import`（批量粘贴仪器表格）**：**保留**，作为实验记录的直接录入方式；
   导入后仍触发 triage 巡检（AI 结构化 / 关联甘特进度 / 日程识别），与面板手动录入路径的 `autoTriage` 语义一致。

2. **Zotero 自动搜集（autoCollect / 会话监听）**：**保留**，但改写触发语义——
   由"绑定会话后检测研究方向讨论时自动检索在线源"改为"绑定会话后自动同步 Zotero 本地库"
   （`syncZotero`），不再检索在线源。文献收纳动作仍自动日志化到 worklog。

以上两项均已在实现计划前明确，代码落地无"或"分叉。

---

## 14. 实现落地说明（2026-08-22）

本规格已按上文实现并提交（见 `docs/superpowers/plans/2026-08-22-experiment-record-centering.md`）。
实现中的关键实际决策（与早期倾向的差异）：

- **`analyze_metrics` 保留**：指标趋势模块作为「记录实验性能参数」的一部分保留。
- **`export_report` 改造而非删除**：仅保留导出实验记录（worklog），移除 review/report/bibtex 分支。
- **`reviews.json` 移除**：实验记录审查已由 triage 巡检承担，独立审查报告不保留。
- **文献日志化触发**：`syncZotero` 检测新增条目（zoteroKey 未在旧库）自动 `appendLiteratureLog`。
- **构建约束**：`@hana/*` 依赖经 `file:../openhanako` 引用，当前环境未装 node_modules；服务端已通过全量 `node --check` 语法与 import 完整性静态验证，纯单元测试（literature-log/import-parser/parsers/metrics/analyze-metrics）实测通过；`sources/zotero-sync` 等依赖 @hana 的测试需 node + 宿主依赖就绪后运行。
