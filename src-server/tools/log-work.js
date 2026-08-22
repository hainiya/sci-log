/**
 * log_work：工作日志记录 + 甘特进度更新 + 下一步建议
 * - 实验记录写入（AI 写即生效，去提案）
 * - AI 巡检补全甘特进度与日程安排（直接写库）
 * - sampleText() 生成下一步提示（只读建议，不落库；结合已排日程避免冲突）
 */
import { createStore } from "../server/store.js";
import { nextStepAdvice, triageWorkEntry } from "../server/llm.js";
import { ensureAutoBinding } from "../server/binding.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const name = "log_work";
export const description =
  "记录一次实验/研究工作汇报：写入实验记录（AI 写即生效）、AI 巡检补全甘特进度与日程安排（直接写库）、可选手动更新甘特进度，并返回下一步行动建议。";
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
      description: "甘特图任务进度更新列表（可选，直接写库）",
    },
  },
  required: ["content"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "plugin_output",
    summary: "将工作汇报写入插件实验记录，并直接更新甘特进度（AI 写即生效）",
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

  // 0. 上下文预读（供 AI 巡检与建议共用；研究方案已移除，不再读取 plan）
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
    taskId: input.taskId || null,
    createdAt: store.now(),
  };

  // 2. AI 巡检本条记录（参数/文献抽取 + 甘特进度推断 + 日程识别）
  //    autoTriage 开关（宿主配置优先，回退 settings.json 旧值；默认 true）：关闭时跳过巡检 LLM 调用
  const autoTriage = toolCtx.config?.get?.("autoTriage") ?? store.read("settings")?.autoTriage ?? true;
  let triageSummary = null;
  let out = null;
  if (autoTriage) {
    try {
      out = await triageWorkEntry(toolCtx, {
        entries: [worklogEntry],
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
      if (out.system) worklogEntry.system = out.system; // 材料体系并入条目（随落库）
    }
  }

  // 3. 实验记录写入（AI 写即生效；参数/文献已并入条目）
  store.update("worklog", undefined, (cur) => ({
    entries: [...(cur.entries || []), worklogEntry],
  }));

  // 3.5 时长补全：记录未填时长且巡检提取到明确时长 → 直接写库（甘特实际时间线）
  if (out?.durationHours && !worklogEntry.durationHours) {
    try {
      store.update("worklog", undefined, (cur) => ({
        entries: (cur.entries || []).map((e) =>
          e.id === worklogEntry.id
            ? { ...e, durationHours: out.durationHours, ...(out.startDate ? { startDate: out.startDate } : {}) }
            : e
        ),
      }));
    } catch (err) {
      toolCtx?.log?.warn?.(`log_work duration enrich failed: ${err?.message || err}`);
    }
  }

  // 4. 巡检产出：甘特进度 + 日程（直接写库，与面板异步巡检一致）
  if (out) {
    for (const tp of out.taskProgress || []) {
      const task = (gantt.tasks || []).find((t) => t.id === tp.taskId);
      try {
        store.update("gantt", undefined, (cur) => ({
          tasks: (cur.tasks || []).map((t) => (t.id === tp.taskId ? { ...t, progress: tp.progress } : t)),
        }));
      } catch (err) {
        toolCtx?.log?.warn?.(`log_work gantt progress failed: ${err?.message || err}`);
      }
    }
    for (const ev of out.events || []) {
      try {
        store.append("calendar", [
          {
            id: newId("evt"),
            title: ev.title,
            date: ev.date,
            startTime: ev.startTime,
            endTime: null,
            type: ev.type,
            taskId: null,
          },
        ]);
      } catch (err) {
        toolCtx?.log?.warn?.(`log_work calendar append failed: ${err?.message || err}`);
      }
    }
    triageSummary = {
      fields: out.fields?.length || 0,
      citations: out.citations?.length || 0,
      gantt: (out.taskProgress || []).length,
      calendar: (out.events || []).length,
    };
  }

  // 5. 甘特进度更新（直接写库；来自用户输入 progressUpdates）
  let progressCount = 0;
  for (const update of input.progressUpdates || []) {
    const task = (gantt.tasks || []).find((t) => t.id === update.taskId);
    if (!task) continue;
    const progress = Math.min(Math.max(Number(update.progress) || 0, 0), 100);
    try {
      store.update("gantt", undefined, (cur) => ({
        tasks: (cur.tasks || []).map((t) => (t.id === update.taskId ? { ...t, progress } : t)),
      }));
      progressCount += 1;
    } catch (err) {
      toolCtx?.log?.warn?.(`log_work progress failed: ${err?.message || err}`);
    }
  }

  // 6. 下一步建议（含刚记录的条目 + 已排日程，避免与已排安排冲突）
  //    与巡检同受 autoTriage 开关控制：关闭时跳过 nextStepAdvice（LLM）
  let advice = "";
  let scheduleCount = 0;
  if (autoTriage) {
    try {
      const worklogWithNew = {
        ...store.read("worklog"),
        entries: [...(store.read("worklog").entries || []), worklogEntry],
      };
      const adviceObj = await nextStepAdvice(toolCtx, worklogWithNew, store.read("gantt"), calendar, date);
      advice = adviceObj.text || "";
      // 把下一步建议中可排程的具体行动，直接排入日历（与 triage events 去重）
      const existingCal = store.read("calendar").events || [];
      const triageKeys = new Set((out?.events || []).map((ev) => `${ev.title}|${ev.date}`));
      const sameDay = (d1, d2) => d1 && d2 && Math.abs(new Date(d1) - new Date(d2)) <= 2 * 86400000;
      for (const item of adviceObj.schedule || []) {
        if (triageKeys.has(`${item.title}|${item.due}`)) continue;
        if (existingCal.some((ev) => ev.title === item.title && sameDay(ev.date, item.due))) continue;
        try {
          store.append("calendar", [
            { id: newId("evt"), title: item.title, date: item.due, startTime: null, endTime: null, type: item.type, taskId: null },
          ]);
          scheduleCount += 1;
        } catch (err) {
          toolCtx?.log?.warn?.(`log_work schedule append failed: ${err?.message || err}`);
        }
      }
    } catch (err) {
      advice = `（建议生成失败：${err.message}）`;
    }
  }

  const lines = [];
  lines.push(`工作汇报已记录（${date}）`);
  if (triageSummary) {
    const parts = [];
    if (triageSummary.fields + triageSummary.citations > 0) {
      parts.push(`参数/文献 ${triageSummary.fields + triageSummary.citations} 项已并入本条`);
    }
    if (triageSummary.gantt > 0) parts.push(`甘特进度 ${triageSummary.gantt} 项`);
    if (triageSummary.calendar > 0) parts.push(`日程 ${triageSummary.calendar} 项`);
    if (parts.length > 0) {
      lines.push(`AI 已巡检本条并直接补全：${parts.join("、")}`);
    }
  }
  if (scheduleCount > 0) {
    lines.push(`AI 下一步建议已排入 ${scheduleCount} 条日程`);
  }
  if (progressCount > 0) {
    lines.push(`甘特进度更新：${progressCount} 项（已直接应用）`);
  }
  if (advice) {
    lines.push("");
    lines.push(`【下一步建议】\n${advice}`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
