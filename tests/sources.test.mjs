/**
 * sources.js 全文链与同步数据安全链测试（T2/T3/T4 + D1/D2/D3/E2 + T6/D5）
 * 全部走 mock ctx.network.fetch / mock LLM（ctx.bus.request），不依赖实机 Zotero。
 * 用法：node tests/sources.test.mjs（由 run-all.mjs 自动收集）
 */
import { createStore } from "../src-server/server/store.js";
import {
  fetchZoteroItems,
  syncZotero,
  enhanceZoteroPdfs,
} from "../src-server/server/sources.js";
import { triageWorklog } from "../src-server/server/triage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..").replace(/^\/([A-Za-z]:)/, "$1");

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name} ${detail}`);
  }
};

const resp = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});

/** URL 前缀分发式 fetch mock */
function makeFetch(routes) {
  return async (url) => {
    for (const r of routes) {
      if (url.includes(r.match)) return r.handler(url);
    }
    return resp({ error: "unexpected url: " + url }, 404);
  };
}

function baseCtx(fetchImpl, llmImpl) {
  return {
    config: { get: () => 23119 },
    network: { fetch: fetchImpl },
    bus: { request: llmImpl || (async () => ({ text: "{}" })) },
    pluginDir: ROOT,
    log: { warn: (...a) => console.log("    [warn]", ...a), info: () => {}, error: () => {} },
    resources: { read: async () => { throw new Error("not used"); } },
  };
}

function tmpStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "sources-test-"));
  return { store: createStore(dir), dir };
}

const item = (key, title, extra = {}) => ({
  ...extra, // 先展开，data/meta 由下方明确构造覆盖（避免 extra.data 覆盖 title）
  key,
  data: { itemType: "journalArticle", title, creators: [], date: "2024-01-01", ...(extra.data || {}) },
  meta: {},
});

const attachment = (key, parent, path_) => ({
  key,
  data: { itemType: "attachment", parentItem: parent, key },
  links: { enclosure: { href: `file:///${path_}` } },
});

console.log("== sources 全文链与同步安全链测试 ==");

// ── 用例 1（T4/B2）：Total-Results 截断校验 ──
{
  const items100 = Array.from({ length: 100 }, (_, i) => item(`K${i}`, `T${i}`));
  const fetch = makeFetch([
    { match: "itemType=attachment", handler: () => resp([]) },
    { match: "itemType=", handler: () => resp(items100, 200, { "Total-Results": "300" }) },
  ]);
  const r = await fetchZoteroItems(baseCtx(fetch), 23119);
  ok("B2: Total-Results 300 ≠ 实收 100 → truncated", r.truncated === true && r.items.length === 0, JSON.stringify(r).slice(0, 80));
}

// ── 用例 2（E2）：Total-Results 头缺失不误判截断 ──
{
  const items100 = Array.from({ length: 100 }, (_, i) => item(`K${i}`, `T${i}`));
  const fetch = makeFetch([
    { match: "itemType=attachment", handler: () => resp([]) },
    { match: "itemType=", handler: () => resp(items100, 200, {}) }, // 无头
  ]);
  const r = await fetchZoteroItems(baseCtx(fetch), 23119);
  ok("E2: 头缺失 → 不误判截断，items 完整返回", Array.isArray(r) && r.length === 100, `len=${Array.isArray(r) ? r.length : "not-array"}`);
}

// ── 用例 3（D2）：多附件时 PDF 优先 ──
{
  const fetch = makeFetch([
    {
      match: "itemType=attachment",
      handler: () =>
        resp([
          attachment("AZIP", "K1", "D:/Zotero/storage/AAAA/supp.zip"),
          attachment("APDF", "K1", "D:/Zotero/storage/AAAA/main.pdf"),
        ]),
    },
    { match: "itemType=", handler: () => resp([item("K1", "T1")]) },
  ]);
  const r = await fetchZoteroItems(baseCtx(fetch), 23119);
  const e = r[0];
  ok("D2: PDF 附件优先于补充材料", e?.pdfKey === "APDF" && e?.pdfPath === "D:\\Zotero\\storage\\AAAA\\main.pdf", JSON.stringify(e?.pdfKey));
}

// ── 用例 4（D3）：fulltext 错误分类（llmLimit=0 只走全文分支） ──
{
  // 4a: 200 长文本 → ok
  let store = tmpStore().store;
  store.write("literature", { version: 0, entries: [{ id: "e1", zoteroKey: "K1", pdfKey: "A1", source: "zotero", abstract: "", abstractSource: null, keywords: [] }] });
  const longText = "x".repeat(500);
  let fetch = makeFetch([{ match: "fulltext", handler: () => resp({ content: longText }) }]);
  await enhanceZoteroPdfs(baseCtx(fetch), store, 8, 0);
  const e1 = store.read("literature").entries[0];
  ok("D3a: fulltext 200 → fullTextParsed=ok", e1.fullTextParsed === "ok" && e1.fullText === longText && e1.failedAt == null, JSON.stringify(e1.fullTextParsed));

  // 4b: 404 → failed + failedAt
  store = tmpStore().store;
  store.write("literature", { version: 0, entries: [{ id: "e2", zoteroKey: "K2", pdfKey: "A2", source: "zotero", abstract: "", abstractSource: null, keywords: [] }] });
  fetch = makeFetch([{ match: "fulltext", handler: () => resp({ error: "no fulltext" }, 404) }]);
  await enhanceZoteroPdfs(baseCtx(fetch), store, 8, 0);
  const e2 = store.read("literature").entries[0];
  ok("D3b: 404 → failed + failedAt 冷却", e2.fullTextParsed === "failed" && e2.failedAt != null, JSON.stringify(e2.fullTextParsed));

  // 4c: 500 → api_error，不写状态（下次循环即重试）
  store = tmpStore().store;
  store.write("literature", { version: 0, entries: [{ id: "e3", zoteroKey: "K3", pdfKey: "A3", source: "zotero", abstract: "", abstractSource: null, keywords: [] }] });
  fetch = makeFetch([{ match: "fulltext", handler: () => resp({ error: "boom" }, 500) }]);
  await enhanceZoteroPdfs(baseCtx(fetch), store, 8, 0);
  const e3 = store.read("literature").entries[0];
  ok("D3c: 500 → api_error 不写 failed，条目状态不变", e3.fullTextParsed == null && e3.failedAt == null, JSON.stringify(e3));

  // 4d: 200 短文本 → scan + abstractSource=none
  store = tmpStore().store;
  store.write("literature", { version: 0, entries: [{ id: "e4", zoteroKey: "K4", pdfKey: "A4", source: "zotero", abstract: "", abstractSource: null, keywords: [] }] });
  fetch = makeFetch([{ match: "fulltext", handler: () => resp({ content: "short" }) }]);
  await enhanceZoteroPdfs(baseCtx(fetch), store, 8, 0);
  const e4 = store.read("literature").entries[0];
  ok("D3d: 短文本 → scan + abstractSource=none", e4.fullTextParsed === "scan" && e4.abstractSource === "none", JSON.stringify(e4));
}

// ── 用例 5（T2）：英文摘要 → 翻译（mock LLM） ──
{
  const store = tmpStore().store;
  store.write("literature", {
    version: 0,
    entries: [{ id: "e5", zoteroKey: "K5", source: "zotero", abstract: "This is an English abstract about thermoelectric materials with high zT.", abstractSource: null, keywords: [] }],
  });
  const fetch = makeFetch([]);
  const ctx = baseCtx(fetch, async () => ({ text: "关于高 zT 热电材料 SnSe 的中文摘要翻译，测试用长文本内容。" }));
  const r = await enhanceZoteroPdfs(ctx, store, 8, 1);
  const e5 = store.read("literature").entries[0];
  ok("T2-翻译: abstractSource=ai_translated + abstractEn 保留原文", e5.abstractSource === "ai_translated" && e5.abstractEn?.includes("English abstract"), JSON.stringify(e5.abstractSource));
  ok("T2-翻译: 消耗 LLM 预算", r.summaries === 1, JSON.stringify(r));
}

// ── 用例 6（T2）：空摘要 + 全文 → AI 生成（mock LLM） ──
{
  const store = tmpStore().store;
  store.write("literature", {
    version: 0,
    entries: [{ id: "e6", zoteroKey: "K6", pdfKey: "A6", source: "zotero", abstract: "", abstractSource: null, keywords: [] }],
  });
  const fetch = makeFetch([{ match: "fulltext", handler: () => resp({ content: "y".repeat(500) }) }]);
  const ctx = baseCtx(fetch, async () => ({ text: "这是根据论文全文生成的关于热电材料 Seebeck 系数提升路径的中文摘要。" }));
  const r = await enhanceZoteroPdfs(ctx, store, 8, 1);
  const e6 = store.read("literature").entries[0];
  ok("T2-生成: abstractSource=ai_generated", e6.abstractSource === "ai_generated" && e6.abstract === "这是根据论文全文生成的关于热电材料 Seebeck 系数提升路径的中文摘要。", JSON.stringify(e6.abstractSource));
  ok("T2-生成: fullText 已写入", e6.fullTextParsed === "ok" && e6.fullText.length === 500);
}

// ── 用例 7（T3）：空响应保护——有镜像时跳过，镜像保留 ──
{
  const { store } = tmpStore();
  store.write("literature", {
    version: 0,
    entries: [{ id: "old1", zoteroKey: "K9", source: "zotero", title: "旧镜像", fullTextParsed: "ok", fullText: "old", keywords: [] }],
  });
  const fetch = makeFetch([
    { match: "limit=1", handler: () => resp([]) },
    { match: "itemType=attachment", handler: () => resp([]) },
    { match: "itemType=", handler: () => resp([]) }, // 主请求空
    { match: "collections", handler: () => resp([]) },
  ]);
  const r = await syncZotero(baseCtx(fetch), store);
  const lit = store.read("literature");
  const settings = store.read("settings");
  ok("T3-空响应: skipped=true", r.skipped === true, JSON.stringify(r));
  ok("T3-空响应: 镜像保留未清空", lit.entries.length === 1 && lit.entries[0].title === "旧镜像", `len=${lit.entries.length}`);
  ok("T3-空响应: zoteroSyncSkipped 置位", settings.zoteroSyncSkipped === true, JSON.stringify(settings));
}

// ── 用例 8（T3）：镜像合并保留增强字段 ──
{
  const { store } = tmpStore();
  store.write("literature", {
    version: 0,
    entries: [
      {
        id: "old2",
        zoteroKey: "K10",
        source: "zotero",
        title: "旧",
        fullTextParsed: "ok",
        fullText: "old-full-text",
        abstract: "AI 中文摘要",
        abstractSource: "ai_generated",
        keywords: ["热电", "SnSe"],
        keywordsSource: "ai",
      },
    ],
  });
  const fetch = makeFetch([
    { match: "limit=1", handler: () => resp([]) },
    { match: "itemType=attachment", handler: () => resp([]) },
    { match: "itemType=", handler: () => resp([item("K10", "新标题", { data: { tags: [{ tag: "en-tag" }] } })]) },
    { match: "collections", handler: () => resp([]) },
  ]);
  await syncZotero(baseCtx(fetch), store);
  const e = store.read("literature").entries[0];
  ok("T3-合并: fullText/fullTextParsed 保留", e.fullText === "old-full-text" && e.fullTextParsed === "ok");
  ok("T3-合并: AI 摘要保留", e.abstract === "AI 中文摘要" && e.abstractSource === "ai_generated");
  ok("T3-合并: AI 关键词不被 tags 覆盖", e.keywordsSource === "ai" && e.keywords?.length === 2, JSON.stringify(e.keywordsSource));
  ok("T3-合并: 标题随 Zotero 更新", e.title === "新标题");
}

// ── 用例 9（D1）：附件请求失败 → 旧 pdfKey 兜底保留 ──
{
  const { store } = tmpStore();
  store.write("literature", {
    version: 0,
    entries: [{ id: "old3", zoteroKey: "K11", source: "zotero", title: "旧", pdfKey: "OLDKEY", pdfPath: "D:\\Zotero\\storage\\OLD\\x.pdf", keywords: [] }],
  });
  const fetch = makeFetch([
    { match: "limit=1", handler: () => resp([]) },
    { match: "itemType=attachment", handler: () => resp({ error: "boom" }, 500) }, // 附件请求失败
    { match: "itemType=", handler: () => resp([item("K11", "新标题")]) },
    { match: "collections", handler: () => resp([]) },
  ]);
  await syncZotero(baseCtx(fetch), store);
  const e = store.read("literature").entries[0];
  ok("D1: 附件失败 → pdfKey 兜底保留", e.pdfKey === "OLDKEY" && e.pdfPath === "D:\\Zotero\\storage\\OLD\\x.pdf", JSON.stringify(e.pdfKey));
}

// ── 用例 10（T6/D5）：triage 同毫秒 4 条 → 两轮补捞不重复 ──
{
  const { store } = tmpStore();
  const tick = "2026-08-07T10:00:00.000Z";
  store.write("worklog", {
    version: 0,
    entries: [1, 2, 3, 4].map((i) => ({ id: `w${i}`, date: "2026-08-07", content: `实验记录 ${i}`, createdAt: tick })),
    meta: {},
  });
  store.write("gantt", { version: 0, tasks: [] });
  store.write("plan", { version: 0, title: "", hypothesis: "", route: "", milestones: [] });
  store.write("literature", { version: 0, entries: [] });
  const llmOut = {
    fields: [],
    citations: [],
    system: "",
    taskProgress: [],
    events: [],
    planNote: null,
    durationHours: null,
    needRedo: false,
  };
  const ctx = baseCtx(makeFetch([]), async () => ({ text: JSON.stringify(llmOut) }));
  const r1 = await triageWorklog(ctx, store);
  const m1 = store.read("worklog").meta;
  ok("T6-轮1: 处理 3 条（BATCH_MAX）", r1.triaged === 3, JSON.stringify(r1));
  ok("T6-轮1: aiReviewedIds 记录 3 个", m1.aiReviewedIds?.length === 3, JSON.stringify(m1.aiReviewedIds));
  const r2 = await triageWorklog(ctx, store);
  ok("T6-轮2: 只补捞 1 条（最早一条）", r2.triaged === 1, JSON.stringify(r2));
  const m2 = store.read("worklog").meta;
  ok("T6-轮2: 集合累积为 4（不覆盖）", m2.aiReviewedIds?.length === 4, JSON.stringify(m2.aiReviewedIds));
  const r3 = await triageWorklog(ctx, store);
  ok("T6-轮3: 全部已巡检，0 处理", r3.triaged === 0, JSON.stringify(r3));
}

// ── 用例 11：failedRetryable 24h 冷却边界 ──
{
  const { store } = tmpStore();
  const now = Date.now();
  store.write("literature", {
    version: 0,
    entries: [
      { id: "f1", zoteroKey: "KF1", pdfKey: "AF1", source: "zotero", abstract: "", abstractSource: null, keywords: [], fullTextParsed: "failed", failedAt: new Date(now - 25 * 3600 * 1000).toISOString() }, // 25h 前 → 可重试
      { id: "f2", zoteroKey: "KF2", pdfKey: "AF2", source: "zotero", abstract: "", abstractSource: "none", keywords: [], fullTextParsed: "failed", failedAt: new Date(now - 1 * 3600 * 1000).toISOString() }, // 1h 前 → 冷却中
    ],
  });
  const fetch = makeFetch([
    { match: "fulltext", handler: () => resp({ content: "z".repeat(500) }) },
  ]);
  await enhanceZoteroPdfs(baseCtx(fetch), store, 8, 0);
  const lit = store.read("literature").entries;
  const f1 = lit.find((e) => e.zoteroKey === "KF1");
  const f2 = lit.find((e) => e.zoteroKey === "KF2");
  ok("E4边界: 25h 前 failed → 重试成功变 ok", f1.fullTextParsed === "ok", JSON.stringify(f1.fullTextParsed));
  ok("E4边界: 1h 前 failed → 冷却中保持 failed", f2.fullTextParsed === "failed", JSON.stringify(f2.fullTextParsed));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
