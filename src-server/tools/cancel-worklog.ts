/**
 * cancel_worklog：丢弃一条实验记录草稿（不落库）。
 * 交互式卡片「取消」按钮经 data-card-manifest 绑定本工具。
 * 服务端无待确认池，草稿由卡片自带，故取消仅作语义确认返回。
 */
import { createStore } from "../server/store.ts";
import { ensureAutoBinding } from "../server/binding.ts";

export const name = "cancel_worklog";
export const description =
  "取消一条尚未落库的实验记录草稿（不写库）；卡片『取消』按钮调用。";
export const parameters = {
  type: "object",
  properties: {
    draftId: { type: "string", description: "来自 prepare_worklog 的草稿引用 id" },
  },
  required: ["draftId"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "取消一条实验记录草稿（不写库）",
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
  const draftId = input.draftId ? String(input.draftId) : "未知";
  return {
    content: [
      {
        type: "text",
        text: `已取消实验记录草稿（draftId=${draftId}），未写入实验记录。`,
      },
    ],
  };
}
