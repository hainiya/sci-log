/**
 * SUGGESTIONS 机器块公共解析（消除三处重复实现：index.js / review-research.js / llm.js）
 * 只负责「提取块 + 解析 JSON」，过滤规则由各调用方按语义保留（review 多 target 白名单、
 * assess 仅 plan/update），避免行为漂移。
 */
const MARKER = "<!--SUGGESTIONS-->";

/**
 * review 类输出的建议白名单过滤（index.js splitSuggestions 与 review-research.js
 * parseSuggestions 共用同一规则，收在此处消除重复）。
 * 仅接受已知 target + create/update/delete 且带 diff 的建议，上限 limit 条。
 */
export function filterReviewSuggestions(parsed, limit = 8) {
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  return suggestions
    .filter(
      (s) =>
        s &&
        s.diff &&
        typeof s.diff === "object" &&
        !Array.isArray(s.diff) && // D6（复审）：与 llm.js parsePlanAssessment 同口径——LLM 输出字符串 diff 时
        // `{...diff}` 会展开成 {0:'a',1:'b'} 索引对象落库成垃圾条目，此处拦截
        ["plan", "gantt", "calendar", "worklog", "literature"].includes(s.target) &&
        ["create", "update", "delete"].includes(s.action)
    )
    .slice(0, limit);
}

/**
 * @param {string} raw LLM 原始输出
 * @returns {{ report: string, parsed: object|null }}
 *   report：剥离机器块后的正文；parsed：解析出的 JSON 对象（无块/解析失败为 null）
 */
export function parseSuggestionBlock(raw) {
  const text = String(raw ?? "");
  const idx = text.indexOf(MARKER);
  if (idx === -1) return { report: text.trim(), parsed: null };
  const report = text.slice(0, idx).trim();
  const block = text.slice(idx + MARKER.length).trim();
  try {
    // 贪婪匹配：取第一个 { 到最后一个 } 的整块 JSON（LLM 可能在块内混入解释文本，
    // 若块内含多个花括号段会被吞并导致解析失败，此时整体返回 null——与旧实现一致）
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    return { report, parsed: jsonMatch ? JSON.parse(jsonMatch[0]) : null };
  } catch {
    return { report, parsed: null };
  }
}
