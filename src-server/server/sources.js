/**
 * 文献源适配器
 * - zotero：本地 Zotero 7+ API（http://127.0.0.1:<port>，走 ctx.network.fetch，manifest 已声明 allowLocalhost）
 *
 * 实验记录中心化改造后：仅保留 Zotero 本地源（去在线检索/工作区扫描）；
 * Zotero 镜像条目进文献库列表，同步时检测新收录并自动日志化到 worklog（appendLiteratureLog）。
 */
import { summarizeFromFulltext, translateAbstract, extractLiteratureKeywords } from "./llm.js";
import { appendLiteratureLog } from "./literature-log.js";

const FAILED_RETRY_COOLDOWN_MS = 24 * 3600 * 1000; // E4：failed 解析 24h 冷却
const PDF_MAX_CHARS = 100000; // E3：60k→100k 保综述/长文结论段（英文约 4.5k 字符/页，≈22 页）
const SCAN_THRESHOLD = 200; // 文本量低于该值视为扫描版（需人工补全）

/** E4：failed 冷却判断（无 failedAt 视为可重试） */
function failedRetryable(entry) {
  if (entry.fullTextParsed !== "failed") return true;
  const t = entry.failedAt ? new Date(entry.failedAt).getTime() : NaN;
  return !Number.isFinite(t) || Date.now() - t > FAILED_RETRY_COOLDOWN_MS;
}
export function readSettings(ctx, store) {
  const doc = store.read("settings");
  return doc || { updatedAt: null };
}

export function writeSettings(ctx, store, patch) {
  const current = readSettings(ctx, store);
  const next = { ...current, ...patch, updatedAt: store.now() };
  store.write("settings", next);
  return next;
}

function parseIsoDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

/** probe 错误分级（A3）：区分「未运行」/「本地 API 未开启」/「网络异常」 */
function classifyProbeError(err) {
  const msgs = [err?.message, err?.cause?.message, err?.cause?.code, String(err || "")]
    .filter(Boolean)
    .join(" | ");
  if (/ECONNREFUSED|connection refused|refused/i.test(msgs)) return "zotero_not_running";
  if (/closed|reset|abort|timeout|timed ?out|fetch failed/i.test(msgs)) return "api_not_enabled";
  return "network_error";
}

/** Zotero 本地 API：探测可用性（显式 UA + 错误分级） */
export async function zoteroProbe(ctx, port) {
  let res;
  try {
    res = await ctx.network.fetch(`http://127.0.0.1:${port}/api/users/0/items?limit=1&format=json`, {
      cacheTtlMs: 0,
      timeoutMs: 3000,
      headers: { "User-Agent": ZOTERO_UA },
    });
  } catch (err) {
    const code = classifyProbeError(err);
    return {
      ok: false,
      code,
      error:
        code === "zotero_not_running"
          ? "Zotero 客户端未运行，请启动桌面客户端"
          : code === "api_not_enabled"
            ? "本地 API 未开启或请求被拒：Zotero → 设置 → 高级 → 允许其他应用与 Zotero 通信（改后需重启 Zotero）"
            : String(err?.message || "无法访问"),
    };
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 400) {
      return { ok: false, code: "api_not_enabled", status: res.status, error: "本地 API 未开启或请求被拒：Zotero → 设置 → 高级 → 允许其他应用与 Zotero 通信（改后需重启 Zotero）" };
    }
    return { ok: false, code: "network_error", status: res.status, error: `HTTP ${res.status}` };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, total: data?.totalResults ?? data?.length ?? 0 };
}

const ZOTERO_ITEM_TYPES = [
  "journalArticle",
  "conferencePaper",
  "preprint",
  "book",
  "bookSection",
  "report",
  "thesis",
];

/** Zotero 本地 API 显式 UA：Mozilla 前缀 UA 会被 Zotero 拒绝（实测连接被关闭），必须显式设置 */
const ZOTERO_UA = "materials-research-copilot/0.1.0";

/** Zotero fetch 封装：显式 UA + 403 兜底 zotero-allowed-request */
async function zoteroFetch(ctx, url) {
  const opts = {
    cacheTtlMs: 0,
    timeoutMs: 10000,
    headers: { "User-Agent": ZOTERO_UA },
  };
  let res = await ctx.network.fetch(url, opts);
  if (res.status === 403) {
    res = await ctx.network.fetch(url, {
      ...opts,
      headers: { ...opts.headers, "zotero-allowed-request": "1" },
    });
  }
  return res;
}

/**
 * Zotero fulltext API（2026-08-07 起全文来源，替代本地 PDF 解析）：
 * GET /items/<附件key>/fulltext 返回 Zotero 已建的全文索引（Zotero 10+ 本地 API 支持）。
 * 返回分类结果（复审 D3）：
 * - { kind: "ok", text } 全文可用
 * - { kind: "no_index" } 404/空 content：未索引（新 PDF 异步建索引）或版本不支持 → failedAt 冷却重试
 * - { kind: "api_error" } 网络异常/非 200 非 404/解析失败：环境问题（API 未开启/Zotero 重启中）
 *   → 不写 failed，下次循环即重试（环境修复后立即恢复，不被 24h 冷却锁住）
 */
async function fetchZoteroFulltext(ctx, port, attachmentKey) {
  if (!attachmentKey) return { kind: "api_error" };
  const url = `http://127.0.0.1:${port}/api/users/0/items/${encodeURIComponent(attachmentKey)}/fulltext`;
  let res;
  try {
    res = await zoteroFetch(ctx, url);
  } catch {
    return { kind: "api_error" };
  }
  if (res.status === 404) return { kind: "no_index" };
  if (!res.ok) return { kind: "api_error" };
  try {
    const json = await res.json();
    const text = String(json?.content || "").trim();
    if (!text) return { kind: "no_index" };
    return { kind: "ok", text };
  } catch {
    return { kind: "api_error" };
  }
}

/** file:///D:/Zotero/storage/x.pdf → D:\Zotero\storage\x.pdf */
function fileUrlToPath(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith("file:///")) return null;
  try {
    const url = new URL(fileUrl);
    let p = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p.replace(/\//g, "\\");
  } catch {
    return null;
  }
}

/**
 * Zotero 全量同步（A1）：
 * - 省略 limit（本地 API 实测 2026-08-07：无 limit 即返回过滤后全量，Total-Results 头一致；旧实现 limit=2000 在超库时截断，
 *   缺失条目会被误标 zoteroGone → 用户一键清除即永久丢失）
 * - meta.creatorSummary / meta.parsedDate 替代自拼 authors/year
 * - 附件条目（links.enclosure）反查 parentItem → pdfPath
 * - 全部标记 readOnly（A4 只读镜像）
 */
export async function fetchZoteroItems(ctx, port) {
  // 注意：itemType OR 过滤是 value 用 || 连接（itemType=journalArticle||conferencePaper），
  // 不能重复 itemType= 前缀（旧写法导致 0 条，静默降级隐藏 bug）
  const typeFilter = ZOTERO_ITEM_TYPES.join("||");
  const url = `http://127.0.0.1:${port}/api/users/0/items?format=json&itemType=${encodeURIComponent(typeFilter)}`;
  const res = await zoteroFetch(ctx, url);
  if (!res.ok) throw new Error(`Zotero API HTTP ${res.status}`);
  const items = await res.json();

  // 分页完整性校验（2026-08-07 复审）：省略 limit 依赖本地 API 未文档化行为，
  // 若将来 API 版本回退到官方默认 limit=25，这里会静默截断（比旧 limit=2000 更隐蔽）。
  // 读 Total-Results 头核对，不一致则显式跳过同步而不是带不全的数据入库。
  // E2（复审）：头缺失（get 返回 null）不做判定——Number(null)=0 会把正常响应误判为截断，
  // 导致每次同步都跳过、镜像永久冻结。
  if (Array.isArray(items) && items.length > 0) {
    const totalRaw = res.headers?.get?.("Total-Results");
    if (totalRaw != null) {
      const total = Number(totalRaw);
      if (Number.isFinite(total) && total !== items.length) {
        ctx.log?.warn?.(`zotero sync: Total-Results ${total} ≠ 实收 ${items.length}，疑似分页截断，跳过本次同步`);
        return { truncated: true, items: [] };
      }
    }
  }

  // 附件映射：parentItem → { path: PDF 本地路径, key: 附件 key }
  // key 供 fulltext API 查询全文（2026-08-07 起全文来源切换为 Zotero 索引，不再本地解析 PDF）
  // D2（复审）：附件请求同样做 Total-Results 截断校验（截断 → warn 继续，缺的 pdfKey 下次同步补）；
  // 多附件时优先选 .pdf（补充材料 zip 等也可能命中 file:// 映射，选错会导致 fulltext 恒 404）
  const pdfByParent = new Map();
  try {
    const attUrl = `http://127.0.0.1:${port}/api/users/0/items?format=json&itemType=attachment`;
    const attRes = await zoteroFetch(ctx, attUrl);
    if (attRes.ok) {
      const atts = await attRes.json();
      if (Array.isArray(atts) && atts.length > 0) {
        const attTotalRaw = attRes.headers?.get?.("Total-Results");
        const attTotal = attTotalRaw != null ? Number(attTotalRaw) : NaN;
        if (Number.isFinite(attTotal) && attTotal !== atts.length) {
          ctx.log?.warn?.(`zotero sync: 附件 Total-Results ${attTotal} ≠ 实收 ${atts.length}，部分条目 pdfKey 缺失待下次同步补`);
        }
      }
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
          // 已有非 PDF 附件（补充材料等）时，PDF 附件优先
          pdfByParent.set(parent, { path: p, key: a?.data?.key || null });
        }
      }
    }
  } catch {
    // 附件映射失败不中断同步
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
      year: typeof parsedDate === "string" && parsedDate ? parsedDate.slice(0, 4) : d.date ? String(d.date).slice(0, 4) : null,
      venue: d.publicationTitle || d.bookTitle || d.publisher || null,
      doi: d.DOI || null,
      url: d.url || (d.DOI ? `https://doi.org/${d.DOI}` : null),
      abstract: String(d.abstractNote || "").trim(),
      // keywords 恒 null：Zotero tags 不占位（英文标签非 AI 关键词），留给增强链路提取（keywordsSource: "ai"）
      keywords: null,
      source: "zotero",
      sourceApi: "zotero",
      zoteroKey: item.key || null,
      citationCount: null,
      readOnly: true,
      pdfPath: pdfByParent.get(item.key)?.path || null,
      pdfKey: pdfByParent.get(item.key)?.key || null,
      // D1：条目所属 collection（Zotero 9.x key 数组，悬空引用在 UI 归「未分类」）
      collectionKeys: Array.isArray(d.collections) ? d.collections.filter(Boolean) : [],
    });
  }
  return entries;
}

/**
 * D1：拉取 Zotero collection 映射（key → {name, parentCollection}）
 * 用于 UI 左侧分类树展示与「未分类」兜底。
 * 实测：collections 端点返回 key/name/parentCollection 字段，全量拉取无分页负担。
 */
export async function fetchZoteroCollections(ctx, port) {
  const url = `http://127.0.0.1:${port}/api/users/0/collections?format=json`;
  let data = [];
  try {
    const res = await zoteroFetch(ctx, url);
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map((c) => ({
      key: c?.key || null,
      name: String(c?.data?.name || "").trim() || null,
      parentCollection: c?.data?.parentCollection || null,
    }))
    .filter((c) => c.key && c.name);
}

/** 指纹：doi 小写 || title 小写（与 store.append 口径一致） */
function fingerprintsOf(entry) {
  const fps = [];
  if (typeof entry.doi === "string" && entry.doi.trim()) fps.push(`doi=${entry.doi.trim().toLowerCase()}`);
  if (typeof entry.title === "string" && entry.title.trim()) fps.push(`title=${entry.title.trim().toLowerCase()}`);
  return fps;
}

/**
 * 去重优先级反转（A1）：同一 DOI/标题冲突时 Zotero 条目优先存活
 * （用户知识库可信度高于在线检索条目）
 */
export function dedupeZoteroPriority(entries) {
  const seen = new Map();
  const order = [];
  for (const e of entries) {
    const fps = fingerprintsOf(e);
    if (fps.length === 0) {
      order.push(e);
      continue;
    }
    let conflict = null;
    for (const fp of fps) {
      if (seen.has(fp)) {
        conflict = seen.get(fp);
        break;
      }
    }
    if (!conflict) {
      for (const fp of fps) seen.set(fp, e);
      order.push(e);
      continue;
    }
    // 冲突：Zotero 赢。已有是 zotero 则丢弃新条目；新条目是 zotero 则原位替换
    if (e.source === "zotero" && conflict.source !== "zotero") {
      const idx = order.indexOf(conflict);
      order[idx] = e;
      for (const fp of fps) seen.set(fp, e);
    }
  }
  return order;
}

/**
 * C3+E2+关键词：文献增强任务（全文获取 + 中文摘要全覆盖 + 关键词提取）
 * - 全文来源：Zotero fulltext API（2026-08-07 起替代本地 PDF 解析，零 PDF 引擎依赖）：
 *   200 + content → fullTextParsed="ok"（截断 PDF_MAX_CHARS）；404（未索引/扫描版）→ failedAt 24h 冷却重试；
 *   文本量 < SCAN_THRESHOLD → "scan"（需人工补全）
 * - E2 摘要链路（LLM 预算 llmLimit 篇/批，生成与翻译共享）：
 *   abstract 空 + 全文可用 → 生成（abstractSource: "ai_generated"）
 *   abstract 为英文（zotero_original）→ 翻译（abstractSource: "ai_translated"，原文存 abstractEn）
 * - 关键词链路：keywords == null 且有来源（abstract/abstractEn/fullText）的条目
 *   （含在线条目）→ LLM 提取 3-5 个中文关键词（keywordsSource: "ai"）
 * 返回 { processed, summaries, keywords }；任何失败不影响主同步。
 * 调用方循环调度（runEnhancementLoop）：每轮批 batchLimit 条、LLM 预算 llmLimit 次。
 */
export async function enhanceZoteroPdfs(ctx, store, batchLimit = 8, llmLimit = 3) {
  const zoteroPort = ctx.config.get?.("zoteroPort") ?? 23119;
  const doc = store.read("literature");
  const targets = (doc.entries || []).filter(
    (e) =>
      // 既有 Zotero 摘要/PDF 目标（不变；pdfKey||pdfPath 兼容 fulltext 迁移前的旧镜像，待下次同步补 pdfKey）
      (e.source === "zotero" &&
        (((e.pdfKey || e.pdfPath) && (!e.fullTextParsed || (e.fullTextParsed === "failed" && failedRetryable(e)))) ||
          (e.fullTextParsed === "ok" && !e.abstractSource) ||
          (e.abstractSource === "zotero_original" && isEnglishText(e.abstract)) ||
          // 英文摘要未打标（含无 PDF 附件的条目）→ 翻译目标（复审：此前仅 zotero_original 入选，
          // 英文条目永不被打标，无 pdfKey 的英文摘要条目永不翻译）
          (isEnglishText(e.abstract) && !e.abstractSource) ||
          (!e.pdfPath && !String(e.abstract || "").trim() && !e.abstractSource))) ||
      // 新增：缺关键词目标（任意来源，有摘要或全文可用）
      (e.keywords == null &&
        (String(e.abstract || "").trim() || String(e.abstractEn || "").trim() || e.fullText))
  );
  if (targets.length === 0) return { processed: 0, summaries: 0, keywords: 0 };

  const batch = targets.slice(0, batchLimit);
  let llmUsed = 0;
  let summaries = 0;
  let keywords = 0;
  const patchEntry = (zoteroKey, patch) => {
    store.update("literature", undefined, (cur) => ({
      entries: (cur.entries || []).map((e) => (e.zoteroKey === zoteroKey ? { ...e, ...patch } : e)),
    }));
  };
  const patchFailed = (zoteroKey) => patchEntry(zoteroKey, { fullTextParsed: "failed", failedAt: new Date().toISOString() });

  for (const entry of batch) {
    try {
      // 关键词分支：缺关键词且 llmUsed 有预算 → 从摘要/全文提取（成功 continue，失败落回既有分支）
      if (entry.keywords == null && llmUsed < llmLimit) {
        const src = String(entry.abstract || "").trim() || String(entry.abstractEn || "").trim() || String(entry.fullText || "").slice(0, 12000);
        if (src) {
          try {
            const kws = await extractLiteratureKeywords(ctx, entry, src);
            if (kws) {
              const patchBase = { keywords: kws, keywordsSource: "ai" };
              if (entry.source === "zotero") {
                patchEntry(entry.zoteroKey, patchBase);
              } else {
                // 在线条目无 zoteroKey，按 e.id 匹配更新
                store.update("literature", undefined, (cur) => ({
                  entries: (cur.entries || []).map((e) => (e.id === entry.id ? { ...e, ...patchBase } : e)),
                }));
              }
              llmUsed += 1;
              keywords += 1;
              continue;
            }
          } catch {}
        }
      }
      // 非 Zotero 条目仅参与关键词提取（摘要/翻译/PDF 链路只服务 Zotero 镜像）
      if (entry.source !== "zotero") continue;
      // 分支零：有摘要但未打标且非英文（已有中文摘要）→ 补 zotero_original 标记
      if (!entry.abstractSource && String(entry.abstract || "").trim() && !isEnglishText(entry.abstract)) {
        patchEntry(entry.zoteroKey, { abstractSource: "zotero_original" });
        continue;
      }
      // 分支一：翻译（英文摘要 → 中文；zotero_original 或老条目未打标均处理）
      if (llmUsed < llmLimit && isEnglishText(entry.abstract) && entry.abstractSource !== "ai_generated" && entry.abstractSource !== "ai_translated" && entry.abstractSource !== "none") {
        try {
          const zh = await translateAbstract(ctx, entry, entry.abstract);
          if (zh) {
            patchEntry(entry.zoteroKey, {
              abstract: zh,
              abstractEn: entry.abstract,
              abstractSource: "ai_translated",
            });
            llmUsed += 1;
            summaries += 1;
            continue;
          }
        } catch {}
      }
      // 已解析未打标：无摘要 → 用已有全文生成（不重解析）；其他已解析 → 跳过
      if (entry.fullTextParsed === "ok") {
        if (!entry.abstractSource && !String(entry.abstract || "").trim() && llmUsed < llmLimit && entry.fullText) {
          try {
            const summary = await summarizeFromFulltext(ctx, entry, entry.fullText.slice(0, 30000));
            if (summary) {
              patchEntry(entry.zoteroKey, { abstract: summary, abstractSource: "ai_generated" });
              llmUsed += 1;
              summaries += 1;
            }
          } catch {}
        }
        continue;
      }
      // 分支二：全文获取（Zotero fulltext API——复用 Zotero 已建全文索引，零本地解析）
      // 错误分类（复审 D3）：no_index（未索引/扫描版/版本不支持）→ failedAt 冷却 24h 重试；
      // api_error（API 未开启/Zotero 重启中）→ 本轮跳过不写 failed，下次循环即重试，环境修复后立即恢复
      if (!entry.pdfKey) continue; // 旧条目无 pdfKey（同步于 fulltext 迁移前），等下次同步补字段，不标 failed
      const ft = await fetchZoteroFulltext(ctx, zoteroPort, entry.pdfKey);
      if (ft.kind === "api_error") continue;
      if (ft.kind === "no_index") {
        patchFailed(entry.zoteroKey);
        continue;
      }
      const isScan = ft.text.length < SCAN_THRESHOLD;
      const patch = isScan
        ? { fullTextParsed: "scan", failedAt: null }
        : { fullTextParsed: "ok", fullText: ft.text.slice(0, PDF_MAX_CHARS), failedAt: null };
      // 摘要生成：abstract 空且文本可用
      if (!isScan && !String(entry.abstract || "").trim() && llmUsed < llmLimit) {
        try {
          const summary = await summarizeFromFulltext(ctx, entry, ft.text.slice(0, 30000));
          if (summary) {
            patch.abstract = summary;
            patch.abstractSource = "ai_generated";
            llmUsed += 1;
            summaries += 1;
          }
        } catch {}
      } else if (isScan && !String(entry.abstract || "").trim()) {
        // 扫描版且无摘要 → 待补全
        patch.abstractSource = "none";
      }
      patchEntry(entry.zoteroKey, patch);
    } catch (err) {
      try {
        patchFailed(entry.zoteroKey);
      } catch {}
    }
  }
  return { processed: batch.length, summaries, keywords };
}

/**
 * 增强循环：逐批铺完摘要/翻译/关键词
 * 终止条件：无目标（processed === 0）或本轮零产出（防止 LLM 持续失败死循环）
 */
export async function runEnhancementLoop(ctx, store) {
  let rounds = 0;
  for (;;) {
    const r = await enhanceZoteroPdfs(ctx, store, 8, 3);
    rounds += 1;
    if (r.processed === 0 || (r.summaries + r.keywords) === 0 || rounds >= 30) break;
  }
  return { rounds };
}

/** 判断文本是否含中文（含中文视为已是中文摘要，不翻译） */
function isEnglishText(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return !/\p{Script=Han}/u.test(s);
}

/**
 * Zotero 全量镜像同步（A1）：探测 → 全量拉取 → 镜像替换 → 水位线
 * 供 scanAllSources 与 index.js 同步定时器复用
 */
export async function syncZotero(ctx, store) {
  const zoteroPort = ctx.config.get?.("zoteroPort") ?? 23119;
  const probe = await zoteroProbe(ctx, zoteroPort);
  if (!probe.ok) {
    return { ok: false, error: probe.error, code: probe.code, entries: [] };
  }
  const fetched = await fetchZoteroItems(ctx, zoteroPort);
  // 分页截断（2026-08-07 复审）：fetchZoteroItems 在 Total-Results 与实收不符时返回
  // { truncated: true, items: [] } 而非数组，视同同步异常走下方跳过路径
  const truncated = !Array.isArray(fetched);
  const items = truncated ? [] : fetched;
  // D1：刷新 Zotero collection 映射（key/name/parentCollection），写入 collections 存储
  const collections = await fetchZoteroCollections(ctx, zoteroPort);
  try {
    const cur = store.read("collections");
    store.update("collections", cur.version, () => ({ collections }));
  } catch { /* collection 映射写入失败不影响文献同步 */ }
  // C3：镜像替换时保留旧条目的 PDF 增强字段（fullText/fullTextParsed/AI 摘要），避免每次同步丢失重解析
  const prev = store.read("literature");
  const prevByKey = new Map(
    (prev.entries || []).filter((e) => e.zoteroKey).map((e) => [e.zoteroKey, e])
  );
  // 空响应保护（P1-5）：旧库存在镜像条目而本次拉取为空 → 视为同步异常（端口被占/API 异常/分页截断），
  // 整体跳过本次同步——不替换、不标记 zoteroGone（upsertByKey 的替换语义会把镜像条目直接清空）。
  const hasMirror = (prev.entries || []).some((e) => e.zoteroKey && e.source === "zotero");
  if (items.length === 0 && (hasMirror || truncated)) {
    ctx.log?.warn?.(`zotero sync: ${truncated ? "分页截断" : "空响应"}且${hasMirror ? "旧库存在镜像条目" : "首次同步"}，跳过本次同步（疑似同步异常）`);
    writeSettings(ctx, store, { zoteroLastSyncAt: store.now(), zoteroCount: 0, zoteroSyncSkipped: true });
    return { ok: true, entries: [], replaced: 0, gone: 0, skipped: true };
  }
  // E4：Zotero 删除同步——本次拉取缺失的镜像条目打 zoteroGone（保留数据，UI 置灰 + 一键清除）
  const liveKeys = new Set(items.filter((i) => i.zoteroKey).map((i) => i.zoteroKey));
  const goneEntries = (prev.entries || [])
    .filter((e) => e.zoteroKey && e.source === "zotero" && !liveKeys.has(e.zoteroKey) && !e.zoteroGone)
    .map((e) => ({ ...e, zoteroGone: true, zoteroGoneAt: store.now() }));
  const merged = items.map((it) => {
    const old = prevByKey.get(it.zoteroKey);
    if (!old) {
      // E2：新条目无摘要 → 待补全标记（有摘要保持 zotero_original 待翻译）
      // E5：firstSeenAt 新入库时间戳（UI「新」徽标）
      const base = { ...it, firstSeenAt: store.now() };
      if (!String(it.abstract || "").trim() && !it.abstractSource) {
        return { ...base, abstractSource: "none" };
      }
      return base;
    }
    const patch = {};
    // D1（复审）：pdfPath/pdfKey 兜底保留——附件映射一次失败（API 5xx/403 兜底仍失败）会让
    // 本轮所有条目 pdfKey 变 null，增强循环整体停摆；旧值保留则下次同步恢复，窗口期只影响增量
    if (!it.pdfPath && old.pdfPath) patch.pdfPath = old.pdfPath;
    if (!it.pdfKey && old.pdfKey) patch.pdfKey = old.pdfKey;
    // 失败项不合并（下次同步重试）；成功/扫描标记保留避免重复解析
    if (old.fullTextParsed && old.fullTextParsed !== "failed") patch.fullTextParsed = old.fullTextParsed;
    if (old.fullText) patch.fullText = old.fullText;
    // E2：增强摘要保留（ai_generated / ai_translated / 旧 fulltext），zotero_original 不保留（下次同步后重新翻译）
    if (old.abstractSource && old.abstractSource !== "zotero_original" && old.abstract) {
      patch.abstract = old.abstract;
      patch.abstractSource = old.abstractSource;
      if (old.abstractEn) patch.abstractEn = old.abstractEn;
    }
    // E5：firstSeenAt / citationCount 保留
    if (old.firstSeenAt) patch.firstSeenAt = old.firstSeenAt;
    if (old.citationCount != null) patch.citationCount = old.citationCount;
    // 增强保留：AI 关键词不被 Zotero tags/空数组覆盖（下次同步仍保留）
    if (old.keywordsSource === "ai") {
      patch.keywords = old.keywords;
      patch.keywordsSource = old.keywordsSource;
    }
    return { ...it, ...patch };
  });
  const result = store.upsertByKey("literature", "zoteroKey", merged, goneEntries);
  writeSettings(ctx, store, { zoteroLastSyncAt: store.now(), zoteroCount: items.length, zoteroSyncSkipped: false });

  // 实验记录中心化：检测本次新增的 Zotero 条目（zoteroKey 未在旧库出现），自动日志化到 worklog
  const newEntries = merged.filter((it) => !prevByKey.has(it.zoteroKey));
  if (newEntries.length > 0 && result.ok) {
    try {
      appendLiteratureLog(store, newEntries, `zotero-sync-${store.now()}`);
    } catch (err) {
      ctx.log?.warn?.(`zotero sync log failed: ${err?.message || err}`);
    }
  }

  return { ok: true, entries: items, replaced: result.replaced, gone: goneEntries.length };
}

/**
 * E5：OpenAlex 引用数补全（按 DOI，节流 batchLimit 条/批）
 * Zotero 镜像条目 citationCount 恒 null，「引用排序」对主库无效——用 OpenAlex cited_by_count 补
 */
export async function enrichCitationCounts(ctx, store, batchLimit = 5) {
  const doc = store.read("literature");
  const targets = (doc.entries || []).filter(
    (e) => e.source === "zotero" && e.doi && e.citationCount == null && !e.zoteroGone
  );
  if (targets.length === 0) return { processed: 0 };
  const batch = targets.slice(0, batchLimit);
  for (const entry of batch) {
    try {
      const res = await ctx.network.fetch(
        `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(entry.doi)}`,
        { timeoutMs: 8000, cacheTtlMs: 0 }
      );
      if (!res?.ok) continue;
      const data = await res.json();
      const c = data?.cited_by_count;
      if (typeof c === "number") {
        store.update("literature", undefined, (cur) => ({
          entries: (cur.entries || []).map((e) =>
            e.zoteroKey === entry.zoteroKey ? { ...e, citationCount: c } : e
          ),
        }));
      }
    } catch {}
  }
  return { processed: batch.length };
}

/**
 * 文献源扫描：仅 Zotero 本地源（实验记录中心化后去除工作区/在线源）
 * 返回 { entries, warnings, sourceStats }
 */
export async function scanAllSources(ctx, store) {
  const entries = [];
  const warnings = [];
  const sourceStats = { zotero: 0 };

  // Zotero：全量镜像（探测失败优雅降级，不影响其他来源）
  const sync = await syncZotero(ctx, store);
  if (sync.ok) {
    entries.push(...sync.entries);
    sourceStats.zotero += sync.entries.length;
  } else {
    warnings.push(`Zotero 未连接（${sync.code || sync.error || "无法访问"}），可从 Zotero 导出 CSL JSON/RIS 到文献目录替代`);
  }

  // 2. 最终去重（Zotero 优先存活）
  const deduped = dedupeZoteroPriority(entries);
  const dropped = entries.length - deduped.length;
  if (dropped > 0) warnings.push(`去重丢弃 ${dropped} 条重复（Zotero 优先存活）`);

  return { entries: deduped, warnings, sourceStats };
}
