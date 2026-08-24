/**
 * 动态边界 zod schema（方案 A 后半）：LLM 输出 / 外部 API 响应 / HTTP 请求体的运行时校验。
 * 原则：
 * - 请求体 schema 用于「明确拒绝」：结构不合法 → 400（替换手写散点检查）；
 * - LLM / 外部 API schema 用于「观测 + 容错」：safeParse 失败仅记日志，不改变既有降级行为
 *   （避免把「宽松容错」的健壮性改坏——错误源文档 rust-refactor-ai-correctness-assessment.md §4.4）。
 * - 不做 store.read 的每读校验（已有结构兜底 + version 归一化，重复解析是纯开销）。
 */

/**
 * @typedef {import("zod").infer<typeof TriageOutputSchema>} TriageOutput
 * @typedef {import("zod").infer<typeof ScheduleItemSchema>} ScheduleItem
 * @typedef {import("zod").infer<typeof OpenAlexWorkSchema>} OpenAlexWork
 * @typedef {import("zod").infer<typeof WorklogImportBodySchema>} WorklogImportBody
 * @typedef {import("zod").infer<typeof SettingsMetricsBodySchema>} SettingsMetricsBody
 */
import { z } from "zod";

// ── LLM 输出边界（triageWorkEntry / parseScheduleBlock） ────────────
// 与 llm.js 解析后的契约一致；字段全部 optional（LLM 输出天然可缺省，缺省走既有默认值）。

export const TriageOutputSchema = z.object({
  fields: z.array(z.object({ k: z.string(), v: z.string() })).optional(),
  citations: z.array(z.string()).optional(),
  system: z.string().optional(),
  taskProgress: z
    .array(z.object({ taskId: z.union([z.string(), z.number()]), progress: z.number(), reason: z.string() }))
    .optional(),
  events: z
    .array(
      z.object({
        title: z.string(),
        date: z.string(),
        startTime: z.string().nullable().optional(),
        type: z.string().optional(),
        reason: z.string().optional(),
      })
    )
    .optional(),
  durationHours: z.union([z.number(), z.string()]).nullable().optional(),
  startDate: z.string().nullable().optional(),
});

export const ScheduleItemSchema = z.object({
  title: z.string(),
  due: z.string(),
  type: z.string().optional(),
  linksTaskId: z.string().nullable().optional(),
  reason: z.string().optional(),
});

// ── 外部 API 边界（sources.js：OpenAlex 引用数） ──────────────────

export const OpenAlexWorkSchema = z.object({
  cited_by_count: z.union([z.number(), z.string(), z.null()]).optional(),
});

// ── HTTP 请求体边界（routes/api.js） ───────────────────────────────
// 结构不合法 → 400；业务级校验（空文本/年份范围/缺失字段）保留在路由内的显式判断，
// 以维持既有 error code（empty_text / missing_targets / missing_sessionId …）语义不变。

export const WorklogImportBodySchema = z.object({
  text: z.string(),
  dryRun: z.boolean().optional(),
});

export const SettingsMetricsBodySchema = z.object({
  targets: z.record(z.unknown()),
});
