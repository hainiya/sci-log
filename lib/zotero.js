/**
 * v2 Zotero 收纳核心（精简版）
 *
 * 自 v1 sources.ts 平移，v2 裁剪：
 * - 保留：拉取条目（fetchZoteroItems）/ collection 映射 / 去重入库 / 新收录日志化
 * - 移除：PDF 全文增强、AI 关键词/摘要、OpenAlex 引用数补全（均依赖 v2 无的 app 侧 LLM）
 * - 网络：用注入的 network.fetch（ctx.network），manifest 已声明 allowLocalhost
 * - store 为 resources-backed 异步 store
 */
import { newId } from "./ids.js";

const ZOTERO_ITEM_TYPES = [
  "journalArticle",
  "conferencePaper",
  "book",
  "bookSection",
  "thesis",
  "report",
  "preprint",
  "dataset",
];

function fileUrlToPath(fileUrl) {
  try {
    if (!/^file:\/\//i.test(fileUrl)) return null;
    const u = new URL(fileUrl);
    if (u.hostname && u.hostname !== "localhost") return null;
    // Windows: file:///C:/x/y.pdf → C:\x\y.pdf
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    p = p.replace(/\//g, "\\");
    return p;
  } catch {
    return null;
  }
}

/** 拉取 Zotero 条目（含附件映射），返回整形后的条目数组 */
export async function fetchZoteroItems(network, port) {
  const typeFilter = ZOTERO_ITEM_TYPES.join("||");
  const url = `http://127.0.0.1:${port}/api/users/0/items?format=json&itemType=${encodeURIComponent(typeFilter)}`;
  const res = await network.fetch(url);
  if (!res.ok) throw new Error(`Zotero API HTTP ${res.status}`);
  const items = await res.json();

  // 附件映射：parentItem → { path, key }
  const pdfByParent = new Map();
  try {
    const attUrl = `http://127.0.0.1:${port}/api/users/0/items?format=json&itemType=attachment`;
    const attRes = await network.fetch(attUrl);
    if (attRes.ok) {
      const atts = await attRes.json();
      if (Array.isArray(atts)) {
        for (const a of atts) {
          const href = a?.links?.enclosure?.href;
          if (!href) continue;
          const p = fileUrlToPath(href);
          const parent = a?.data?.parentItem;
          if (!parent || !p) continue;
          const existing = pdfByParent.get(parent);
          if (!existing) {
            pdfByParent.set(parent, { path: p, key: a?.data?.key || null });
          } else if (/\.pdf$/i.test(p) && !/\.pdf$/i.test(existing.path)) {
            pdfByParent.set(parent, { path: p, key: a?.data?.key || null });
          }
        }
      }
    }
  } catch {
    // 附件映射失败不中断
  }

  const entries = [];
  for (const item of items) {
    if (item?.data?.itemType === "attachment" || item?.data?.itemType === "note") continue;
    const d = item?.data || {};
    const title = String(d.title || "").trim();
    if (!title) continue;
    const parsedDate = item?.meta?.parsedDate;
    entries.push({
      title,
      authors: (d.creators || [])
        .map((c) => [c.firstName, c.lastName].filter(Boolean).join(" "))
        .filter(Boolean),
      authorSummary: item?.meta?.creatorSummary || null,
      year:
        typeof parsedDate === "string" && parsedDate
          ? parsedDate.slice(0, 4)
          : d.date
            ? String(d.date).slice(0, 4)
            : null,
      venue: d.publicationTitle || d.bookTitle || d.publisher || null,
      doi: d.DOI || null,
      url: d.url || (d.DOI ? `https://doi.org/${d.DOI}` : null),
      abstract: String(d.abstractNote || "").trim(),
      keywords: null,
      source: "zotero",
      sourceApi: "zotero",
      zoteroKey: item.key || null,
      citationCount: null,
      readOnly: true,
      pdfPath: pdfByParent.get(item.key)?.path || null,
      pdfKey: pdfByParent.get(item.key)?.key || null,
      collectionKeys: Array.isArray(d.collections) ? d.collections.filter(Boolean) : [],
    });
  }
  return entries;
}

/** 拉取 Zotero collection 映射 */
export async function fetchZoteroCollections(network, port) {
  const url = `http://127.0.0.1:${port}/api/users/0/collections?format=json`;
  try {
    const res = await network.fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((c) => ({
        key: c?.key || null,
        name: String(c?.data?.name || "").trim() || null,
        parentCollection: c?.data?.parentCollection || null,
      }))
      .filter((c) => c.key && c.name);
  } catch {
    return [];
  }
}

/** 新收录日志化到 worklog（幂等：同 scanId 只记一次） */
export async function appendLiteratureLog(store, newEntries, scanId) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) {
    return { ok: true, appended: 0 };
  }
  const wl = await store.read("worklog");
  if (
    Array.isArray(wl.entries) &&
    wl.entries.some((e) => e.kind === "literature-log" && e.scanId === scanId)
  ) {
    return { ok: true, appended: 0 };
  }
  const lines = ["# 文献收纳", `新增 ${newEntries.length} 篇`];
  for (const e of newEntries.slice(0, 20)) {
    const authors =
      Array.isArray(e.authors) && e.authors.length > 0 ? `（${e.authors.slice(0, 3).join(", ")}）` : "";
    lines.push(`- [${e.year || "?"}] ${e.title || "未命名"}${authors}`);
  }
  const entry = {
    id: newId("work"),
    kind: "literature-log",
    scanId,
    date: store.now().slice(0, 10),
    content: lines.join("\n"),
    data: null,
    taskId: null,
    sampleId: null,
    fields: [],
    citations: [],
    planVersion: null,
    durationHours: null,
    startDate: null,
    createdAt: store.now(),
  };
  const result = await store.append("worklog", [entry]);
  return { ok: true, appended: result.appended, entry };
}

/** 探测 Zotero 是否可用：返回 { ok, status, hint } */
export async function zoteroProbe(network, port) {
  try {
    const res = await network.fetch(`http://127.0.0.1:${port}/api/users/0/items?limit=1&format=json`, {
      timeoutMs: 4000,
    });
    if (res.ok) return { ok: true, status: res.status };
    if (res.status === 403) {
      return { ok: false, status: res.status, hint: "Zotero 返回 403：本地 API 未启用（Zotero 设置 → 高级 → 允许其他应用程序通过本地 API 通信）" };
    }
    return { ok: false, status: res.status, hint: `Zotero API HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      return { ok: false, status: 0, hint: "无法连接 Zotero 本地 API：请确认 Zotero 桌面端正在运行" };
    }
    return { ok: false, status: 0, hint: msg };
  }
}
