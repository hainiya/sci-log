/**
 * log_work（v2 AI 编排版）：记录一次实验/研究工作汇报
 *
 * v2 架构差异（相对 v1 log-work.ts）：
 * - v1 在工具内部偷偷调 app 侧 LLM（triageWorkEntry / nextStepAdvice）做 AI 巡检。
 *   v2 无 app 侧 sampleText，改为「AI 编排」：调用本工具的 AI（模型）在调用前
 *   已理解记录内容，可直接通过参数传入结构化产出：
 *     fields（指标参数 [{k,v}]）、citations（文献 id[]）、system（材料体系）、
 *     progressUpdates（甘特进度）。工具忠实写入，不做第二遍 LLM。
 * - 保留纯规则逻辑：时长正则兜底、跨天长时程甘特建议（无 LLM）。
 * - 数据层走 ctx.resources（异步 store）。
 */
import { createStore } from "../lib/store.js";
import { newId } from "../lib/ids.js";

let _dataDir = null;
let _resources = null;
export function __setDataDir(dir) {
  _dataDir = dir;
}
export function __setResources(r) {
  _resources = r;
}

export const name = "log_work";

export const description =
  "记录一次实验/研究工作汇报：写入实验记录（AI 写即生效），可附指标参数 fields / 文献关联 citations / 材料体系 system / 甘特进度更新 progressUpdates；规则自动补全实验时长（从文本/数据提取），跨天时长给出甘特任务建议。不内置 LLM 巡检：结构化产出请由调用方判断后随参传入。";

export const parameters = {
  type: "object",
  properties: {
    content: { type: "string", description: "本次工作的内容描述（做了什么、结果如何）" },
    date: { type: "string", description: "记录日期，缺省为今天（YYYY-MM-DD）" },
    data: { type: "string", description: "实验数据/原始记录（可选，文本形式）" },
    durationHours: { type: "number", description: "实验时长（小时，可选）" },
    startDate: { type: "string", description: "实际时间线开始日期（可选，YYYY-MM-DD；缺省取记录日期）" },
    taskId: { type: "string", description: "关联的甘特任务 id（可选）" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          k: { type: "string", description: "指标键名（可带温度，如 ZT@823K）" },
          v: { type: "string", description: "值串（可带单位）" },
        },
        required: ["k", "v"],
      },
      description: "从本次记录提炼的性能指标参数（可选，AI 判断后传入）",
    },
    citations: {
      type: "array",
      items: { type: "string" },
      description: "关联的文献库条目 id 列表（可选）",
    },
    system: { type: "string", description: "材料体系（如 SnSe、Bi₂Te₃），可选" },
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

export async function execute(input = {}) {
  if (!_dataDir || !_resources) throw new Error("dataDir/resources 未注入");
  const store = createStore(_dataDir, _resources);

  const content = String(input.content || "").trim();
  if (!content) throw new Error("content 不能为空");

  const date = input.date || new Date().toISOString().slice(0, 10);
  // 日期合法性：拒绝未来日期（本地时区）
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date 格式须为 YYYY-MM-DD（got ${date}）`);
  if (date > today) throw new Error(`date 不能晚于今天（${date}）`);

  const durationHours =
    input.durationHours === undefined || input.durationHours === null || input.durationHours === ""
      ? null
      : Number(input.durationHours);
  if (durationHours !== null && (!Number.isFinite(durationHours) || durationHours <= 0)) {
    throw new Error("durationHours 必须为正数（小时）");
  }
  const startDate = input.startDate ? String(input.startDate).trim() : null;
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("startDate 格式须为 YYYY-MM-DD");
    if (startDate > today) throw new Error(`startDate 不能晚于今天（${startDate}）`);
  }

  const gantt = await store.read("gantt");
  const calendar = await store.read("calendar");

  // 1. 构造实验记录条目（AI 结构化产出直接并入）
  const worklogEntry = {
    id: newId("work"),
    date,
    content,
    data: input.data || null,
    durationHours,
    startDate,
    taskId: input.taskId || null,
    createdAt: store.now(),
    ...(Array.isArray(input.fields) && input.fields.length ? { fields: input.fields } : {}),
    ...(Array.isArray(input.citations) && input.citations.length ? { citations: input.citations } : {}),
    ...(input.system ? { system: String(input.system) } : {}),
  };

  // 2. 实验记录写入
  await store.update("worklog", undefined, (cur) => ({
    entries: [...(cur.entries || []), worklogEntry],
  }));

  // 3. 时长兜底：未填时长时，用规则从文本/数据提取
  let durationApplied = false;
  if (!worklogEntry.durationHours) {
    try {
      const joined = [String(content), String(input.data || "")].join("\n");
      const explicit = joined.match(/(?:总长|总共|总时长|共|约)\s*(\d+(?:\.\d+)?)\s*(h|hour|hours|小时|天|d|day|days)/i);
      let fallback = null;
      if (explicit) {
        const val = Number(explicit[1]);
        const unit = explicit[2].toLowerCase();
        fallback =
          unit === "h" || unit === "hour" || unit === "hours" || unit === "小时" ? val : val * 24;
      } else {
        const dataOnly = String(input.data || "");
        let total = 0;
        for (const m of [...dataOnly.matchAll(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?/gi)]) total += Number(m[1]);
        for (const m of [...dataOnly.matchAll(/(\d+(?:\.\d+)?)\s*h(?:our)?s?/gi)]) total += Number(m[1]) * 60;
        for (const m of [...dataOnly.matchAll(/(\d+(?:\.\d+)?)\s*天/gi)]) total += Number(m[1]) * 24 * 60;
        fallback = total > 0 ? Math.round((total / 60) * 10) / 10 : null;
      }
      if (fallback !== null) {
        await store.update("worklog", undefined, (cur) => ({
          entries: (cur.entries || []).map((e) =>
            e.id === worklogEntry.id ? { ...e, durationHours: fallback } : e
          ),
        }));
        worklogEntry.durationHours = fallback;
        durationApplied = true;
      }
    } catch (err) {
      // 时长兜底失败不阻塞
    }
  }

  // 4. 甘特进度更新（来自输入 progressUpdates）
  let progressCount = 0;
  for (const update of input.progressUpdates || []) {
    const task = (gantt.tasks || []).find((t) => t.id === update.taskId);
    if (!task) continue;
    const progress = Math.min(Math.max(Number(update.progress) || 0, 0), 100);
    await store.update("gantt", undefined, (cur) => ({
      tasks: (cur.tasks || []).map((t) => (t.id === update.taskId ? { ...t, progress } : t)),
    }));
    progressCount += 1;
  }

  // 5. 规则兜底：跨天长时程 → 甘特任务建议（纯规则，无 LLM）
  let fallbackGanttSuggestion = null;
  const joinedText = [String(content), String(input.data || "")].join("\n");
  const dur = worklogEntry.durationHours;
  if (dur !== null && dur !== undefined && Number(dur) >= 24) {
    const existingNames = new Set((gantt.tasks || []).map((t) => (t.name || "").trim().toLowerCase()));
    const title = `${worklogEntry.system ? worklogEntry.system + " " : ""}长时程实验`.trim();
    if (!existingNames.has(title.toLowerCase())) {
      let start = worklogEntry.startDate || null;
      if (!start) {
        const m = joinedText.match(/(\d{1,2})\/(\d{1,2})\s*(?:进炉|开始|启动|入炉|装炉)/);
        const m2 = joinedText.match(/(\d{1,2})月(\d{1,2})日\s*(?:开始|进炉|启动|入炉)/);
        if (m) {
          const mm = String(Number(m[1])).padStart(2, "0");
          const dd = String(Number(m[2])).padStart(2, "0");
          const candidate = `${date.slice(0, 4)}-${mm}-${dd}`;
          if (candidate <= date) start = candidate;
        } else if (m2) {
          const mm = String(Number(m2[1])).padStart(2, "0");
          const dd = String(Number(m2[2])).padStart(2, "0");
          const candidate = `${date.slice(0, 4)}-${mm}-${dd}`;
          if (candidate <= date) start = candidate;
        }
      }
      if (!start) start = date;
      const startMs = new Date(start + "T00:00:00").getTime();
      const endMs = startMs + Math.round(Number(dur) * 3600 * 1000);
      const endD = new Date(endMs);
      const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
      fallbackGanttSuggestion = { kind: "gantt", title, start, end, date: null, startTime: null, reason: "规则兜底：跨天实验时长" };
    }
  }

  const lines = [];
  lines.push(`工作汇报已记录（${date}）`);
  const enrichParts = [];
  if (Array.isArray(input.fields) && input.fields.length) enrichParts.push(`参数 ${input.fields.length} 项`);
  if (Array.isArray(input.citations) && input.citations.length) enrichParts.push(`文献 ${input.citations.length} 项`);
  if (input.system) enrichParts.push(`体系 ${input.system}`);
  if (enrichParts.length) lines.push(`结构化信息已并入：${enrichParts.join("、")}`);
  if (durationApplied) lines.push(`已按文本规则补全实验时长：${worklogEntry.durationHours} 小时`);
  if (progressCount > 0) lines.push(`甘特进度更新：${progressCount} 项（已直接应用）`);
  if (fallbackGanttSuggestion) {
    lines.push(
      `检测到可生成甘特任务（跨天长时程）：「${fallbackGanttSuggestion.title}」${fallbackGanttSuggestion.start} ~ ${fallbackGanttSuggestion.end}。如需创建请用 manage_schedule 添加。`
    );
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export default { name, description, parameters, execute };
