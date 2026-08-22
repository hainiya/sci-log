/**
 * 材料科研副驾 lifecycle（index.js）
 * - 会话绑定：订阅绑定会话的用户消息，节流触发本地 Zotero 同步（autoCollectEnabled 控制）
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

const AUTO_COLLECT_THROTTLE_MS = 10 * 60 * 1000; // 10 分钟节流

export default class MaterialsResearchCopilotPlugin {
  async onload() {
    const ctx = this.ctx;
    const register = this.register;
    this._store = createStore(ctx.dataDir);
    this._state = {
      binding: null,
      lastAutoCollectAt: 0,
    };

    // ── 会话事件（用户消息 → 自动同步 Zotero 本地库） ──
    // 注意：bus.subscribe 返回的句柄 / setInterval 返回的 Timeout 都含循环引用（_idlePrev/_idleNext），
    // 不能挂到插件实例 this 上（宿主在安装/启用时会序列化插件实例，遇到 Timeout 会抛
    // "Converting circular structure to JSON"）。全部收为局部变量，仅把 cleanup 函数交给 register()。
    const unsubSession = ctx.bus.subscribe(
      (event, sessionPath) => this._onSessionEvent(event, sessionPath),
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

  // ── 会话事件：用户消息 → 节流同步 Zotero 本地库 ──────────────

  async _onSessionEvent(event, sessionPath) {
    const ctx = this.ctx;
    const boundPath = this._boundSessionPath();
    if (!boundPath || !sessionPath || sessionPath !== boundPath) return;

    const autoCollect = ctx.config.get?.("autoCollectEnabled") ?? true;
    if (!autoCollect) return;

    const now = Date.now();
    if (now - this._state.lastAutoCollectAt < AUTO_COLLECT_THROTTLE_MS) return;
    this._state.lastAutoCollectAt = now;

    const text = String(event?.message?.text || "").trim();
    if (!text || text.length < 20) return;

    // 异步执行，不阻塞消息流：绑定会话在方向性讨论时自动同步 Zotero 本地库
    this._syncZoteroNow().catch((err) => {
      ctx.log.warn("auto zotero sync failed:", err.message);
    });
  }
}
