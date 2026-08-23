/**
 * collect_literature：文献收纳（仅 Zotero 本地源）
 * - 只有 Zotero 本地库扫描（在线检索已移除）
 * - 入库直接追加式写入（去提案确认），新收录自动日志化到 worklog（由 syncZotero 完成）
 */
import { createStore } from "../server/store.js";
import { scanAllSources } from "../server/sources.js";
import { ensureAutoBinding } from "../server/binding.js";

export const name = "collect_literature";
export const description =
  "为科研工作收纳文献：扫描本地 Zotero 文献源，去重后直接入文献库（AI 写即生效）。新收录自动日志化到实验记录。";
export const parameters = {
  type: "object",
  properties: {
    source: {
      type: "string",
      enum: ["zotero"],
      description: "文献来源（当前仅支持 zotero 本地扫描）",
    },
  },
};

export const sessionPermission = {
  kind: "external_side_effect",
  describeSideEffect: () => ({
    kind: "external_side_effect",
    summary: "调用本地 Zotero API 扫描并写入插件文献库",
    ruleId: "sci-log-zotero-literature",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.js").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  ensureAutoBinding(toolCtx);

  const warnings = [];
  const scan = await scanAllSources(toolCtx, store);
  warnings.push(...scan.warnings);

  const entries = /** @type {any[]} */ (scan.entries).map((entry, index) => ({
    id: `lit_scan_${Date.now().toString(36)}_${index}`,
    addedAt: store.now(),
    status: "new",
    ...entry,
  }));

  if (entries.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `没有扫描到新文献${warnings.length > 0 ? `。\n提示：\n${warnings.join("\n")}` : ""}`,
        },
      ],
    };
  }

  // 去重复（scanAllSources 已按 Zotero 优先去重），追加式直接入库
  const result = store.append("literature", entries);
  const titles = entries
    .slice(0, 10)
    .map((r) => `- [${r.year || "?"}] ${r.title}（${r.sourceApi || r.source || "?"}）`)
    .join("\n");
  const more = entries.length > 10 ? `\n…等共 ${entries.length} 条` : "";

  return {
    content: [
      {
        type: "text",
        text:
          `文献收纳完成：扫描到 ${entries.length} 条，已直接入库 ${result.appended} 条（AI 写即生效）。\n${titles}${more}` +
          (warnings.length > 0 ? `\n提示：\n${warnings.slice(0, 5).join("\n")}` : ""),
      },
    ],
  };
}
