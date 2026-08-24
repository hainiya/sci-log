# 科研日志 sci-log —— 材料科研实验记录中心

面向材料专业科研的 **AI 科研辅助插件**：以**实验记录为数据主线**，提供甘特图/日历可视化、指标趋势、Zotero 文献收纳，并让 AI 直接读写这些数据。

- 插件 ID：`sci-log`
- 类型：`full`（对话工具 + 生命周期 + 面板 UI）
- 信任级别：`full-access` · 版本：`1.1.0` · 最低宿主：`0.159.0`
- 宿主：Hana（openhanako）

> **设计主线**：实验记录中心化。AI 主要承担实验记录的**记录与巡检**，用户主要是**审校与补充**——AI 写操作**直接落库**（乐观锁防并发覆盖），不再有"提案-确认"环节。面板首屏是"已记录的实验记录"，手动记录仅作为纠错入口。

---

## 功能总览

| 模块 | 位置 | 说明 |
|---|---|---|
| 日程 / 甘特图 | 默认首页 | 任务排期 + SVG 甘特图：拖拽改期、两端缩放、双击编辑；实验记录实时投影为「实际时间线」 |
| 日历 | 日程 tab | 月视图日程；有实验记录的日期叠加绿色圆点标记 |
| 实验记录 | 主 Tab | 时间线记录列表 + 手动记录（默认折叠）+ AI 巡检（参数结构化/文献关联/甘特进度/日程/时长提取，直接写库）|
| 指标趋势 | Tab | 从实验记录提取性能参数（ZT/功率因子/σ/Seebeck/κ/载流子浓度/迁移率…）绘制趋势，叠加文献基准与目标值；温度筛选与单位未标注空心点 |
| 文献库 | Tab | Zotero 本地扫描收纳、分类/搜索/排序、AI 摘要/翻译/关键词、失效镜像清除；顶部内嵌 Zotero 在线/离线状态 |

**panel（页面）与 widget（窄条）** 两种输出面：widget 只保留最有信息量的"本周统计 + 今日状态行"，避免与页面重复。

---

## 架构分层

```
┌──────────────────────────── 宿主 Hana ────────────────────────────┐
│  iframe 面板(assets/panel.js)  ·  Agent 对话 · 配置 · 数据目录      │
└───────────┬──────────────────────────────┬───────────────────────┘
            │ hana.api.fetch(path)         │ tools / lifecycle
┌───────────▼────────────┐         ┌───────▼────────────────────────┐
│ ui/  React + Vite      │         │ src-server/  Node (esbuild)     │
│  Panel(自挂载)          │         │  index.js      lifecycle        │
│  Dashboard/Gantt/      │         │  tools/*.js    Agent 接口        │
│  Calendar/Metrics/     │         │  routes/*.js   面板 API          │
│  Worklog/Literature/   │         │  server/*.js   业务逻辑          │
└───────────┬────────────┘         └───────┬────────────────────────┘
            └───────────── store.js ◄──────┘
                         JSON 文件 + 乐观锁 + 快照 + 水位线
```

---

## 目录结构

```
sci-log/
├── manifest.json          # 能力声明、configSchema、network、UI surface、dev 场景
├── package.json
├── vite.config.ts         # 前端构建（输出固定 assets/panel.js|css）
├── vitest.config.ts       # 前端测试配置（jsdom）
├── tsconfig.json
├── src-server/            # ★ Node 侧源码（构建后输出到插件根）★
│   ├── index.js           # lifecycle：会话绑定/节流同步 Zotero/30min 镜像
│   ├── tools/*.js         # 8 个对话工具（manage_schedule/log_work/collect_literature/export_report/analyze_metrics/prepare_worklog/commit_worklog/cancel_worklog）
│   ├── routes/*.js        # ui.js（面板路由 shell）/ api.js（面板 API）
│   └── server/            # 共享业务层
│       ├── store.js       # 数据层：乐观锁/append/upsertByKey/snapshot/rollback/bump/compact
│       ├── sources.js     # Zotero 同步 + 增强循环 + 引用数补全
│       ├── llm.js         # sampleText 封装、triageWorkEntry、nextStepAdvice
│       ├── triage.js      # 实验记录巡检（自动巡检）
│       ├── metrics.js     # buildMetricsSeries / filterSeries / 文献基准
│       ├── import-parser.js   # 指标/仪器表格解析
│       ├── worklog-gen.js / worklog-parse.js # AI 生成草稿解析
│       ├── literature-log.js  # 文献动作日志化（动作写回实验记录）
│       └── binding.js     # 会话绑定
├── ui/                    # React 前端（类型 TSX）
│   ├── Panel.tsx          # 顶层：createRoot 自挂载，tab 路由，widget/page 分派，轮询
│   ├── api.ts             # hana.api.fetch 封装（路径约定、错误处理）
│   ├── components/        # Dashboard / GanttChart / CalendarView / MetricsChart / ConfirmButton
│   ├── panels/            # SchedulePanel / WorklogPanel / MetricsPanel / LiteraturePanel
│   └── panel.css          # --mrc-* 主题变量，暗色主题兜底
├── prompts/               # LLM prompt（next-step-advisor/worklog-generate/worklog-triage）
├── assets/                # ★ 构建产物（panel.js / panel.css）★
├── tests/                 # 后端 node 单测 + tests/ui/ 前端 vitest 测试
└── docs/                  # 附加文档
```

> ⚠️ **构建产物在插件根**：插件根目录的 `index.js` / `tools/*` / `routes/*` 是 `esbuild` 打包产物，`assets/` 是 Vite 产物。**改后端必须改 `src-server/`，改前端改 `ui/`**，否则会被 `npm run build:*` 覆盖。

---

## 数据模型（`ctx.dataDir` 下的 JSON）

| 文件 | 顶层字段 | 说明 |
|---|---|---|
| `binding.json` | `sessionId / sessionPath / boundAt / source` | 会话绑定 |
| `gantt.json` | `version / tasks[] / updatedAt` | 计划任务 |
| `calendar.json` | `version / events[] / updatedAt` | 日历日程 |
| `worklog.json` | `version / entries[] / updatedAt` | **实验记录（主线）** |
| `literature.json` | `version / entries[] / updatedAt / lastCompactedAt` | 文献库（追加式 + 镜像） |
| `updates.json` | `{gantt,calendar,worklog,literature}` | 水位线（增量轮询/巡检触发） |
| `settings.json` | `updatedAt / metricTargets` | 面板配置 |
| `collections.json` | `version / collections[]` | Zotero collection 只读镜像 |
| `snapshots/<name>/` | `*.json` | 版本快照（最多 20 个，自动快照） |

**并发规则（`store.js`）**：除 `literature` 的追加式写入外，所有可编辑文件顶层含 `version`，任何写入必须携带读取时的 `version`；`version` 匹配 → 写入并 `version+1`、生成快照、推进 `updates.json` 水位线；不匹配 → 拒绝并返回最新数据（供前端重试）。`read()` 会对 `version` 做数值归一化，避免字符串版本导致永久锁死。

---

## 对话工具（Agent 接口）

每个工具在 `src-server/tools/*.js` 用 `export const name/description/parameters/sessionPermission + execute(input, toolCtx)` 声明。

| 工具 | 用途 | 权限 |
|---|---|---|
| `manage_schedule` | 甘特任务 / 日历日程增删改（直接写库） | `plugin_output`（AI 写即生效）|
| `log_work` | 记录实验：写入实验记录 + AI 巡检补进度/日程 + 下一步建议 | `plugin_output`（AI 写即生效）|
| `prepare_worklog` | 生成实验记录草稿并暂存（供交互式卡片确认落库/取消） | `plugin_output`（AI 写即生效）|
| `commit_worklog` | 落库交互式卡片上的实验记录草稿（含 AI 巡检直接写库） | `plugin_output`（AI 写即生效）|
| `cancel_worklog` | 取消交互式卡片上的实验记录草稿 | `plugin_output`（AI 写即生效）|
| `collect_literature` | Zotero 本地扫描收纳入库（动作日志化到实验记录） | `external_side_effect`（调外部 Zotero API）|
| `export_report` | 导出实验记录为 Markdown 下载卡片（`toolCtx.stageFile` 投递 SessionFile） | `plugin_output`（`session_file_output`）|
| `analyze_metrics` | 指标趋势查询（只读） | `read` |

> `manage_plan` / `assess_plan` / `review_research` 已随研究方案与提案机制移除，`route` 与 `api.ts` 中相关残留已清或不建议再使用。

---

## 面板 API（前端 ↔ 后端）

前端 `ui/api.ts` 用 `hana.api.fetch(path)` 调用，**路径不带 `api/` 前缀**（宿主会把 path 原样拼到 `/api/plugins/<pluginId>/` 之后，`routes/*.js` 注册路径与之对应）。主要端点：

| 端点 | 方法 | 说明 |
|---|---|---|
| `state` | GET | 全量状态（binding/gantt/calendar/literature/worklog/settings/collections/updates/config/sessionId）|
| `changes?since=` | GET | 增量水位线轮询（前端每 15s）|
| `gantt` `calendar` `worklog` `literature` | GET / PUT | 乐观锁读写（`{version, data}`）|
| `literature` | DELETE | 移除条目（Zotero 镜像由服务端拒绝/受只读保护）|
| `literature/purge-gone` | POST | 清除失效镜像 |
| `literature/enhance-pdfs` | POST | 触发 AI 摘要/关键词增强链路 |
| `worklog/import` | POST | 仪器表格批量导入 |
| `scan` | POST | Zotero 扫描 |
| `settings/metrics` | POST | 指标目标值配置 |
| `metrics/series` | GET | 指标序列（供指标面板）|
| `sources/zotero` | GET | Zotero 连接状态 |

**返回约定**：所有接口响应需为 `{ok, ...}` 或 `{error, ...}` 形态；`PUT` 冲突返回 `409` + `{error:"version_conflict", data: 最新}`，前端据此用最新数据重试。

---

## 前端要点

- **React + Vite**，构建产物固定 `assets/panel.js` / `panel.css`（`emptyOutDir:false`、`preserveSymlinks:true`、`dedupe:['react','react-dom']`）。
- `Panel.tsx` 用 `createRoot` 自挂载到 `#root`，依据 `#root.dataset.surface` 区分 `page` / `widget`。
- 主题用 `HanaThemeProvider mode="inherit"` 跟随宿主；样式用 `--mrc-*` 变量，暗色主题有 `[data-hana-theme=dark]` 兜底。
- 列表/表单/图表均为自带动画与高 DPI 友好的 SVG/HTML，无第三方 UI 库。
- **编辑保存的乐观锁**：`WorklogPanel` 写入先读最新 `worklog`，在最新数据上 patch 目标条目，冲突自动重试，避免 AI 巡检/并发写导致的 `version_conflict` 卡死。

---

## 后台生命周期（`src-server/index.js`）

- 通过 `ctx.bus.subscribe` 监听会话事件（底层/未文档化事件 `session_user_message`），驱动：
  - **Zotero 节流同步**：绑定会话检测到用户消息，10 分钟节流内自动同步本地库（受 `autoCollectEnabled` 控制）。
  - **AI 实验记录生成**：由 Agent 调用 `prepare_worklog` 生成草稿并 cast 交互式确认卡，卡片按钮经 data-card-manifest 绑 `commit_worklog` / `cancel_worklog` 落库/取消（后台不再维护文本确认状态机）。
- 定时任务：Zotero 30 分钟全量镜像；文献新增自动触发摘要/关键词增强链路。

> `ctx.bus.subscribe` 句柄与 `setInterval` 的 Timeout **含循环引用**，不能挂到插件实例 `this`（宿主序列化会抛 `Converting circular structure to JSON`）；事件名属底层用法，宿主文档未公开。

---

## 宿主配置（manifest `configuration`）

| 配置 | 默认 | 说明 |
|---|---|---|
| `zoteroPort` | 23119 | Zotero 本地 API 端口（Zotero 7+ 且客户端运行；全文提取/AI 摘要需 10+）|
| `autoCollectEnabled` | 开 | 绑定会话后用户消息触发自动同步 Zotero |
| `autoTriage` | 开 | 实验记录写入后自动 AI 巡检，直接写库 |

外部 HTTP 通过 `ctx.network.fetch()`，宿主在 manifest 中用 `network.allowedHosts` / `methods` / `defaultTimeoutMs` / `maxResponseBytes` 约束（含 `localhost`，`allowLocalhost`）。

---

## 开发与构建

```bash
npm install
npm run build:server   # esbuild 打包 src-server/ → 插件根 index.js/tools/routes
npm run build:ui       # Vite 构建前端 → assets/panel.js|css
npm run build          # 两者
npm run typecheck      # TypeScript 检查
```

**`@hana/*` 依赖来源**：`package.json` 中 `@hana/plugin-*` 指向 hana-plugin-creator skill 自带的 SDK tarball（`~/.hanako/skills/hana-plugin-creator/assets/sdk/hana-plugin-*-0.0.0.tgz`）。该路径为**本机** SDK 副本，clone 到其它环境需自行提供同版本 SDK（或改用仓库内 self-contained 方案）。

**后端改动必须改 `src-server/`**；构建仅在 `build:server` 后把 `src-server/` 打包到插件根。

---

## 测试

| 命令 | 覆盖 |
|---|---|
| `npm test` | 后端 node 单测（`tests/*.mjs`）：store 数据层、指标、导入解析、文献日志化、worklog 解析、Zotero 同步逻辑、实机 Zotero 连通 |
| `npm run test:ui` | 前端 vitest（`tests/ui/*`，mock 宿主 `api`/`hana`）：组件渲染与交互（Dashboard/Gantt/Calendar/Metrics/Literature/Worklog/Settings/Panel 等，14 文件 / 37 用例）|

> `zotero-sync.test.mjs` 在启动本地 Zotero 后跑实机同步；否则标记 SKIP。

---

## 已知边界

- 文献来源仅 Zotero 本地库（在线检索已移除）。
- CAJ 文件仅识别并标注「暂不支持解析」。
- 面板导出依赖宿主注入的会话标识；不可用时降级为对话指令导出。
- **实验记录「AI 主导录入」确认方式**：AI 用 `prepare_worklog` 生成草稿，cast 确认卡片，卡片「记录/取消」按钮经 data-card-manifest 绑 `commit_worklog` / `cancel_worklog` 落库/取消；未确认前不落库。

---

## 二次开发速查

- **改后端逻辑** → 改 `src-server/`，跑 `npm run build:server`。
- **改前端** → 改 `ui/`，跑 `npm run build:ui`，宿主 `plugin.dev.reload` 后生效。
- **新增工具** → 在 `src-server/tools/` 建文件（`export const name/description/parameters + execute(input,toolCtx)`），并在 manifest `capabilities`/会话权限里声明；返回必须是 `content:[{type:'text',text}]`。
- **新增前端路由/面板** → `routes/*.js` 注册 + `ui/api.ts` 加方法（路径不带 `api/` 前缀）。
- **宿主契约**：`hana.api.fetch(path)` 拼 `/api/plugins/<id>/`；外部 HTTP 用 `ctx.network.fetch()`；用户文件用 `ctx.resources`；插件生成文件用 `toolCtx.stageFile()` 投递 SessionFile。
- **验证**：`npm run typecheck && npm run build && npm test && npm run test:ui`。
