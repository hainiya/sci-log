# 材料科研副驾改进 v3（E1–E6）实现计划

日期：2026-08-05
依据：`improvement-plan.md`（v3，2026-08-05）+ 源码实测核实
流程：superpowers（brainstorming 范围确认 → 本计划 → 内联执行分两批 + 检查点）

## 现状核实（以源码为准）

- ✅ 已落地：A1–A4、B1–B4、C1–C5、**D1**（collection 同步/分类树/计数/待整理）、**D2**（Semaphore 信号量 + 关键路径 200s 超时 + 重试一次 + 调用点日志）——D2 报告未勾选，实际已实现
- ⬜ 待做：E1–E6（本计划）

## 任务分解

### 批次一（UI 形态 + 摘要 + 全文）

#### ✅ E1. 文献库去功能化：Zotero 能做的交给 Zotero
- [ ] 1.1 LiteraturePanel 删除卡片单条「📋 引文 / BibTeX / 复制 RIS」按钮
- [ ] 1.2 新增「🔗 在 Zotero 中定位」按钮：`zotero://select/library/items/<zoteroKey>`；深链失败（click 无响应）降级显示 zoteroKey 文本
- [ ] 1.3 删除「BibTeX 全库」导出（export.js 确认后移除）；批量 RIS 导出仅限「待整理」分组（非 Zotero 条目）
- [ ] 1.4 卡片形态收敛：collection 树 + 标题/作者/年份/期刊 + 中文摘要 + 定位按钮；全文徽标/AI 徽标保留
- 验收：卡片无单条导出按钮；待整理可批量导出 RIS；定位按钮打开 Zotero 对应条目

#### ✅ E2. 中文 AI 摘要全覆盖（分级标记防幻觉）
- [ ] 2.1 llm.js 新增 `translateAbstract(ctx, text, title)`（英文→中文，材料术语保真）；`abstractSource` 三级：`zotero_original` / `ai_generated`（全文生成）/ `ai_translated`（原文翻译）
- [ ] 2.2 sources.js 增强流程扩展：无摘要→生成；有英文摘要→翻译（复用现有每批 3 篇限流，节流补全 67 条）
- [ ] 2.3 无 PDF 且无摘要条目标记 `abstractSource: "none"` + UI「待补全」
- [ ] 2.4 LiteraturePanel：AI 摘要行带「✨ AI」徽标（ai_generated/ai_translated 区分色），点击展开英文原文对照
- 验收：全部条目有中文摘要且分级标记正确；点击展开原文；「待补全」可见

#### ✅ E3. 保证「AI 能读全文」
- [ ] 3.1 parsers.js `PDF_MAX_CHARS` 60000 → 100000（保综述结论）；每页仍限流
- [ ] 3.2 「🔄 补全全文」手动触发（POST /literature/enhance-pdfs，限流参数放宽 20 篇/批），初始批次同步放宽
- 验收：长文 fullText 含结论段；手动触发一次铺完全库

### 批次二（可靠性 + 性能 + 联动）

#### ✅ E4. 数据可靠性
- [ ] 4.1 删除同步：syncZotero 对比缺失 zoteroKey → 打 `zoteroGone: true`（保留数据不删）；UI 置灰 + 「🗑 清除失效」一键删除
- [ ] 4.2 failed 重试冷却：解析失败记 `failedAt`，targets 过滤 `failedAt < now-24h`；成功/扫描清 failedAt
- [ ] 4.3 自动搜集门槛：extractKeywords 结果与消息标题重合度阈值（≥1 关键词命中标题词才算相关），不过线转提案（proposal）或丢弃
- 验收：Zotero 删除条目 30 分钟内标记 zoteroGone；坏 PDF 24h 不重试；闲聊消息不污染文献库

#### ✅ E5. 数据质量与性能
- [ ] 5.1 citationCount 补全：同步后异步按 DOI 查 OpenAlex `cited_by_count`（节流 5 条/批），写入条目
- [ ] 5.2 fullText 出 state：state 组装时剔除 fullText（保留 fullTextParsed 标记），新增 `GET /literature/fulltext?id=` 按需读取（仅 AI 侧与增强流程使用）
- [ ] 5.3 firstSeenAt：同步首次出现记时间戳；UI「🆕」徽标（7 天内）
- 验收：引用排序对 Zotero 条目有效；UI state 无 fullText 大字段；新条目带「新」徽标

#### ✅ E6. 报告与联动
- [ ] 6.1 报告范围可选：`analyzeLiterature` 入参 scope（all / collection:<key> / recent:N），api.js `POST /report/refresh` 支持 scope，UI 报告区加范围选择
- [ ] 6.2 聚类联动：literature-analysis.md 聚类标题输出为 `【聚类名】` 纯文本（已有），UI 侧将报告聚类行渲染为可点击链接 → 按关键词筛文献
- [ ] 6.3 Collection 建议同联动：点击建议的 collection 名 → 筛选对应文献
- 验收：报告可按 collection/最近 N 篇生成；点击聚类标题筛出对应文献

### 收尾
- [ ] 全量回归：5 套测试 + typecheck + 页面回归（新 UI 元素在位、state 无 fullText、415KB 内联不受影响）
- [ ] 更新 improvement-plan.md 勾选 E1–E6 与 D2；更新计划文档
- [ ] 最终交付总结（安装建议、已知边界更新、E1 后 Zotero 深链实测结果）

## 已知约束（沿用）
- 无 git → 每批前备份到 `docs/superpowers/backups/*.pre-e1e3 / *.pre-e4e6`
- 构建链路：`npm run build:server`（esbuild，unpdf 已打入 bundle）→ `npm run build:ui` → `plugin_dev_install(allowFullAccess=true)`
- 新依赖必须先本地 bundle 验证再进插件（C3 教训）
- Zotero 9.x 只读；深链 `zotero://select/library/items/` 需实测（Windows 偶发 6.0.9 协议注册问题）


