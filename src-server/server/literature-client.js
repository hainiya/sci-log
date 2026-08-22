/**
 * 在线文献检索客户端：Semantic Scholar / arXiv / Crossref
 * 全部走 ctx.network.fetch()（受 manifest network.allowedHosts 约束）
 * 限流：并发 3 + 指数退避 + 24h 内存缓存
 */
import { extractDoi } from "./parsers.js";

const CONCURRENCY = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 解析检索年份窗口：settings.searchYearWindow 默认 5（1-30 校验），返回 {from, to}，含当年共 N 年 */
export function resolveYearRange(settings = {}) {
  const w = Number(settings?.searchYearWindow);
  const window = Number.isInteger(w) && w >= 1 && w <= 30 ? w : 5;
  const to = new Date().getFullYear();
  return { from: to - window + 1, to };
}

function sanitizeTitle(title) {
  return String(title || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

function mapSemanticScholar(paper) {
  const authors = (paper.authors || []).map((a) => a.name || "").filter(Boolean);
  return {
    title: sanitizeTitle(paper.title),
    authors,
    year: paper.year ? String(paper.year) : null,
    venue: paper.venue || paper.journal?.name || null,
    doi: paper.externalIds?.DOI || paper.doi || null,
    url: paper.url || null,
    abstract: sanitizeTitle(paper.abstract || ""),
    // keywords 恒 null：API 自带标签（fieldsOfStudy）不占位，留给 AI 提取（keywordsSource: "ai"）
    keywords: null,
    source: "online",
    sourceApi: "semanticscholar",
    externalIds: paper.externalIds || null,
    citationCount: typeof paper.citationCount === "number" ? paper.citationCount : null,
  };
}

function mapArxiv(entry) {
  const authors = (entry.authors || []).map((a) => a.name || "").filter(Boolean);
  const doi = extractDoi(entry.doi);
  const title = sanitizeTitle((entry.title || "").replace(/\s+/g, " "));
  return {
    title,
    authors,
    year: entry.published ? entry.published.slice(0, 4) : null,
    venue: "arXiv",
    doi,
    url: entry.id || entry.link || (entry.arxivId ? `https://arxiv.org/abs/${entry.arxivId}` : null),
    abstract: sanitizeTitle(entry.summary || ""),
    keywords: null,
    source: "online",
    sourceApi: "arxiv",
    arxivId: entry.arxivId || null,
    citationCount: null,
  };
}

function mapCrossref(item) {
  const authors = (item.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean);
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const title = sanitizeTitle((item.title || [])[0] || "");
  if (!title) return null;
  return {
    title,
    authors,
    year: year ? String(year) : null,
    venue: item["container-title"]?.[0] || item.publisher || null,
    doi: item.DOI || null,
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
    abstract: sanitizeTitle(item.abstract ? item.abstract.replace(/<[^>]+>/g, "") : ""),
    keywords: null,
    source: "online",
    sourceApi: "crossref",
    citationCount: typeof item["is-referenced-by-count"] === "number" ? item["is-referenced-by-count"] : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避重试包装 */
async function fetchWithRetry(fetchFn, url, options, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetchFn(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(500 * 2 ** attempt);
  }
  throw lastError || new Error(`fetch failed: ${url}`);
}

export function createLiteratureClient(ctx, cache = new Map()) {
  async function cachedFetch(url, options = {}) {
    const cacheKey = `${options.method || "GET"} ${url}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.snapshot;
    const res = await fetchWithRetry(ctx.network.fetch.bind(ctx.network), url, options);
    const text = await res.text();
    const snapshot = { status: res.status, text };
    if (res.ok) cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
    return snapshot;
  }

  /** Semantic Scholar：批量搜索（Graph API） */
  async function searchSemanticScholar(query, limit = 10, yearRange = null) {
    const yearParam = yearRange ? `&year=${yearRange.from}-${yearRange.to}` : "";
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}&fields=title,authors,year,venue,abstract,externalIds,url,fieldsOfStudy,citationCount,doi,journal${yearParam}`;
    const { text, status } = await cachedFetch(url, { cacheTtlMs: CACHE_TTL_MS });
    // 解析防护：上游 200+ 非 JSON（网关错误页/限流页）时显式降级为空并告警，避免静默吞掉整源结果
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      ctx?.log?.warn?.(`semanticscholar: 200 响应非 JSON（status=${status}），前 200 字符：${String(text).slice(0, 200)}`);
      return [];
    }
    return (data.data || []).map(mapSemanticScholar);
  }

  /** arXiv API（Atom 格式） */
  async function searchArxiv(query, limit = 10, yearRange = null) {
    const dateParam = yearRange ? ` AND submittedDate:[${yearRange.from}01010000 TO ${yearRange.to}12312359]` : "";
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}${dateParam}`)}&start=0&max_results=${Math.min(limit, 100)}`;
    const { text } = await cachedFetch(url, { cacheTtlMs: CACHE_TTL_MS });
    // 极简 Atom 解析
    const entries = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entryRe.exec(text)) !== null) {
      const body = m[1];
      const get = (tag) => {
        const mm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return mm ? mm[1].trim() : "";
      };
      const id = get("id");
      entries.push({
        title: get("title"),
        summary: get("summary"),
        authors: [...body.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((x) => x[1].trim()),
        published: get("published"),
        doi: get("doi") || null,
        id: id || null,
        arxivId: id ? id.split("/abs/")[1]?.split("v")[0] || null : null,
      });
      if (entries.length >= limit) break;
    }
    return entries.map(mapArxiv);
  }

  /** Crossref 搜索 */
  async function searchCrossref(query, limit = 10, yearRange = null) {
    const dateFilter = yearRange ? `&filter=from-pub-date:${yearRange.from}-01-01,until-pub-date:${yearRange.to}-12-31` : "";
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${Math.min(limit, 100)}&select=DOI,title,author,issued,container-title,publisher,URL,abstract,is-referenced-by-count${dateFilter}`;
    const { text, status } = await cachedFetch(url, { cacheTtlMs: CACHE_TTL_MS });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      ctx?.log?.warn?.(`crossref: 200 响应非 JSON（status=${status}），前 200 字符：${String(text).slice(0, 200)}`);
      return [];
    }
    return (data.message?.items || []).map(mapCrossref).filter(Boolean);
  }

  /** 三源并行检索（Semantic Scholar 为主，arXiv/Crossref 补充） */
  async function searchAll(query, limit = 10, signal = null, yearRange = null) {
    const perSource = Math.max(3, Math.ceil(limit / 2));
    const tasks = [
      { name: "semanticscholar", fn: () => searchSemanticScholar(query, perSource, yearRange) },
      { name: "arxiv", fn: () => searchArxiv(query, Math.max(3, Math.ceil(perSource / 2)), yearRange) },
      { name: "crossref", fn: () => searchCrossref(query, Math.max(3, Math.ceil(perSource / 2)), yearRange) },
    ];
    const results = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        if (signal?.aborted) return;
        const task = tasks[cursor++];
        try {
          const items = await task.fn();
          results.push(...items);
        } catch (err) {
          // 单源失败不阻塞整体
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // 去重（DOI/标题），优先保留 Semantic Scholar 结果
    const seen = new Set();
    const merged = [];
    const fingerprint = (item) => {
      if (item.doi) return `doi:${item.doi.toLowerCase()}`;
      if (item.title) return `title:${item.title.toLowerCase()}`;
      return null;
    };
    const priority = { semanticscholar: 0, arxiv: 1, crossref: 2 };
    results.sort((a, b) => (priority[a.sourceApi] ?? 9) - (priority[b.sourceApi] ?? 9));
    for (const item of results) {
      const fp = fingerprint(item);
      if (fp && seen.has(fp)) continue;
      if (fp) seen.add(fp);
      merged.push(item);
      if (merged.length >= limit) break;
    }
    return merged;
  }

  return { searchAll, searchSemanticScholar, searchArxiv, searchCrossref };
}
