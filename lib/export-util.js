/**
 * 导出工具（自 v1 export-util.ts 平移，纯函数）
 */
export function safeName(value) {
  return (
    String(value || "export")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "export"
  );
}

/** 把实验记录 entries 渲染为 Markdown（每条：## 日期（任务） + 正文 + 数据块） */
export function renderWorklogMarkdown(entries) {
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
