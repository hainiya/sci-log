/**
 * manage_schedule：甘特任务 / 任务清单 / 日历日程 的增删改
 * 所有写操作均以提案形式提交（proposals.json），经用户确认后落库
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { ensureAutoBinding } from "../server/binding.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const name = "manage_schedule";
export const description =
  "管理科研工作的甘特图任务、任务清单与日历日程。读取直接返回；增删改均生成编辑提案，用户确认后才生效。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["read", "create", "update", "delete"],
      description: "read 直接读取；create/update/delete 生成提案待确认",
    },
    target: {
      type: "string",
      enum: ["gantt", "calendar"],
      description: "gantt=甘特任务/任务清单；calendar=日历日程",
    },
    data: {
      type: "object",
      description:
        "create/update 时的条目内容：gantt 传 {name,start,end,dependsOn?,progress?,tags?}；calendar 传 {title,date,startTime?,endTime?,type?,taskId?}",
    },
    id: {
      type: "string",
      description: "update/delete 时必填的条目 id",
    },
  },
  required: ["action", "target"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "将甘特图/日历编辑作为提案写入插件数据目录，待用户确认后生效",
    ruleId: "materials-research-copilot-plugin-output",
  }),
};

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const { action, target } = input;
  ensureAutoBinding(toolCtx);

  if (action === "read") {
    const doc = store.read(target);
    const text =
      target === "gantt"
        ? `甘特图任务（共 ${(doc.tasks || []).length} 个）：\n${JSON.stringify(doc.tasks || [], null, 2)}`
        : `日历日程（共 ${(doc.events || []).length} 条）：\n${JSON.stringify(doc.events || [], null, 2)}`;
    return { content: [{ type: "text", text }] };
  }

  const baseVersion = store.read(target).version;

  if (action === "create") {
    if (!input.data || typeof input.data !== "object") {
      throw new Error("create 需要 data 参数");
    }
    const diff =
      target === "gantt"
        ? {
            id: newId("task"),
            name: input.data.name || "未命名任务",
            start: input.data.start || null,
            end: input.data.end || null,
            dependsOn: input.data.dependsOn || [],
            progress: input.data.progress ?? 0,
            tags: input.data.tags || [],
          }
        : {
            id: newId("evt"),
            title: input.data.title || "未命名日程",
            date: input.data.date || null,
            startTime: input.data.startTime || null,
            endTime: input.data.endTime || null,
            type: input.data.type || "default",
            taskId: input.data.taskId || null,
          };
    const result = createProposal(store, {
      target,
      action: "create",
      diff,
      reason: `新增${target === "gantt" ? "甘特任务" : "日历日程"}：${diff.name || diff.title}`,
      baseVersion,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已直接应用：${diff.name || diff.title}`
            : `已生成提案 ${result.entry.id}（新增${target === "gantt" ? "任务" : "日程"}：${diff.name || diff.title}），等待确认。`,
        },
      ],
    };
  }

  if (action === "update") {
    if (!input.id) throw new Error("update 需要 id 参数");
    if (!input.data || typeof input.data !== "object") throw new Error("update 需要 data 参数");
    const diff = { id: input.id, ...input.data };
    const result = createProposal(store, {
      target,
      action: "update",
      diff,
      reason: `更新${target === "gantt" ? "任务" : "日程"} ${input.id}`,
      baseVersion,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已直接应用：${target} 条目 ${input.id} 已更新`
            : `已生成提案 ${result.entry.id}（更新${target === "gantt" ? "任务" : "日程"} ${input.id}），等待确认。`,
        },
      ],
    };
  }

  if (action === "delete") {
    if (!input.id) throw new Error("delete 需要 id 参数");
    const targetDoc = store.read(target);
    const list = target === "gantt" ? targetDoc.tasks : targetDoc.events;
    if (!(list || []).some((e) => e?.id === input.id)) {
      throw new Error(`${target === "gantt" ? "任务" : "日程"} ${input.id} 不存在`);
    }
    const result = createProposal(store, {
      target,
      action: "delete",
      diff: { id: input.id },
      reason: `删除${target === "gantt" ? "任务" : "日程"} ${input.id}`,
      baseVersion,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已删除 ${target} 条目 ${input.id}`
            : `已生成删除提案 ${result.entry.id}，等待确认。`,
        },
      ],
    };
  }

  throw new Error(`不支持的 action: ${action}`);
}
