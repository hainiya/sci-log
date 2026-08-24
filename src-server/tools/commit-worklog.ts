/**
 * commit_worklog：把一张确认卡片携带的草稿对象落库到实验记录。
 * 交互式卡片「记录」按钮经 data-card-manifest 绑定本工具，invoke 时传入草稿对象，
 * 复用 worklog-gen.ts 的 commitDraft 落库（含 AI 巡检）。
 */
import { createStore } from "../server/store.ts";
import { commitDraft } from "../server/worklog-gen.ts";
import { ensureAutoBinding } from "../server/binding.ts";

/** 避免循环引用的 JSON 序列化（诊断日志用） */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return `[unserializable: ${typeof value}, keys: ${Object.keys(value as any).join(",")}]`;
    } catch {
      return "[unserializable]";
    }
  }
}

export const name = "commit_worklog";
export const description =
  "把确认卡片携带的实验记录草稿对象落库（AI 写即生效，含自动巡检）；卡片『记录』按钮调用。";
export const parameters = {
  type: "object",
  properties: {
    draft: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "草稿引用 id（来自 prepare_worklog）" },
        sampleId: { type: "string", description: "样品编号，可空" },
        system: { type: "string", description: "材料体系，可空" },
        durationHours: { type: "number", description: "实验时长（小时），可空" },
        startDate: { type: "string", description: "开始日期 YYYY-MM-DD，可空" },
        taskId: { type: "string", description: "关联甘特任务 id，可空" },
        content: { type: "string", description: "实验记录内容（必填）" },
        data: { type: "string", description: "结构化原始数据，可空" },
      },
      required: ["content"],
      description: "要落库的草稿对象（卡片 manifest 固定 input 携带）",
    },
    sessionPath: { type: "string", description: "会话路径，可空" },
  },
  required: ["draft"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "将确认的实验记录草稿写入插件实验记录，并触发自动巡检（AI 写即生效）",
    ruleId: "sci-log-plugin-output",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.ts").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input: Record<string, any> = {}, toolCtx: import("../server/types.ts").ToolCtx): Promise<any> {
  toolCtx?.log?.info?.(`commit_worklog execute called, input type=${typeof input}, keys=${JSON.stringify(Object.keys(input || {}))}`);
  toolCtx?.log?.info?.(`commit_worklog input = ${safeStringify(input)}`);
  const store = createStore(toolCtx.dataDir);
  ensureAutoBinding(toolCtx);
  const draft = input?.draft;
  if (!draft || typeof draft !== "object") throw new Error(`draft 不能为空, got: ${typeof input?.draft}`);
  if (!draft.content || !String(draft.content).trim()) throw new Error("draft.content 不能为空");

  const sessionPath = input.sessionPath ? String(input.sessionPath) : (toolCtx.sessionPath || null);
  const res = commitDraft(toolCtx, store, draft, { sessionPath });
  if (!res.ok) throw new Error(`记录失败：${res.reason}`);

  return {
    content: [
      {
        type: "text",
        text: `已记录实验工作（id=${res.id}）：\n${draft.content}`,
      },
    ],
  };
}
