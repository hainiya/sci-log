/**
 * Zotero 全量同步测试（tests/zotero-sync.test.mjs）
 * 用法：node tests/zotero-sync.test.mjs
 * 针对实机 Zotero 本地 API（127.0.0.1:23119，9.x）做只读探测与断言。
 * 前提：Zotero 桌面客户端运行中且已开启本地 API。
 */
const BASE = "http://127.0.0.1:23119/api/users/0/items";
const UA = "materials-research-copilot/0.1.0";

let pass = 0;
let fail = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

async function tryFetch(url, opts = {}) {
  try {
    const r = await fetch(url, opts);
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

console.log("== Zotero 全量同步测试 ==");

// 连通性探测（T12 复审）：无 Zotero 运行的环境下输出 SKIP 并以 0 退出，
// 不污染 npm test 结果（run-all 识别 SKIP 标记）；有 Zotero 才做真实断言
const probe = await tryFetch(BASE + "?limit=1&format=json", {
  headers: { "User-Agent": UA },
});
if (!probe.ok) {
  console.log(`  SKIP：Zotero 本地 API 不可达（${probe.error || probe.status}），跳过实机断言`);
  console.log("\n结果: SKIP");
  process.exit(0);
}

// 断言 4：Mozilla 前缀 UA 被拒（验证 UA 防御必要性——宿主 ctx.network.fetch 可能带 Chromium UA）
const mozUa = await tryFetch(BASE + "?limit=1&format=json", {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
});
ok("Mozilla UA 请求被拒（连接关闭/失败）", !mozUa.ok, `(${mozUa.error || mozUa.status})`);

// 断言 1：显式 UA 可拉全量（无 limit）；条目数宽松阈值（>0，避免绑定实机库规模）
// + Total-Results 头与实收数一致（分页完整性）
const full = await tryFetch(BASE + "?format=json", { headers: { "User-Agent": UA } });
ok("显式 UA 全量拉取成功", full.ok, `(${full.error || full.status})`);
if (!full.ok) {
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}
const total = full.json?.totalResults ?? full.json?.length ?? 0;
ok(`全量条目数 > 0（实际 ${total}）`, total > 0, `(${total})`);
const trRaw = full.headers?.get?.("Total-Results");
if (trRaw != null) {
  const tr = Number(trRaw);
  ok(`Total-Results 头（${trRaw}）与实收（${total}）一致`, Number.isFinite(tr) && tr === total, `(${trRaw} vs ${total})`);
} else {
  console.log(`  · Total-Results 头缺失（本地 API 版本行为，跳过一致性断言）`);
}

// 断言 2：每条含 data.creators / data.abstractNote / meta.creatorSummary / meta.parsedDate
const items = full.json || [];
let withCreators = 0;
let withCreatorSummary = 0;
let withParsedDate = 0;
let withAbstract = 0;
let withTags = 0;
let attachmentCount = 0;
let enclosureSample = null;
// 断言 3 采集：附件条目 links.enclosure 在条目顶层（不在 data 内）
const itemWithEnclosure = items.find((it) => it?.links?.enclosure?.href);
if (itemWithEnclosure) enclosureSample = itemWithEnclosure.links.enclosure.href;
for (const it of items) {
  const d = it?.data || {};
  if (d.itemType === "attachment" || d.itemType === "note") {
    attachmentCount += 1;
    continue;
  }
  if (d.creators?.length) withCreators += 1;
  if (it.meta?.creatorSummary) withCreatorSummary += 1;
  if (it.meta?.parsedDate) withParsedDate += 1;
  if (d.abstractNote) withAbstract += 1;
  if (d.tags?.length) withTags += 1;
}
const literatureItems = items.filter((it) => {
  const t = it?.data?.itemType;
  return t !== "attachment" && t !== "note";
});
ok(`文献类条目 creators 齐全（${withCreators}/${literatureItems.length}）`, withCreators >= literatureItems.length * 0.9);
ok(`meta.creatorSummary 现成（${withCreatorSummary}/${literatureItems.length}）`, withCreatorSummary >= literatureItems.length * 0.9);
ok(`meta.parsedDate 现成（${withParsedDate}/${literatureItems.length}）`, withParsedDate >= literatureItems.length * 0.9);
// T1 复审：覆盖率改为记录性输出（不计入断言计数）——abstractNote/tags 覆盖率天然随库变化
// （大量文献无摘要正是全文增强的用途），定死阈值会假红；真值断言交给上面的结构校验
console.log(`  · abstractNote 覆盖率 ${withAbstract}/${literatureItems.length}（记录，不计断言）`);
console.log(`  · tags 覆盖率 ${withTags}/${literatureItems.length}（记录，不计断言）`);

// 断言 3：附件条目 links.enclosure 给出 file:/// 路径（在条目顶层，不在 data 内）
const attachmentSample = items.find((it) => it?.data?.itemType === "attachment");
if (!enclosureSample && attachmentSample) enclosureSample = attachmentSample?.links?.enclosure?.href || null;
ok(`附件条目存在（${attachmentCount} 个）`, attachmentCount > 0);
ok("enclosure 形如 file:///", enclosureSample?.startsWith("file:///") === true, `(${enclosureSample})`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
