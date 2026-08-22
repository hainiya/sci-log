# P1 实现记录：指标时间线面板（ZT / 功率因子趋势）

日期：2026-08-05
目标：补全"材料科研刚需 + 差异化最强"的能力——把历次实验记录里的性能数值（ZT、功率因子、电导率、Seebeck、热导率等）按材料体系分组、按时间排序，绘制趋势曲线，并叠加文献基准与自设目标参考线。

## 一、改动清单（src-server/ + ui/）

### 新增
- `src-server/server/metrics.js`：纯函数提取模块
  - `METRIC_DEFS`：8 个规范指标（ZT / 功率因子 PF / 电导率 σ / Seebeck S / 热导率 κ / 载流子浓度 n / 迁移率 μ / 温度），每项含 `keyRe`（命中字段键）、`valueRe`（全语料兜底，已允许 "ZT of 2.5"、"功率因子 达到 2.0" 等连接词）。
  - `SYSTEM_DEFS`：材料体系识别（SnSe / SnS₂ / SnS / Bi₂Te₃ / PbSe / MnTe / Cu₂Se / Ag₂Se / PEDOT/导电聚合物 / 碳材料 / 无机-有机复合），命中即归类，否则「未标注」。
  - `buildMetricsSeries(entries, literature)`：双策略抽取（① 字段 key 命中 → 从值取数；② 全语料数值正则兜底）→ 按体系分组成时间序列、按时间升序。兼容 `fields` 数组/对象两种形态。
  - `extractLiteratureBaseline(literature)`：仅在 record/peak/最高/创纪录 语境下取最大值作文献基准（保守，避免把正文任意提及当基准）。
  - 测试温度抽取（@823K / 150°C）作为性能上下文附在数据点。
- `ui/components/MetricsChart.tsx`：主题感知 SVG 多序列折线图（体系为序列、文献基准虚线灰、用户目标虚线绿），X 轴按时间、Y 轴按数值，含网格/刻度/点 tooltip，无 emoji。
- `ui/panels/MetricsPanel.tsx`：指标切换 chips / 图表 / 图例（体系色点、最新值、Δ、首值、点数）/ 目标值输入 / 空态引导。
- `tests/metrics.test.mjs`：20 条断言（双策略抽取、体系分组、温度抽取、时间升序、文献基准取最大、fields 形态兼容、空输入）。

### 修改
- `src-server/routes/api.js`：新增 `GET /metrics/series`（调用 buildMetricsSeries）、`POST /settings/metrics`（持久化 `metricTargets` 到 settings）。
- `ui/api.ts`：新增 `getMetrics()`、`saveMetricTargets()`。
- `ui/Panel.tsx`：注册「📈 指标趋势」tab（`metrics`）。
- `ui/panels/WorklogPanel.tsx`：**顺带修复一个已有 bug**——`worklog.fields` 落库为数组 `[{k,v}]`，原 `Object.entries(entry.fields)` 渲染会输出 `[object Object]`；改为先归一化为对象再渲染。
- `ui/panel.css`：新增指标面板样式（复用既有 `.mrc-chip`、主题 CSS 变量，浅色/深色自适应）。

## 二、验证

| 项 | 命令 | 结果 |
|---|---|---|
| 单元 | `node tests/metrics.test.mjs` | 20/20 通过 |
| 类型 | `npm run typecheck` | 仅剩 `@hana/*` 环境性模块解析错误（原 Panel.tsx/api.ts 亦引用，用户 Hana 构建环境可解析）；**我的新增代码无类型错误** |
| UI 编译 | esbuild 打包 `ui/Panel.tsx`（`@hana/*` 外部化） | exit 0，产物含 MetricsPanel / mrc-metrics / 指标趋势 |
| 服务路由 | esbuild 打包 `src-server/routes/api.js` | exit 0 |

> 说明：本环境无法跑通 `npm run build:ui`（vite 解析不到 `@hana` 包，原代码亦如此）与 `npm run build:server`（根 `index.js` 被宿主占用锁写）。请在 Hana dev 环境执行 `npm run build` + `plugin_dev_install(allowFullAccess=true)` 重建生效。

## 三、使用方式
1. 在实验记录「实验数据」里写 `ZT=0.9 @ 823K`、`功率因子=1.2`、`电导率=320` 等，AI 巡检（triage）会自动把参数抽取进 `fields`（数组形态）。
2. 打开「📈 指标趋势」tab：自动按体系分组画趋势；可切换指标、看 Δ、设目标值（持久化）、对照文献基准。

## 四、下一步（未在本次范围）
- `analyze_metrics` 对话工具（让用户在聊天里问"我的 SnSe ZT 趋势如何"），与现有工具范式对齐。
- P1 第二项 `assess-plan-against-literature`：假设-证据对照表 + 研究 gap 陈述（补足"基于文献评估"的针对性）。
- IMA 知识库接入后，文献基准可直接取自你 71 篇柔性热电文献的实测/报告值。
