# 科研工作（原材料科研副驾 / Materials Research Copilot）

面向材料专业硕士生的 AI 科研辅助插件：**研究方案管理 + 甘特图时间表 + 日历日程 + 文献库 + 任务清单 + 实验记录审查**。

插件 ID：`materials-research-copilot`，类型：`full`（工具 + lifecycle + 三栏面板 UI）。

## 功能总览

| 模块 | 位置 | 说明 |
|---|---|---|
| 文献库 | 面板左栏 | 在线检索（Semantic Scholar/arXiv/Crossref）+ 工作区扫描 + Zotero 本地 API 三来源，可筛选 |
| 文献分析报告 | 面板左栏 | AI 生成（研究脉络/主题聚类/证据强度/推荐），手动刷新或后台自动更新 |
| 研究方案 | 面板中栏 | 题目/假设/技术路线/里程碑，人工编辑直接落库 |
| 实验记录 | 面板中栏 | 工作日志 + 数据，关联甘特任务与进度 |
| 提案确认 | 面板中栏 | AI 的所有修改都以提案出现，Diff 视图：接受/拒绝（填理由）/改后接受 |
| 甘特图 | 面板右栏 | SVG 拖拽改期、两端缩放、双击编辑（依赖/进度） |
| 任务清单 | 面板右栏 | 增删改、勾选完成 |
| 日历 | 面板右栏 | 月视图，点日期添加/删除日程，可关联甘特任务 |
| 设置抽屉 | 面板右上角 | 文献目录管理 / 会话绑定管理 / 拒绝记录清空（四项 config 配置在宿主设置页） |

## 对话工具（8 个）

| 工具 | 用途 |
|---|---|
| `manage_plan` | 研究方案/实验记录读写（写走提案确认） |
| `manage_schedule` | 甘特任务/日历日程增删改（走提案确认） |
| `collect_literature` | 在线 + 本地全源文献搜集入库（去重合并） |
| `log_work` | 汇报工作：写实验记录 + 更新甘特进度 + 下一步建议 |
| `review_research` | AI 审查：错误指出 / 改进建议（带文献依据）/ 风险提示，修改建议自动转提案 |
| `export_report` | 导出审查报告/分析报告/BibTeX/实验记录为 SessionFile 下载卡片 |
| `assess_plan` | 文献对照评估：假设-证据对照表 / 技术路线可行性 / 研究 gap，建议自动转提案 |
| `analyze_metrics` | 指标趋势分析：ZT/PF/电导率等时间序列、文献基准对比、未标注体系清单 |

## 核心机制

- **提案-确认**：AI 可读一切、建议一切，落库前必须经用户确认；拒绝记录（含理由）注入后续 prompt 避免重复提议。
- **乐观锁 + 版本快照**：并发不互相覆盖，保留最近 20 个版本可回退。
- **literature 追加式写入**：多路并发入库不整文件覆盖，按 DOI/标题去重，500 条自动压实。
- **会话绑定 + 节流自动搜集**：绑定会话中检测到研究方向性讨论，10 分钟节流内自动检索文献入库（宿主设置页可关闭）。
- **后台更新**：文献新增 ≥10 篇或 ≥7 天自动刷新分析报告；当日有新实验记录且距上次 ≥24h 自动审查一次。
- **导出双轨**：面板导出（路由 stageFile）或对话中直接说「导出审查报告」等。
- **首屏零 LLM 调用**：分析报告只在用户点击或后台条件满足时生成。

## 开发与构建

```bash
npm install
npm run build:server   # esbuild 打包 src-server/ 到插件根（tools/routes/index，自包含）
npm run build:ui       # Vite 构建前端到 assets/
npm run build          # 两者
npm run typecheck      # TS 检查
node tests/store-proposals.test.mjs   # 数据层 + 提案机制单元测试
```

目录结构：

```
materials-research-copilot/
├── manifest.json          # 能力声明、configSchema、network（含 allowLocalhost）、UI surface
├── src-server/            # Node 侧源码（构建后输出到插件根）
│   ├── index.js           # lifecycle：会话绑定/节流搜集/watch/定时报告与审查/清理
│   ├── tools/*.js         # 6 个对话工具
│   ├── routes/*.js        # ui/api/proposals/export 路由
│   └── server/            # 共享：store（数据层）/literature-client/parsers/llm/proposals/sources
├── ui/                    # React 前端（Panel + 3 面板 + 甘特/日历组件 + 设置抽屉）
├── prompts/               # LLM prompt 模板（含拒绝反馈注入）
├── assets/                # 构建产物（panel.js/panel.css）
└── tests/                 # 数据层单元测试
```

## 数据存储（`ctx.dataDir`）

`binding.json` 会话绑定 · `plan.json` 方案 · `gantt.json` 任务 · `calendar.json` 日程 · `literature.json` 文献库 · `worklog.json` 实验记录 · `reviews.json` 审查报告（只增）· `proposals.json` 待确认提案 · `rejected.json` 拒绝归档 · `updates.json` 水位线 · `settings.json` 文献目录 · `report.json` 分析报告 · `snapshots/` 版本快照

## 宿主设置页配置

| 配置 | 默认 | 说明 |
|---|---|---|
| Zotero 本地 API 端口 | 23119 | 需 Zotero 7+ 且客户端运行；**全文提取/AI 摘要需 Zotero 10+**（fulltext API，2026-08-07 起替代本地 PDF 解析，插件不再内置 PDF 引擎） |
| 自动搜集文献 | 开 | 绑定会话中检测研究方向讨论时自动检索 |
| 新增文献免提案确认 | 开 | 新增直接入库；删除/修改仍需确认 |

## 已知边界

- Zotero 数据只进文献库列表，不进分析报告（数据口径）。
- CAJ 文件仅识别列出并标注「暂不支持解析」。
- 腾讯 ima 知识库按 V4.1 降级方案 C 未接入（宿主无 MCP 桥接 API，开放 API 不稳定）。
- 面板导出依赖宿主注入的会话标识；不可用时降级为对话指令导出。
