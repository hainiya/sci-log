/**
 * 面板数据 API（routes/api.js，挂载前缀 /api）
 * - 读写 + 乐观锁 + api/changes 增量接口（面板轮询）
 * - 设置抽屉：文献目录管理 / 会话绑定管理
 * - 文献扫描、Zotero 探测、指标序列
 *
 * 实验记录中心化改造后：移除 plan / report / assessment / proposals / rejected / review 相关路由。
 */
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../server/store.js";
import { triageWorklog } from "../server/triage.js";
import { readSettings, writeSettings, scanAllSources, zoteroProbe, runEnhancementLoop, enrichCitationCounts } from "../server/sources.js";
import { buildMetricsSeries } from "../server/metrics.js";
import { parseMetricTable } from "../server/import-parser.js";

const WRITABLE = new Set(["worklog", "gantt", "calendar", "literature"]);

export default function registerApiRoutes(app, ctx) {
  const store = createStore(ctx.dataDir);

  const sessionIdOf = (c) => {
    const header = c.req.header("x-hana-plugin-surface-session");
    if (header && header.trim()) return header.trim();
    return c.req.query("sessionId") || null;
  };

  const sessionPathOf = (c) => c.req.query("sessionPath") || null;

  // ── 全量状态 ──────────────────────────────────────────────
  app.get("/state", (c) => {
    const state = {};
    for (const name of ["binding", "gantt", "calendar", "literature", "worklog", "settings", "collections"]) {
      if (name === "literature") {
        // E5：fullText 不进 UI state（60k-100k × N ≈ 10MB 级传输）——按需读取
        const doc = store.read(name);
        state[name] = { ...doc, entries: (doc.entries || []).map(({ fullText, ...rest }) => rest) };
      } else {
        state[name] = store.read(name);
      }
    }
    state.updates = store.getUpdates();
    state.config = {
      autoCollectEnabled: ctx.config.get?.("autoCollectEnabled") ?? true,
      autoApproveLiterature: ctx.config.get?.("autoApproveLiterature") ?? true,
      zoteroPort: ctx.config.get?.("zoteroPort") ?? 23119,
      // autoTriage 迁入宿主配置（技术栈复审）：宿主优先，回退 settings.json 旧值兼容迁移
      autoTriage: ctx.config.get?.("autoTriage") ?? state.settings?.autoTriage ?? true,
    };
    state.sessionId = sessionIdOf(c);
    return c.json(state);
  });

  // ── E5：全文按需读取（AI 侧 / 后续全文阅读用） ────────────
  app.get("/literature/fulltext", (c) => {
    const id = c.req.query("id") || "";
    const lit = store.read("literature");
    const entry = (lit.entries || []).find((e) => e.zoteroKey === id || e.id === id);
    if (!entry) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, fullText: entry.fullText || null, fullTextParsed: entry.fullTextParsed || null, title: entry.title });
  });

  // ── E4：一键清除失效镜像（zoteroGone 条目，用户主动操作） ──
  app.post("/literature/purge-gone", (c) => {
    const lit = store.read("literature");
    const gone = (lit.entries || []).filter((e) => e.zoteroGone);
    if (gone.length === 0) return c.json({ ok: true, purged: 0 });
    store.update("literature", undefined, (cur) => ({
      entries: (cur.entries || []).filter((e) => !e.zoteroGone),
    }));
    return c.json({ ok: true, purged: gone.length });
  });

  // ── 增量水位线（面板轮询） ───────────────────────────────
  app.get("/changes", (c) => {
    const sinceRaw = c.req.query("since");
    let since = {};
    if (sinceRaw) {
      try {
        since = JSON.parse(sinceRaw);
      } catch {}
    }
    const updates = store.getUpdates();
    const changed = {};
    for (const [key, value] of Object.entries(updates)) {
      if ((since[key] || 0) !== value) changed[key] = value;
    }
    return c.json({ changed, updates });
  });

  // ── 通用读写（乐观锁） ────────────────────────────────────
  for (const name of WRITABLE) {
    app.get(`/${name}`, (c) => c.json(store.read(name)));

    app.put(`/${name}`, async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
      const { version, data, evolution } = body || {};
      if (data === undefined) {
        return c.json({ error: "missing_data" }, 400);
      }
      // A4：Zotero 镜像条目只读（提交中镜像条目与库中不一致 → 拒绝）
      if (name === "literature" && Array.isArray(data?.entries)) {
        const current = store.read("literature");
        const curMirror = (current.entries || []).filter((e) => e.readOnly);
        const newMirror = data.entries.filter((e) => e.readOnly);
        const mirrorTouched =
          curMirror.length !== newMirror.length ||
          curMirror.some((e) => {
            const counterpart = newMirror.find((n) => n.zoteroKey === e.zoteroKey);
            return !counterpart || JSON.stringify(counterpart) !== JSON.stringify(e);
          });
        if (mirrorTouched) {
          return c.json({ error: "readonly_source", message: "Zotero 镜像条目为只读，请在 Zotero 中修改后同步（或删除本地镜像）" }, 400);
        }
      }
      const result = store.update(name, version, () => data);
      if (!result.ok) {
        return c.json({ error: "version_conflict", data: result.data }, 409);
      }
      // 实验记录写入后触发 AI 巡检（异步，不阻塞响应）：参数结构化/文献关联/甘特进度/日程识别 → 直接写库
      // autoTriage 开关（宿主配置优先，回退 settings.json 旧值；默认 true）：关闭则跳过自动巡检
      if (name === "worklog" && result.ok) {
        const settings = readSettings(ctx, store);
        const autoTriage = ctx.config.get?.("autoTriage") ?? settings.autoTriage ?? true;
        if (autoTriage) {
          triageWorklog(ctx, store).catch((err) => ctx?.log?.warn(`triage after write failed: ${err?.message || err}`));
        }
      }
      return c.json({ ok: true, data: result.data });
    });
  }

  // ── 批量导入（仪器表格粘贴 → worklog 记录）───────────────
  // dryRun=true 只解析预览；否则解析 + 直接落库（等价表单录入，手工粘贴本身是显式操作）
  // 落库后巡检照常触发（autoTriage 开关语义与 app.put /worklog 一致）
  app.post("/worklog/import", async (c) => {
    let body = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const text = String(body?.text || "");
    const dryRun = Boolean(body?.dryRun);
    if (!text.trim()) {
      return c.json({ error: "empty_text" }, 400);
    }
    const today = store.now().slice(0, 10);
    const parsed = parseMetricTable(text, { today });
    if (dryRun) {
      return c.json({ ok: true, dryRun: true, records: parsed.records, errors: parsed.errors, summary: parsed.summary });
    }
    if (parsed.records.length === 0) {
      return c.json({ ok: false, error: "no_valid_rows", errors: parsed.errors, summary: parsed.summary }, 400);
    }
    const now = store.now();
    const stamp = Date.now().toString(36);
    const entries = parsed.records.map((r, i) => ({
      id: `work_${stamp}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      sampleId: r.sampleId || null,
      date: r.date,
      content: r.contentParts.length > 0 ? r.contentParts.join("；") : `批量导入（${today}）`,
      data: null,
      taskId: null,
      durationHours: null,
      startDate: null,
      createdAt: now,
      fields: r.fields,
      citations: [],
      ...(r.system ? { system: r.system } : {}),
    }));
    const result = store.update("worklog", undefined, (cur) => ({
      entries: [...(cur.entries || []), ...entries],
    }));
    if (result.ok) {
      const settings = readSettings(ctx, store);
      const autoTriage = ctx.config.get?.("autoTriage") ?? settings.autoTriage ?? true;
      if (autoTriage) {
        triageWorklog(ctx, store).catch((err) => ctx?.log?.warn(`triage after import failed: ${err?.message || err}`));
      }
    }
    return c.json({
      ok: true,
      imported: entries.length,
      points: parsed.summary.points,
      skippedRows: parsed.errors.length,
      errors: parsed.errors,
    });
  });

  // ── 实验记录 AI 巡检（手动触发） ─────────────────────────
  app.post("/worklog/triage", async (c) => {
    let body = {};
    try {
      body = await c.req.json();
    } catch {}
    const force = Boolean(body?.force);
    const result = await triageWorklog(ctx, store, { force }).catch((err) => ({
      error: "triage_failed",
      detail: err?.message || String(err),
    }));
    return c.json({ ok: !result?.error, ...result });
  });

  // ── literature 追加式（扫描入库共用） ────────────────
  app.post("/literature/append", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const items = Array.isArray(body?.entries) ? body.entries : [];
    if (items.length === 0) return c.json({ ok: true, appended: 0 });
    const result = store.append("literature", items);
    return c.json({ ok: true, appended: result.appended, data: result.data });
  });

  // ── E5：手动触发 OpenAlex 引用数补全（多轮铺完） ──────────
  app.post("/literature/enrich-cites", async (c) => {
    let processed = 0;
    for (let round = 0; round < 8; round++) {
      const r = await enrichCitationCounts(ctx, store, 5);
      processed += r.processed;
      if (r.processed === 0) break;
    }
    store.bump("literature");
    return c.json({ ok: true, processed });
  });

  // ── 文献扫描（手动） ──────────────────────────────────────
  app.post("/scan", async (c) => {
    try {
      const { entries, warnings, sourceStats } = await scanAllSources(ctx, store);
      const enriched = entries.map((e, index) => ({
        id: `lit_scan_${Date.now().toString(36)}_${index}`,
        addedAt: store.now(),
        status: "new",
        ...e,
      }));
      // 入库走追加式（实验记录中心化：自动扫描直接入库，AI 写即生效）
      const appended = store.append("literature", enriched).appended;
      return c.json({
        ok: true,
        found: entries.length,
        appended,
        warnings,
        sourceStats,
      });
    } catch (err) {
      ctx.log.error("scan failed:", err.message);
      return c.json({ error: "scan_failed", detail: err.message }, 500);
    }
  });

  // ── 文献移除（用户操作：待整理条目单条/清空；Zotero 镜像只读拒绝） ──
  app.delete("/literature", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch {}
    const doc = store.read("literature");
    const entries = doc.entries || [];
    let targets;
    if (body?.all === true) {
      targets = entries.filter((e) => e.source !== "zotero" && typeof e.id === "string").map((e) => e.id);
    } else if (Array.isArray(body?.ids)) {
      targets = body.ids.filter((id) => typeof id === "string" && id);
    } else {
      return c.json({ error: "bad_request", hint: "需要 ids 数组或 all=true" }, 400);
    }
    const removable = new Set(
      entries.filter((e) => typeof e.id === "string" && targets.includes(e.id) && e.source !== "zotero").map((e) => e.id)
    );
    if (removable.size === 0) return c.json({ ok: true, removed: 0 });
    const result = store.update("literature", doc.version, (cur) => ({
      entries: (cur.entries || []).filter((e) => typeof e.id !== "string" || !removable.has(e.id)),
    }));
    if (!result.ok) {
      return c.json({ error: "conflict", hint: "文献库已变更，请刷新后重试" }, 409);
    }
    return c.json({ ok: true, removed: removable.size });
  });

  // ── E3：手动增强（✨ AI 摘要：生成/翻译摘要 + 提取关键词；fire-and-forget 启动新一轮循环铺完） ──
  app.post("/literature/enhance-pdfs", async (c) => {
    runEnhancementLoop(ctx, store)
      .then((r) => {
        store.bump("literature");
        ctx.log.info(`manual enhance loop done: ${r.rounds} round(s)`);
      })
      .catch((err) => ctx.log.warn("manual enhance failed:", err.message));
    return c.json({ ok: true, started: true, hint: "补全已在后台启动，约 10-20 分钟完成，稍后刷新面板查看" });
  });

  // ── Zotero 状态探测（面板标注用，5 分钟节流） ─────────────────
  let zoteroProbeCache = { at: 0, result: null };
  app.get("/sources/zotero", async (c) => {
    const port = ctx.config.get?.("zoteroPort") ?? 23119;
    const now = Date.now();
    if (zoteroProbeCache.result && now - zoteroProbeCache.at < 5 * 60 * 1000) {
      return c.json({ port, ...zoteroProbeCache.result });
    }
    const probe = await zoteroProbe(ctx, port);
    zoteroProbeCache = { at: now, result: probe };
    return c.json({ port, ...probe });
  });

  // 手动重试探测（绕过节流缓存）
  app.post("/sources/zotero/probe", async (c) => {
    const port = ctx.config.get?.("zoteroPort") ?? 23119;
    const probe = await zoteroProbe(ctx, port);
    zoteroProbeCache = { at: Date.now(), result: probe };
    return c.json({ port, ...probe });
  });

  // ── P1：指标时间线（从实验记录抽取性能数值，按体系/时间分组） ──
  app.get("/metrics/series", (c) => {
    const worklog = store.read("worklog");
    const literature = store.read("literature");
    const result = buildMetricsSeries(worklog.entries || [], literature.entries || []);
    return c.json(result);
  });

  // ── 设置抽屉：指标目标值（用户自设的 ZT/PF 等目标线，持久化到 settings） ──
  app.post("/settings/metrics", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const targets = body?.targets;
    if (!targets || typeof targets !== "object") {
      return c.json({ error: "missing_targets" }, 400);
    }
    // 仅保留数值或 null，过滤非法输入
    const clean = {};
    for (const [k, v] of Object.entries(targets)) {
      if (v === null || v === undefined) clean[k] = null;
      else if (Number.isFinite(Number(v))) clean[k] = Number(v);
    }
    const next = writeSettings(ctx, store, { metricTargets: clean });
    return c.json({ ok: true, metricTargets: next.metricTargets || {} });
  });

  // ── 设置抽屉：检索年份窗口（默认近 N 年，在线检索/自动搜集共用） ──
  app.post("/settings/search-window", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const years = Number(body?.years);
    if (!Number.isInteger(years) || years < 1 || years > 30) {
      return c.json({ error: "invalid_years", message: "年份窗口需为 1-30 的整数" }, 400);
    }
    writeSettings(ctx, store, { searchYearWindow: years });
    return c.json({ ok: true, searchYearWindow: years });
  });

  // ── 设置抽屉：实验记录自动巡检开关（autoTriage，默认 true）──
  // 仅控制「写入后自动巡检」；手动 force 巡检（POST /worklog/triage）不受开关限制
  app.post("/settings/auto-triage", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch {}
    const enabled = body?.enabled === true;
    try {
      ctx.config.set?.("autoTriage", enabled);
    } catch (err) {
      ctx.log?.warn?.(`auto-triage config set failed: ${err?.message || err}`);
    }
    return c.json({ ok: true, autoTriage: enabled });
  });

  // ── 设置抽屉：会话绑定管理 ────────────────────────────────
  app.get("/binding", (c) => c.json(store.read("binding")));

  app.post("/binding", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const { sessionId, sessionPath, source = "manual" } = body || {};
    if (!sessionId) {
      return c.json({ error: "missing_sessionId" }, 400);
    }
    const current = store.read("binding");
    const next = {
      sessionId,
      sessionPath: sessionPath || null,
      boundAt: store.now(),
      source,
    };
    store.write("binding", next);
    try {
      ctx.bus?.emit?.({ type: "materials-research-copilot:binding-changed", sessionId }, null);
      ctx.appEvents.emit("binding-changed", { sessionId });
    } catch {}
    return c.json({ ok: true, binding: next, previous: current });
  });

  app.delete("/binding", (c) => {
    const current = store.read("binding");
    store.write("binding", {
      sessionId: null,
      sessionPath: null,
      boundAt: null,
      source: null,
    });
    try {
      ctx.bus?.emit?.({ type: "materials-research-copilot:binding-changed", sessionId: null }, null);
      ctx.appEvents.emit("binding-changed", { sessionId: null });
    } catch {}
    return c.json({ ok: true, previous: current });
  });

  // ── 快照/回退 ─────────────────────────────────────────────
  app.get("/snapshots/:name", (c) => {
    const name = c.req.param("name");
    if (!WRITABLE.has(name)) return c.json({ error: "invalid_target" }, 400);
    return c.json({ snapshots: store.listSnapshots(name) });
  });

  app.post("/snapshots/:name/rollback", async (c) => {
    const name = c.req.param("name");
    if (!WRITABLE.has(name)) return c.json({ error: "invalid_target" }, 400);
    let toVersion;
    try {
      const body = await c.req.json();
      toVersion = body?.toVersion;
    } catch {}
    if (toVersion === undefined) {
      const q = c.req.query("toVersion");
      if (q !== undefined && q !== null && q !== "") toVersion = Number(q);
    }
    const result = store.rollback(name, toVersion);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, data: result.data });
  });
}
