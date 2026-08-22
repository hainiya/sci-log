/**
 * review_research：自动审查研究方案与实验记录
 * - AI 直出审查报告，写入 reviews.json（只增不改，唯一不由用户手动编辑的内容）
 * - 报告包含：❌ 错误指出 / 💡 改进建议（带文献依据）/ ⚠️ 风险提示
 * - 报告引发的修改动作：解析报告末尾 SUGGESTIONS 块，自动生成对应编辑提案
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { reviewResearch } from "../server/llm.js";
import { ensureAutoBinding } from "../server/binding.js";
import { parseSuggestionBlock, filterReviewSuggestions } from "../server/suggestions.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const name = "review_research";
export const description =
  "审查科研工作中的研究方案与实验记录：AI 生成审查报告（错误指出/改进建议/风险提示），写入只读的审查记录；报告中涉及修改的建议会自动生成编辑提案，确认后生效。";
export const parameters = {
  type: "object",
  properties: {
    target: {
      type: "string",
      enum: ["research", "plan", "worklog"],
      description: "审查对象：research=整体研究进展（默认）；plan=研究方案；worklog=实验记录",
    },
  },
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "调用模型生成审查报告写入插件数据目录，并生成可能的编辑提案",
    ruleId: "materials-research-copilot-plugin-output",
  }),
};

/** 解析报告中的 SUGGESTIONS 块（提取解析 + review 白名单过滤走公共层） */
function parseSuggestions(report) {
  const { report: body, parsed } = parseSuggestionBlock(report);
  return { report: body, suggestions: filterReviewSuggestions(parsed) };
}

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const target = input.target || "research";
  ensureAutoBinding(toolCtx);

  const plan = store.read("plan");
  const worklog = store.read("worklog");
  const gantt = store.read("gantt");
  const literature = store.read("literature");
  const rejected = store.read("rejected");

  const rawReport = await reviewResearch(toolCtx, {
    plan,
    worklog,
    gantt,
    literature,
    rejected,
    target,
  });

  const { report, suggestions } = parseSuggestions(rawReport);

  // 审查报告只增不改
  const reviewEntry = {
    id: newId("rev"),
    date: store.now(),
    target,
    report,
    createdAt: store.now(),
  };
  store.update("reviews", undefined, (current) => ({
    entries: [...(current.entries || []), reviewEntry],
  }));

  // 报告引发的修改 → 自动生成编辑提案
  const proposalResults = [];
  for (const suggestion of suggestions) {
    try {
      const baseVersion = store.read(suggestion.target).version;
      const result = createProposal(store, {
        target: suggestion.target,
        action: suggestion.action,
        diff: suggestion.diff,
        reason: `审查建议：${suggestion.reason || "依据审查报告"}`,
        baseVersion,
      });
      proposalResults.push(result);
    } catch (err) {
      // 单个建议失败不阻塞
    }
  }

  const lines = [];
  lines.push(`审查完成（对象：${target}），报告已存档。`);
  if (proposalResults.length > 0) {
    const pending = proposalResults.filter((r) => !r.applied).length;
    lines.push(
      `根据审查建议自动生成了 ${proposalResults.length} 个编辑提案${pending > 0 ? `（${pending} 个待确认）` : "（已直接应用）"}：`
    );
    for (const r of proposalResults) {
      lines.push(`- ${r.entry.id}: ${r.entry.reason}`);
    }
  }
  lines.push("");
  lines.push("【审查报告】");
  lines.push(report.slice(0, 6000));

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
