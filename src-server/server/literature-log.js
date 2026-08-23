/**
 * 文献动作日志化（literature-log）：把文献收纳/扫描的动作用一条 worklog 记录留痕。
 *
 * 设计要点：
 * - 纯函数、无 @hana 依赖、无 LLM、无外部网络，只依赖 store 的 read/append。
 * - 幂等去重：同一 scanId（Zotero 同步批次标识）只在 worklog 中记录一次，
 *   避免后台定时同步重复追加造成实验记录时间线被污染。
 * - 记录结构与手写实验记录一致（content/date/createdAt），供与手写记录混排；
 *   额外带 kind: "literature-log" 标记与 scanId，便于面板区分与测试断言。
 *
 * 用途：syncZotero / scanAllSources 检测到新收录条目时调用。
 */
import { newId } from "./ids.js";

/**
 * @typedef {import("./types.js").StoreApi} StoreApi
 * @typedef {import("./types.js").LiteratureEntry} LiteratureEntry
 */

/**
 * @param {StoreApi} store
 * @param {LiteratureEntry[]} newEntries
 * @param {string} scanId
 * @returns {{ ok: boolean, appended?: number, entry?: import("./types.js").WorklogEntry }}
 */
export function appendLiteratureLog(store, newEntries, scanId) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) {
    return { ok: true, appended: 0 };
  }
  // 幂等：同一 scanId 已在 worklog 记录过则跳过（后台定时同步重复触发不重复写）
  const wl = store.read("worklog");
  if (Array.isArray(wl.entries) && wl.entries.some((e) => e.kind === "literature-log" && e.scanId === scanId)) {
    return { ok: true, appended: 0 };
  }

  const lines = [`# 文献收纳`, `新增 ${newEntries.length} 篇`];
  for (const e of newEntries.slice(0, 20)) {
    const authors = Array.isArray(e.authors) && e.authors.length > 0 ? `（${e.authors.slice(0, 3).join(", ")}）` : "";
    lines.push(`- [${e.year || "?"}] ${e.title || "未命名"}${authors}`);
  }

  /** @type {import("./types.js").WorklogEntry} */
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

  const result = store.append("worklog", [entry]);
  return { ok: true, appended: result.appended, entry };
}
