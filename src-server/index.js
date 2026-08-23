/**
 * 材料科研副驾 lifecycle（index.js）
 * - 会话事件：订阅绑定会话的用户消息；空闲时节流触发本地 Zotero 同步（autoCollectEnabled 控制），
 *   消息含「记录」时 AI 生成实验记录草稿并回发会话询问（aiWorklogGen 控制，回复确认词落库/拒绝词丢弃）
 * - 后台 Zotero 同步：30 分钟定时全量镜像，同步时自动日志化新收录到 worklog
 * - 隐私：autoCollectEnabled=false 时跳过会话监听逻辑，不触发不检索
 *
 * 实验记录中心化改造后：删除后台分析报告更新（_maybeAutoReport）、定期审查（_maybeAutoReview）、
 * 滞后再平衡（_maybeRebalance）；autoCollect 改为绑定会话后自动同步 Zotero 本地库（不再在线检索）。
 *
 * 宿主约定：本模块被宿主 new 实例化，ctx/register 通过属性注入，onload() 无参调用。
 */
import { createStore } from "./server/store.js";
import { syncZotero, runEnhancementLoop, enrichCitationCounts } from "./server/sources.js";
import { sendSessionMessage } from "@hana/plugin-runtime";
import { generateDraft, commitDraft } from "./server/worklog-gen.js";

const AUTO_COLLECT_THROTTLE_MS = 10 * 60 * 1000; // 10 分钟节流

/**
 * 关键词判定（AI 工作流确认/拒绝）：返回 'confirm' | 'reject' | 'other'。
 * 忽略大小写与首尾空白，整词相等或前缀匹配；拒绝词优先判定（“不用”/“不要”以「不」开头）。
 */
function matchVerdict(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return "other";
  const rejectWords = ["不", "不用", "不要", "算了", "取消", "no"];
  const confirmWords = ["记录", "好", "是", "确认", "ok"];
  if (rejectWords.some((w) => s === w || s.startsWith(w))) return "reject";
  if (confirmWords.some((w) => s === w || s.startsWith(w))) return "confirm";
  return "other";
}

/**
 * 构造 sendSessionMessage 的会话目标：{ sessionId, sessionPath }，sessionId 优先
 * （取自 event 携带的 sessionId，缺失时回退到绑定信息）；sessionPath 是 legacy locator，
 * 仅作兼容兜底一并带上（宿主要求对已有 session 的操作必须携带 sessionId/sessionRef）。
 */
function buildSessionTarget(event, sessionPath, fallbackSessionId = null) {
  const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
  const sessionId = trimmed(event?.sessionId) || trimmed(fallbackSessionId) || null;
  return sessionId
    ? { sessionId, sessionPath: sessionPath || null }
    : { sessionPath: sessionPath || null };
}

export default class MaterialsResearchCopilotPlugin {
  async onload() {
    const ctx = this.ctx;
    const register = this.register;
    this._store = createStore(ctx.dataDir);
    this._state = {
      binding: null,
      lastAutoCollectAt: 0,
    };
    this._pendingDraft = null; // AI 主导生成：待确认草稿（内存态，{ draft, sessionPath, ts }）

    // ── 会话事件（用户消息 → AI 记录状态机 / 节流同步 Zotero 本地库） ──
    // 注意：bus.subscribe 返回的句柄 / setInterval 返回的 Timeout 都含循环引用（_idlePrev/_idleNext），
    // 不能挂到插件实例 this 上（宿主在安装/启用时会序列化插件实例，遇到 Timeout 会抛
    // "Converting circular structure to JSON"）。全部收为局部变量，仅把 cleanup 函数交给 register()。
    const unsubSession = ctx.bus.subscribe(
      (event, sessionPath) => {
        // _onSessionEvent 为 async：显式接管 rejection（fire-and-forget，不让未处理拒绝逃逸）
        this._onSessionEvent(event, sessionPath).catch((err) => {
          ctx.log.warn("session event handling failed:", err.message);
        });
      },
      { types: ["session_user_message"] }
    );
    register(() => typeof unsubSession === "function" && unsubSession());

    // ── 内部事件：绑定变化 → 重新加载 ──
    const unsubBinding = ctx.bus.subscribe(
      () => this._reloadBinding(),
      { types: ["materials-research-copilot:binding-changed"] }
    );
    register(() => typeof unsubBinding === "function" && unsubBinding());

    // ── Zotero 全量镜像同步：30 分钟间隔，异步不阻塞消息流 ──
    const zoteroTimer = setInterval(() => this._syncZoteroNow(), 30 * 60 * 1000);
    zoteroTimer.unref?.();
    register(() => clearInterval(zoteroTimer));

    // ── 初始化 ──
    this._reloadBinding();
    this._syncZoteroNow(true).catch(() => {}); // 启动后立即同步一次（失败静默，定时器会重试）；同步后跑增强循环（摘要+关键词铺完）

    ctx.log.info("materials-research-copilot lifecycle loaded");
  }

  async _syncZoteroNow(firstRun = false) {
    // firstRun 参数保留兼容：首轮放宽已由增强循环取代（runEnhancementLoop 内部固定 8 条/3 篇 LLM 逐批铺完）
    const ctx = this.ctx;
    try {
      const result = await syncZotero(ctx, this._store);
      if (result.ok) {
        ctx.log.info(`zotero sync: ${result.replaced} entries mirrored`);
        // 增强循环：PDF 摘要/翻译/关键词逐批铺完（异步，不阻塞；直到无目标或本轮零产出）
        runEnhancementLoop(ctx, this._store)
          .then((r) => ctx.log.info(`literature enhance loop: ${r.rounds} round(s)`))
          .catch((err) => ctx.log.warn("literature enhance failed:", err.message));
        // E5：OpenAlex 引用数补全（异步节流 5 条/批）
        enrichCitationCounts(ctx, this._store, 5)
          .then((r) => ctx.log.info(`citation enrich: ${r.processed} queried`))
          .catch((err) => ctx.log.warn("citation enrich failed:", err.message));
      } else {
        ctx.log.info(`zotero sync skipped: ${result.code || result.error}`);
      }
    } catch (err) {
      ctx.log.warn("zotero sync failed:", err.message);
    }
  }

  async onunload() {
    this._state.binding = null;
    this._pendingDraft = null;
  }

  // ── 会话绑定 ──────────────────────────────────────────────

  _reloadBinding() {
    try {
      this._state.binding = this._store.read("binding");
    } catch {
      this._state.binding = null;
    }
  }

  _boundSessionPath() {
    return this._state.binding?.sessionPath || null;
  }

  // ── 会话事件：AI 记录状态机 + 节流同步 Zotero 本地库 ──────────

  async _onSessionEvent(event, sessionPath) {
    const ctx = this.ctx;
    const boundPath = this._boundSessionPath();
    if (!boundPath || !sessionPath || sessionPath !== boundPath) return;

    const text = String(event?.message?.text || "").trim();
    const genEnabled = ctx.config.get?.("aiWorklogGen") ?? true;

    // 1) 待确认态：先把消息解释为对草稿的确认/拒绝
    if (this._pendingDraft && genEnabled) {
      const verdict = matchVerdict(text);
      if (verdict === "confirm") {
        const pending = this._pendingDraft;
        // commitDraft 为同步函数：store 乐观锁冲突等情况返回 { ok:false, reason }
        const res = commitDraft(ctx, this._store, pending.draft, { sessionPath });
        this._pendingDraft = null;
        await sendSessionMessage(ctx, buildSessionTarget(event, sessionPath, this._state.binding?.sessionId), {
          role: "assistant",
          text: res.ok ? "已记录 ✅" : `记录失败：${res.reason}`,
        }).catch((err) => ctx.log.warn("ai worklog notify failed:", err.message));
      } else if (verdict === "reject") {
        this._pendingDraft = null;
        await sendSessionMessage(ctx, buildSessionTarget(event, sessionPath, this._state.binding?.sessionId), {
          role: "assistant",
          text: "好的，已取消记录。",
        }).catch((err) => ctx.log.warn("ai worklog notify failed:", err.message));
      }
      // 其它消息：维持待确认（首版忽略，不重总结）
      return;
    }

    // 2) 空闲态：原有 autoCollect 节流逻辑
    const autoCollect = ctx.config.get?.("autoCollectEnabled") ?? true;
    if (!autoCollect) return;
    const now = Date.now();
    if (now - this._state.lastAutoCollectAt < AUTO_COLLECT_THROTTLE_MS) return;
    this._state.lastAutoCollectAt = now;
    if (!text || text.length < 20) return;

    // 3) AI 主导生成：空闲 + 含「记录」关键词 → 异步生成草稿并回发询问（不阻塞消息流）
    if (genEnabled && text.includes("记录")) {
      this._maybeGenerateWorklog(text, sessionPath).catch((err) => {
        ctx.log.warn("ai worklog generate failed:", err.message);
      });
    }

    // 原有 Zotero 本地库同步
    this._syncZoteroNow().catch((err) => {
      ctx.log.warn("auto zotero sync failed:", err.message);
    });
  }

  /** 生成实验记录草稿并向会话询问确认（fire-and-forget 的可等待实现）。 */
  async _maybeGenerateWorklog(text, sessionPath) {
    const ctx = this.ctx;
    let taskList = [];
    try {
      // 甘特任务提示：让 LLM 能把 taskId 关联到已有甘特任务（store.read 自带默认兜底 { tasks: [] }）
      taskList = (this._store.read("gantt")?.tasks || []).map((t) => ({ id: t.id, name: t.name }));
    } catch {}

    // prompt 缺失/输入为空/LLM 失败或无法解析时返回 null；抛错则由调用方 .catch 记日志
    const draft = await generateDraft(ctx, { text, taskList });
    if (!draft) {
      await sendSessionMessage(ctx, buildSessionTarget(null, sessionPath, this._state.binding?.sessionId), {
        role: "assistant",
        text: "没能从这条消息识别出可记录的实验内容，稍后再试。",
      }).catch((err) => ctx.log.warn("ai worklog notify failed:", err.message));
      return;
    }

    // 设为待确认（单槽：同一时刻至多一个待确认草稿；发送失败仅记日志，草稿保留，用户下条回复仍可确认）
    this._pendingDraft = { draft, sessionPath, ts: Date.now() };
    const summary = [
      draft.sampleId ? `样品：${draft.sampleId}` : null,
      draft.system ? `体系：${draft.system}` : null,
      draft.durationHours ? `时长：${draft.durationHours}h` : null,
      `内容：${draft.content.slice(0, 120)}`, // parseDraft 保证 content 为非空字符串
    ].filter(Boolean).join("\n");
    await sendSessionMessage(ctx, buildSessionTarget(null, sessionPath, this._state.binding?.sessionId), {
      role: "assistant",
      text: `检测到实验记录草稿：\n${summary}\n\n回复「记录」确认，回复「不」取消。`,
    }).catch((err) => ctx.log.warn("ai worklog notify failed:", err.message));
  }
}
