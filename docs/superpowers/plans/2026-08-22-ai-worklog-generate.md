# AI 主导生成实验记录 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在绑定会话里，用户消息含关键词「记录」时，AI 用 `sampleText` 总结成一条实验记录草稿，通过 `sendSessionMessage` 在会话里询问用户是否记录；用户回复「记录/好/是/确认」确认后落库到 `worklog`，回复「不/不用/不要/算了/取消」则丢弃。

**架构：** 新增 `worklog-gen.js` 承载草稿生成与落库（含可测纯函数 `parseDraft`）；新增 `prompts/worklog-generate.md`；改造 `src-server/index.js` 的 `_onSessionEvent` 实现「空闲→草稿→待确认→落库/丢弃」状态机；`manifest.json` 加 `aiWorklogGen` 开关；重新 build 生成插件根产物。

**技术栈：** Hana 插件（`@hana/plugin-runtime` 的 `sampleText`/`sendSessionMessage`）、现有 `store`、`prompts/` 目录、node --check + node --test。

**spec：** `docs/superpowers/specs/2026-08-22-ai-worklog-generate-design.md`

---

### 任务 1：新增 `prompts/worklog-generate.md`

**文件：**
- 创建：`prompts/worklog-generate.md`

- [ ] **步骤 1：编写 prompt 文件**

```markdown
你是实验记录整理器。从下面给定的一段会话消息/讨论里，提取一条结构化实验记录。

要求：
- content：必填，用第一人称简明概括本次实验做了什么、得到什么（≤300 字），去掉寒暄和无关对话。
- sampleId：能确定样品编号就填字符串，否则 null。
- system：能判断材料体系（如 SnSe、SnS₂、Bi₂Te₃、碳材料、无机/有机复合）就填标准名，否则 null。
- data：若有结构化参数/数据（温度、压力、氛围、ZT、Seebeck 等），按"参数: 值"每行一条，否则 null。
- taskId：若关联到已有甘特任务，填任务 id（见下文任务列表），否则 null。
- durationHours：本次实验时长的数字（小时），无法确定填 null。
- startDate：实验开始日期 YYYY-MM-DD，无法确定填 null。

只能输出一个 JSON 对象，不要任何额外文字。字段固定，缺的给 null：
{"content":"","sampleId":null,"system":null,"data":null,"taskId":null,"durationHours":null,"startDate":null}

下面是要整理的消息：
{{MESSAGE}}
```

> 说明：`{{MESSAGE}}` 由 `generateDraft` 在调用前替换为用户消息文本。任务列表信息由 `generateDraft` 拼到 user 消息里（可选），prompt 词面兼容。

- [ ] **步骤 2：验证文件存在且可被加载**

运行：`test -f prompts/worklog-generate.md && echo OK`
预期：`OK`

- [ ] **步骤 3：Commit**

```bash
git add prompts/worklog-generate.md
git commit -m "feat(worklog-gen): add LLM prompt for AI worklog draft"
```

---

### 任务 2：实现 `worklog-gen.js`（含可测纯函数 `parseDraft`）

**文件：**
- 创建：`src-server/server/worklog-gen.js`
- 测试：`tests/worklog-gen.test.mjs`

**职责：**
- `parseDraft(rawText)` —— 纯函数：LLM 输出字符串 → 清洗/校验 → 草稿对象（可测）。
- `generateDraft(ctx, { text, taskList })` —— 读 prompt → `sampleText` → `parseDraft` → 草稿或 `null`。
- `commitDraft(ctx, store, draft, { sessionPath })` —— `store.update("worklog")` 追加，附 `aiGenerated/sourceSession/generatedAt`。

- [ ] **步骤 1：编写失败的测试 `parseDraft`**

```javascript
// tests/worklog-gen.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft } from "../src-server/server/worklog-gen.js";

test("parseDraft: 合法 JSON 输出被解析为草稿", () => {
  const raw = '{"content":"做了旋涂，得到PEDOT薄膜","sampleId":"PEDOT-01","system":"PEDOT/导电聚合物","data":"温度: 60\\n旋涂转速: 3000","taskId":"t_1","durationHours":2.5,"startDate":"2026-08-22"}';
  const d = parseDraft(raw);
  assert.equal(d.content, "做了旋涂，得到PEDOT薄膜");
  assert.equal(d.sampleId, "PEDOT-01");
  assert.equal(d.system, "PEDOT/导电聚合物");
  assert.equal(d.durationHours, 2.5);
  assert.equal(d.startDate, "2026-08-22");
});

test("parseDraft: content 缺失 → 返回 null", () => {
  assert.equal(parseDraft('{"sampleId":"x"}'), null);
});

test("parseDraft: 非 JSON → 返回 null（不抛）", () => {
  assert.equal(parseDraft("这不是json"), null);
});

test("parseDraft: 字段为 null 时保留 null、非法时长归 null", () => {
  const d = parseDraft('{"content":"记录一下","durationHours":"abc","taskId":null,"startDate":"bad"}');
  assert.equal(d.content, "记录一下");
  assert.equal(d.durationHours, null);
  assert.equal(d.taskId, null);
  assert.equal(d.startDate, null);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test tests/worklog-gen.test.mjs`
预期：FAIL（`parseDraft` 未定义：`Cannot find module .../worklog-gen.js` 或 `parseDraft is not a function`）

- [ ] **步骤 3：编写最小实现**

```javascript
// src-server/server/worklog-gen.js
import { sampleText } from "./llm.js";

/** LLM 输出 → 草稿对象（纯函数，可测）。返回 null 表示无法构成草稿。 */
export function parseDraft(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const content = typeof parsed.content === "string" ? parsed.content.trim().slice(0, 300) : "";
  if (!content) return null;
  const cleanDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const cleanNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0
    ? null
    : Math.round(Number(v) * 10) / 10);
  return {
    content,
    sampleId: typeof parsed.sampleId === "string" ? parsed.sampleId.trim().slice(0, 40) || null : null,
    system: typeof parsed.system === "string" ? parsed.system.trim().slice(0, 50) || null : null,
    data: typeof parsed.data === "string" ? parsed.data.trim().slice(0, 1500) || null : null,
    taskId: typeof parsed.taskId === "string" ? parsed.taskId.trim() || null : null,
    durationHours: cleanNum(parsed.durationHours),
    startDate: cleanDate(parsed.startDate),
  };
}

/** 生成草稿：读 prompt → sampleText → parseDraft。失败返回 null。 */
export async function generateDraft(ctx, { text, taskList = [] }) {
  const base = readPrompt(ctx, "worklog-generate.md");
  if (!base) return null;
  const msg = String(text || "").trim();
  if (!msg) return null;
  const taskHint = taskList.length
    ? "\n现有甘特任务(id: 名称):\n" + taskList.map((t) => `- ${t.id}: ${t.name}`).join("\n")
    : "";
  const result = await sampleText(ctx, {
    callPoint: "generateWorklog",
    messages: [
      { role: "system", content: base },
      { role: "user", content: msg + taskHint },
    ],
    maxTokens: 700,
    temperature: 0.3,
  });
  return parseDraft(result?.text);
}

/** 落库：追加一条 worklog 记录，附 AI 来源标记。 */
export async function commitDraft(ctx, store, draft, { sessionPath = null } = {}) {
  if (!draft || !draft.content) return { ok: false, reason: "empty_draft" };
  const now = new Date().toISOString();
  const entry = {
    id: `work_${Date.now().toString(36)}`,
    sampleId: draft.sampleId || null,
    system: draft.system || null,
    date: draft.startDate || new Date().toISOString().slice(0, 10),
    content: draft.content,
    data: draft.data || null,
    taskId: draft.taskId || null,
    durationHours: draft.durationHours,
    startDate: draft.startDate || null,
    createdAt: now,
    aiGenerated: true,
    sourceSession: sessionPath,
    generatedAt: now,
  };
  const res = store.update("worklog", undefined, (cur) => ({
    ...cur,
    entries: [...(cur.entries || []), entry],
  }));
  if (!res.ok) return { ok: false, reason: "store_update_failed", data: res.data };
  return { ok: true, id: entry.id };
}

/** 读 prompt（与 llm.js 相同实现，避免跨模块耦合）。 */
function readPrompt(ctx, name) {
  try {
    const path = await import("node:path");
    const fs = await import("node:fs");
    return fs.readFileSync(path.join(ctx.pluginDir, "prompts", name), "utf-8");
  } catch {
    return "";
  }
}
```

> 注：`readPrompt` 里用 `await import` 是为了让本文件在 `node --test` 下不因顶层 `import { readFileSync }` 的副作用报错。若 `--test` 环境可直接 `node:fs`，也可改回顶层 import。实现时可保持与 `llm.js` 一致的顶层 `import fs/path`，但测试需要能独立加载本模块（本模块仅依赖 `llm.js` 的 `sampleText`）。为让 `parseDraft` 单测无需宿主，`commitDraft`/`generateDraft` 用到 `sampleText`/`fs` 的部分需容错：`generateDraft` 调 `readPrompt` 用 fs，`parseDraft` 纯函数不触 fs。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --test tests/worklog-gen.test.mjs`
预期：PASS（4 个用例全过）

- [ ] **步骤 5：Commit**

```bash
git add src-server/server/worklog-gen.js tests/worklog-gen.test.mjs
git commit -m "feat(worklog-gen): add AI draft generation + parseDraft pure fn"
```

---

### 任务 3：改造 `src-server/index.js` 的 `_onSessionEvent`（状态机）

**文件：**
- 修改：`src-server/index.js`（`_onSessionEvent`、`onload`/实例字段、`_syncZoteroNow` 附近）
- 依赖：`@hana/plugin-runtime` 的 `sendSessionMessage`（确认导入方式）、`worklog-gen.js`

**状态机：**
- 实例字段：`this._pendingDraft = null`（`{ draft, sessionPath, ts }`）。
- 空闲 + 消息含「记录」→ `generateDraft` → 设 `_pendingDraft` → `sendSessionMessage` 发询问。
- 待确认 + 消息为确认词 → `commitDraft` → 清 `_pendingDraft` → 发"已记录"。
- 待确认 + 消息为拒绝词 → 清 `_pendingDraft` → 发"已取消"。
- 待确认 + 其它消息 → 维持待确认，提示。
- 确认词：记录/好/是/确认/ok；拒绝词：不/不用/不要/算了/取消（忽略大小写/空白，含匹配）。

- [ ] **步骤 1：确认 `sendSessionMessage` 导入方式与 ctx 传递**

运行：`grep -rn "sendSessionMessage" src-server/ 2>/dev/null || true`
预期：目前无引用。从 `@hana/plugin-runtime` 导入（与 `sampleText` 同源）。若无法直接 import，改用 `ctx.bus.request("session:send", {...})`。

- [ ] **步骤 2：阅读当前 `_onSessionEvent` 与 `onload` 以确定插入点**

运行：`sed -n '18,54p' src-server/index.js && echo '---' && sed -n '99,118p' src-server/index.js`
预期：`onload` 里 `const ctx=this.ctx; const register=this.register;`；`_onSessionEvent` 里 `const boundPath=this._boundSessionPath(); ... const text=String(event?.message?.text||"").trim();`

- [ ] **步骤 3：在类顶部加 `_pendingDraft` 初始化**

```javascript
// 在构造函数或 onload 中初始化实例字段（onload 里 this 已实例化）
// onload() 内、_state 之后追加：
this._pendingDraft = null; // AI 主导生成：待确认草稿（内存态，{ draft, sessionPath, ts }）
```

- [ ] **步骤 4：改写 `_onSessionEvent` 加入状态机**

```javascript
async _onSessionEvent(event, sessionPath) {
  const ctx = this.ctx;
  const boundPath = this._boundSessionPath();
  if (!boundPath || !sessionPath || sessionPath !== boundPath) return;

  const text = String(event?.message?.text || "").trim();
  const genEnabled = ctx.config.get?.("aiWorklogGen") ?? true;

  // 1) 若存在待确认草稿，先按确认/拒绝解释
  if (this._pendingDraft && genEnabled) {
    const verdict = matchVerdict(text);
    if (verdict === "confirm") {
      const res = await commitDraft(ctx, this._store, this._pendingDraft.draft, { sessionPath });
      this._pendingDraft = null;
      await sendSessionMessage(ctx, { sessionPath }, {
        role: "assistant",
        text: res.ok ? "已记录 ✅" : `记录失败：${res.reason}`,
      }).catch(() => {});
    } else if (verdict === "reject") {
      this._pendingDraft = null;
      await sendSessionMessage(ctx, { sessionPath }, {
        role: "assistant",
        text: "好的，已取消记录。",
      }).catch(() => {});
    }
    // 其它消息：维持待确认（首版忽略，不重总结）
    return;
  }

  // 2) 空闲态：不再作 Zotero 之外的 AI 记录处理时，先走原有同步逻辑
  const autoCollect = ctx.config.get?.("autoCollectEnabled") ?? true;
  if (!autoCollect) return;
  const now = Date.now();
  if (now - this._state.lastAutoCollectAt < AUTO_COLLECT_THROTTLE_MS) return;
  this._state.lastAutoCollectAt = now;
  if (!text || text.length < 20) return;

  // 3) AI 主导生成：空闲 + 含「记录」关键词
  if (genEnabled && text.includes("记录")) {
    this._maybeGenerateWorklog(text, sessionPath).catch((err) => {
      ctx.log.warn("ai worklog generate failed:", err.message);
    });
  }

  // 原有 Zotero 同步
  this._syncZoteroNow().catch((err) => {
    ctx.log.warn("auto zotero sync failed:", err.message);
  });
}

/** 关键词判定：返回 'confirm' | 'reject' | 'other'（忽略大小写/首尾空白，含匹配）。 */
function matchVerdict(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return "other";
  const confirm = ["记录", "好", "是", "确认", "ok"];
  const reject = ["不", "不用", "不要", "算了", "取消", "no"];
  if (reject.some((w) => s === w || s.startsWith(w))) return "reject";
  if (confirm.some((w) => s === w || s.startsWith(w))) return "confirm";
  return "other";
}

/** 生成草稿并询问（fire-and-forget 的可等待实现）。 */
async _maybeGenerateWorklog(text, sessionPath) {
  const ctx = this.ctx;
  const taskList = (this._store.read("gantt")?.tasks || []).map((t) => ({ id: t.id, name: t.name }));
  const draft = await generateDraft(ctx, { text, taskList });
  if (!draft) {
    await sendSessionMessage(ctx, { sessionPath }, {
      role: "assistant",
      text: "没能从这条消息识别出可记录的实验内容，稍后再试。",
    }).catch(() => {});
    return;
  }
  this._pendingDraft = { draft, sessionPath, ts: Date.now() };
  const summary = [
    draft.sampleId ? `样品：${draft.sampleId}` : null,
    draft.system ? `体系：${draft.system}` : null,
    draft.durationHours ? `时长：${draft.durationHours}h` : null,
    `内容：${draft.content.slice(0, 120)}`,
  ].filter(Boolean).join("\n");
  await sendSessionMessage(ctx, { sessionPath }, {
    role: "assistant",
    text: `检测到实验记录草稿：\n${summary}\n\n回复「记录」确认，回复「不」取消。`,
  }).catch(() => {});
}
```

> 注：`sendSessionMessage(ctx, { sessionPath }, {...})` —— 目标用 `{ sessionPath }`（或 `{ sessionRef }`）。实现时按宿主实际接受的 `HanaSessionTarget` 调整；`sessionPath` 若被拒则用 `{ sessionId }`（`event.sessionId` 或绑定信息）。请在 `src-server/index.js` 顶部 import：`import { sendSessionMessage } from "@hana/plugin-runtime";` 与 `import { generateDraft, commitDraft } from "./server/worklog-gen.js";`。

- [ ] **步骤 5：node --check 校验**

运行：`node --check src-server/index.js`
预期：无输出（语法通过）

- [ ] **步骤 6：Commit**

```bash
git add src-server/index.js
git commit -m "feat(index): add in-session AI worklog draft confirm state machine"
```

---

### 任务 4：`manifest.json` 加 `aiWorklogGen` 配置

**文件：**
- 修改：`manifest.json`（`contributes.configuration.properties`）

- [ ] **步骤 1：加配置项**

```json
"aiWorklogGen": {
  "type": "boolean",
  "title": "会话消息含『记录』时 AI 生成实验记录（需回复确认）",
  "default": true
}
```

插入到现有 `contributes.configuration.properties` 中（如 `autoTriage` 附近），保证 JSON 合法。

- [ ] **步骤 2：校验 JSON**

运行：`node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('JSON OK')"`
预期：`JSON OK`

- [ ] **步骤 3：Commit**

```bash
git add manifest.json
git commit -m "feat(manifest): add aiWorklogGen config"
```

---

### 任务 5：重新 build 生成插件根产物

**文件：**
- 生成：`index.js`、`routes/*.js`、`tools/*.js`、`assets/panel.js`、`assets/panel.css`

- [ ] **步骤 1：构建**

运行：`npm run build`
预期：`build:server`（esbuild）+ `build:ui`（vite）均成功，EXIT 0。

- [ ] **步骤 2：验证构建产物含新逻辑**

运行：
```bash
grep -c "generateWorklog" index.js        # 应 >0（generateDraft 被打进 bundle）
grep -c "aiWorklogGen" manifest.json      # 应 >0
grep -c "worklog-generate" index.js       # 应 >0（prompt 名被引用）
```
预期：各项 >0

- [ ] **步骤 3：移除构建残留（若 build 残留旧产物）**

运行：`node --check index.js && node --check routes/api.js && ls tools/ | grep -E "assess-plan|manage-plan|review-research" || echo "no stale tools"`
预期：语法 OK，无 `assess-plan`/`manage-plan`/`review-research` 残留。若仍有残留，`rm -f` 之（它们无 src-server 源）。

- [ ] **步骤 4：Commit**

```bash
git add index.js routes assets tools manifest.json 2>/dev/null
git commit -m "chore: rebuild plugin bundle for AI worklog generation"
```

> 注：`index.js`/`assets/`/`routes/`/`tools/` 可能被 `.gitignore` 忽略（构建产物）。若被忽略，commit 只覆盖源码改动（`src-server/`、`manifest.json`、`prompts/`），构建产物靠复制到宿主。

---

### 任务 6：端到端验证(宿主内，人工)

**文件：**
- 无源码改动

- [ ] **步骤 1：复制到宿主目录**

复制 `index.js`/`assets/`/`routes/`/`tools/`/`prompts/`/`manifest.json` 到宿主加载目录，reload 插件。

- [ ] **步骤 2：触发验证（人工）**

在绑定会话内发送含「记录」的消息 → 观察 AI 是否发询问草稿；回复「记录」→ 观察 worklog 是否新增、面板是否可见；回复「不」→ 观察取消、不落库。

预期：按状态机正确响应。

---

## 自检

- **规格覆盖度**：触发（任务3）、生成（任务2+pytask1 prompt）、落库（任务2 commitDraft）、去重=用户确认（任务3 状态机）、确认/拒绝词（任务3）、配置（任务4）、build（任务5）、测试（任务2 单测+任务6 e2e）全部覆盖。README 交互卡片方向已单独 commit。
- **占位符**：无"待定/TODO/后续实现"。`generateDraft` 的 `readPrompt` 用 `await import` 的权衡已说明；`sendSessionMessage` target 形态备注了需按宿主调整（这是实现时的 adapter 点，非占位符缺陷）。
- **类型一致性**：`parseDraft` 返回 `{ content,sampleId,system,data,taskId,durationHours,startDate }` 与 prompt/commitDraft 一致；`commitDraft` 读取这些字段与 `store.update` 语义一致；`matchVerdict`/`_maybeGenerateWorklog` 在同一 index.js 内定义，引用一致。

> 注：因无法在本机完整跑宿主 LLM，`parseDraft` 纯函数单测是本计划唯一可自动化验证的测试；其余靠 `node --check` + 静态核对 + 宿主内人工 e2e。
