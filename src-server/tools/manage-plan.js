/**
 * manage_plan：研究方案 / 实验记录 的结构化写入与修改
 * 所有写操作均以提案形式提交（proposals.json），经用户确认后落库
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { ensureAutoBinding } from "../server/binding.js";

export const name = "manage_plan";
export const description =
  "管理科研工作的研究方案与实验记录。读取直接返回；创建、更新、删除均生成编辑提案，用户确认后才生效。";
export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["read", "create", "update", "delete"],
      description: "read 直接读取；create 仅用于空方案新建；update/delete 生成提案待确认",
    },
    target: {
      type: "string",
      enum: ["plan", "worklog"],
      description: "plan=研究方案；worklog=实验记录",
    },
    data: {
      type: "object",
      description: "update 时的内容：plan 传 {title,hypothesis,route,milestones}；worklog 传 {date,content,data?,taskId?}",
    },
    id: {
      type: "string",
      description: "worklog 条目 id（update/delete 时必填）",
    },
    evolution: {
      type: "object",
      description:
        "可选，仅 plan 的 update 时使用：本次方案变更的类型与原因，写入方案演进史。types 从 ['material','process','scope','direction','other'] 多选（material=改材料/process=改工艺/scope=范围调整/direction=大改方向/other=其他）；reason 为变更原因一句话",
      properties: {
        types: { type: "array", items: { type: "string", enum: ["material", "process", "scope", "direction", "other"] } },
        reason: { type: "string" },
      },
    },
  },
  required: ["action", "target"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "将研究方案/实验记录编辑作为提案写入插件数据目录，待用户确认后生效",
    ruleId: "materials-research-copilot-plugin-output",
  }),
};

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const action = input.action;
  const target = input.target;
  ensureAutoBinding(toolCtx);

  if (action === "read") {
    const doc = store.read(target);
    const text =
      target === "plan"
        ? `研究方案：\n${JSON.stringify(doc, null, 2)}`
        : `实验记录（共 ${(doc.entries || []).length} 条）：\n${JSON.stringify(doc.entries || [], null, 2)}`;
    return { content: [{ type: "text", text }] };
  }

  if (action === "create") {
    if (target !== "plan") {
      throw new Error("create 仅支持 plan；worklog 用 update 追加内容");
    }
    if (!input.data || typeof input.data !== "object") {
      throw new Error("create 需要 data 参数（title/hypothesis/route/milestones）");
    }
    const current = store.read("plan");
    if (String(current.title || "").trim() || String(current.hypothesis || "").trim()) {
      throw new Error("研究方案已存在，如需替换请用 update；create 仅用于从空创建");
    }
    const result = createProposal(store, {
      target: "plan",
      action: "create",
      diff: { ...input.data },
      reason: "创建研究方案",
      baseVersion: current.version,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已直接应用（本次变更经白名单/宿主层确认）：研究方案已创建`
            : `已生成创建提案 ${result.entry.id}（plan），等待确认。可在面板「提案确认」中接受/拒绝；也可以在对话中说『接受提案』。`,
        },
      ],
    };
  }

  if (action === "update") {
    if (!input.data || typeof input.data !== "object") {
      throw new Error("update 需要 data 参数");
    }
    const baseVersion = store.read(target).version;
    let diff;
    if (target === "plan") {
      diff = { ...input.data };
    } else {
      const id = input.id;
      if (!id) throw new Error("worklog update 需要 id 参数");
      diff = { id, ...input.data };
    }
    const result = createProposal(store, {
      target,
      action: "update",
      diff,
      reason: target === "plan" ? "更新研究方案" : `更新实验记录条目 ${input.id}`,
      baseVersion,
      meta: target === "plan" && input.evolution ? { evolution: input.evolution } : undefined,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已直接应用（本次变更经白名单/宿主层确认）：${target} 已更新`
            : `已生成编辑提案 ${result.entry.id}（${target}），等待确认。可在面板中栏 Tab 查看并接受/拒绝；也可以在对话中说『接受提案』。`,
        },
      ],
    };
  }

  if (action === "delete") {
    if (target === "plan") {
      throw new Error("研究方案不支持删除，可用 update 清空");
    }
    if (!input.id) throw new Error("delete 需要 id 参数");
    const targetDoc = store.read(target);
    if (!(targetDoc.entries || []).some((e) => e?.id === input.id)) {
      throw new Error(`实验记录条目 ${input.id} 不存在`);
    }
    const baseVersion = targetDoc.version;
    const result = createProposal(store, {
      target,
      action: "delete",
      diff: { id: input.id },
      reason: `删除实验记录条目 ${input.id}`,
      baseVersion,
    });
    return {
      content: [
        {
          type: "text",
          text: result.applied
            ? `已删除实验记录条目 ${input.id}`
            : `已生成删除提案 ${result.entry.id}，等待确认。`,
        },
      ],
    };
  }

  throw new Error(`不支持的 action: ${action}`);
}
