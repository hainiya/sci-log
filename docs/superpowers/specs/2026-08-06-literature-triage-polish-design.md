# 规格：文献体验打磨 + 巡检开关 + 文案澄清（2026-08-06）

状态：已批准（brainstorming 五节全确认）

## 背景

用户对插件提出 5 项改进，来源为使用体验反馈：

1. 网络搜集的「待整理」文献无法移除，越积越多；且不确定「放入 Zotero 后是否仍显示未整理」（既有去重为 DOI/标题指纹替换，依赖扫描与指纹匹配，可能残留）
2. 「补全全文」按钮名不副实——功能是 AI 摘要增强，不提供全文阅读
3. 「扫描文献」按钮在顶层界面，应属于文献库
4. AI 提案触发频率不可见、不可控（现状：每次实验记录写入后立即增量巡检，无设置）
5. 「开始日期」与记录日期语义混淆

## 目标

- 摘要/关键词默认自动铺完，让每篇文献「知道是干什么的」
- 待整理可移除（单条 + 清空），用户掌控库内容
- 扫描入口归位文献库
- AI 巡检可开关（默认开，手动始终可用）
- 开始日期语义明确

## 1. AI 摘要 + 关键词（节 1）

### 数据模型

文献条目（literature.json entries）新增：

- `keywords: string[] | null` — AI 提取的中文关键词 3-5 个；null = 未提取
- `keywordsSource: 'ai' | null` — 标记关键词来源；null = 无

既有字段 `abstract/abstractEn/abstractSource/fullTextParsed` 不变。

### 自动链路（增强任务扩展）

现有 `enhanceZoteroPdfs`（E3）扩展为通用增强任务（摘要 + 关键词），行为变化：

- **覆盖对象扩展**：除既有的 Zotero 摘要/PDF 目标外，增加「缺关键词」目标——`keywords == null` 且有条目可提取来源（`abstract` 非空，或全文可用）的所有条目（含在线条目）
- **逐批铺完**：每轮批 8 篇（batchLimit）、LLM 3 篇（llmLimit），循环执行直到「无目标」或「本轮零进展」（防 LLM 失败死循环）；一次调用只处理一批，由调用方循环调度
- **调度**：启动时首轮 + 每 30 分钟 Zotero 同步后各调度一轮；每轮结束后若仍有目标，继续下一轮（后台循环，不阻塞消息流）
- **关键词生成**：LLM 从摘要（abstract/abstractEn）或全文提取 3-5 个中文关键词；无任何来源（非 Zotero 且无摘要）的条目跳过（不生成）
- 摘要生成/翻译链路保持现状（仅 Zotero 条目，PDF 来源或英文摘要翻译）

### 手动按钮

- 「🔄 补全全文」改名为「✨ AI 摘要」，**常驻显示**（不再按条件隐藏）
- title：「生成/翻译摘要 + 提取关键词（解析 PDF）」
- 点击行为：立即调度一轮增强（等价于启动新一轮循环），busy 期间禁用显示「补全中…」

### 面板展示

摘要块下方新增关键词行（AI 生成时带 ✨）：

```
关键词：Cu掺杂 · 区熔法 · 热电性能
```

- `keywords` 非空时显示，空数组/不显示
- 无摘要但有关键词的条目照常显示关键词行（摘要块逻辑不变）

## 2. 待整理移除（节 2）

- 移除按钮**仅对 `source !== 'zotero'` 条目**显示（Zotero 镜像只读）
- **单条**：卡片操作区「✕ 移除」→ 行内两段式确认（「确认移除 / 取消」，与清除失效 purgeGone 交互一致）；确认后删除该条目并刷新
- **批量**：待整理分组（filter === 'to-organize'）工具行加「🗑 清空待整理（N）」→ 行内两段式确认；确认后删除全部非 Zotero 条目
- **API**：新增 `DELETE /literature`，body `{ ids?: string[] }` 或 `{ all: true }`（all 仅删非 Zotero 条目）；直接删除文献库条目（用户操作，不走提案），返回 `{ ok, removed: number }`
- **无黑名单**：删除后再次在线检索命中会重新入库（不做忽略列表，YAGNI）
- 校验：ids 为空数组返回 0；不存在 id 忽略；镜像 id（source === 'zotero'）拒绝删除

## 3. 扫描按钮搬家（节 3）

- 顶层（Panel.tsx）「🔄 扫描文献」按钮及其 scanning 状态移除
- 文献库面板（LiteraturePanel）头部按钮区新增「🔄 扫描」：busy 显示「⏳ 扫描中…」，成功 toast 提示新增/更新数量，失败 toast 错误
- 复用既有 `POST /scan` 端点与 `api.scan()`，行为不变

## 4. 巡检开关（节 4）

- **设置项**：`autoTriage`（布尔，默认 `true`）——「实验记录自动巡检：每次记录写入后自动 AI 巡检（生成提案）」
- 存储：settings.json（既有 `readSettings/writeSettings` 通道）；UI 设置面板（SettingsDrawer）新增开关
- 生效点（两处）：
  - 面板写入路径：routes/api.js 写入 worklog 成功后的 fire-and-forget 巡检前检查 `autoTriage === false` 则跳过
  - 工具路径：log-work.js 内联巡检前检查（读 config）
- **手动始终可用**：`POST /worklog/triage`（force）不受开关限制
- 开关仅控制「写入后自动巡检」，不影响 30/60 分钟定时器（报告/审查/同步，不产提案，不在本开关范围）

## 5. 开始日期文案（节 5）

- WorklogPanel 表单 label：「开始日期（可选）」→「实验开始日期（可选）」
- 表单内新增一行小字 hint：「决定甘特图实际条起点；留空则从记录日期开始」
- 编辑弹窗同步改 label（hint 可省略，与新建一致更佳——统一加）

## 影响文件

| 文件 | 改动 |
|---|---|
| `src-server/server/sources.js` | 增强任务扩展（关键词目标 + 逐批循环调度 + 关键词提取） |
| `src-server/server/llm.js` | 关键词提取 prompt + 解析 |
| `src-server/routes/api.js` | `DELETE /literature` 端点 + 巡检开关检查（写入路径） |
| `src-server/tools/log-work.js` | 巡检开关检查（工具路径） |
| `src-server/routes/settings.js`（或 settings 所在文件） | autoTriage 设置项读写 |
| `ui/panels/LiteraturePanel.tsx` | 按钮改名/常驻/关键词行/移除单条/清空/扫描按钮迁入 |
| `ui/Panel.tsx` | 顶层扫描按钮移除 |
| `ui/settings/SettingsDrawer.tsx` | 巡检开关 |
| `ui/panels/WorklogPanel.tsx` | label + hint |
| `ui/api.ts`（面板 API 模块） | 新端点调用 + 设置项类型 |

## 测试与验收

1. **关键词链路**（工具/服务层模拟）：mock LLM 返回关键词 → 增强任务为目标条目写入 `keywords`/`keywordsSource`；无来源条目跳过；批处理循环直到清空（模拟 20 篇缺失 → 3 轮循环，LLM 调用次数 = 3×3）
2. **移除 API**：单条删除 → 条目消失、计数 -1；清空 → 全部非 Zotero 条目消失、Zotero 镜像不动；镜像 id 拒绝
3. **巡检开关**：关闭后写入 worklog → 无巡检 LLM 调用（mock 计数 0）；force 端点 → 仍触发；开启恢复自动
4. **UI 静态/浏览器**：顶层无扫描按钮；文献库有；按钮文案「✨ AI 摘要」常驻；关键词行渲染；待整理卡片有「✕ 移除」、分组有「🗑 清空待整理」；设置面板有「实验记录自动巡检」开关；表单 label/hint 文本
5. **回归**：tsc 0 错误；build:server + build:ui 成功；既有 7 项功能（检索约束/分析范围/方案演进/时长甘特等）不受影响——项目回归基线（test-log.md 记录项）

## 范围外（YAGNI）

- 关键词导出（BibTeX/RIS 的 KW 字段）——后续需要再做
- 移除黑名单/忽略列表
- 摘要的批量手动重试单条级（整轮重试已够）
- autoTriage 对报告/审查定时器的影响（不产提案，不纳入）
- 在线条目的摘要生成（无 PDF 来源，只用 API 自带摘要；不生成）
- 关键词语言选项（固定中文）
