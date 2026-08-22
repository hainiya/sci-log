/**
 * 面板数据 API（routes/api.js，挂载前缀 /api）
 * - 读写 + 乐观锁 + api/changes 增量接口（面板轮询）
 * - 设置抽屉：文献目录管理 / 会话绑定管理 / 拒绝记录清空
 * - 文献扫描与报告刷新
 */
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../server/store.js";
import { createProposal } from "../server/proposals.js";
import { triageWorklog } from "../server/triage.js";
import { readSettings, writeSettings, scanAllSources, zoteroProbe, runEnhancementLoop, enrichCitationCounts } from "../server/sources.js";
import { analyzeLiterature, extractKeywords, draftProposalFromGuide, extractClusters, assessPlanAgainstLiterature, parsePlanAssessment } from "../server/llm.js";
import { buildMetricsSeries } from "../server/metrics.js";
import { parseMetricTable } from "../server/import-parser.js";
import { appendPlanEvolution } from "../server/evolution.js";
import { mergeMilestoneDiff } from "../tools/assess-plan.js";

const WRITABLE = new Set(["plan", "gantt", "calendar", "worklog", "literature"]);

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
    for (const name of ["binding", "plan", "plan-evolution", "gantt", "calendar", "literature", "worklog", "reviews", "rejected", "settings", "report", "collections", "proposals", "assessment"]) {
      if (name === "literature") {
        // E5：fullText 不进 UI state（60k-100k × 129 ≈ 10MB 级传输）——按需读取
        const doc = store.read(name);
        state[name] = { ...doc, entries: (doc.entries || []).map(({ fullText, ...rest }) => rest) };
      } else if (name === "plan-evolution") {
        // 演进史 UI 需要快照列表（判断回退/查看可用性）；快照动态计算不落盘
        state[name] = { ...store.read(name), snapshots: store.listSnapshots("plan") };
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
      if (name === "plan" && result.ok) {
        const ev = evolution;
        appendPlanEvolution(store, {
          version: result.data.version,
          by: "user",
          types: Array.isArray(ev?.types)
            ? ev.types.filter((t) => ["material", "process", "scope", "direction", "other"].includes(t))
            : [],
          reason: typeof ev?.reason === "string" ? ev.reason.slice(0, 300) : "",
          experimentKeys: Array.isArray(ev?.experimentKeys) ? ev.experimentKeys.map(String).slice(0, 20) : [],
        });
      }
      // 实验记录写入后触发 AI 巡检（异步，不阻塞响应）：参数结构化/文献关联/甘特进度/日程/方案对比 → 全部走提案
      // autoTriage 开关（宿主配置优先，回退 settings.json 旧值；默认 true）：关闭则跳过自动巡检；手动 force 端点不受限
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
    const plan = store.read("plan");
    const now = store.now();
    const stamp = Date.now().toString(36);
    const entries = parsed.records.map((r, i) => ({
      id: `work_${stamp}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      sampleId: r.sampleId || null,
      date: r.date,
      content: r.contentParts.length > 0 ? r.contentParts.join("；") : `批量导入（${today}）`,
      data: null,
      taskId: null,
      planVersion: plan.version,
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

  // ── C1：方案引导草案（空方案时面板调用） ──────────────────
  app.post("/guide/proposal-draft", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const { background, problem, data } = body || {};
    if (!String(background || "").trim() && !String(problem || "").trim()) {
      return c.json({ error: "missing_input", message: "至少填写课题背景或要解决的问题" }, 400);
    }
    try {
      const draft = await draftProposalFromGuide(ctx, { background, problem, data });
      if (!draft) return c.json({ error: "draft_failed", message: "草案生成失败，请稍后重试" }, 500);
      const planVersion = store.read("plan").version;
      const result = createProposal(store, {
        target: "plan",
        action: "update",
        diff: draft,
        reason: `方案引导草案：${draft.title}`,
        baseVersion: planVersion,
      });
      return c.json({ ok: true, draft, proposalId: result.entry?.id || null, applied: !!result.applied });
    } catch (err) {
      ctx.log.error("proposal draft failed:", err.message);
      return c.json({ error: "draft_failed", detail: err.message }, 500);
    }
  });

  // ── literature 追加式（在线/扫描入库共用） ────────────────
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

  // ── 报告 ──────────────────────────────────────────────────
  app.get("/reviews", (c) => c.json(store.read("reviews")));

  app.get("/report", (c) => c.json(store.read("report")));

  /** 显式触发文献分析报告（首屏不自动调 LLM，必须用户动作触发）
   *  E6：支持范围 scope（all / {type:'recent', n} / {type:'collection', key, label}）
   */
  app.post("/report/refresh", async (c) => {
    try {
      let scope = null;
      try {
        scope = (await c.req.json())?.scope || null;
      } catch {}
      let literature = store.read("literature");
      let scopeNote = `全库（${(literature.entries || []).length} 篇）`;
      if (scope?.type === "recent" && Number(scope.n) > 0) {
        const n = Math.min(Number(scope.n) || 20, 200);
        literature = { ...literature, entries: (literature.entries || []).slice(-n) };
        scopeNote = `最近 ${literature.entries.length} 篇`;
      } else if (scope?.type === "collection" && scope.key) {
        const key = scope.key;
        literature = {
          ...literature,
          entries: (literature.entries || []).filter((e) => (e.collectionKeys || []).includes(key)),
        };
        scopeNote = `collection「${scope.label || key}」${literature.entries.length} 篇`;
      }
      const plan = store.read("plan");
      const report = await analyzeLiterature(ctx, literature, plan);
      const content = `> 分析范围：${scopeNote}\n\n${report}`;
      const clusters = extractClusters(report);
      store.write("report", {
        version: 0,
        content,
        clusters,
        scope: scope?.type || "all",
        updatedAt: store.now(),
        planVersion: plan.version,
        literatureVersion: literature.version,
        // E5（复审）：手动刷新视为已消费当前文献版本，防止 _maybeAutoReport 按 `?? 0` 误判
        // newCount≥阈值而立即再跑一次全库报告覆盖本次 scope 报告
        basedOnLiteratureVersion: literature.version,
      });
      store.bump("report");
      return c.json({ ok: true, report: content, clusters });
    } catch (err) {
      ctx.log.error("report refresh failed:", err.message);
      return c.json({ error: "report_failed", detail: err.message }, 500);
    }
  });

  // ── 方案演进史 ─────────────────────────────────────────────
  app.get("/plan/evolution", (c) => {
    const doc = store.read("plan-evolution");
    return c.json({ entries: doc.entries || [], snapshots: store.listSnapshots("plan") });
  });

  app.get("/plan/evolution/:version", (c) => {
    const v = Number(c.req.param("version"));
    if (!Number.isInteger(v) || v <= 0) return c.json({ error: "invalid_version" }, 400);
    const file = path.join(ctx.dataDir, "snapshots", "plan", `${v}.json`);
    if (!fs.existsSync(file)) return c.json({ error: "no_snapshot" }, 404);
    return c.json({ version: v, content: JSON.parse(fs.readFileSync(file, "utf-8")) });
  });

  // ── P1-2：文献对照评估（从方案页「文献对照评估」按钮触发） ──
  app.post("/plan/assess", async (c) => {
    try {
      let force = false;
      try {
        force = Boolean((await c.req.json())?.force);
      } catch {}
      const plan = store.read("plan");
      const literature = store.read("literature");
      if ((literature.entries || []).length === 0) {
        return c.json({ error: "empty_literature", message: "文献库为空，无法对照评估" }, 400);
      }
      const prev = store.read("assessment");
      const fresh =
        force ||
        !prev.updatedAt ||
        prev.planVersion !== plan.version ||
        prev.literatureVersion !== literature.version;
      if (!fresh) {
        return c.json({
          ok: true,
          reused: true,
          content: prev.content,
          gaps: prev.gaps || [],
          updatedAt: prev.updatedAt,
          planVersion: prev.planVersion,
          literatureVersion: prev.literatureVersion,
        });
      }
      const raw = await assessPlanAgainstLiterature(ctx, { plan, literature });
      const { report, suggestions, gaps } = parsePlanAssessment(raw);
      store.write("assessment", {
        version: 0,
        content: report,
        gaps: gaps || [],
        updatedAt: store.now(),
        planVersion: plan.version,
        literatureVersion: literature.version,
      });
      store.bump("assessment");
      // SUGGESTIONS → 方案修改提案
      const proposalResults = [];
      for (const s of suggestions) {
        try {
          // 与工具路径行为对齐：里程碑合并守卫（LLM 建议只含部分里程碑时整段替换会丢其余）
          const diff = mergeMilestoneDiff(s.diff, plan.milestones);
          const result = createProposal(store, {
            target: "plan",
            action: "update",
            diff,
            reason: `文献对照评估建议：${s.reason || "依据评估结论"}`,
            baseVersion: plan.version,
          });
          proposalResults.push(result);
        } catch {}
      }
      return c.json({
        ok: true,
        reused: false,
        content: report,
        gaps: gaps || [],
        suggestions: suggestions.length,
        proposals: proposalResults.length,
        updatedAt: store.now(),
        planVersion: plan.version,
        literatureVersion: literature.version,
      });
    } catch (err) {
      ctx.log.error("plan assess failed:", err.message);
      return c.json({ error: "assess_failed", detail: err.message }, 500);
    }
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
      // 入库走追加式（自动扫描按 autoApproveLiterature 决定是否直入）
      const autoApprove = ctx.config.get?.("autoApproveLiterature") ?? true;
      let appended = 0;
      if (autoApprove) {
        const result = store.append("literature", enriched);
        appended = result.appended;
      } else {
        // 生成批量提案（面板逐个确认）
        for (const entry of enriched) {
          createProposal(store, {
            target: "literature",
            action: "create",
            diff: entry,
            reason: `扫描到新文献：${entry.title}`,
          });
        }
      }
      return c.json({
        ok: true,
        found: entries.length,
        appended,
        pendingProposals: autoApprove ? 0 : enriched.length,
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
      // FIX(2026-08-06)：all 模式必须过滤非字符串 id——无 id 条目的 id=undefined 会与 Zotero 镜像（无 id）共享同一值，
      // 导致 removable 含 undefined 后把所有无 id 条目（含全部镜像）连带删除（生产事故：清空待整理删光 155 条）
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
      // 双保险：无 id 条目永不参与删除（undefined/null id 一律保留）
      entries: (cur.entries || []).filter((e) => typeof e.id !== "string" || !removable.has(e.id)),
    }));
    if (!result.ok) {
      return c.json({ error: "conflict", hint: "文献库已变更，请刷新后重试" }, 409);
    }
    return c.json({ ok: true, removed: removable.size });
  });

  // ── E3：手动增强（✨ AI 摘要：生成/翻译摘要 + 提取关键词；fire-and-forget 启动新一轮循环铺完） ──
  app.post("/literature/enhance-pdfs", async (c) => {
    // 手动按钮 = 启动新一轮循环铺完（后台循环不阻塞响应；结束后 bump 版本供前端刷新）
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

  // ── C4：本周概况（组会周报快照） ──────────────────────────
  app.get("/summary/week", (c) => {
    const now = Date.now();
    const day = new Date(now).getDay() || 7; // 周日=7
    const weekStart = new Date(now - (day - 1) * 86400000);
    weekStart.setHours(0, 0, 0, 0);
    const startIso = weekStart.toISOString();
    const inWeek = (iso) => iso && String(iso) >= startIso;

    const worklog = store.read("worklog");
    const literature = store.read("literature");
    const gantt = store.read("gantt");
    const reviews = store.read("reviews");

    const workCount = (worklog.entries || []).filter((e) => inWeek(e.createdAt)).length;
    const litCount = (literature.entries || []).filter((e) => inWeek(e.addedAt)).length;
    const tasks = gantt.tasks || [];
    const progressed = tasks.filter((t) => t.progress && t.progress > 0);
    const avgProgress = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => s + (Number(t.progress) || 0), 0) / tasks.length)
      : 0;
    const lastReview = (reviews.entries || []).at(-1);

    return c.json({
      weekStart: startIso,
      workCount,
      litCount,
      taskCount: tasks.length,
      progressedCount: progressed.length,
      avgProgress,
      lastReview: lastReview
        ? { date: lastReview.date || null, summary: String(lastReview.report || "").slice(0, 120) }
        : null,
    });
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
  // 2026-08-07 迁入宿主配置（manifest.configuration + ctx.config），不再写 settings.json（读兼容保留）
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
    // 通知 lifecycle 刷新订阅（E4 复审：统一走 bus 事件通道——lifecycle 只订阅 bus 的
    // "materials-research-copilot:binding-changed"，appEvents 的 "binding-changed" 无订阅方，
    // 原来手动绑定后自动搜集静默按旧绑定运行。保留 appEvents 发射兼容宿主侧可能存在的监听）
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

  // ── 设置抽屉：拒绝记录 ────────────────────────────────────
  app.get("/rejected", (c) => c.json(store.read("rejected")));

  app.post("/rejected/clear", (c) => {
    store.write("rejected", { version: 0, entries: [], updatedAt: store.now() });
    store.bump("rejected");
    return c.json({ ok: true });
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
    if (name === "plan") {
      appendPlanEvolution(store, {
        version: result.data.version,
        by: "rollback",
        types: [],
        reason: toVersion !== undefined ? `回退到 v${toVersion}` : "回退到上一版本",
      });
    }
    return c.json({ ok: true, data: result.data });
  });
}
