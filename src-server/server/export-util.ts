/**
 * 导出工具（O-4 DRY）：safeName 与「实验记录 Markdown 渲染」此前在
 * routes/export.js 与 tools/export-report.js 各有一份，现统一到此，避免双份逻辑漂移。
 * @typedef {import("./types.ts").WorklogEntry} WorklogEntry
 */

/**
 * @param {any} value
 * @returns {string}
 */
export function safeName(value: any): string {
  return (
    String(value || "export")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "export"
  );
}

/** 把实验记录 entries 渲染为 Markdown（每条：## 日期（任务） + 正文 + 数据块）
 * @param {WorklogEntry[]} entries
 * @returns {string}
 */
export function renderWorklogMarkdown(entries: import("./types.ts").WorklogEntry[]): string {
  const lines = ["# 实验记录", ""];
  for (const entry of entries || []) {
    lines.push(`## ${entry.date || ""}${entry.taskId ? `（任务：${entry.taskId}）` : ""}`);
    lines.push("");
    lines.push(String(entry.content || ""));
    if (entry.data) {
      lines.push("");
      lines.push("**数据**");
      lines.push("");
      lines.push("```");
      lines.push(String(entry.data).slice(0, 2000));
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}
