/**
 * export_report：导出工具
 * 生成文件到 ctx.dataDir/exports/ → toolCtx.stageFile() 投递 SessionFile → 会话中出现下载卡片
 * 不手写本地路径、不生成 file:// 链接、不经 iframe 直接下载
 */
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../server/store.js";
import { ensureAutoBinding } from "../server/binding.js";

function safeName(value) {
  return (
    String(value || "export")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "export"
  );
}

export const name = "export_report";
export const description =
  "导出科研工作的内容为文件（审查报告/文献分析报告/BibTeX/实验记录），通过 SessionFile 下载卡片投递到会话。";
export const parameters = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["review", "report", "bibtex", "worklog"],
      description: "review=审查报告；report=文献分析报告；bibtex=文献库 BibTeX；worklog=实验记录",
    },
    id: {
      type: "string",
      description: "指定某次审查报告的 id（type=review 时可选，缺省导出最新）",
    },
  },
  required: ["type"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "session_file_output",
    summary: "在插件数据目录生成导出文件并注册为 SessionFile 下载卡片",
    ruleId: "materials-research-copilot-export-session-file",
  }),
};

export async function execute(input = {}, toolCtx) {
  const sessionRef =
    toolCtx.sessionRef ||
    (toolCtx.sessionId ? { sessionId: toolCtx.sessionId, sessionPath: toolCtx.sessionPath || null } : null);
  if (!sessionRef?.sessionId) {
    return {
      content: [
        {
          type: "text",
          text: "当前没有可用的会话上下文，无法投递下载卡片。请在对话中直接说『导出审查报告 / 导出文献分析报告 / 导出 BibTeX / 导出实验记录』，由助手在会话上下文中执行本工具。",
        },
      ],
    };
  }
  if (!toolCtx.stageFile) {
    throw new Error("export_report 需要宿主 stageFile 能力");
  }

  const store = createStore(toolCtx.dataDir);
  const type = input.type;
  const id = input.id || null;
  ensureAutoBinding(toolCtx);

  let content = "";
  let label = "";

  if (type === "review") {
    const reviews = store.read("reviews");
    const review = id
      ? (reviews.entries || []).find((r) => r.id === id)
      : (reviews.entries || []).at(-1);
    if (!review) {
      return {
        content: [{ type: "text", text: "还没有审查报告。先在对话中说『审查我的研究进展』生成一份，再导出。" }],
      };
    }
    content = `# 审查报告\n\n- 日期：${review.date || ""}\n- 审查对象：${review.target || "研究进展"}\n\n${review.report || ""}\n`;
    label = `审查报告-${(review.date || "latest").slice(0, 10)}.md`;
  } else if (type === "report") {
    const report = store.read("report");
    if (!report?.content) {
      return {
        content: [{ type: "text", text: "文献分析报告尚未生成。请在面板左栏点击『🔄 更新报告』，或在对话中说『更新文献分析报告』。" }],
      };
    }
    content = report.content;
    label = "文献分析报告.md";
  } else if (type === "bibtex") {
    const literature = store.read("literature");
    const lines = [];
    (literature.entries || []).forEach((e, i) => {
      lines.push(`@article{ref${i + 1},`);
      if (e.title) lines.push(`  title = {${escapeBib(e.title)}},`);
      if (e.authors?.length) lines.push(`  author = {${escapeBib(e.authors.join(" and "))}},`);
      if (e.year) lines.push(`  year = {${e.year}},`);
      if (e.venue) lines.push(`  journal = {${escapeBib(e.venue)}},`);
      if (e.doi) lines.push(`  doi = {${e.doi}},`);
      if (e.url) lines.push(`  url = {${e.url}},`);
      lines.push("}", "");
    });
    content = lines.join("\n") || "% 文献库为空";
    label = `literature-${store.now().slice(0, 10)}.bib`;
  } else if (type === "worklog") {
    const worklog = store.read("worklog");
    const lines = ["# 实验记录", ""];
    for (const entry of worklog.entries || []) {
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
    content = lines.join("\n");
    label = `实验记录-${store.now().slice(0, 10)}.md`;
  } else {
    throw new Error(`不支持的导出类型：${type}（支持 review | report | bibtex | worklog）`);
  }

  const outputDir = path.join(toolCtx.dataDir, "exports");
  fs.mkdirSync(outputDir, { recursive: true });
  const ext = path.extname(label) || ".md";
  const baseName = safeName(label.replace(/\.[a-z]+$/i, ""));
  const filePath = path.join(outputDir, `${baseName}${ext}`);
  fs.writeFileSync(filePath, content, "utf-8");

  const staged = toolCtx.stageFile({
    sessionId: sessionRef.sessionId,
    sessionRef,
    filePath,
    label: path.basename(filePath),
  });

  const details = {
    media: {
      items: [staged.mediaItem || staged],
    },
  };

  return {
    content: [
      { type: "text", text: `导出完成：${path.basename(filePath)}（共 ${content.length} 字符），下载卡片已出现在会话中。` },
    ],
    details,
  };
}

function escapeBib(value) {
  return String(value).replace(/[{}]/g, (m) => `\\${m}`);
}
