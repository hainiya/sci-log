/**
 * 面板路由壳（routes/ui.js，挂载 /page /widget）
 * - 静态资源：优先走官方 assets 契约（/api/plugins/{pluginId}/assets/ 或宿主传入的 hana-asset-base），
 *   宿主以 HttpOnly asset session cookie 保护，跨站 iframe 亦可加载（见 @hana/plugin-sdk README）。
 * - widget 兼容回退：widget iframe 在宿主侧的资源加载时序与 page 不同（实测 widget 外部 assets 偶发 403），
 *   故 widget surface 内联 CSS/JS（与 1.2.1 一致，已验证可用），page 保持外部引用。
 * - 保留 hana-css / hana-theme query 参数（主题兼容协议）
 * - 保留极小的内联诊断脚本（仅调试用，非大资源）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default function registerPluginUiRoutes(app: any, ctx: import("../server/types.ts").ToolCtx) {
  app.get("/page", (c: any) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (c: any) => c.html(renderShell(c, ctx, "widget")));
}

// 内联缓存：CSS/JS 内容不变，避免每次请求都读盘
const inlineCache = new Map();

/**
 * 读取插件 assets/ 下文件的文本内容（widget 内联用）。
 * @param {import("../server/types.ts").ToolCtx} ctx
 * @param {string} name
 * @returns {string|null}
 */
function inlineAsset(ctx: import("../server/types.ts").ToolCtx, name: string): string | null {
  if (inlineCache.has(name)) return inlineCache.get(name);
  const candidates = [];
  if (ctx?.pluginDir) candidates.push(path.join(ctx.pluginDir, "assets", name));
  candidates.push(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", name));
  for (const p of candidates) {
    try {
      const content = fs.readFileSync(p, "utf8");
      inlineCache.set(name, content);
      return content;
    } catch {
      // try next candidate
    }
  }
  inlineCache.set(name, null);
  return null;
}

/**
 * @param {any} c
 * @param {import("../server/types.ts").ToolCtx} ctx
 * @param {string} surface
 * @returns {string}
 */
function renderShell(c: any, ctx: import("../server/types.ts").ToolCtx, surface: string): string {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const title = "科研工作";

  const diagScript = `<script>
    // 面板加载诊断：任何脚本错误/资源失败都在页面上直接可见（桌面端 iframe 内 console 不可见）
    window.__mrcDiag = [];
    window.addEventListener('error', (e: any) => {
      window.__mrcDiag.push('err:' + (e.message || 'unknown'));
      const el = document.getElementById('mrc-diag');
      if (el) el.textContent = window.__mrcDiag.join(' | ');
    });
    window.addEventListener('unhandledrejection', (e: any) => {
      window.__mrcDiag.push('rej:' + String(e.reason));
      const el = document.getElementById('mrc-diag');
      if (el) el.textContent = window.__mrcDiag.join(' | ');
    });
    const diag = document.createElement('div');
    diag.id = 'mrc-diag';
    diag.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;font:11px/1.4 monospace;padding:4px 8px;white-space:pre-wrap;display:none';
    document.body.appendChild(diag);
    setTimeout(() => {
      const el = document.getElementById('mrc-diag');
      if (el && window.__mrcDiag.length) el.style.display = 'block';
    }, 3000);
  </script>`;

  const head = (cssTag: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  ${cssTag}
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  ${diagScript}`;

  if (surface === "widget") {
    // widget 兼容回退：内联 CSS/JS（与 1.2.1 一致，避免宿主 widget iframe 资源时序问题）
    const css = inlineAsset(ctx, "panel.css") || "";
    const js = inlineAsset(ctx, "panel.js") || "";
    const safeCss = css.replace(/<\/style>/gi, "<\\/style>");
    const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
    return `${head(`<style>${safeCss}</style>`)}
  <script type="module">${safeJs}</script>
</body>
</html>`;
  }

  // page：官方 assets 契约（宿主 assets 路由 + HttpOnly cookie；hana-asset-base 为宿主传入的备选 base）
  const assetsBase =
    (c.req.query("hana-asset-base") && String(c.req.query("hana-asset-base")).replace(/\/+$/, "")) ||
    `/api/plugins/${ctx.pluginId}/assets`;
  return `${head(`<link rel="stylesheet" href="${escapeAttr(assetsBase)}/panel.css">`)}
  <script type="module" src="${escapeAttr(assetsBase)}/panel.js"></script>
</body>
</html>`;
}

/** @param {unknown} value @returns {string} */
function escapeAttr(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** @param {unknown} value @returns {string} */
function escapeHtml(value: unknown): string {
  return escapeAttr(value).replace(/>/g, "&gt;");
}
