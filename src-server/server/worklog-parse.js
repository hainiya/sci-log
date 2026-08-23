import { extractFirstJson } from "./json-util.js";

/**
 * parseDraft —— LLM 输出字符串 → 实验记录草稿对象的纯函数模块。
 *
 * 刻意约束：本文件不 import 任何 @hana 模块，也不 import 项目内其它模块，
 * 因此 node --test 可以独立加载它做单元测试（tests/worklog-gen.test.mjs），
 * 无需宿主 bus / pluginDir 环境（task-2-brief 修正点 ①）。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 清洗可选字符串字段：非字符串或 trim 后为空 → null；否则截断到 max 字符
 * @param {unknown} v
 * @param {number} max
 * @returns {string|null}
 */
function cleanStr(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

/** 时长（小时）：正数保留 1 位小数；缺失/非数值/非正 → null（与 llm.js triageWorkEntry 同规则）
 * @param {unknown} v
 * @returns {number|null}
 */
function cleanDurationHours(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

/**
 * 解析 LLM 输出为实验记录草稿。返回 null 表示无法构成草稿：
 * 空输入 / 文本中无 {...} / JSON 非法 / content 缺失或为空。
 * @param {unknown} rawText
 * @returns {null | {
 *   content: string,
 *   sampleId: string | null,
 *   system: string | null,
 *   data: string | null,
 *   taskId: string | null,
 *   durationHours: number | null,
 *   startDate: string | null,
 * }}
 */
export function parseDraft(rawText) {
  const raw = String(rawText ?? "").trim();
  if (!raw) return null;
  const json = extractFirstJson(raw);
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // content 必填，截 300
  const content = typeof parsed.content === "string" ? parsed.content.trim().slice(0, 300) : "";
  if (!content) return null;

  return {
    content,
    sampleId: cleanStr(parsed.sampleId, 40),
    system: cleanStr(parsed.system, 50),
    data: cleanStr(parsed.data, 1500),
    taskId: typeof parsed.taskId === "string" ? parsed.taskId.trim() || null : null,
    durationHours: cleanDurationHours(parsed.durationHours),
    startDate: DATE_RE.test(parsed.startDate ?? "") ? parsed.startDate : null,
  };
}
