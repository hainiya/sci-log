import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {any} app
 * @param {import("../server/types.js").ToolCtx} ctx
 */
export default function registerPluginUiRoutes(app, ctx) {
  app.get("/page", (/** @type {any} */ c) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (/** @type {any} */ c) => c.html(renderShell(c, ctx, "widget")));
}

// 内联缓存：CSS/JS 内容不变，避免每次请求都读盘
const inlineCache = new Map();

/**
 * @param {import("../server/types.js").ToolCtx} ctx
 * @param {string} name
 * @returns {string|null}
 */
function inlineAsset(ctx, name) {
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
 * @param {import("../server/types.js").ToolCtx} ctx
 * @param {string} surface
 * @returns {string}
 */
function renderShell(c, ctx, surface) {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const title = "科研工作";

  // 内联 CSS/JS：桌面端 iframe 跨站（file:// 父页 → http://127.0.0.1）时，
  // SameSite=Strict 的 asset session cookie 不会发送，外链 assets 必然 403。
  // 全部内联进 HTML 后不再依赖插件 assets 路由，任何环境都能加载。
  const css = inlineAsset(ctx, "panel.css") || "";
  const js = inlineAsset(ctx, "panel.js") || "";
  // 防止 bundle 内容中出现闭合标签字面量截断 HTML
  const safeCss = css.replace(/<\/style>/gi, "<\\/style>");
  const safeJs = js.replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <style>${safeCss}</style>
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  <script>
    // 面板加载诊断：任何脚本错误/资源失败都在页面上直接可见（桌面端 iframe 内 console 不可见）
    window.__mrcDiag = [];
    window.addEventListener('error', (e) => {
      window.__mrcDiag.push('err:' + (e.message || 'unknown'));
      const el = document.getElementById('mrc-diag');
      if (el) el.textContent = window.__mrcDiag.join(' | ');
    });
    window.addEventListener('unhandledrejection', (e) => {
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
  </script>
  <script type="module">${safeJs}</script>
</body>
</html>`;
}

/** @param {unknown} value @returns {string} */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** @param {unknown} value @returns {string} */
function escapeHtml(value) {
  return escapeAttr(value).replace(/>/g, "&gt;");
}
