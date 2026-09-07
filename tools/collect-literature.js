/**
 * collect_literature（v2 手动版）：收纳 Zotero 本地文献库
 *
 * v1 自动后台同步 → v2 手动触发（v2 无后台会话监听门）。
 * - 拉取 Zotero 条目 + collection 映射
 * - 按 zoteroKey 镜像替换入库（源为准，删掉的条目移除），非镜像条目保留
 * - 新收录自动日志化到 worklog
 * - 移除 PDF 增强 / AI 关键词 / OpenAlex 引用补全（v2 无 app 侧 LLM）
 */
import { createStore } from "../lib/store.js";
import {
  fetchZoteroItems,
  fetchZoteroCollections,
  appendLiteratureLog,
  zoteroProbe,
} from "../lib/zotero.js";

let _dataDir = null;
let _resources = null;
let _network = null;
let _config = null;
export function __setDataDir(dir) {
  _dataDir = dir;
}
export function __setResources(r) {
  _resources = r;
}
export function __setNetwork(n) {
  _network = n;
}
export function __setConfig(c) {
  _config = c;
}

export const name = "collect_literature";

export const description =
  "为科研工作收纳文献：扫描本地 Zotero 文献源（需 Zotero 桌面端运行且开启本地 API），按源镜像更新文献库（删除的条目移除），新收录自动日志化到实验记录。手动触发。";

export const parameters = {
  type: "object",
  properties: {
    source: {
      type: "string",
      enum: ["zotero"],
      description: "文献来源（当前仅支持 zotero 本地扫描）",
    },
  },
};

export async function execute(input = {}) {
  if (!_dataDir || !_resources) throw new Error("dataDir/resources 未注入");
  if (!_network || typeof _network.fetch !== "function") {
    throw new Error("network 未注入：本工具需要访问本地 Zotero API");
  }
  const source = input?.source || "zotero";
  if (source !== "zotero") throw new Error(`不支持的文献来源：${source}`);

  const store = createStore(_dataDir, _resources);
  const port = _config?.get?.("zoteroPort") ?? 23119;

  // 1. 探测 Zotero
  const probe = await zoteroProbe(_network, port);
  if (!probe.ok) {
    return {
      content: [
        {
          type: "text",
          text: `Zotero 收纳未执行：${probe.hint}\n请确认 Zotero 桌面端运行中，且已开启本地 API（Zotero 设置 → 高级 → 允许其他应用程序通过本地 API 通信，端口 ${port}）。`,
        },
      ],
    };
  }

  // 2. 拉取条目 + collections
  const entries = await fetchZoteroItems(_network, port);
  const collections = await fetchZoteroCollections(_network, port);

  // 3. 镜像替换 literature 库（按 zoteroKey；源为准）
  const doc = await store.read("literature");
  const existingMirrorKeys = new Set((doc.entries || []).filter((e) => e.zoteroKey).map((e) => e.zoteroKey));
  const newKeys = new Set(entries.filter((e) => e.zoteroKey).map((e) => e.zoteroKey));
  const freshEntries = entries.filter((e) => !existingMirrorKeys.has(e.zoteroKey));
  const removedCount = (doc.entries || []).filter((e) => e.zoteroKey && !newKeys.has(e.zoteroKey)).length;

  const scanId = `zotero_${Date.now().toString(36)}`;
  const result = await store.upsertByKey("literature", "zoteroKey", entries);
  await store.write("collections", {
    ...(await store.read("collections")),
    version: 0,
    collections,
    updatedAt: store.now(),
  });
  const log = await appendLiteratureLog(store, freshEntries, scanId);

  const lines = [];
  lines.push(`Zotero 收纳完成：镜像 ${result.replaced} 篇，新增 ${freshEntries.length} 篇${removedCount > 0 ? `，移除 ${removedCount} 篇` : ""}`);
  if (log.appended > 0) lines.push("新收录已日志化到实验记录");
  lines.push(`collection 分组：${collections.length} 个`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export default { name, description, parameters, execute };
