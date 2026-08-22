# 科研工作（实验记录中心 / Materials Research Copilot）

面向材料专业硕士生的 AI 科研辅助插件：**实验记录中心 + 甘特图/日历 + 指标趋势 + 文献库（Zotero 收纳）**。

插件 ID：`materials-research-copilot`，类型：`full`（工具 + lifecycle + 面板 UI）。

> 实验记录中心化改造（2026-08-22）后：**移除**研究方案、提案确认、在线检索、文献分析报告；
> 保留实验记录为数据主线、甘特图/日历为可视化核心、指标趋势与 Zotero 文献收纳为辅助；
> 所有 AI 写操作**直接生效**（不再生成待确认提案）。

## 功能总览

| 模块 | 位置 | 说明 |
|---|---|---|
| 日程 / 甘特图 | 默认首页 | 可视化实验过程与实验计划：SVG 拖拽改期、任务清单、日历、实际时间线投影 |
| 实验记录 | 主 Tab | 时间线记录 + AI 巡检（参数结构化/文献关联/甘特进度/日程/时长），直接写库 |
| 指标趋势 | Tab | 从实验记录 fields 提取性能参数序列（ZT/PF/σ/S/κ/n/μ），文献基准对比 |
| 文献库 | Tab | Zotero 本地扫描收纳，动作自动日志化到实验记录，AI 摘要/翻译/关键词 |
| 设置抽屉 | 右上角 | Zotero 连接 / 会话绑定 / 检索窗口 / AI 巡检开关 |

## 对话工具（4 个）

| 工具 | 用途 |
|---|---|
| `manage_schedule` | 甘特任务 / 日历日程增删改（直接写库） |
| `collect_literature` | Zotero 本地扫描收纳入库（动作日志化到实验记录） |
| `log_work` | 记录实验：写入实验记录 + AI 巡检补全进度/日程 + 下一步建议 |
| `export_report` | 导出实验记录为 Markdown 下载卡片 |
| `analyze_metrics` | 指标趋势查询（只读） |

（`manage_plan` / `assess_plan` / `review_research` 已随研究方案与提案移除。）

## 核心机制

- **AI 写即生效**：AI 的任何修改直接落库（乐观锁 version 防并发覆盖），不再有提案-确认环节。
- **文献动作日志化**：Zotero 同步/扫描检测到新收录时，自动向实验记录写入一条「# 文献收纳」记录（幂等去重）。
- **乐观锁 + 版本快照**：并发不互相覆盖，保留最近 20 个版本可回退。
- **会话绑定 + 节流同步**：绑定会话中检测到用户消息，10 分钟节流内自动同步 Zotero 本地库（宿主设置页可关闭）。
- **后台更新**：Zotero 30 分钟定时全量镜像；文献新增自动触发摘要/关键词增强链路。
- **导出**：面板/对话导出实验记录为 SessionFile 下载卡片。

## 开发与构建

```bash
npm install
npm run build:server   # esbuild 打包 src-server/ 到插件根（tools/routes/index，自包含）
npm run build:ui       # Vite 构建前端到 assets/
npm run build          # 两者
npm run typecheck      # TS 检查
node tests/literature-log.test.mjs    # 文献日志化单元测试
```

目录结构：

```
materials-research-copilot/
├── manifest.json          # 能力声明、configSchema、network（含 allowLocalhost）、UI surface
├── src-server/            # Node 侧源码（构建后输出到插件根）
│   ├── index.js           # lifecycle：会话绑定/节流同步 Zotero/定时镜像
│   ├── tools/*.js         # 4 个对话工具 + analyze_metrics
│   ├── routes/*.js        # ui/api/export 路由
│   └── server/            # 共享：store（数据层）/literature-log/sources/llm/parsers/metrics/triage
├── ui/                    # React 前端（Panel + 面板 + 甘特/日历/指标组件 + 设置抽屉）
├── prompts/               # LLM prompt 模板（keyword/next-step/worklog-triage）
├── assets/                # 构建产物（panel.js/panel.css）
└── tests/                 # 单元测试
```

## 数据存储（`ctx.dataDir`）

`binding.json` 会话绑定 · `gantt.json` 任务 · `calendar.json` 日程 · `worklog.json` 实验记录 · `literature.json` 文献库 · `updates.json` 水位线 · `settings.json` 配置 · `collections.json` Zotero 分类 · `snapshots/` 版本快照

## 宿主设置页配置

| 配置 | 默认 | 说明 |
|---|---|---|
| Zotero 本地 API 端口 | 23119 | 需 Zotero 7+ 且客户端运行；全文提取/AI 摘要需 Zotero 10+ |
| 绑定会话后自动同步 Zotero | 开 | 绑定会话中检测用户消息时自动同步本地库 |
| 新增文献直接入库 | 开 | 同步/扫描新增文献直接入库；删除与修改受只读镜像保护 |
| 实验记录自动巡检 | 开 | 每次写入后自动 AI 巡检（参数结构化/文献关联/甘特进度/日程/时长），直接写库 |

## 已知边界

- 文献来源仅 Zotero 本地库（在线检索已移除）。
- CAJ 文件仅识别并标注「暂不支持解析」。
- 面板导出依赖宿主注入的会话标识；不可用时降级为对话指令导出。
