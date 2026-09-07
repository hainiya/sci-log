/**
 * sci-log v2 App 入口
 *
 * v2 形态（manifestVersion 2）：独立子进程、install 目录只读、数据在 ctx.dataDir。
 * - apply(ctx) 是唯一入口，ctx 含 tools/resources/dataDir/config/network 等 15 个成员
 * - 工具经 ctx.tools.register 注册；v2 execute 为单参数（args），dataDir 经闭包注入
 * - 首次启动把 v1 老数据（plugin-data/sci-log）迁移到 app-data/sci-log
 *
 * v2 相对 v1 的能力裁剪（对应新版插件形态的架构边界）：
 * - 移除自动会话监听 / 自动 Zotero 后台同步 / 会话绑定（v2 无对应门）
 * - 移除 app 侧自动 LLM 巡检（v2 无 model.sample；AI 编排由 agent 侧完成）
 * - 工具注册不带 v1 的 sessionPermission 语义（v2 在 Security 面板统一授权）
 *
 * 注意：v2 app 子进程运行在 Node 权限模型下（无 --allow-fs-write），
 * 裸 fs 写入被禁止，文件读写必须走 ctx.resources（宿主托管 + 路径重定向）。
 * 因此数据层（lib/store.js 等）需基于 ctx.resources 而非 node:fs。
 */
import path from "node:path";
import * as manageSchedule from "./tools/manage-schedule.js";
import * as analyzeMetrics from "./tools/analyze-metrics.js";
import * as exportReport from "./tools/export-report.js";
import * as logWork from "./tools/log-work.js";
import * as collectLiterature from "./tools/collect-literature.js";
import { buildOverview } from "./lib/overview.js";

export const name = "sci-log";

async function probeResources(ctx) {
  try {
    const probeRef = { kind: "local-file", path: path.join(ctx.dataDir, ".probe") };
    await ctx.resources.write(probeRef, "x");
    await ctx.resources.delete(probeRef);
  } catch (e) {
    ctx.logger.warn(`resources probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function apply(ctx) {
  ctx.logger.info("sci-log v2 apply");
  ctx.logger.info(`apply dataDir=${ctx.dataDir}`);
  probeResources(ctx);

  // ── 注入 dataDir / resources / network / config 到工具模块 ──
  for (const tool of [
    manageSchedule,
    analyzeMetrics,
    exportReport,
    logWork,
    collectLiterature,
  ]) {
    if (typeof tool.__setDataDir === "function") tool.__setDataDir(ctx.dataDir);
    if (typeof tool.__setResources === "function") tool.__setResources(ctx.resources);
    if (typeof tool.__setNetwork === "function") tool.__setNetwork(ctx.network);
    if (typeof tool.__setConfig === "function") tool.__setConfig(ctx.config);
  }

  // ── 注册工具 ──
  const registrations = [
    { mod: manageSchedule },
    { mod: analyzeMetrics },
    { mod: exportReport },
    { mod: logWork },
    { mod: collectLiterature },
  ];
  for (const { mod } of registrations) {
    if (typeof mod.execute !== "function") continue;
    ctx.tools.register({
      name: mod.name,
      description: mod.description,
      parameters: mod.parameters,
      execute: mod.execute,
    });
    ctx.logger.info(`registered tool: ${mod.name}`);
  }

  // ── 工作台数据路由：/api/apps/sci-log/routes/state ──
  if (typeof ctx.routes?.register === "function") {
    try {
      ctx.routes.register((app) => {
        app.get("/state", async (c) => {
          try {
            const overview = await buildOverview(ctx.dataDir, ctx.resources);
            return c.json({ ok: true, ...overview });
          } catch (err) {
            return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
          }
        });
      });
      ctx.logger.info("route registered: /state");
    } catch (err) {
      ctx.logger.warn(`route register failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.logger.info("sci-log v2 ready");
}

export default { name, apply };
