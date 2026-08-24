/**
 * prepare_worklog：生成实验记录草稿（准备态，不落库）。
 * AI 当编排者时调用本工具拿到草稿，再把草稿内容烧进交互式确认卡片
 * （manifest 固定 input 携带草稿对象），卡片按钮调 commit_worklog 落库。
 * - 只读/生成，不写 worklog；服务端无待确认池（草稿由卡片自带），无跨调用共享状态。
 */
import { createStore } from "../server/store.ts";
import { generateDraft } from "../server/worklog-gen.ts";
import { ensureAutoBinding } from "../server/binding.ts";
import { newId } from "../server/ids.ts";

export const name = "prepare_worklog";
export const description =
  "生成一条实验记录草稿（不落库），返回结构化草稿对象供 AI 烧绘确认卡片；用户确认后卡片调 commit_worklog 落库。";
export const parameters = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "要整理成实验记录的会话消息/讨论内容",
    },
    taskList: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "甘特任务 id" },
          name: { type: "string", description: "甘特任务名" },
        },
      },
      description: "可选的甘特任务列表，供 LLM 关联 taskId",
    },
  },
  required: ["text"],
};

export const sessionPermission = {
  kind: "read",
  describeSideEffect: () => ({
    kind: "read",
    summary: "生成实验记录草稿（不直接写库）",
    ruleId: "sci-log-plugin-output",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.ts").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input: Record<string, any> = {}, toolCtx: import("../server/types.ts").ToolCtx): Promise<any> {
  const store = createStore(toolCtx.dataDir);
  ensureAutoBinding(toolCtx);
  const text = String(input.text || "").trim();
  if (!text) throw new Error("text 不能为空");

  let taskList: Array<{ id: string; name: string }> = [];
  if (Array.isArray(input.taskList)) {
    taskList = input.taskList.map((t: any) => ({ id: String(t.id || ""), name: String(t.name || "") }));
  } else {
    try {
      taskList = (store.read("gantt")?.tasks || []).map((t: any) => ({ id: t.id, name: t.name }));
    } catch {}
  }

  const draft = (await generateDraft(toolCtx, { text, taskList })) as any;
  if (!draft) throw new Error("没能从这条消息识别出可记录的实验内容");

  const draftId = newId("wg");
  const structured = {
    draftId,
    sampleId: draft.sampleId || null,
    system: draft.system || null,
    durationHours: draft.durationHours ?? null,
    startDate: draft.startDate || null,
    taskId: draft.taskId || null,
    content: draft.content,
    data: draft.data || null,
  };
  const summary = [
    structured.sampleId ? `样品：${structured.sampleId}` : null,
    structured.system ? `体系：${structured.system}` : null,
    structured.durationHours ? `时长：${structured.durationHours}h` : null,
    `内容：${structured.content}`,
  ].filter(Boolean).join("\n");

  return {
    content: [
      {
        type: "text",
        text: `实验记录草稿（draftId=${draftId}）：\n${summary}`,
      },
    ],
    draft: structured,
  };
}
