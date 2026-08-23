/**
 * AI 主导生成实验记录：LLM 生成草稿（generateDraft）+ 落库（commitDraft）。
 *
 * 结构说明（task-2-brief 修正点）：
 * - parseDraft 纯函数在 ./worklog-parse.js，本模块 re-export 以保持
 *   `import { parseDraft } from "./worklog-gen.js"` 的旧调用面可用；
 * - readPrompt 与 llm.js 相同实现（顶层 import fs/path 的同步函数），不用 await import。
 */
import fs from "node:fs";
import path from "node:path";
import { sampleText } from "./llm.js";
import { triageWorklog } from "./triage.js";

export { parseDraft } from "./worklog-parse.js";

/**
 * 生成实验记录草稿：读 prompt → sampleText → parseDraft。
 * @returns {Promise<null | object>} 草稿对象；prompt 缺失 / 输入为空 / LLM 失败或无法解析时返回 null
 */
export async function generateDraft(ctx, { text, taskList = [] }) {
  const base = readPrompt(ctx, "worklog-generate.md");
  if (!base) return null;
  const msg = String(text || "").trim();
  if (!msg) return null;
  // 任务列表提示：让 LLM 能把 taskId 关联到已有甘特任务
  const taskHint = (taskList || []).length
    ? "\n\n现有甘特任务(id: 名称):\n" +
      taskList.map((t) => `- ${t.id}: ${t.name}`).join("\n")
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

/**
 * 落库：向 worklog 追加一条 AI 生成的实验记录。
 * @returns {{ ok: true, id: string } | { ok: false, reason: string, data?: object }}
 */
export function commitDraft(ctx, store, draft, { sessionPath = null } = {}) {
  if (!draft || !draft.content) {
    return { ok: false, reason: "empty_draft" };
  }
  const nowIso = new Date().toISOString();
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
    createdAt: nowIso,
    aiGenerated: true,
    sourceSession: sessionPath,
    generatedAt: nowIso,
  };
  // store.update 内部 write(原子写)抛异常时不能让草稿静默丢失：捕获并返回明确失败，
  // 由 index.js 在收到 ok:false 后保留 _pendingDraft 供用户重试
  try {
    const res = store.update("worklog", undefined, (cur) => ({
      ...cur,
      entries: [...(cur.entries || []), entry],
    }));
    if (!res?.ok) return { ok: false, reason: "store_update_failed", data: res?.data };
  } catch (err) {
    return { ok: false, reason: "store_error", data: { message: err?.message || String(err) } };
  }
  // 落库成功后触发 AI 巡检（manifest autoTriage 承诺）：fire-and-forget，开关与既有调用点一致
  const autoTriage = ctx?.config?.get?.("autoTriage") ?? true;
  if (autoTriage) {
    triageWorklog(ctx, store).catch((err) => {
      ctx?.log?.warn(`triage after ai worklog commit failed: ${err?.message || err}`);
    });
  }
  return { ok: true, id: entry.id };
}

/** 读 prompt（与 llm.js 同实现：顶层 import fs/path 的同步读取）。 */
function readPrompt(ctx, name) {
  try {
    return fs.readFileSync(path.join(ctx.pluginDir, "prompts", name), "utf-8");
  } catch {
    return "";
  }
}
