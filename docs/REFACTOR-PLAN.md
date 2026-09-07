# sci-log 科研工作插件 — UI 能力对齐改造方案

> 基于工作区源码工程 `OH-WorkSpace/sci-log`（完整 TS/TSX 源码 + git）。
> 基准版本：manifest/package 均 `1.0.0`。本文档为改造蓝图，改动前对照，改动后回填。

## 0. 现状与结论（已核实）

- 装机版 `~/.hanako/plugins/sci-log` 是**发行打包产物**（esbuild/Vite 单文件，无源码）。
- 工作区 `OH-WorkSpace/sci-log` 是**完整源码工程**：`src-server/*.ts`、`ui/*.tsx`、`package.json`、
  `vite.config.ts`、`vitest.config.ts`、`tests/`、`vendor/openhanako`（SDK 源码）。可编译、可改。
- 当前 UI 表面为 legacy `contributes.page` + `contributes.widget`（宿主标记 deprecation），
  未使用交互式卡片宿主桥（无 `window.card.invoke` / `command.run` / `data-card-manifest`）。
- 交互式确认（实验记录入库）当前为**会话文本状态机**：`src-server/index.ts` 的
  `matchVerdict` + `_pendingDraft` + `sendSessionMessage("回复「记录」确认")`。

## 1. 核心判断

插件把两类性质不同的 UI 揉在一个 WebView 里，是「对不上」的源头：

- **A 类 · 持久工作台**：甘特/日历/实验记录列表/指标趋势/文献库。信息密集、实时刷新、长时间停留。
  应保留为**宿主面板（WebView）**，职责是浏览与密集编辑。
- **B 类 · 对话触点**：AI 与用户之间的决策瞬间——「这条记录要不要入库」「这组趋势是什么」。
  应改为**可交互卡片**（我在对话中 cast），职责是决策确认。

改造不是「把插件换成卡片」，而是把 A、B 拆开，各归各位。

## 2. 原则

1. 工作台保留 WebView 面板，声明从 legacy `page/widget` 迁到 `contributes.cards`，去掉 deprecation。
2. 对话触点改为交互式卡片：由 **AI（agent）在对话中 cast**，用 `data-card-manifest` 绑定插件工具，
   把「AI 决策 → 用户确认」从文本状态机变成可点击卡片。
3. 卡片**永远自带真实数据**（先取数、再烧绘，不依赖运行时 fetch 渲染空壳）。
4. 卡片视觉套 `hana-house-style`（纸面、serif 优先、仅 400/500 字重、禁渐变/阴影/emoji、SVG 图标）。
5. **AI 当编排者，插件只当数据与工具提供者**：插件后端不能直接调 `show_card`（那是 agent 工具），
   因此确认流程改为「插件暴露工具 + AI cast 卡片绑定工具」。

## 3. 轨道 A：对话触点卡片化（核心）

### A1 · 实验记录「记录 / 取消」确认 → 交互式卡片

删除 `src-server/index.ts` 中的 `matchVerdict` + `_pendingDraft` + `sendSessionMessage` 文本确认状态机，
替换为：

- 插件新增只读工具 `sci-log_prepare_worklog(text, taskList?)` → 返回草稿 + `draftId`（存待确认池）。
- 插件新增写工具 `sci-log_commit_worklog(draftId)` / `sci-log_cancel_worklog(draftId)`（`plugin_output`）。
- AI 拿草稿后 cast 一张确认卡，把草稿内容烧进卡片，manifest 绑定提交/取消工具。
- 用户点「记录」→ `window.card.invoke("commit")` → 网关分发到 `sci-log_commit_worklog` → 落库。
- 用户点「取消」→ invoke `cancel` → 丢草稿。

配套改动：`manifest.json` 删除/豁免 `aiWorklogGen` 的文本确认描述（改为「交互式卡片确认」）。

### A2 · 指标趋势 → 图表卡片

`analyze_metrics` 数据 → AI cast 趋势卡（ZT/PF/σ/Seebeck 多序列，叠加文献基准 + 目标 + 单位未标注空心点），
绑定 `time.now` 做时间戳，其余数据烧入。

### A3 · 甘特 / 日程快照 → 摘要卡

「这周安排」类查询 → cast 本周任务卡（复用 widget 的取数逻辑），卡片带跳转工作台入口按钮。

### A4 · 导出报告

已是 SessionFile 下载卡，仅补视觉规范。

## 4. 轨道 B：工作台去 deprecation

### B1 · manifest 表面迁移

`contributes.page/widget` → `contributes.cards`（保留 route-shell、`hana.api.fetch`/`pluginSurfaceSession`
协议不变，仅改声明层；`hostCapabilities:["external.open"]` 保留，按最小集声明）。

### B2 · 面板归位为「内嵌工作台卡片」

B 类触点全部迁到卡片后，面板聚焦为纯工作台。我（agent）不对面板面板做逐元素 `ui_action` 驱动
（当前它也 expose `interactiveElements:[]` / `webView:null`），面板管浏览，卡片管决策，
两者经同一套 `ctx.dataDir` JSON + 工具层衔接。

## 5. 卡片视觉规范（套 hana-house-style）

- 标题 ≤5 词、居中、无 accent bar。
- 表头 `th`：`font-weight:500; color:var(--text-light); font-size:0.85rem`。
- 指标值：`font-size:1.6rem; font-weight:600; color:var(--accent); tabular-nums`。
- 数字全取整（`Math.round/.toFixed/Intl.NumberFormat`）。
- 配色：accent `#537D96` 为主 + 至多 1 语义色；图表 2–3 色，禁止 >4。
- 圆角 `rx=2`；`stroke-width` 1 或 1.5。
- 可访问性：卡片开头 `<h2 class="sr-only">`；SVG `role="img"`+`<title>`+`<desc>`；
  自定义控件 `role="button" tabindex="0" data-action`。
- 禁用：emoji、渐变/阴影、`display:none`、注释、外部 `<img>`。

## 6. 分阶段

- **P0 · 地基清理**：manifest `page/widget → contributes.cards`；版本一致（package 与 manifest 同源）。
- **P1 · 卡片协议打通**：新增 `prepare_worklog/commit_worklog/cancel_worklog`；改造 `index.ts`；
  AI cast 首张「记录 / 取消」确认卡，`window.card.invoke` 真能落库。
- **P2 · 对话触点铺开**：指标趋势卡、甘特/日程摘要卡。
- **P3 · 收尾**：视觉巡检 + 与面板衔接回归 + `typecheck/test` 全绿。

## 7. 风险与边界

- `chat.surface` 富交互卡片仍未进公开 SDK；本方案用 **agent 侧 `show_card`** 实现卡片，
  不是插件 `createChatSurfaceCard` 产原生卡片。
- 生命周期/后端不能直接调 `show_card`，确认流程必须「AI 编排 + 插件提供工具」，
  控制权从后台状态机转移到 AI——本次改造最本质的行为变化。
- 工作台 WebView 无法被我逐元素驱动，是持久面板的固有边界。
