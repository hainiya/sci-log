/**
 * 会话自动绑定（source: "auto"）
 * 工具执行时宿主注入 toolCtx.sessionId，若 binding.json 无绑定或绑定不一致，
 * 自动写入绑定并通知 lifecycle 刷新订阅。面板手动绑定（source: "manual"）优先级更高。
 */
import { createStore } from "./store.ts";

/**
 * @param {import("./types.ts").ToolCtx} ctx
 * @returns {any}
 */
export function ensureAutoBinding(ctx: import("./types.ts").ToolCtx): any {
  if (!ctx?.dataDir) return null;
  const store = createStore(ctx.dataDir);
  const binding = store.read("binding");
  const sessionId = typeof ctx.sessionId === "string" && ctx.sessionId.trim()
    ? ctx.sessionId.trim()
    : null;
  if (!sessionId) return null;
  // 已有手动绑定则尊重
  if (binding.sessionId && binding.source === "manual") return binding;
  if (binding.sessionId === sessionId) return binding;
  const next = {
    sessionId,
    sessionPath: typeof ctx.sessionPath === "string" ? ctx.sessionPath : null,
    boundAt: store.now(),
    source: "auto",
  };
  store.write("binding", next);
  try {
    ctx.bus?.emit?.({ type: "sci-log:binding-changed", sessionId }, null);
  } catch {}
  return next;
}
