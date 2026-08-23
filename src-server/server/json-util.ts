/**
 * 从 LLM 输出中提取第一个完整 JSON 对象（O-10）。
 * 之前用 /\{[\s\S]*\}/ 贪婪匹配：若输出含两个 JSON 对象，会从首个 { 一路吞到末个 }
 * 导致 JSON.parse 失败、整条数据丢弃。这里按深度配对定位首个 '{' 的匹配 '}'，
 * 并跳过字符串内（含转义 \"）的 { } " 干扰。
 */
/**
 * @param {any} raw
 * @returns {string|null}
 */
export function extractFirstJson(raw: any): string|null {
  const s = String(raw || '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
