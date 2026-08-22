# 文献分析范围控制 + 检索约束 设计文档

日期：2026-08-06
状态：已批准（用户确认）
范围：materials-research-copilot v0.1.0

## 背景

用户反馈两个问题：

1. **分析范围不可控**：文献分析报告默认基于全库（145 篇）生成，用户研究方向较窄，不需要分析那么多文献。后端 `/report/refresh` 虽已支持按 Zotero 分类（collection）筛选，但 UI 只暴露了「全库 / 最近 10/20/50 篇」，分类入口缺失。
2. **检索无约束、不可追溯**：`collect_literature` 无时间限制，检索词可留空（由 AI 从上下文猜测），用户不知道收进来的文献是哪个方向的。三个检索源（Semantic Scholar / arXiv / Crossref）底层都支持年份过滤，但未接线。

## 设计决策（用户逐项确认）

- **时间窗口形式**：C. 默认 + 可覆盖。settings 配置默认窗口（近 N 年，N 默认 5），手动检索可传 `fromYear`/`toYear` 覆盖。
- **关键词机制**：A. 强制 + 记录。手动检索不填检索词报错（AI 不许猜）；自动搜集从会话消息提取关键词；关键词与时间窗口随条目入库并在 UI 展示。
- **分析范围交互**：A. 下拉加分类。报告范围下拉变为「全库 / 最近 N 篇 / 各分类（带篇数）」，单选。

## 变更明细

### ① 检索约束

**工具参数（src-server/tools/collect-literature.js）**

- `query` 改为必填：为空返回 `{ error: "missing_query" }`（含提示文案「请提供检索关键词」）。删除现有 `useAutoKeywords` 从 `_contextText` 提取关键词的兜底逻辑（AI 不许自行猜测检索方向）。
- 新增可选参数 `fromYear` / `toYear`：4 位数字，`from ≤ to`，`to` 不超过当前年；校验失败返回参数错误。不传时用默认窗口。

**默认窗口（settings）**

- settings 新增字段 `searchYearWindow`（默认 5），窗口 = `[当前年 - N, 当前年]`，滚动窗口（随时间自动前移）。
- 校验：`1 ≤ searchYearWindow ≤ 30`，越界回退默认 5。
- 设置抽屉（SettingsDrawer.tsx）新增「检索年份窗口（近 N 年）」数字输入，走现有 settings 读写端点（`readSettings`/`writeSettings`）。

**检索源改造（src-server/server/literature-client.js）**

- `searchSemanticScholar(query, limit, yearRange)`：URL 追加 `&year=${from}-${to}`（Graph API 原生支持）。
- `searchArxiv(query, limit, yearRange)`：search_query 追加 `AND submittedDate:[${from}01010000 TO ${to}12312359]`。
- `searchCrossref(query, limit, yearRange)`：追加 `filter=from-pub-date:${from}-01-01,until-pub-date:${to}-12-31`。
- `searchAll(query, limit, signal, yearRange)`：透传给三个源。
- yearRange 为 null/undefined 时保持现状（不追加过滤），向后兼容。

**入库元数据**

- 在线检索入库条目新增 `collectedWith: { query, fromYear, toYear, sourceApi }`（sourceApi 取该条目实际来源，query/fromYear/toYear 为本次检索的统一参数）。
- 旧条目无此字段，不做迁移；UI 需兼容缺省。

**UI 文献卡片（ui/panels/LiteraturePanel.tsx + panel.css）**

- 来源标签扩展：有 `collectedWith` 的在线条目显示 `在线 · ${fromYear}-${toYear}`（如「在线 · 21-26」），title 属性展示完整检索词与窗口；无 `collectedWith` 的旧条目保持「在线检索」。
- 标签配色沿用现有 `.src-online` 样式，不新增色系。

**工具返回文本**

- collect_literature 返回文本追加一行检索参数说明：`检索参数：关键词「${query}」，时间 ${fromYear}-${toYear}`。

**自动搜集（lifecycle 会话消息触发）**

- 复用同一约束：提取关键词 → 套默认窗口（或 settings 配置）检索 → 条目带 `collectedWith` 入库。
- 实现细节（调 collect_literature.execute 还是内部函数直调）在实现计划阶段按代码现状确定，行为与手动检索一致。

### ② 分析范围（UI 入口）

**ui/panels/LiteraturePanel.tsx**

- 报告范围下拉选项变为：`全库 / 最近 10 篇 / 最近 20 篇 / 最近 50 篇 / ── 按分类 ── / 各 Zotero 分类（带篇数）`。
- 分类列表来自 `state.collections.collections`（已有 collectionMap 可用）；篇数由前端 `entries.filter(e => (e.collectionKeys || []).includes(key)).length` 计算。
- 选中分类 → `scope = { type: 'collection', key, label }` → `api.refreshReport(scope)`（api.ts 无需改动）。
- 报告开头已有 `> 分析范围：collection「xx」N 篇` 注记，无需后端改动。

### ③ 错误处理

| 场景 | 行为 |
| --- | --- |
| query 为空 | `missing_query`，提示提供检索关键词 |
| fromYear/toYear 非 4 位数字 | 参数错误，拒绝执行 |
| from > to | 参数错误，拒绝执行 |
| to > 当前年 | 参数错误，拒绝执行 |
| searchYearWindow 越界（<1 或 >30） | 回退默认 5 |
| 检索源无 yearRange | 保持现状不追加过滤 |

### ④ 测试

- 无 query 调用 collect_literature → 报错 missing_query。
- 带 query + fromYear/toYear → 返回条目年份抽样验证全部落在窗口内（含 S2/arXiv/Crossref 三源）。
- 只带 query → 默认窗口生效（当前年-N ~ 当前年）。
- 自动搜集路径：会话消息触发 → 条目带 collectedWith、卡片角标正确。
- 分类分析：UI 选分类 → 报告开头显示 collection 范围注记。
- 回归：7 工具冒烟 + 报告刷新 + 提案链路。

## 不做的事（YAGNI）

- 多选分类分析（并集）——用户未要求，以后需要再加。
- 分类 + 年份组合筛选分析——同上。
- 旧条目 collectedWith 回溯迁移——无必要，旧条目角标退化显示「在线检索」即可。
- 检索词历史/常用词管理——超范围。

## 数据兼容

- literature 条目：新增可选字段 collectedWith，旧条目不受影响。
- settings：新增可选字段 searchYearWindow，缺失时按默认 5 处理。
- 报告存储结构不变。
