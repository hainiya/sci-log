/**
 * 面板路由壳（routes/ui.js，挂载 /page /widget）
 * - 静态资源走官方 assets 契约：/api/plugins/{pluginId}/assets/panel.css|js
 *   （宿主以 HttpOnly asset session cookie 保护，跨站 iframe 亦可加载，见 @hana/plugin-sdk README）
 * - 保留 hana-css / hana-theme query 参数（主题兼容协议）
 * - 保留极小的内联诊断脚本（仅调试用，非大资源）
 */
export default function registerPluginUiRoutes(app: any, ctx: import("../server/types.ts").ToolCtx) {
  app.get("/page", (c: any) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (c: any) => c.html(renderShell(c, ctx, "widget")));
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

  // 官方 assets 契约：资源由宿主 assets 路由提供（@hana/plugin-sdk hana.assets.url 同构路径）
  const assetsBase = `/api/plugins/${ctx.pluginId}/assets/`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <link rel="stylesheet" href="${escapeAttr(assetsBase)}panel.css">
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  <script>
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
  </script>
  <script type="module" src="${escapeAttr(assetsBase)}panel.js"></script>
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
