# P1-2 实现记录：文献对照评估（assess-plan-against-literature）

> 日期：2026-08-05
> 目标：补足"AI 基于文献评估"的**针对性**——此前 literature-analysis 偏宏观领域全景，不拿用户的研究假设/技术路线去对照文献。

## 用户原始诉求回顾
插件四大功能含"AI 基于文献评估"。经分析，原 `literature-analysis.md` 产出领域脉络/聚类/证据强度，但**不拿方案假设去对照文献**；`plan-reviewer.md` 是以方案为出发点的审查。二者都不等于"以文献为根据评估方案"。本改动补上这一环。

## 改动清单

### 新增
- `prompts/assess-plan-against-literature.md`：Prompt 约定三段输出（假设-证据对照表 / 技术路线可行性 / 研究 gap 陈述）+ 末尾 `<!--SUGGESTIONS-->` 机器块（plan 修改提案 + gaps 标签）。**刻意不用 emoji 标记**（用纯文本），align 到插件既有 P0 规则精神。
- `src-server/tools/assess-plan.js`：工具 `assess_plan`。读 plan+literature → 调 LLM → 写只读 `assessment` 报告（bump）→ 解析 SUGGESTIONS 生成 plan 提案。含新鲜度检查（方案/文献版本未变则复用，可 force 强制）。
- `tests/assess-plan.test.mjs`：纯函数 `parsePlanAssessment` 单测（12 断言全过）。

### 修改
- `src-server/server/llm.js`：新增 `assessPlanAgainstLiterature(ctx,{plan,literature})`（用 `sampleLiterature` 限流、critical 路径、maxTokens 4000）与导出的纯函数 `parsePlanAssessment(raw)`（分离正文/SUGGESTIONS/gaps，可被测试与工具复用）。
- `src-server/routes/api.js`：`POST /plan/assess`（面板按钮触发，持久化 assessment + bump，复用解析逻辑生成提案）；`/state` 返回键增加 `assessment`。
- `src-server/server/store.js`：`DEFAULT_DOC` 增加 `assessment`（结构同 report，附 gaps）；`UPDATES_KEYS` 增加 `assessment`（bump 触发面板刷新）。
- `ui/api.ts`：增加 `assessPlan(force?)`。
- `ui/panels/PlanPanel.tsx`：方案页内新增「文献对照评估」区块——触发按钮（对照评估 / 强制重评）+ 结果卡片（Markdown 渲染）+ gap 标签 chips + 过期提示 + 放大阅读弹窗。沿用 `Markdown` 组件与 `mrc-report-*` 视觉。
- `ui/panel.css`：`.mrc-assess-block` / `.mrc-gap-row` / `.mrc-chip.gap`（含暗色主题）样式。

## 设计要点
- **只读报告 + 提案分离**：评估报告写入 `assessment`（只读，结构同 report），报告中可落地的方案修改以**提案**形式进 `proposals`，用户确认后生效——延续插件"AI 落库前必确认"防幻觉机制。
- **新鲜度**：方案或文献库版本变动才重评，避免每次打开重复消耗模型调用；`force` 可绕过。
- **限流**：literature >80 篇走 `sampleLiterature` 三路采样（最新/高引/方案相关），与 literature-analysis 同策略。
- **复用**：解析逻辑抽成纯函数 `parsePlanAssessment`，review-research 的同类逻辑未强改（避免范围蔓延），但新工具一律走纯函数便于测试。

## 验证
- 单测 `node tests/assess-plan.test.mjs` → **12/12 通过**（含无 SUGGESTIONS 兜底、JSON 损坏兜底、非 plan 提案过滤）。
- 全量回归：`tests/metrics.test.mjs`（20/20）+ `tests/schedule-rebalance.test.mjs`（14/14）→ 均绿，无回归。
- esbuild 打包 `routes/api.js` + `tools/assess-plan.js`（server，exit 0）；`ui/Panel.tsx`（@hana 外部化，exit 0，新代码已打进 bundle）。
- `npm run typecheck`：除预存的 `@hana/*` 环境错误（原 Panel.tsx/api.ts 也引用，仅在你 Hana 构建环境解析）外无新错误。

## 用户需做的一步
本机无法跑 `npm run build`（vite 解析不到 `@hana` 包；`build:server` 根 `index.js` 被宿主锁写）。请在 **Hana dev 环境**执行 `npm run build` + `plugin_dev_install(allowFullAccess=true)` 重建生效。

## 备份
`docs/superpowers/backups/pre-p1x/`（llm.js / routes/api.js / store.js / PlanPanel.tsx / api.ts）。
