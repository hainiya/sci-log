/**
 * manage_schedule：甘特任务 / 任务清单 / 日历日程 的增删改
 * AI 写即生效（去提案）：增删改直接写库，乐观锁由 store 兜底。
 */
import { createStore } from "../server/store.js";
import { ensureAutoBinding } from "../server/binding.js";
import { newId } from "../server/ids.js";

export const name = "manage_schedule";
export const description =
  "管理科研工作的甘特图任务、任务清单与日历日程。读取直接返回；增删改直接写库（AI 写即生效，无提案确认）。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["read", "create", "update", "delete"],
      description: "read 直接读取；create/update/delete 直接写库",
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
    summary: "直接写入插件甘特图/日历数据（AI 写即生效，无提案确认）",
    ruleId: "sci-log-plugin-output",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.js").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const { action, target } = input;
  ensureAutoBinding(toolCtx);

  // 容器的条目字段：gantt → tasks，calendar → events
  const listField = target === "gantt" ? "tasks" : "events";

  if (action === "read") {
    const doc = /** @type {Record<string, any>} */ (store.read(target));
    const list = doc[listField] || [];
    const text =
      target === "gantt"
        ? `甘特图任务（共 ${list.length} 个）：\n${JSON.stringify(list, null, 2)}`
        : `日历日程（共 ${list.length} 条）：\n${JSON.stringify(list, null, 2)}`;
    return { content: [{ type: "text", text }] };
  }

  if (action === "create") {
    if (!input.data || typeof input.data !== "object") {
      throw new Error("create 需要 data 参数");
    }
    const item =
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
    store.update(target, undefined, (cur) => ({ [listField]: [...(cur[listField] || []), item] }));
    return { content: [{ type: "text", text: `已创建${target === "gantt" ? "甘特任务" : "日历日程"}：${item.name || item.title}` }] };
  }

  if (action === "update") {
    if (!input.id) throw new Error("update 需要 id 参数");
    if (!input.data || typeof input.data !== "object") throw new Error("update 需要 data 参数");
    store.update(target, undefined, (cur) => ({
      [listField]: /** @type {any[]} */ (cur[listField] || []).map((e) => (e.id === input.id ? { ...e, ...input.data } : e)),
    }));
    return { content: [{ type: "text", text: `已更新${target === "gantt" ? "任务" : "日程"} ${input.id}` }] };
  }

  if (action === "delete") {
    if (!input.id) throw new Error("delete 需要 id 参数");
    store.update(target, undefined, (cur) => ({
      [listField]: /** @type {any[]} */ (cur[listField] || []).filter((e) => e.id !== input.id),
    }));
    return { content: [{ type: "text", text: `已删除 ${target} 条目 ${input.id}` }] };
  }

  throw new Error(`不支持的 action: ${action}`);
}
