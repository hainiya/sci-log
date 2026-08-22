# AI 主导生成实验记录设计

> 日期：2026-08-22
> 插件：materials-research-copilot（Hana 插件）
> 模块：绑定会话 → AI 生成实验记录 → 写入 worklog

## 一、目标与背景

当前插件是"实验记录中心"。写入实验记录的唯一路径是用户在「实验记录」面板**手动填表单**。本功能新增一条**AI 主导**的写入路径：

- 在**绑定会话**里，用户消息文本包含**关键词「记录」**时，AI 自动把该消息/讨论聚合成一条实验记录，写入 `worklog`。
- 生成的记录**用户可在面板随时修改/删除**（沿用现有 WorklogPanel 的编辑/删除能力）。
- 这是对"记录实验"的高频路径的补充，让用户不离开会话就能沉淀实验记录。

## 二、核心决策（已确认/采用的可逆默认）

| 决策点 | 选择 | 理由 / 可逆性 |
|---|---|---|
| 触发 | 绑定会话内，消息文本含关键词「记录」 | 用户明确指定；误触发面小 |
| 生成主体 | AI（`sampleText` 非流式 LLM 调用） | 符合"AI 主导" |
| 落库方式 | **直接落库** + 标记 `aiGenerated: true` | 用户可随时改/删；字段可逆 |
| 去重 | 同会话时间窗限频（默认 15 分钟 1 次） | 简单可靠，不额外耗 LLM |
| 生成范围 | 取含「记录」的这条消息 | 最直接，可后续扩展 |

## 三、架构与数据流

```
宿主会话用户消息
   └─ ctx.bus event "session_user_message"（绑定会话）
        └─ _onSessionEvent(event, sessionPath)        [src-server/index.js]
             ├─ 消息文本含「记录」？  ──否──> 仅原有 Zotero 同步
             └─ 是
                  ├─ 限频通过？（同会话 15 分钟窗口）
                  └─ 是
                       └─ generateWorklogFromText(ctx, store, { text, sessionPath })
                            ├─ readPrompt("worklog-generate.md")           [prompts/]
                            ├─ sampleText(ctx, { callPoint:"generateWorklog", ... })
                            │      → LLM 输出 JSON { content, sampleId, system,
                            │          data, taskId, durationHours, startDate }
                            ├─ 解析/校验（防御非 JSON）
                            └─ store.update("worklog", ...) 追加一条
                                 fields: { id, sampleId, system, date, content, data,
                                           taskId, durationHours, startDate,
                                           aiGenerated: true, sourceSession, generatedAt }
```

## 四、组件划分

1. **`src-server/server/worklog-gen.js`**（新增）
   - `export async function generateWorklogFromText(ctx, store, { text, sessionPath })`
   - 职责：读 prompt → 调 `sampleText` → 解析 JSON → `store.update("worklog")` 追加。
   - 返回 `{ ok: true/false, id?, reason? }`。
   - 只在生成的记录上附加 `aiGenerated`/`sourceSession`/`generatedAt`。

2. **`prompts/worklog-generate.md`**（新增）
   - system prompt：从给定会话消息提取一条实验记录。
   - 输出严格 JSON，字段对齐 WorklogPanel 表单：
     `{ "content": string, "sampleId": string|null, "system": string|null, "data": string|null, "taskId": string|null, "durationHours": number|null, "startDate": "YYYY-MM-DD"|null }`
   - 约束：`content` 必填、简明（≤300 字）；无法确定的字段给 null。

3. **`src-server/index.js`**（改 `_onSessionEvent`）
   - 现有逻辑保留（Zotero 同步）。
   - 新增：消息含「记录」且限频通过 → 调 `generateWorklogFromText`（fire-and-forget，失败仅 log）。

4. **`src-server/server/worklog-gen.js` 依赖注入**
   - `sampleText`、`readPrompt`、`store`、`localTodayStr` 均已有/复用 llm.js 既有实现，不重复定义。

## 五、限频与去重

- 插件级状态字段：`_state.lastAiWorklogAt`、`_state.lastAiWorklogSession`（仅在 index.js 实例内存，不持久化）。
- 判定：`now - lastAiWorklogAt < WINDOW_MS`（默认 15min）且同会话 → 跳过。
- 失败（LLM 错误/空输出）不推进水位线，用户再发「记录」可重试。

## 六、错误处理

- `generateWorklogFromText` 内部 try/catch：LLM 失败、非 JSON、`store.update` 冲突 → 记录 `ctx.log.warn` 并返回 `{ ok: false, reason }`。
- 不阻塞消息流（fire-and-forget），单条失败不影响插件与其它功能。
- `readPrompt` 缺 prompt 文件时返回空串 → 视为不可用，跳过生成。

## 七、测试

- 无法在本机真实调 LLM（需宿主 `@hana/plugin-runtime` 的 `sampleText`），故：
  - `node --check` 校验新增/改动文件语法。
  - 静态核对：新增文件被 `src-server/index.js` import；prompt 文件被 `readPrompt` 读取。
  - 构造 `generateWorklogFromText` 的纯解析部分（LLM 输出→JSON→清洗）为可导出纯函数，便于后续单测。
- 在宿主内实际触发（绑定会话发含「记录」消息）验证端到端。

## 八、配置（manifest）

- 新增配置项 `aiWorklogGen`（boolean，默认 true，标题"会话消息含『记录』时 AI 生成实验记录"）。
- autoTriage 无关，本功能独立于巡检开关。

## 九、范围与取舍

- 不做：聚合多条消息、AI 相似性去重（首版仅限频）、级联触发 `triageWorklog` 二次巡检（避免重复巡检）。
- 可后续扩展：trigger 词更灵活、生成质量提升、草稿确认流。

## 十、超出范围

- 不改变现有手动录入路径。
- 不改变 worklog 现有数据结构（仅新增可选字段）。
- 不引入第三方依赖。
