/**
 * assess_plan：以文献为根据评估研究方案
 * - 调 LLM 生成「假设-证据对照 / 技术路线可行性 / 研究 gap 陈述」报告
 * - 报告写入只读的 assessment.json（结构同 report，附 gaps 标签），bump 触发面板刷新
 * - 报告末尾 SUGGESTIONS 块解析为 plan 修改提案，用户确认后生效
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { assessPlanAgainstLiterature, parsePlanAssessment } from "../server/llm.js";
import { ensureAutoBinding } from "../server/binding.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 里程碑合并守卫：AI 评估建议可能只含部分里程碑（如只改 M3 判据），
 * 直接整段替换会丢失其余里程碑。按 id 与现有方案合并：
 * diff 条目覆盖同 id，新 id 追加，未涉及的里程碑完整保留。
 */
export function mergeMilestoneDiff(diff, currentMilestones) {
  if (!diff || !Array.isArray(diff.milestones)) return diff;
  const current = Array.isArray(currentMilestones) ? currentMilestones : [];
  const diffIds = new Set(diff.milestones.map((m) => m && m.id).filter(Boolean));
  return {
    ...diff,
    milestones: [...current.filter((m) => !diffIds.has(m && m.id)), ...diff.milestones],
  };
}

export const name = "assess_plan";
export const description =
  "以文献库为根据评估当前研究方案：AI 生成假设-证据对照表、技术路线可行性分析与研究 gap 陈述，写入只读评估记录；报告中生成的方案修改建议会自动生成编辑提案，确认后生效。";
export const parameters = {
  type: "object",
  properties: {
    force: {
      type: "boolean",
      description: "是否忽略评估新鲜度强制重跑（默认 false：若近期已评估且方案/文献未变则复用）",
    },
  },
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "调用模型对照文献库生成方案评估报告写入插件数据目录，并生成可能的方案编辑提案",
    ruleId: "materials-research-copilot-plugin-output",
  }),
};

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const force = Boolean(input.force);
  ensureAutoBinding(toolCtx);

  const plan = store.read("plan");
  const literature = store.read("literature");

  const litCount = (literature.entries || []).length;
  if (litCount === 0) {
    return {
      content: [
        {
          type: "text",
          text: "文献库为空，无法对照评估。请先导入/扫描文献后再运行本工具。",
        },
      ],
    };
  }

  // 新鲜度检查：方案与文献库版本均未变且已评估过 → 提示复用
  const prev = store.read("assessment");
  const fresh =
    force ||
    !prev.updatedAt ||
    prev.planVersion !== plan.version ||
    prev.literatureVersion !== literature.version;
  if (!fresh) {
    return {
      content: [
        {
          type: "text",
          text: `评估结果仍是最新（基于 方案 v${plan.version} · 文献库 v${literature.version}）。如需强制重评，传入 force:true。\n\n${String(prev.content || "").slice(0, 4000)}`,
        },
      ],
    };
  }

  const raw = await assessPlanAgainstLiterature(toolCtx, { plan, literature });
  const { report, suggestions, gaps } = parsePlanAssessment(raw);

  // 评估只读报告（覆盖式写入）
  store.write("assessment", {
    version: 0,
    content: report,
    gaps: gaps || [],
    updatedAt: store.now(),
    planVersion: plan.version,
    literatureVersion: literature.version,
  });
  store.bump("assessment");

  // SUGGESTIONS → 方案修改提案
  const proposalResults = [];
  for (const s of suggestions) {
    try {
      const baseVersion = plan.version;
      // 里程碑合并守卫：LLM 建议可能只含部分里程碑（如只改 M3 判据），
      // 直接整段替换会丢失其余里程碑。按 id 与现有方案合并。
      const diff = mergeMilestoneDiff(s.diff, plan.milestones);
      const result = createProposal(store, {
        target: "plan",
        action: "update",
        diff,
        reason: `文献对照评估建议：${s.reason || "依据评估结论"}`,
        baseVersion,
      });
      proposalResults.push(result);
    } catch {
      // 单个提案失败不阻塞
    }
  }

  const lines = [];
  lines.push(`文献对照评估完成（方案 v${plan.version} · 文献库 ${litCount} 篇），报告已存档。`);
  if (proposalResults.length > 0) {
    const pending = proposalResults.filter((r) => !r.applied).length;
    lines.push(
      `根据评估自动生成了 ${proposalResults.length} 个方案修改提案${pending > 0 ? `（${pending} 个待确认）` : "（已直接应用）"}，可在「提案确认」中查看。`
    );
  }
  if ((gaps || []).length > 0) {
    lines.push(`研究 gap：${gaps.join("；")}`);
  }
  lines.push("");
  lines.push("【评估报告】");
  lines.push(report.slice(0, 6000));

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
