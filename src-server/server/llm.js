/**
 * LLM 封装层：宿主 sampleText helper 调用 + prompt 组装
 * 底层通道：@hana/plugin-runtime 的 sampleText()（→ bus.request('model:sample-text')，宿主公开契约 stability: stable）
 * 本层自有的增强（宿主不提供）：并发信号量 / 超时分层 / critical 重试 / 调用点日志
 */
import fs from "node:fs";
import path from "node:path";
import { sampleText as hanaSampleText } from "@hana/plugin-runtime";

const DEFAULT_TIMEOUT = 120000;

/**
 * D2 并发信号量：限制同时进行的核心 LLM 调用数。
 * 自动搜集 / 报告 / 审查 / PDF 摘要共享同一信号量，避免同窗口多路调用互相挤压导致 LLM_TIMEOUT。
 */
class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    this.active = Math.max(0, this.active - 1);
    if (this.queue.length > 0 && this.active < this.limit) {
      this.active += 1;
      this.queue.shift()();
    }
  }
}
const LLM_SEM = new Semaphore(2);

function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages || []) {
    chars += typeof m?.content === "string" ? m.content.length : 0;
  }
  return Math.ceil(chars / 4); // 粗估：4 字符 ≈ 1 token
}

function isTimeoutError(err) {
  return /timeout/i.test(err?.message || err?.cause?.message || err?.code || String(err));
}

export async function sampleText(ctx, input) {
  if (!ctx?.bus?.request) {
    throw new Error("plugin bus request unavailable");
  }
  const callPoint = input.callPoint || "sampleText";
  const critical = Boolean(input.critical);
  // D2 超时分层：关键路径（报告/审查）放宽到 200s 且失败重试一次；非关键路径默认 120s 不重试
  const timeoutMs = input.timeoutMs ?? (critical ? 200000 : DEFAULT_TIMEOUT);
  const maxAttempts = critical ? 2 : 1;
  const inputSize = estimateTokens(input.messages);
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await LLM_SEM.acquire();
    try {
      // 官方 helper：自动补 pluginId，options.timeout 透传 EventBus.request（默认 30s，可覆盖）
      const result = await hanaSampleText(
        ctx,
        {
          messages: input.messages,
          maxTokens: input.maxTokens ?? 1200,
          temperature: input.temperature ?? 0.4,
        },
        { timeout: timeoutMs }
      );
      return result;
    } catch (err) {
      lastErr = err;
      if (isTimeoutError(err)) {
        ctx?.log?.warn(`LLM_TIMEOUT [${callPoint}] attempt ${attempt + 1}/${maxAttempts} input≈${inputSize}tok, timeout=${timeoutMs}ms`);
        if (attempt < maxAttempts - 1) continue; // 重试一次
        ctx?.log?.warn(`LLM_TIMEOUT [${callPoint}] 重试后仍超时，放弃`);
      } else {
        ctx?.log?.warn(`LLM error [${callPoint}]: ${err?.message || String(err)}`);
      }
      throw err;
    } finally {
      LLM_SEM.release();
    }
  }
  throw lastErr || new Error("LLM call failed");
}

function readPrompt(ctx, name) {
  try {
    return fs.readFileSync(path.join(ctx.pluginDir, "prompts", name), "utf-8");
  } catch {
    return "";
  }
}

/** 从用户消息提取检索关键词（文献自动搜集用） */
export async function extractKeywords(ctx, text) {
  const base = readPrompt(ctx, "keyword-extractor.md");
  const result = await sampleText(ctx, {
    messages: [
      { role: "system", content: base },
      { role: "user", content: text },
    ],
    maxTokens: 200,
    temperature: 0.2,
  });
  const raw = String(result?.text || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((k) => String(k).trim()).filter(Boolean);
  } catch {}
  return raw
    .split(/[,，;；\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * C3：从全文生成 2-3 句摘要（abstract 为空的 Zotero 条目用）
 */
export async function summarizeFromFulltext(ctx, entry, text) {
  const result = await sampleText(ctx, {
    messages: [
      {
        role: "system",
        content:
          "你是材料科学文献摘要助手。根据论文全文开头部分，用中文写 2-3 句摘要：该文研究什么、方法是什么、关键结论。只输出摘要正文，不要标题和解释。",
      },
      {
        role: "user",
        content: `论文标题：${entry.title || ""}（${entry.year || ""}）\n\n全文节选：\n${String(text || "").slice(0, 30000)}`,
      },
    ],
    maxTokens: 300,
    temperature: 0.3,
  });
  const summary = String(result?.text || "").trim();
  return summary.length >= 20 ? summary : null;
}

/**
 * 文献关键词提取：从摘要或全文提取 3-5 个中文关键词（逗号分隔）
 * 返回 string[]；失败返回 null（不阻塞增强链路）
 * 命名 extractLiteratureKeywords 而非 extractKeywords：
 * 后者已被 B1 检索关键词提取占用（同名导出在 ES module 中直接 SyntaxError）
 */
export async function extractLiteratureKeywords(ctx, entry, text) {
  const out = await sampleText(ctx, {
    callPoint: "extractLiteratureKeywords",
    messages: [
      { role: "system", content: "你是材料科学文献关键词提取助手。根据论文标题与摘要/全文，提取 3-5 个最能概括主题的中文关键词。只输出 JSON 数组字符串，如 [\"关键词1\",\"关键词2\"]，不要解释。" },
      { role: "user", content: `标题：${entry.title || ""}（${entry.year || ""}）\n\n来源文本：\n${String(text || "").slice(0, 12000)}` },
    ],
    maxTokens: 200,
    temperature: 0.2,
  });
  const raw = String(out?.text || "").trim();
  if (!raw) return null;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    const kws = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    return kws.length >= 1 ? kws : null;
  } catch {
    return null;
  }
}

/**
 * E2：英文摘要 → 中文翻译（材料术语保真，保留原文对照用 abstractEn）
 */
export async function translateAbstract(ctx, entry, abstractEn) {
  const result = await sampleText(ctx, {
    callPoint: "translateAbstract",
    messages: [
      {
        role: "system",
        content:
          "你是材料科学文献翻译助手。把英文摘要翻译成准确的中文：材料名称、术语、单位、数值必须保真（如 SnSe 保留为 SnSe，Seebeck coefficient 译为塞贝克系数）。只输出译文正文，不要标题、解释或原文。",
      },
      {
        role: "user",
        content: `论文标题：${entry.title || ""}（${entry.year || ""}）\n\n英文摘要：\n${String(abstractEn || "").slice(0, 4000)}`,
      },
    ],
    maxTokens: 600,
    temperature: 0.3,
  });
  const translated = String(result?.text || "").trim();
  return translated.length >= 20 ? translated : null;
}

/**
 * 实验记录 AI 巡检：参数结构化 + 文献关联 + 甘特进度推断 + 日程识别 + 方案对比
 * 一次 LLM 调用输出全部结果；解析失败返回 null（不阻塞主流程）
 */
export async function triageWorkEntry(ctx, { entries, gantt, literature, today }) {
  const base = readPrompt(ctx, "worklog-triage.md");
  const litList = (literature?.entries || [])
    .slice(-120)
    .map((e) => ({
      id: e.id || e.zoteroKey || null,
      zoteroKey: e.zoteroKey || null,
      title: e.title,
      doi: e.doi || null,
      keywords: (e.keywords || []).slice(0, 8),
    }))
    .filter((e) => e.id);
  const taskList = (gantt?.tasks || []).map((t) => ({
    id: t.id,
    name: t.name,
    progress: Number(t.progress) || 0,
  }));
  const docs = {
    today: today || new Date().toISOString().slice(0, 10),
    "实验记录": (entries || []).map((e) => ({
      id: e.id,
      sampleId: e.sampleId || null,
      date: e.date || null,
      content: String(e.content || "").slice(0, 2000),
      data: String(e.data || "").slice(0, 1500) || null,
      taskId: e.taskId || null,
    })),
    "甘特任务": taskList,
    "文献库": litList,
  };

  const result = await sampleText(ctx, {
    callPoint: "triageWorkEntry",
    messages: [
      { role: "system", content: base },
      { role: "user", content: JSON.stringify(docs, null, 2) },
    ],
    maxTokens: 900,
    temperature: 0.2,
  });

  const raw = String(result?.text || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    ctx?.log?.warn("triageWorkEntry: LLM 输出非 JSON，跳过巡检");
    return null;
  }

  const taskIds = new Set(taskList.map((t) => t.id));
  const fields = Array.isArray(parsed?.fields)
    ? parsed.fields
        .filter((f) => f && typeof f.k === "string" && f.k.trim())
        .slice(0, 10)
        .map((f) => ({ k: f.k.trim(), v: String(f.v ?? "").trim() }))
        .filter((f) => f.v)
    : [];
  const citations = Array.isArray(parsed?.citations)
    ? parsed.citations.map((c) => String(c).trim()).filter(Boolean).slice(0, 5)
    : [];
  // 材料体系：记录能明确判断时填标准名，无法判断为空字符串（供提案回填/落库）；限长防自由文本
  const system = typeof parsed?.system === "string" ? parsed.system.trim().slice(0, 50) : "";
  const taskProgress = Array.isArray(parsed?.taskProgress)
    ? parsed.taskProgress
        .filter((tp) => tp && taskIds.has(String(tp.taskId)))
        .map((tp) => {
          const p = Math.min(100, Math.max(0, Number(tp.progress) || 0));
          return { taskId: String(tp.taskId), progress: Math.round(p), reason: String(tp.reason || "").slice(0, 60) };
        })
        .filter((tp) => tp.reason)
        .slice(0, 3)
    : [];
  const events = Array.isArray(parsed?.events)
    ? parsed.events
        .filter((ev) => ev && typeof ev.title === "string" && ev.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || "")))
        .map((ev) => ({
          title: String(ev.title).trim().slice(0, 80),
          date: String(ev.date),
          startTime: typeof ev.startTime === "string" && /^\d{2}:\d{2}$/.test(ev.startTime) ? ev.startTime : null,
          type: ["experiment", "meeting", "deadline", "other"].includes(ev.type) ? ev.type : "other",
          reason: String(ev.reason || "").slice(0, 60),
        }))
        .slice(0, 3)
    : [];

  // 实验时长：明确持续时长（小时），供甘特图投影实际时间线
  const rawDur = parsed?.durationHours;
  const durationHours =
    rawDur === null || rawDur === undefined || rawDur === "" || !Number.isFinite(Number(rawDur)) || Number(rawDur) <= 0
      ? null
      : Math.round(Number(rawDur) * 10) / 10;
  const startDate =
    typeof parsed?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) && parsed.startDate <= localTodayStr()
      ? parsed.startDate
      : null;

  return { fields, citations, system, taskProgress, events, durationHours, startDate };
}

/** 本地时区今天（YYYY-MM-DD），用于 startDate 不晚于今天的保守校验 */
function localTodayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SCHEDULE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析 next-step-advisor 输出中的 <!--SCHEDULE--> JSON 块。
 * 返回结构化日程意图数组（已校验 due 为合法绝对日期，且 >= 今天）。
 */
function parseScheduleBlock(raw, today, maxItems = 5) {
  const marker = "<!--SCHEDULE-->";
  const idx = String(raw || "").indexOf(marker);
  if (idx === -1) return [];
  const block = raw.slice(idx + marker.length).trim();
  try {
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    const list = Array.isArray(parsed?.schedule) ? parsed.schedule : [];
    const todayStr = today || new Date().toISOString().slice(0, 10);
    return list
      .filter(
        (it) =>
          it &&
          typeof it.title === "string" &&
          it.title.trim() &&
          typeof it.due === "string" &&
          SCHEDULE_DATE_RE.test(it.due) &&
          it.due >= todayStr // 不得早于今天
      )
      .map((it) => ({
        title: String(it.title).trim().slice(0, 40),
        due: String(it.due),
        type: ["experiment", "meeting", "deadline", "other"].includes(it.type) ? it.type : "other",
        linksTaskId: typeof it.linksTaskId === "string" && it.linksTaskId.trim() ? it.linksTaskId.trim() : null,
        reason: String(it.reason || "").slice(0, 60),
      }))
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

/**
 * 生成下一步行动建议（log_work 后返回）
 * 上下文含：近期实验记录（含刚记录的新条目）/ 时间表 / 已排日程（避免与已排安排冲突）
 * 返回 { text, schedule }：text 为可读建议；schedule 为可排入日程的结构化意图（P0 闭环用）
 */
export async function nextStepAdvice(ctx, worklog, gantt, calendar, today) {
  const base = readPrompt(ctx, "next-step-advisor.md");
  const docs = {
    worklog: JSON.stringify((worklog?.entries || []).slice(-10), null, 2),
    gantt: JSON.stringify((gantt?.tasks || []), null, 2),
    calendar: JSON.stringify((calendar?.events || []).slice(-20), null, 2),
  };
  const result = await sampleText(ctx, {
    messages: [
      { role: "system", content: base },
      {
        role: "user",
        content: `近期实验记录：\n${docs.worklog}\n\n时间表：\n${docs.gantt}\n\n已排日程：\n${docs.calendar}`,
      },
    ],
    maxTokens: 800,
    temperature: 0.4,
  });
  const raw = String(result?.text || "").trim();
  const text = raw.split("<!--SCHEDULE-->")[0].trim();
  const schedule = parseScheduleBlock(raw, today);
  return { text, schedule };
}

