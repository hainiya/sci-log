/**
 * log_work：工作日志记录 + 甘特进度更新 + 下一步建议
 * - 实验记录写入（提案）
 * - 甘特图进度更新（提案，progressUpdates）
 * - sampleText() 生成结合研究方案的下一步提示（只读建议，不落库）
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { nextStepAdvice, triageWorkEntry } from "../server/llm.js";
import { rebalanceSchedule, proposeRedoTask, parseDate, diffDays, DATE_RE } from "../server/schedule-rebalance.js";
import { ensureAutoBinding } from "../server/binding.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const name = "log_work";
export const description =
  "记录一次实验/研究工作汇报：写入实验记录、AI 巡检补全甘特进度与日程安排（提案待确认）、可选手动更新甘特进度，并返回结合研究方案与已排日程的下一步行动建议。写入动作以提案形式提交，确认后生效。";
export const parameters = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "本次工作的内容描述（做了什么、结果如何）",
    },
    date: {
      type: "string",
      description: "记录日期，缺省为今天（YYYY-MM-DD）",
    },
    data: {
      type: "string",
      description: "实验数据/原始记录（可选，文本形式）",
    },
    durationHours: {
      type: "number",
      description: "实验时长（小时，可选；填写后甘特图会投影实际时间线）",
    },
    startDate: {
      type: "string",
      description: "实际时间线开始日期（可选，YYYY-MM-DD；缺省取记录日期）",
    },
    taskId: {
      type: "string",
      description: "关联的甘特任务 id（可选）",
    },
    progressUpdates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "甘特任务 id" },
          progress: { type: "number", description: "完成度 0-100" },
        },
        required: ["taskId", "progress"],
      },
      description: "甘特图任务进度更新列表（可选，走提案确认）",
    },
  },
  required: ["content"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "将工作汇报写入插件实验记录并生成甘特进度更新提案",
    ruleId: "materials-research-copilot-plugin-output",
  }),
};

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const content = String(input.content || "").trim();
  if (!content) throw new Error("content 不能为空");
  ensureAutoBinding(toolCtx);

  const date = input.date || new Date().toISOString().slice(0, 10);
  // 日期合法性：拒绝未来日期（本地时区，与面板路径一致；UTC 在凌晨会误判）
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  if (date > today) throw new Error(`date 不能晚于今天（${date}）`);

  // 时长/开始日：供甘特图投影实际时间线（可选，但填了必须合法）
  const durationHours =
    input.durationHours === undefined || input.durationHours === null || input.durationHours === ""
      ? null
      : Number(input.durationHours);
  if (durationHours !== null && (!Number.isFinite(durationHours) || durationHours <= 0)) {
    throw new Error(`durationHours 必须为正数（小时）`);
  }
  const startDate = input.startDate ? String(input.startDate).trim() : null;
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`startDate 格式须为 YYYY-MM-DD`);
    if (startDate > today) throw new Error(`startDate 不能晚于今天（${startDate}）`);
  }

  // 0. 上下文预读（供 AI 巡检与建议共用）
  const plan = store.read("plan");
  const gantt = store.read("gantt");
  const literature = store.read("literature");
  const calendar = store.read("calendar");

  // 1. 构造实验记录条目
  const worklogEntry = {
    id: newId("work"),
    date,
    content,
    data: input.data || null,
    durationHours,
    startDate,
    planVersion: plan.version,
    taskId: input.taskId || null,
    createdAt: store.now(),
  };

  // 2. AI 巡检本条记录（与面板写入路径一致：参数/文献抽取 + 甘特进度推断 + 日程识别）
  //    用 triageWorkEntry 一次性产出，替代原先 enrichWorkEntry（避免重复抽取），
  //    并补上原先缺失的「甘特进度 + 日程」提案，使对话记录与面板记录行为一致。
  //    autoTriage 开关（宿主配置优先，回退 settings.json 旧值；默认 true）：关闭时跳过巡检 LLM 调用；
  //    衍生提案块（3.5 时长 / 4 甘特日程 / 4.5 重做）依赖 out，out=null 时自然跳过；
  //    P0-1 排程提案在步骤 6 内一并受控；步骤 5（用户显式 progressUpdates）不受影响。
  const autoTriage = toolCtx.config?.get?.("autoTriage") ?? store.read("settings")?.autoTriage ?? true;
  let triageSummary = null;
  let out = null;
  if (autoTriage) {
    try {
      out = await triageWorkEntry(toolCtx, {
        entries: [worklogEntry],
        plan,
        gantt,
        literature,
        today: date,
      });
    } catch (err) {
      toolCtx?.log?.warn?.(`log_work triage failed: ${err?.message || err}`);
    }
    if (out) {
      if (out.fields?.length) worklogEntry.fields = out.fields;
      if (out.citations?.length) worklogEntry.citations = out.citations;
      if (out.system) worklogEntry.system = out.system; // 材料体系并入条目（随 create 提案落库）
    }
  }

  // 3. 实验记录写入（提案；参数/文献已并入条目）
  const worklogVersion = store.read("worklog").version;
  const worklogResult = createProposal(store, {
    target: "worklog",
    action: "create",
    diff: worklogEntry,
    reason: `记录工作汇报（${date}）：${content.slice(0, 60)}`,
    baseVersion: worklogVersion,
  });

  // 3.5 时长提案：记录未填时长且巡检提取到明确时长 → 提案确认后落库（甘特实际时间线）
  //     与面板巡检（triage.js 1.5 步）语义一致；手动已填时长时手动值优先，不再生成
  //     已有同记录 pending 时长提案时跳过（与 triage.js 1.5 对称，防重复提案）
  if (out?.durationHours && !worklogEntry.durationHours) {
    const pendingDur = (store.read("proposals").entries || []).some(
      (p) => p.status === "pending" && p.meta?.worklogEntryId === worklogEntry.id && p.diff?.durationHours != null
    );
    if (!pendingDur) {
      try {
        createProposal(store, {
          target: "worklog",
          action: "update",
          diff: { id: worklogEntry.id, durationHours: out.durationHours, ...(out.startDate ? { startDate: out.startDate } : {}) },
          reason: `AI 巡检「${String(worklogEntry.content || "").slice(0, 40)}」→ 提取实验时长 ${out.durationHours} 小时${out.startDate ? `（${out.startDate} 开始）` : ""}`,
          baseVersion: worklogVersion,
          meta: { auto: true, kind: "triage", worklogEntryId: worklogEntry.id },
        });
      } catch (err) {
        toolCtx?.log?.warn?.(`log_work duration proposal failed: ${err?.message || err}`);
      }
    }
  }

  // 4. 巡检产出：甘特进度 + 日程提案（均为待确认提案，与面板异步巡检一致）
  if (out) {
    const ganttVersion = store.read("gantt").version;
    for (const tp of out.taskProgress || []) {
      const task = (gantt.tasks || []).find((t) => t.id === tp.taskId);
      try {
        createProposal(store, {
          target: "gantt",
          action: "update",
          diff: { id: tp.taskId, progress: tp.progress },
          reason: `AI 巡检「${content.slice(0, 40)}」→ 任务「${task?.name || tp.taskId}」进度 ${tp.progress}%（${tp.reason || ""}）`,
          baseVersion: ganttVersion,
          meta: { auto: true, kind: "triage", worklogEntryId: worklogEntry.id },
        });
      } catch (err) {
        toolCtx?.log?.warn?.(`log_work gantt proposal failed: ${err?.message || err}`);
      }
    }
    const calendarVersion = store.read("calendar").version;
    for (const ev of out.events || []) {
      try {
        createProposal(store, {
          target: "calendar",
          action: "create",
          diff: { id: newId("evt"), title: ev.title, date: ev.date, startTime: ev.startTime, type: ev.type },
          reason: `AI 巡检识别安排：${ev.title}（${ev.date}${ev.startTime ? " " + ev.startTime : ""}；${ev.reason || "来自实验记录"}）`,
          baseVersion: calendarVersion,
          meta: { auto: true, kind: "triage", worklogEntryId: worklogEntry.id },
        });
      } catch (err) {
        toolCtx?.log?.warn?.(`log_work calendar proposal failed: ${err?.message || err}`);
      }
    }
    triageSummary = {
      fields: out.fields?.length || 0,
      citations: out.citations?.length || 0,
      gantt: (out.taskProgress || []).length,
      calendar: (out.events || []).length,
      planNote: out.planNote || null,
    };
  }

  // 4.5 失败重做提案（P0-3）：记录识别为实验未达预期且关联了任务时，复制原任务排重做
  let redoCount = 0;
  if (out?.needRedo && worklogEntry.taskId) {
    try {
      redoCount = proposeRedoTask(toolCtx, store, {
        taskId: worklogEntry.taskId,
        reason: out.redoReason || "实验记录表明未达预期",
        worklogEntryId: worklogEntry.id,
        today: date,
      });
    } catch (err) {
      toolCtx?.log?.warn?.(`log_work redo proposal failed: ${err?.message || err}`);
    }
  }

  // 5. 甘特进度更新（提案，逐个；来自用户输入 progressUpdates）
  const progressResults = [];
  for (const update of input.progressUpdates || []) {
    const task = (gantt.tasks || []).find((t) => t.id === update.taskId);
    if (!task) continue;
    const progress = Math.min(Math.max(Number(update.progress) || 0, 0), 100);
    const result = createProposal(store, {
      target: "gantt",
      action: "update",
      diff: { id: update.taskId, progress },
      reason: `任务「${task.name || update.taskId}」进度更新为 ${progress}%`,
      baseVersion: gantt.version,
    });
    progressResults.push(result);
  }

  // 6. 下一步建议（含刚记录的条目 + 已排日程，避免与已排安排冲突）
  //    与巡检同受 autoTriage 开关控制：关闭时跳过 nextStepAdvice（LLM）与 P0-1 排程提案
  let advice = "";
  let scheduleCount = 0;
  if (autoTriage) {
    try {
      const worklogWithNew = {
        ...store.read("worklog"),
        entries: [...(store.read("worklog").entries || []), worklogEntry],
      };
      const adviceObj = await nextStepAdvice(toolCtx, plan, worklogWithNew, store.read("gantt"), calendar, date);
      advice = adviceObj.text || "";

      // P0-1：把下一步建议中可排程的具体行动，生成日历提案（与 triage events / 已有日历去重）
      const existingCal = store.read("calendar").events || [];
      const triageKeys = new Set((out?.events || []).map((ev) => `${ev.title}|${ev.date}`));
      for (const item of adviceObj.schedule || []) {
        const key = `${item.title}|${item.due}`;
        if (triageKeys.has(key)) continue;
        const dueDt = parseDate(item.due);
        const dup = existingCal.some(
          (ev) => ev.title === item.title && ev.date && dueDt && Math.abs(diffDays(parseDate(ev.date), dueDt)) <= 2
        );
        if (dup) continue;
        try {
          createProposal(store, {
            target: "calendar",
            action: "create",
            diff: { id: newId("evt"), title: item.title, date: item.due, startTime: null, type: item.type },
            reason: `AI 下一步建议排入日程：${item.reason || item.title}`,
            baseVersion: store.read("calendar").version,
            meta: { auto: true, kind: "advice" },
          });
          scheduleCount += 1;
        } catch (err) {
          toolCtx?.log?.warn?.(`log_work schedule proposal failed: ${err?.message || err}`);
        }
      }
    } catch (err) {
      advice = `（建议生成失败：${err.message}）`;
    }
  }

  // 7. 滞后再平衡（P0-2）：基于当前甘特状态，顺延滞后任务的下游 + 关联日历
  let rebalanceCount = 0;
  try {
    const rb = rebalanceSchedule(toolCtx, store);
    rebalanceCount = rb.proposals || 0;
  } catch (err) {
    toolCtx?.log?.warn?.(`log_work rebalance failed: ${err?.message || err}`);
  }

  const lines = [];
  lines.push(
    `工作汇报已记录（${date}）${worklogResult.applied ? "（已直接应用）" : `，生成提案 ${worklogResult.entry.id} 待确认`}`
  );
  if (triageSummary) {
    const parts = [];
    if (triageSummary.fields + triageSummary.citations > 0) {
      parts.push(`参数/文献 ${triageSummary.fields + triageSummary.citations} 项已并入本条`);
    }
    if (triageSummary.gantt > 0) parts.push(`甘特进度 ${triageSummary.gantt} 项`);
    if (triageSummary.calendar > 0) parts.push(`日程 ${triageSummary.calendar} 项`);
    if (parts.length > 0) {
      lines.push(`AI 已巡检本条，生成补全提案：${parts.join("、")}，请在提案面板确认`);
    }
  }
  if (redoCount > 0) {
    lines.push(`AI 识别实验未达预期，已生成 ${redoCount} 条重做日程提案（甘特重做任务 + 日历事件），请在提案面板确认`);
  }
  if (scheduleCount > 0) {
    lines.push(`AI 下一步建议已生成 ${scheduleCount} 条日程提案，请在提案面板确认`);
  }
  if (rebalanceCount > 0) {
    lines.push(`AI 滞后再平衡：已生成 ${rebalanceCount} 条顺延提案（滞后任务的下游 + 关联日历），请在提案面板确认`);
  }
  if (progressResults.length > 0) {
    const pending = progressResults.filter((r) => !r.applied).length;
    lines.push(
      `甘特进度更新：${progressResults.length} 项${pending > 0 ? `，其中 ${pending} 项提案待确认` : "（已直接应用）"}`
    );
  }
  if (advice) {
    lines.push("");
    lines.push(`【下一步建议】\n${advice}`);
  }
  if (triageSummary?.planNote) {
    lines.push("");
    lines.push(`【AI 观察】\n${triageSummary.planNote}`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
