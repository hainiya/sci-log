/**
 * 导出路由（routes/export.js，挂载前缀 /export）
 * 主方案：面板点导出 → 生成文件 → ctx.stageFile 投递 SessionFile → 会话中出现下载卡片
 *
 * spike③ 结论：路由 ctx 暴露 stageFile（plugin-context 提供），
 * 会话标识取 X-Hana-Plugin-Surface-Session 头，缺失时降级为 400 提示
 * （面板会提示"在对话中说『导出xx』即可"并复制指令到剪贴板）。
 */
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../server/store.js";
import { safeName, renderWorklogMarkdown } from "../server/export-util.js";

const EXPORT_DIR = "exports";

/**
 * @param {any} app
 * @param {import("../server/types.js").ToolCtx} ctx
 */
export default function registerExportRoutes(app, ctx) {
  const store = createStore(ctx.dataDir);
  // stageFile 由宿主 plugin-context 提供（spike③ 已验证），本地断言为非可选避免逐点可选链
  const stageFile = /** @type {(input: Record<string, any>) => any} */ (ctx.stageFile);

  // E1：待整理批量 RIS（非 Zotero 条目进入 Zotero 的唯一通道；9.x 无写 API）
  app.post("/export/ris-batch", async (/** @type {any} */ c) => {
    const literature = store.read("literature");
    const entries = (literature.entries || []).filter((e) => e.source !== "zotero");
    if (entries.length === 0) return c.json({ error: "no_to_organize", hint: "待整理分组为空：非 Zotero 条目均已归类" }, 404);
    const content = entries.map(renderRis).join("\n");
    const binding = store.read("binding");
    const sessionPath = binding?.sessionPath || null;
    const sessionId = binding?.sessionId || null;
    if (!sessionPath) {
      return c.json({ error: "no_session", hint: "尚未绑定会话。先在面板右上角『绑定当前会话』，再导出 RIS" }, 400);
    }
    try {
      const outputDir = path.join(ctx.dataDir, EXPORT_DIR);
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, `to-organize-${store.now().slice(0, 10)}.ris`);
      fs.writeFileSync(filePath, content, "utf-8");
      const staged = stageFile({ sessionId, sessionPath, filePath, label: path.basename(filePath) });
      return c.json({ ok: true, count: entries.length, file: { fileId: staged?.file?.fileId, label: path.basename(filePath) } });
    } catch (err) {
      ctx.log?.error("ris-batch stage failed:", /** @type {Error} */ (err).message);
      return c.json({ error: "stage_failed", detail: /** @type {Error} */ (err).message }, 500);
    }
  });

  /** @param {import("../server/types.js").LiteratureEntry} e @returns {string} */
  function renderRis(e) {
    const lines = [];
    lines.push("TY  - JOUR");
    for (const a of e.authors || []) lines.push(`AU  - ${a}`);
    lines.push(`PY  - ${e.year || ""}`);
    lines.push(`TI  - ${e.title || ""}`);
    if (e.venue) lines.push(`JO  - ${e.venue}`);
    if (e.doi) lines.push(`DO  - ${e.doi}`);
    if (e.url) lines.push(`UR  - ${e.url}`);
    if (e.abstract) lines.push(`AB  - ${e.abstract}`);
    for (const k of e.keywords || []) lines.push(`KW  - ${k}`);
    lines.push("ER  -");
    return lines.join("\n") + "\n";
  }

  app.get("/export/:type", async (/** @type {any} */ c) => {
    const type = c.req.param("type");
    const id = c.req.query("id") || null;
    // 投递目标：优先请求里的 surface session（未来宿主扩展），否则用绑定会话
    const binding = store.read("binding");
    const sessionPath =
      c.req.header("x-hana-plugin-surface-session")?.trim() &&
      c.req.query("sessionPath")?.trim()
        ? c.req.query("sessionPath").trim()
        : (binding?.sessionPath || null);
    const sessionId = binding?.sessionId || null;

    if (!sessionPath) {
      return c.json(
        { error: "no_session", hint: "尚未绑定会话。先在面板右上角『绑定当前会话』，或在对话中说『导出审查报告』获取文件" },
        400
      );
    }

    let content = "";
    let label = "";
    let ext = ".md";

    try {
      if (type === "worklog") {
        const worklog = store.read("worklog");
        content = renderWorklogMarkdown(worklog.entries || []);
        label = `实验记录-${store.now().slice(0, 10)}.md`;
      } else {
        return c.json({ error: "invalid_type", hint: "type 支持 worklog（review/report 已随研究方案/提案移除）" }, 400);
      }
    } catch (err) {
      ctx.log?.error("export build failed:", /** @type {Error} */ (err).message);
      return c.json({ error: "export_failed", detail: /** @type {Error} */ (err).message }, 500);
    }

    // 生成文件 → stageFile 投递 SessionFile
    try {
      const outputDir = path.join(ctx.dataDir, EXPORT_DIR);
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, safeName(label.replace(/\.[a-z]+$/i, "")) + ext);
      fs.writeFileSync(filePath, content, "utf-8");
      const staged = stageFile({
        sessionId,
        sessionPath,
        filePath,
        label: path.basename(filePath),
      });
      return c.json({
        ok: true,
        file: {
          fileId: staged?.file?.fileId || staged?.mediaItem?.fileId,
          label: path.basename(filePath),
        },
      });
    } catch (err) {
      ctx.log?.error("export stage failed:", /** @type {Error} */ (err).message);
      return c.json({ error: "stage_failed", detail: /** @type {Error} */ (err).message }, 500);
    }
  });
}
