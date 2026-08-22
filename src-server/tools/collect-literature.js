/**
 * collect_literature：文献检索与入库
 * - 在线源：Semantic Scholar / arXiv / Crossref（去重合并，强制检索词 + 年份窗口）
 * - 本地源：Zotero（按 source 参数选择）
 * - 入库：autoApproveLiterature=true 直接追加式入库；否则生成批量提案
 */
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { createLiteratureClient, resolveYearRange } from "../server/literature-client.js";
import { scanAllSources } from "../server/sources.js";
import { ensureAutoBinding } from "../server/binding.js";

export const name = "collect_literature";
export const description =
  "为科研工作搜集文献：按检索词在线检索（Semantic Scholar/arXiv/Crossref）并扫描本地 Zotero 文献源，去重后入文献库。入库策略受 autoApproveLiterature 设置控制。";
export const parameters = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "检索词，必填，如「SnSe 热电 掺杂」；不填将拒绝执行",
    },
    limit: {
      type: "integer",
      description: "在线检索条数上限，默认 10，最大 50",
    },
    fromYear: {
      type: "integer",
      description: "起始年份（4 位数字），覆盖默认窗口；不传则用设置中的默认窗口",
    },
    toYear: {
      type: "integer",
      description: "结束年份（4 位数字），不超过当前年；不传则用默认窗口的结束年",
    },
    source: {
      type: "string",
      enum: ["online", "zotero", "all"],
      description: "文献来源：online=在线检索（query 参与过滤）；zotero=扫描本地 Zotero 全库并入本地库（按标题去重，query 不参与过滤，保持镜像语义）；all=全部（默认）",
    },
  },
};

export const sessionPermission = {
  kind: "external_side_effect",
  describeSideEffect: () => ({
    kind: "external_side_effect",
    summary: "调用在线文献 API（Semantic Scholar/arXiv/Crossref）检索并写入插件文献库",
    ruleId: "materials-research-copilot-network-literature",
  }),
};

export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const source = input.source || "all";
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const autoApprove = toolCtx.config?.get?.("autoApproveLiterature") ?? true;
  ensureAutoBinding(toolCtx);

  const results = [];
  const warnings = [];
  let query = "";
  let yearRange = null;

  // 1. 在线检索
  if (source === "online" || source === "all") {
    query = String(input.query || "").trim();
    if (!query) {
      return {
        content: [
          {
            type: "text",
            text: "请提供检索关键词（query 参数）。插件不支持无关键词检索，以免收进方向不明的文献。",
          },
        ],
      };
    }
    // 年份窗口：默认近 N 年（settings.searchYearWindow，默认 5）；fromYear/toYear 可覆盖
    const currentYear = new Date().getFullYear();
    const settings = store.read("settings");
    yearRange = resolveYearRange(settings);
    if (input.fromYear !== undefined || input.toYear !== undefined) {
      const f = input.fromYear !== undefined ? Number(input.fromYear) : yearRange.from;
      const t = input.toYear !== undefined ? Number(input.toYear) : currentYear;
      const valid4 = (v, raw) =>
        raw === undefined || (Number.isInteger(v) && String(raw).match(/^\d{4}$/));
      if (!valid4(f, input.fromYear) || !valid4(t, input.toYear)) {
        return {
          content: [{ type: "text", text: "fromYear / toYear 必须为 4 位年份数字（如 2021、2026）。" }],
        };
      }
      if (f > t) {
        return { content: [{ type: "text", text: "fromYear 不能晚于 toYear。" }] };
      }
      if (t > currentYear) {
        return { content: [{ type: "text", text: `toYear 不能超过当前年份 ${currentYear}。` }] };
      }
      yearRange = { from: f, to: t };
    }
    const client = createLiteratureClient(toolCtx);
    const items = await client.searchAll(query, limit, null, yearRange);
    // 本地年份兜底过滤：API 过滤可能不完整（如 arXiv 语法差异），入库前再按 year 核对
    const filtered = items.filter((item) => {
      const y = Number(item.year);
      if (!Number.isFinite(y)) return true; // 无年份条目保留（可能为预印本新作）
      return y >= yearRange.from && y <= yearRange.to;
    });
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      results.push({
        id: `lit_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: store.now(),
        status: "new",
        collectedWith: { query, fromYear: yearRange.from, toYear: yearRange.to, sourceApi: item.sourceApi },
        ...item,
      });
    }
  }

  // 2. 本地源扫描
  if (source !== "online") {
    const scan = await scanAllSources(toolCtx, store);
    warnings.push(...scan.warnings);
    const existingIds = new Set(results.map((r) => r.title?.toLowerCase()));
    for (let i = 0; i < scan.entries.length; i++) {
      const entry = scan.entries[i];
      if (existingIds.has(entry.title?.toLowerCase())) continue;
      existingIds.add(entry.title?.toLowerCase());
      if (source === "zotero" && entry.source !== "zotero") continue;
      results.push({
        id: `lit_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: store.now(),
        status: "new",
        ...entry,
      });
    }
  }

  if (results.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `没有找到新文献${warnings.length > 0 ? `。\n提示：\n${warnings.join("\n")}` : ""}`,
        },
      ],
    };
  }

  // 3. 入库
  let applied = 0;
  if (autoApprove) {
    const result = store.append("literature", results);
    applied = result.appended;
  } else {
    for (const entry of results) {
      createProposal(store, {
        target: "literature",
        action: "create",
        diff: entry,
        reason: `文献入库：${entry.title}`,
      });
    }
    store.bump("proposals");
  }

  const searchMeta =
    source === "online" || source === "all"
      ? `检索参数：关键词「${query}」，时间 ${yearRange.from}-${yearRange.to}\n\n`
      : "";

  const titles = searchMeta + results
    .slice(0, 10)
    .map((r) => `- [${r.year || "?"}] ${r.title}（${r.sourceApi || r.source || "?"}）`)
    .join("\n");
  const more = results.length > 10 ? `\n…等共 ${results.length} 条` : "";

  return {
    content: [
      {
        type: "text",
        text:
          `文献搜集完成：检索到 ${results.length} 条，` +
          (autoApprove
            ? `已直接入库 ${applied} 条`
            : `已生成 ${results.length} 个入库提案（autoApproveLiterature 已关闭，需逐条确认）`) +
          `。\n${titles}${more}` +
          (warnings.length > 0 ? `\n提示：\n${warnings.slice(0, 5).join("\n")}` : ""),
      },
    ],
  };
}
