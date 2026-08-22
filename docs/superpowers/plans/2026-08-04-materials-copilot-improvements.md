# 材料科研副驾三期改进实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 依据 `improvement-plan.md`（2026-08-04，v1）实施全部 13 项改进：一期数据底座（A1–A4）、二期分析能力（B1–B4）、三期体验闭环（C1–C5），每期结束设用户确认检查点。

**架构：** 全部改动集中在 `src-server/`（esbuild 打包进插件根目录）与 `ui/`（vite 构建）。服务端零 `@hana` import，只用 ctx 原生对象（resources/network/config/store）。验证链路固定为：`npm run build:server`（+`build:ui`）→ `plugin_dev_install(allowFullAccess=true)` → 宿主 HTTP（`127.0.0.1:32087/api/plugins/materials-research-copilot/...?token=...`）与 node 测试脚本双轨验证。Zotero 实机（9.0.6，本地库 67 条，D:\Zotero\storage 55 目录）作为数据底座验收环境。

**技术栈：** Node ESM + esbuild + Hono（宿主注入）、React + Vite（ui）、pdf-parse（三期 C3 PDF 文本，npm 依赖经 esbuild 打包）、node 原生测试脚本（tests/*.mjs）。

**执行环境关键约束（每任务都适用）：**
- dev install 不带 node_modules → server 端禁止 `@hana/*` import，npm 依赖必须被 esbuild 打进 bundle（`--bundle` 已开启）
- 构建后必须 `plugin_dev_install(allowFullAccess=true)` 同步 dev slot（不带 flag 会降级 restricted）
- 验证以 HTTP 响应内容/状态码为准（插件 route 的 console.log 不进宿主日志）
- 项目无 git 仓库：每个任务完成后把改动前的关键文件快照保留在 `docs/superpowers/backups/`（如无法回退时使用），以验证脚本 + HTTP 断言代替 commit 检查点

---

## 文件结构（锁定分解）

| 文件 | 职责 | 本期改动 |
|---|---|---|
| `src-server/server/sources.js` | 文献源适配器（工作区/Zotero） | A1 全量同步、A3 UA/探测分级、C3 PDF 解析 |
| `src-server/server/store.js` | 数据存储 + 快照/回退 | A4 同步替换（zoteroKey 镜像）、C3 fullTextParsed 字段 |
| `src-server/index.js` | lifecycle：watch/定时器/自动报告/自动审查 | A1 同步定时器、A2 解除口径、B2 注入上次审查、B4 建议指向 worklog |
| `src-server/server/llm.js` | LLM 调用（分析/审查/关键词） | B1 三路采样、B2 时间维度、C1 引导 prompt |
| `src-server/tools/log-work.js` | 实验记录工具 | B3 fields 抽取、B4 citations |
| `src-server/routes/api.js` | 面板数据 API | A3 探测详情、C4 周报聚合、C5 单条导出/批量提案 |
| `src-server/routes/export.js` | 导出 | A4 单条 RIS、C5 单条 BibTeX/GB-T 7714 引文 |
| `prompts/literature-analysis.md` | 分析 prompt | A2 可信度行、C2 Collection 建议 |
| `prompts/plan-reviewer.md` | 审查 prompt | B2 前次问题对照、B3 参数一致性 |
| `ui/panels/LiteraturePanel.tsx` | 文献面板 | A4 只读态、C3 fullText 标记 |
| `ui/panels/ProposalsPanel.tsx` | 提案面板 | C5 批量接受/过期提醒 |
| `ui/settings/SettingsDrawer.tsx` | 设置抽屉 | A3 Zotero 连接状态展示 |
| `ui/panels/PlanPanel.tsx` | 方案面板 | C1 空状态引导 |
| `ui/components/`（新增 `WeekSummary.tsx`） | 周报视图 | C4 |
| `ui/panel.css` | 样式 | A4/C4/C5 增量样式 |
| `tests/*.mjs` | node 验证脚本 | 每任务对应断言 |
| `docs/superpowers/backups/*` | 改动前快照 | 每任务备份被改文件 |

---

# 一期 · 数据底座（A1–A4）

## ✅ 任务 1.1：A1 Zotero 全量同步（fetchZoteroItems 改造）

**文件：** 修改 `src-server/server/sources.js`；测试 `tests/zotero-sync.test.mjs`（新建）

- [ ] **步骤 1：编写测试**（先验证实机 API 返回结构与新字段提取）

```js
// tests/zotero-sync.test.mjs —— 对实机 Zotero（127.0.0.1:23119）做只读断言
// 用法：node tests/zotero-sync.test.mjs
const BASE = "http://127.0.0.1:23119/api/users/0/items";
async function rawFetch(url, ua) {
  const r = await fetch(url, { headers: { "User-Agent": ua } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// 断言1：显式 UA 可拉全量（无 limit），条目数 >= 67
// 断言2：每条含 data.creators / data.abstractNote / data.tags / meta.creatorSummary / meta.parsedDate
// 断言3：attachment 子条目 links.enclosure.href 形如 file:///D:/Zotero/storage/...
// 断言4：无 UA 请求被拒（连接关闭）——验证 UA 防御必要性
```

- [ ] **步骤 2：运行测试确认基线**（预期：断言 4 演示被拒，其余通过/或暴露字段缺失）

运行：`node tests/zotero-sync.test.mjs`

- [ ] **步骤 3：改造 `fetchZoteroItems`**

```js
export async function fetchZoteroItems(ctx, port) {
  // 去掉 limit/sort=dateModified；保留 itemType OR 过滤；单次全量（上限兜底 2000）
  // 每条 entry 新增：
  //   zoteroKey: item.key
  //   authorSummary: meta?.creatorSummary || null
  //   parsedDate: meta?.parsedDate || null
  //   pdfPath: 从该条目 data.children 或独立附件请求中找 links.enclosure（见步骤 4）
  //   readOnly: true（A4 标记，随条目落库）
  // year 优先用 meta.parsedDate?.year 或 data.date 前 4 位
  // 显式 User-Agent: materials-research-copilot/0.1.0；403 时补 zotero-allowed-request: 1 重试
}
```

- [ ] **步骤 4：附件路径获取**（Zotero API 语义：条目不含附件，需按 parentItem 反查）

```js
// 附加请求：GET /api/users/0/items?itemKey=<key>&itemType=attachment
// 或用 format=versions 全量拉一次再对 parentItem 关联
// 从附件条目 data.links.enclosure.href 取 file:/// 路径 → 转 Windows 路径 D:\Zotero\storage\...
// 每 50 条目批处理一次，超时 8000ms，失败仅记 pdfPath=null 不中断同步
```

- [ ] **步骤 5：运行测试验证新字段**

运行：`node tests/zotero-sync.test.mjs`（断言 1–4 全过；本地全量条目数与 Zotero 库一致）

- [ ] **步骤 6：快照备份 + 构建**

运行：`Copy-Item src-server/server/sources.js docs/superpowers/backups/sources-1.0.js`；`npm run build:server`；`plugin_dev_install(allowFullAccess=true)`

## ✅ 任务 1.2：A1 同步水位线 + scanAllSources 接入 + 去重反转

**文件：** 修改 `src-server/server/sources.js`、`src-server/server/store.js`；测试 `tests/zotero-sync.test.mjs`（扩展）

- [ ] **步骤 1：store.js 增加镜像替换能力**

```js
// store.append 保持；新增 store.upsertByKey(collection, keyField, entries)
// 语义：entries 中带 keyField 的按 key 全量替换（删除库中同 key 旧条目再插入，版本 bump 一次）
// 供 Zotero 镜像使用：库中 zoteroKey 条目整体以源为准替换
```

- [ ] **步骤 2：scanAllSources 的 Zotero 分支改用新流程**

```js
// 1) 探测 → 2) 全量拉取（任务 1.1 新函数）→ 3) upsertByKey("literature", "zoteroKey", zoteroEntries)
// 非 Zotero 条目不受影响；sourceStats.zotero 返回镜像后总数
// 4) writeSettings 写 zoteroLastSyncAt = store.now()
```

- [ ] **步骤 3：去重优先级反转**（同一 DOI/标题时 Zotero 优先存活）

```js
// scanAllSources 合并后统一去重：按 (doi 小写 || title 小写) 分组，
// 冲突时优先保留 source==="zotero" 条目（online 让位）
// 工作区条目与 Zotero 冲突也以 Zotero 为准（用户知识库可信度更高）
```

- [ ] **步骤 4：index.js 挂同步定时器**

```js
// _setupWatch 旁新增 _setupZoteroSync()：setInterval 30 分钟，unref
// 每次：scanAllSources 仅执行 Zotero 分支（抽出 syncZotero(ctx, store) 导出函数复用）
// 完成后 bump literature 版本（upsertByKey 内部完成）；日志记录条目数
```

- [ ] **步骤 5：实机验证**：`POST /scan` 触发全量扫描 → `GET /literature` 断言条目数 ≥ 67、含 zoteroKey/readOnly 字段、settings.zoteroLastSyncAt 已更新

## ✅ 任务 1.3：A2 解除 6.4 口径

**文件：** 修改 `src-server/index.js`、`prompts/literature-analysis.md`；测试 `tests/zotero-sync.test.mjs`（扩展断言）

- [ ] **步骤 1：删除 `_maybeAutoReport` 中的 Zotero 过滤**，全部条目进分析；空摘要/无 DOI 的 Zotero 条目在 prompt 侧标注「待补全」

- [ ] **步骤 2：literature-analysis.md 增加可信度行**：分析输出要求含「数据可信度」段落：Zotero 条目占比、DOI 覆盖率、摘要覆盖率；高 Zotero 占比时说明分析基于用户知识库

- [ ] **步骤 3：构建 + 实机验证**：确保文献库含 Zotero 条目后调用分析（`POST /report/refresh` 或触发 `_maybeAutoReport`），断言报告内容包含「数据可信度」且引用了 Zotero 条目标题

## ✅ 任务 1.4：A3 连接健壮性（UA 防御 + 探测分级 + 状态展示）

**文件：** 修改 `src-server/server/sources.js`、`src-server/routes/api.js`、`ui/settings/SettingsDrawer.tsx`、`ui/api.ts`

- [ ] **步骤 1：sources.js `zoteroProbe` 错误分级**

```js
// 返回 { ok: true, total } | { ok: false, code, message }
// code 分级：
//   "zotero_not_running" —— fetch 抛错（ECONNREFUSED 等）：提示「Zotero 未运行，请启动桌面客户端」
//   "api_not_enabled" —— HTTP 403/400 或连接被关闭（UA 已带仍失败）：提示「本地 API 未开启：Zotero → 设置 → 高级 → 允许其他应用与 Zotero 通信，改后需重启 Zotero」
//   "network_error" —— 其他：提示端口/网络异常与排查步骤
// 显式 UA 恒为 materials-research-copilot/0.1.0；403 兜底 zotero-allowed-request: 1
```

- [ ] **步骤 2：api.js `/sources/zotero` 返回分级结果 + 节流缓存**（5 分钟内不重复探测，缓存存 store settings 或模块级变量）

- [ ] **步骤 3：SettingsDrawer 增加 Zotero 连接状态行**：「🟢 已连接（67 条）」「🔴 未连接：<分级提示文案>」+「重试探测」按钮；面板加载时拉取并节流

- [ ] **步骤 4：构建 + 实机验证**：Zotero 运行时显示已连接 + 条数；杀掉 Zotero 进程后重试显示分级提示（验证后恢复）

## ✅ 任务 1.5：A4 Zotero 条目只读镜像

**文件：** 修改 `src-server/routes/api.js`、`ui/panels/LiteraturePanel.tsx`、`src-server/routes/export.js`、`ui/panel.css`

- [ ] **步骤 1：API 层只读**：`POST /literature/delete`、`PUT /literature/:id` 对 `readOnly: true` 条目拒绝（400 + code "readonly_source"），提示「Zotero 镜像条目请到 Zotero 中修改」

- [ ] **步骤 2：LiteraturePanel 只读态**：readOnly 条目行内编辑/删除按钮禁用（灰显 + title 提示）；来源徽标显示「Zotero 镜像」；在线/工作区条目保持编辑权

- [ ] **步骤 3：export.js 单条 RIS**：新增 `POST /export/item-ris`（body: id），输出单条 RIS（Zotero 条目用 zoteroKey 原样数据，字段映射：TY/DO/AU/PY/T1/JO/UR/AB/KW）

- [ ] **步骤 4：UI 增加「导出 RIS」单条按钮**（仅非 readOnly 或 readOnly 均可导出，提示「Zotero 内已有，可跳过」）；复制到剪贴板

- [ ] **步骤 5：实机验证**：文献库 Zotero 条目删除接口返回 400 readonly_source；在线条目正常；单条 RIS 输出合法

## 🔖 一期检查点（用户确认门）

- [x] 重启插件后文献库条目数 = Zotero 全库（67）
- [x] 设置抽屉显示 Zotero 连接状态（实机绿点）
- [x] 分析报告含 Zotero 引用 + 可信度行
- [x] Zotero 条目只读（UI 灰显 + API 400）
- [x] 杀 Zotero 后探测给出分级提示

---

# 二期 · 分析能力（B1–B4）

## ✅ 任务 2.1：B1 三路采样替代 slice 截断

**文件：** 修改 `src-server/server/llm.js`；测试 `tests/llm-sampling.test.mjs`（新建）

- [ ] **步骤 1：新建 `sampleLiterature(entries, planText)` 导出函数**

```js
// 输入全部条目；输出指纹去重后的 ~80 条：
//   路1：按 addedAt/时间 最新 30 条
//   路2：citationCount 降序前 30 条（无计数的条目按 title/abstract 长度近似）
//   路3：与方案关键词（plan 文本分词）相关度最高 20 条（关键词命中 title+abstract+keywords 计数）
// 指纹：doi 小写 || title 小写；去重后补足到 80（按时间兜底填充）
// analyzeLiterature 与 reviewResearch 全部改用 sampleLiterature
```

- [ ] **步骤 2：测试**：构造 120 条假数据（混合新旧/引用数/关键词命中），断言输出 ≤80、含最新与高引与高相关、无重复指纹

- [ ] **步骤 3：构建 + 集成验证**：实机文献库跑一次分析，报告引用老文献（2020 年前）或高引文献

## ✅ 任务 2.2：B2 审查注入时间维度

**文件：** 修改 `src-server/server/llm.js`、`src-server/index.js`、`prompts/plan-reviewer.md`

- [ ] **步骤 1：llm.js `reviewResearch` 增加前次审查注入**：入参 reviews（最近 1 条报告），prompt 增加「前次问题 → 当前状态 → 是否闭环」要求；输出结构含该对照段

- [ ] **步骤 2：plan-reviewer.md 增加输出模板**：`<!--REVIEWS-->` 段后增加「## 上次问题闭环情况」表格（前次问题 | 当前状态 | 闭环与否 | 依据）

- [ ] **步骤 3：index.js `_maybeAutoReview` 传入最近审查**（reviews.entries.at(-1)）

- [ ] **步骤 4：测试**：两次连续审查同一场景，第二次输出含「前次问题」引用；无历史时输出「首次审查」

## ✅ 任务 2.3：B3 结构化实验记录

**文件：** 修改 `src-server/tools/log-work.js`、`prompts/plan-reviewer.md`、`ui/panels/`（实验记录 tab）、`ui/api.ts`

- [ ] **步骤 1：log-work.js `data` 支持 JSON/键值对 + AI 参数抽取**：文本记录时并行调用 LLM 抽参数（≤10 键值，存 `fields: {key: value}`）；显式传入 fields 则跳过抽取

- [ ] **步骤 2：plan-reviewer.md 增加「参数一致性检查」**：同 taskId 多条记录 fields 对比，异常漂移（偏离中位数超阈值）标注

- [ ] **步骤 3：UI 实验记录 tab 展示 fields**：每条记录折叠显示键值对；审查报告渲染参数漂移标红

- [ ] **步骤 4：测试**：构造同 taskId 三条记录（温度 100/120/450），断言审查提示漂移

## ✅ 任务 2.4：B4 文献-实验关联回路

**文件：** 修改 `src-server/tools/log-work.js`、`src-server/server/llm.js`、`prompts/plan-reviewer.md`

- [ ] **步骤 1：log-work.js 增加 `citations: [zoteroKey|id]`**：AI 从文本/上下文建议关联文献（基于文献库标题/DOI 匹配）；无匹配留空数组

- [ ] **步骤 2：llm.js 审查建议可指向 worklog 条目**：suggestion.diff 增加 `worklogId` 可选字段；splitSuggestions 校验放行

- [ ] **步骤 3：测试 + 构建**：log_work 返回 citations；审查建议带 worklogId 时落库成功

## 🔖 二期检查点（用户确认门）

- [x] 分析报告能引用 2020 年前/高引文献
- [x] 连续两次审查，第二次含「前次问题闭环」对照
- [x] 实验记录出现 fields 键值对；同任务参数漂移被标出
- [x] worklog 出现 citations 字段

---

# 三期 · 体验闭环（C1–C5）

## ✅ 任务 3.1：C1 方案引导流

**文件：** 修改 `ui/panels/PlanPanel.tsx`、`src-server/server/llm.js`（新增引导 prompt 函数）、`src-server/routes/api.js`（`/guide/proposal-draft`）、`prompts/`（新增 `proposal-guide.md`）

- [ ] **步骤 1：检测空方案**：`GET /plan` 返回 plan 为空时，PlanPanel 显示「建立研究方案」引导卡片（课题背景 / 要解决的问题 / 手头数据 三个输入框 + 「生成草案」按钮）

- [ ] **步骤 2：llm.js 新增 `draftProposalFromGuide(ctx, {background, problem, data})`**：proposal-guide.md 模板 → 生成研究题目/假设/技术路线/里程碑草案 → 走 createProposal（target: plan, action: update）

- [ ] **步骤 3：确认后触发**：提案确认通过 plan 更新后，自动调用 collect_literature（action: scan, source: all）+ `POST /report/refresh` 一次（防抖：仅方案首次建立时）

- [ ] **步骤 4：验证**：空方案状态下 UI 出现引导卡；生成草案 → 提案确认 → 自动搜集触发（文献库增加）

## ✅ 任务 3.2：C2 Collection 引导

**文件：** 修改 `prompts/literature-analysis.md`、`ui/panels/LiteraturePanel.tsx`

- [ ] **步骤 1：literature-analysis.md 增加主题聚类输出**：报告附「建议在 Zotero 中为以下 N 篇创建 collection」段落（按关键词/主题聚 2–4 类，每类列条目标题）

- [ ] **步骤 2：UI 文献分析报告渲染该段**（标题 + 折叠列表）；collection 存在时（后续 Zotero API 探测）再扩展按 collection 筛选（本期仅提示）

- [ ] **步骤 3：验证**：报告刷新后含聚类建议段

## ✅ 任务 3.3：C3 PDF 全文接入

**文件：** 修改 `src-server/server/sources.js`、`src-server/server/parsers.js`、`src-server/server/llm.js`（摘要补充）、`ui/panels/LiteraturePanel.tsx`；package.json 新增依赖 `pdf-parse`

**前置已验证（2026-08-04）**：宿主 `resource.read` 可读 `D:\Zotero\storage\*\*.pdf`（返回 %PDF-1.5 头，1–4MB）

- [ ] **步骤 1：安装依赖**：`npm i pdf-parse`（esbuild `--bundle` 会打进 server bundle；运行时 Node 内置 fs 可用）

- [ ] **步骤 2：parsers.js 新增 `extractPdfText(buffer, maxChars=60000)`**：pdf-parse 提取纯文本；异常返回 `{ok:false, error}`；扫描版（无文本）返回 `{ok:true, text:""}`

- [ ] **步骤 3：sources.js 同步时接入**：有 pdfPath 的 Zotero 条目读取 PDF → 提取文本 → 截前 60000 字符存 `fullText`（store）→ 标记 `fullTextParsed: true`；空文本标记 `fullTextParsed: "scan"`（需人工补全）；失败不中断同步

- [ ] **步骤 4：摘要补充**：fullTextParsed 且 abstract 为空时，LLM 从 fullText 生成 2–3 句摘要补 `abstract`（标记 `abstractSource: "fulltext"`）；同步回调不阻塞主流程（异步）

- [ ] **步骤 5：UI**：条目详情显示「📄 已解析全文 / 扫描版需人工补全」徽标；abstractSource 为 fulltext 时显示「AI 摘要」

- [ ] **步骤 6：实机验证**：同步后 ≥10 条 Zotero 条目带 fullTextParsed（D:\Zotero 有 55 目录）；PDF 文本长度 >0；扫描版正确标记

## ✅ 任务 3.4：C4 组会周报视图

**文件：** 新建 `ui/components/WeekSummary.tsx`；修改 `src-server/routes/api.js`（`GET /summary/week`）、`ui/panels/SchedulePanel.tsx` 或右栏、`ui/api.ts`、`ui/panel.css`

- [ ] **步骤 1：api.js 聚合端点**：基于现有存储计算本周（周一 00:00 起）：实验记录数（worklog 本周）、文献增量（literature 按 addedAt）、甘特进度变化（updates 水位线对比本周初）、最近审查摘要（reviews 最后一条）；返回结构化 JSON

- [ ] **步骤 2：WeekSummary 卡片**：右栏（甘特/日历下方或独立卡片）显示四行统计 + 最近审查一句话；空数据显示「本周暂无数据」

- [ ] **步骤 3：验证**：端点返回与 updates.json 数据一致；UI 卡片渲染

## ✅ 任务 3.5：C5 导出粒度与提案批量处理

**文件：** 修改 `src-server/routes/export.js`、`src-server/routes/api.js`、`ui/panels/LiteraturePanel.tsx`、`ui/panels/ProposalsPanel.tsx`

- [ ] **步骤 1：单条 GB/T 7714 引文**：`POST /export/item-citation`（body: id）返回 GB/T 7714 格式（著者. 题名[J]. 刊名, 年(期): 页码.）复制按钮

- [ ] **步骤 2：单条 BibTeX**：`POST /export/item-bibtex` 复用现有 BibTeX 生成逻辑单条输出

- [ ] **步骤 3：提案批量接受**：ProposalsPanel 增加「接受全部同类」按钮（同 target+action 分组，批量 baseVersion 校验后逐个 apply）；过期提醒（提案 createdAt > 7 天标「待确认已超 7 天」黄色角标）

- [ ] **步骤 4：验证**：单条引文/BibTeX 输出合法；批量接受一次落库多条并 bump 版本一次

## 🔖 三期检查点（用户确认门）

- [x] 空方案 5 分钟内完成引导 → 草案 → 提案确认 → 自动首轮搜集
- [x] 分析报告含 Collection 建议段
- [x] Zotero PDF 全文条目带摘要/全文标记；扫描版正确标注
- [x] 周报卡片数据与 updates.json 一致
- [x] 单条引文/BibTeX/RIS 可用；提案批量接受与过期提醒生效

---

## 回归清单（每期构建后必须重跑）

1. `npm run typecheck`（tsc --noEmit）通过
2. `node tests/parsers-verify.mjs`、`node tests/store-proposals.test.mjs`、`node tests/v3-proposal-integration.mjs` 全绿
3. 页面 HTML 全内联（412KB 级）仍正常：`GET /page?token=...` 200 且含 panel.css 内联样式
4. 三布局回归：widget 单列（data-surface=widget 规则）、任务清单独立卡片、抽屉不透明（--mrc-bg-solid）
5. 工具层 smoke：`plugin_dev_invoke_tool` 跑 manage_plan read / collect_literature（Zotero 分支）

## 已知边界（保持）

- Zotero 10 升级后本地 API 协议变更（version 语义）→ 同步逻辑需重写增量；本计划不依赖 version
- Zotero 9.x 无写 API → 只读镜像 + 单条 RIS 导出兜底
- 本地 API 无认证 → 只读 + 本机访问
- 全量同步异步执行不阻塞消息流（沿用现有模式）



