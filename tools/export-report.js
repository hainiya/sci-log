/**
 * export_report（v2 版）：导出实验记录为 Markdown
 * - 自 v1 export-report.ts 迁移
 * - v2 改动：store 与文件写入走 ctx.resources（裸 fs 在 v2 权限模型下被禁）；
 *   投递用 ctx.resources.stage
 */
import path from "node:path";
import { createStore } from "../lib/store.js";
import { safeName, renderWorklogMarkdown } from "../lib/export-util.js";

let _dataDir = null;
let _resources = null;
export function __setDataDir(dir) {
  _dataDir = dir;
}
export function __setResources(r) {
  _resources = r;
}

export const name = "export_report";

export const description =
  "导出科研工作的实验记录为 Markdown 文件，投递到会话（供周报/存档）。";

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

export async function execute(input = {}) {
  if (!_dataDir || !_resources) throw new Error("dataDir/resources 未注入");
  const type = input?.type;
  if (type !== "worklog") {
    throw new Error(`不支持的导出类型：${type}（当前仅支持 worklog 实验记录）`);
  }

  const store = createStore(_dataDir, _resources);
  const worklog = await store.read("worklog");
  const content = renderWorklogMarkdown(worklog.entries || []);

  const exportsDir = path.join(_dataDir, "exports");
  const label = `实验记录-${store.now().slice(0, 10)}.md`;
  const baseName = safeName(label.replace(/\.[a-z]+$/i, ""));
  const fileName = `${baseName}.md`;
  const fileRef = { kind: "local-file", path: path.join(exportsDir, fileName) };

  await _resources.mkdir({ kind: "local-file", path: exportsDir });
  await _resources.write(fileRef, content);

  // v2 投递：ctx.resources.stage 把 app dataDir 内文件复制进会话
  let staged = null;
  try {
    staged = await _resources.stage({
      path: fileRef.path,
      name: fileName,
      deliverAs: "attachment",
    });
  } catch (err) {
    staged = null;
  }

  const stagedName = staged?.name || fileName;
  return {
    content: [
      {
        type: "text",
        text: `导出完成：${stagedName}（共 ${content.length} 字符）${staged ? "，文件已投递到会话。" : "，文件已生成。"}`,
      },
    ],
  };
}

export default { name, description, parameters, execute };
