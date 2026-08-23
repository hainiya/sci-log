/**
 * export_report：导出工具（实验记录中心化后仅保留实验记录导出）
 * 生成文件到 ctx.dataDir/exports/ → toolCtx.stageFile() 投递 SessionFile → 会话中出现下载卡片
 * 不手写本地路径、不生成 file:// 链接、不经 iframe 直接下载
 */
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../server/store.js";
import { ensureAutoBinding } from "../server/binding.js";
import { safeName, renderWorklogMarkdown } from "../server/export-util.js";

export const name = "export_report";
export const description =
  "导出科研工作的实验记录为 Markdown 文件，通过 SessionFile 下载卡片投递到会话（供周报/存档）。";
export const parameters = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["worklog"],
      description: "worklog=实验记录（当前支持的唯一导出类型）",
    },
  },
  required: ["type"],
};

export const sessionPermission = {
  kind: "plugin_output",
  describeSideEffect: () => ({
    kind: "session_file_output",
    summary: "在插件数据目录生成实验记录导出文件并注册为 SessionFile 下载卡片",
    ruleId: "materials-research-copilot-export-session-file",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.js").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input = {}, toolCtx) {
  const sessionRef =
    toolCtx.sessionRef ||
    (toolCtx.sessionId ? { sessionId: toolCtx.sessionId, sessionPath: toolCtx.sessionPath || null } : null);
  if (!sessionRef?.sessionId) {
    return {
      content: [
        {
          type: "text",
          text: "当前没有可用的会话上下文，无法投递下载卡片。请在对话中直接说『导出实验记录』，由助手在会话上下文中执行本工具。",
        },
      ],
    };
  }
  if (!toolCtx.stageFile) {
    throw new Error("export_report 需要宿主 stageFile 能力");
  }

  const store = createStore(toolCtx.dataDir);
  const type = input.type;
  ensureAutoBinding(toolCtx);

  if (type !== "worklog") {
    throw new Error(`不支持的导出类型：${type}（当前仅支持 worklog 实验记录）`);
  }

  const worklog = store.read("worklog");
  const content = renderWorklogMarkdown(worklog.entries || []);
  const label = `实验记录-${store.now().slice(0, 10)}.md`;

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
