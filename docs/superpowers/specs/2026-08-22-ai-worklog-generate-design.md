# AI 主导生成实验记录设计（方案 A：会话内交互确认）

> 日期：2026-08-22
> 插件：materials-research-copilot（Hana 插件）
> 模块：绑定会话 → AI 总结 → 会话内询问 → 用户确认 → 写入 worklog

## 一、目标与背景

当前插件写入实验记录的路径只有「实验记录」面板手动填表。本功能新增一条 **AI 主导 + 用户会话内确认** 的写入路径：

- 在**绑定会话**里，用户消息文本包含关键词「记录」时，AI 把该消息/讨论聚合成一条实验记录草稿。
- **AI 在会话里主动询问用户是否记录**；用户回复确认后才落库到 `worklog`。
- 这样既**不担心重复**（用户亲自判断），又**不影响短时间连录多条**（每条都是独立确认，无时间窗限制）。

## 二、核心决策（已确认）

| 决策点 | 选择 |
|---|---|
| 触发 | 绑定会话内，消息文本含关键词「记录」 |
| 生成主体 | AI（`sampleText` 非流式 LLM 调用） |
| 确认方式 | **会话内交互确认**：AI 发问 → 用户回复确认 → 落库 |
| 落库字段 | 对齐 WorklogPanel 表单 + `aiGenerated: true`/`sourceSession`/`generatedAt` |
| 去重 | **不靠时间窗**；AI 总结草稿 + 用户亲自确认（确认即人工去重） |
| 状态管理 | 插件实例内存持有"待确认草稿"（不持久化，会话重启丢失） |

## 三、交互状态机

```
[空闲] --用户消息含「记录」--> [生成草稿]
   AI summary(sampleText) → 草稿 draft
   AI 发消息问：检测到实验记录，是否记录？（附草稿摘要；回复"记录/好/是"确认）
   → [待确认]

[待确认] --用户回复 确认词(记录/好/是/确认/ok)--> [落库]
   把草稿 append 到 worklog
   发消息：已记录 ✅
   → [空闲]

[待确认] --用户回复 拒绝词(不/不用/不要/算了/取消)--> [丢弃]
   发消息：好的，已取消记录
   → [空闲]

[待确认] --用户回复 其它(非确认非拒绝 且 不再含"记录")--> 维持 [待确认]
   （可选：把该回复追加进草稿重新总结，首版忽略，仅提示"回复 记录 或 不 即可"）

[待确认] --用户回复含新"记录"--> 视为确认（同确认词）
```

**关键冲突处理**：确认消息本身可能含"记录"（如"记录"就是确认）。状态机以**当前是否处于 [待确认]** 为准：
- 处于 [待确认] 时，一切用户消息优先按确认/拒绝解释（含"记录"视为确认）。
- 处于 [空闲] 时，含"记录"的消息才触发新草稿。

## 四、架构与数据流

```
宿主会话用户消息
   └─ ctx.bus event "session_user_message"（绑定会话）
        └─ _onSessionEvent(event, sessionPath)        [src-server/index.js]
             ├─ 若已有待确认草稿：按确认/拒绝处理（见状态机）→ 落库或丢弃
             ├─ 否则(空闲) + 消息含「记录」：
             │     └─ generateDraft(ctx, store, { text, sessionPath })
             │           ├─ readPrompt("worklog-generate.md")
             │           ├─ sampleText → LLM 输出 JSON 草稿
             │           ├─ 解析/校验 → draft
             │           ├─ 存 _pendingDraft = { draft, sessionPath, ts }
             │           └─ sendSessionMessage(ctx, {sessionRef}, {
             │                 role:"assistant",
             │                 text:"检测到实验记录草稿：…\n回复「记录」确认，回复「不」取消。"
             │               })
             └─ 否则：仅原有 Zotero 同步

用户回复确认 → [落库] store.update("worklog", ...) append draft
   fields: { id, sampleId, system, date, content, data, taskId,
             durationHours, startDate, aiGenerated:true, sourceSession, generatedAt }
```

## 五、组件划分

1. **`src-server/server/worklog-gen.js`**（新增）
   - `generateDraft(ctx, { text, sessionPath })`：读 prompt → `sampleText` → 解析成草稿对象。返回 `{ content, sampleId, system, data, taskId, durationHours, startDate }` 或 `null`。
   - `commitDraft(ctx, store, draft, { sessionPath })`：`store.update("worklog", ...)` append 一条，附加 `aiGenerated`/`sourceSession`/`generatedAt`。
   - `parseDraft(raw)`（可导出纯函数）：LLM 输出 → JSON → 清洗/校验，便于单测。

2. **`prompts/worklog-generate.md`**（新增）
   - system prompt：从会话消息提取一条实验记录，输出严格 JSON：
     `{ "content": string, "sampleId": string|null, "system": string|null, "data": string|null, "taskId": string|null, "durationHours": number|null, "startDate": "YYYY-MM-DD"|null }`
   - `content` 必填、简明（≤300 字）；无法确定的字段给 null。

3. **`src-server/index.js`**（改 `_onSessionEvent`）
   - 新增实例字段 `_pendingDraft = null`（`{ draft, sessionPath, ts }`）。
   - 事件内：先判 `_pendingDraft`（确认/拒绝），再判空闲触发（含「记录」）。
   - 复用 `sendSessionMessage`（@hana/plugin-runtime）往会话发询问/结果消息。
   - 失败仅 `ctx.log.warn`，不阻塞消息流。

4. **依赖注入**
   - `sampleText`/`readPrompt` 复用 `llm.js`；`sendSessionMessage` 从 `@hana/plugin-runtime` import；`store` 由载体传递。

## 六、确认词与拒绝词（首版内建，可后续配置）

- 确认词：`记录`、`好`、`是`、`确认`、`ok`（含中英文，忽略大小写/空白）。
- 拒绝词：`不`、`不用`、`不要`、`算了`、`取消`、`no`。
- 首版不区分大小写、用 startsWith/包含匹配；确认词优先于拒绝词（`记录` 既非拒绝也非歧义）。

## 七、错误处理

- `generateDraft` 失败（LLM 错误/非 JSON/空输出）：不设 `_pendingDraft`，仅 log；用户再发「记录」可重试。
- `sendSessionMessage` 失败：log；草稿保留在 `_pendingDraft`，用户下次回复仍可确认。
- `commitDraft` 失败（store 冲突等）：log，清 `_pendingDraft`，发消息告知失败。
- 断线/重启：`_pendingDraft` 内存态丢失（不持久化），属可接受（用户重新触发即可）。

## 八、测试

- 本机无法真调 LLM/宿主，故：
  - `node --check` 校验新增/改动文件语法。
  - `parseDraft` 为纯函数，可用 node 单测（喂 LLM 样本 JSON → 断言清洗结果）。
  - 静态核对：`generateDraft`/`commitDraft` 被 import；prompt 被 `readPrompt` 读到；`sendSessionMessage` 导入存在。
- 端到端（宿主内）：绑定会话发含「记录」消息 → 看 AI 询问 → 回复「记录」→ 检查 worklog 落库）待宿主侧验证。

## 九、配置（manifest）

- 新增配置项 `aiWorklogGen`（boolean，默认 true，标题"会话消息含『记录』时 AI 生成实验记录（需回复确认）"）。
- 独立于 `autoTriage` 巡检开关。

## 十、范围与取舍

- 不做：把确认回复并入草稿重总结（首版仅提示确认/拒绝）、多会话并发草稿（同一时刻仅一个 `_pendingDraft`）、草稿持久化。
- 可后续扩展：trigger 词配置、确认/拒绝词配置、多轮补全草稿。

## 十一、超出范围

- 不改变现有手动录入路径与面板。
- 不改变 worklog 现有数据结构（仅新增 `aiGenerated`/`sourceSession`/`generatedAt` 字段）。
- 不引入第三方依赖。
