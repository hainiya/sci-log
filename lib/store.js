/**
 * 数据层（v2 resources-backed）：JSON 数据文件 + 乐观锁 + 追加式写入 + 版本快照 + 水位线
 *
 * v2 架构差异：app 子进程无 --allow-fs-write，裸 node:fs 写入被 Node 权限模型禁止。
 * 所有文件读写必须走 ctx.resources（宿主托管，自动把 ~ 占位路径重定向到真实 home）。
 * 因此本层全部方法为 async，ref 用 { kind: "local-file", path }。
 *
 * 功能与 v1 store.ts 对齐：乐观锁 / 快照 / 水位线 / 去重 append / upsertByKey / rollback。
 */
import path from "node:path";

export const MAX_SNAPSHOTS = 20;
export const LITERATURE_COMPACT_THRESHOLD = 500;

const DEFAULT_DOC = {
  gantt: () => ({ version: 0, tasks: [], updatedAt: null }),
  calendar: () => ({ version: 0, events: [], updatedAt: null }),
  literature: () => ({ version: 0, entries: [], updatedAt: null, lastCompactedAt: null }),
  worklog: () => ({ version: 0, entries: [], updatedAt: null }),
  updates: () => ({ literature: 0, worklog: 0, gantt: 0, calendar: 0 }),
  settings: () => ({ updatedAt: null }),
  collections: () => ({ version: 0, collections: [], updatedAt: null }),
};

export const UPDATES_KEYS = {
  gantt: "gantt",
  calendar: "calendar",
  worklog: "worklog",
  literature: "literature",
};

function refFor(dataDir, name) {
  return { kind: "local-file", path: path.join(dataDir, `${name}.json`) };
}

function snapshotRefFor(dataDir, name, version) {
  return { kind: "local-file", path: path.join(dataDir, "snapshots", name, `${version}.json`) };
}

function nowIso() {
  return new Date().toISOString();
}

/** resources.read 返回 { content: Buffer | {type,data} }，统一转字符串 */
function contentToStr(content) {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (Buffer.isBuffer(content)) return content.toString("utf-8");
  if (content.type === "Buffer" && Array.isArray(content.data)) {
    return Buffer.from(content.data).toString("utf-8");
  }
  return String(content);
}

/**
 * 创建 resources-backed store。
 * @param {string} dataDir
 * @param {{ read: Function, write: Function, mkdir: Function, list: Function, delete: Function }} resources
 */
export function createStore(dataDir, resources) {
  if (!resources || typeof resources.read !== "function") {
    throw new Error("createStore(dataDir, resources): resources 必须提供 read/write/mkdir/list/delete");
  }

  async function ensureDir() {
    try {
      await resources.mkdir({ kind: "local-file", path: dataDir });
    } catch {}
  }

  /** 读取 JSON（含结构兜底与 version 归一化） */
  async function read(name) {
    try {
      const res = await resources.read(refFor(dataDir, name));
      const text = contentToStr(res?.content);
      if (text == null) return { ...DEFAULT_DOC[name](), version: 0 };
      const doc = JSON.parse(text);
      const defaults = DEFAULT_DOC[name]();
      const merged = { ...defaults, ...doc };
      if (typeof merged.version !== "number") {
        merged.version = Number(merged.version) || 0;
      }
      return merged;
    } catch (err) {
      // 文件不存在或损坏：回退默认
      return { ...DEFAULT_DOC[name](), version: 0 };
    }
  }

  async function write(name, data) {
    await ensureDir();
    await resources.write(refFor(dataDir, name), `${JSON.stringify(data, null, 2)}\n`);
    return data;
  }

  async function snapshot(name, version) {
    try {
      const doc = await read(name);
      await resources.mkdir({
        kind: "local-file",
        path: path.join(dataDir, "snapshots", name),
      });
      await resources.write(
        snapshotRefFor(dataDir, name, version),
        JSON.stringify(doc, null, 2)
      );
      await pruneSnapshots(name);
    } catch (err) {
      // 快照失败不阻塞主流程
    }
  }

  async function listSnapshotFiles(name) {
    try {
      const res = await resources.list({
        kind: "local-file",
        path: path.join(dataDir, "snapshots", name),
      });
      const items = res?.entries || res?.items || [];
      return items
        .map((it) => (typeof it === "string" ? it : it.name || it.path))
        .filter((f) => typeof f === "string" && f.endsWith(".json"));
    } catch {
      return [];
    }
  }

  async function pruneSnapshots(name) {
    let files;
    try {
      files = await listSnapshotFiles(name);
    } catch {
      return;
    }
    if (files.length <= MAX_SNAPSHOTS) return;
    const sorted = files.sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
    for (const f of sorted.slice(0, files.length - MAX_SNAPSHOTS)) {
      try {
        await resources.delete({
          kind: "local-file",
          path: path.join(dataDir, "snapshots", name, f),
        });
      } catch {}
    }
  }

  /** 乐观锁更新：version 匹配才允许写入 */
  async function update(name, expectedVersion, mutator) {
    const doc = await read(name);
    if (expectedVersion !== undefined && doc.version !== expectedVersion) {
      return { ok: false, error: "version_conflict", data: doc };
    }
    const next = { ...doc, ...mutator(doc), version: doc.version + 1, updatedAt: nowIso() };
    await write(name, next);
    await snapshot(name, next.version);
    await bump(name);
    return { ok: true, data: next };
  }

  /** 追加式写入（literature 专用），按 dedupeKeys 去重 */
  async function append(name, items, dedupeKeys = ["doi", "title"]) {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: true, data: await read(name), appended: 0 };
    }
    const doc = await read(name);
    const fingerprintsOf = (entry) => {
      const parts = [];
      for (const key of dedupeKeys) {
        const value = entry[key];
        if (typeof value === "string" && value.trim()) {
          parts.push(`${key}=${value.trim().toLowerCase()}`);
        }
      }
      return parts;
    };
    const existingKeys = new Set();
    for (const entry of doc.entries || []) {
      for (const fp of fingerprintsOf(entry)) existingKeys.add(fp);
    }
    const fresh = [];
    for (const item of items) {
      const fps = fingerprintsOf(item);
      if (fps.length > 0 && fps.some((fp) => existingKeys.has(fp))) continue;
      for (const fp of fps) existingKeys.add(fp);
      fresh.push(item);
    }
    if (fresh.length === 0) {
      return { ok: true, data: doc, appended: 0 };
    }
    const next = {
      ...doc,
      entries: [...(doc.entries || []), ...fresh],
      version: doc.version + 1,
      updatedAt: nowIso(),
    };
    await write(name, next);
    await snapshot(name, next.version);
    await bump(name);
    if (next.entries.length >= LITERATURE_COMPACT_THRESHOLD) {
      await compact(name);
    }
    return { ok: true, data: next, appended: fresh.length };
  }

  async function compact(name) {
    const doc = await read(name);
    const seen = new Map();
    const entries = [];
    for (const entry of doc.entries || []) {
      const key = entry.doi || entry.url || entry.title?.toLowerCase() || entry.id;
      if (!key || seen.has(key)) continue;
      seen.set(key, true);
      entries.push(entry);
    }
    if (entries.length === doc.entries.length) {
      const next = { ...doc, lastCompactedAt: nowIso() };
      await write(name, next);
      return;
    }
    const next = {
      ...doc,
      entries,
      version: doc.version + 1,
      updatedAt: nowIso(),
      lastCompactedAt: nowIso(),
    };
    await write(name, next);
    await snapshot(name, next.version);
  }

  /** 回退到指定快照版本（或上一版本） */
  async function rollback(name, toVersion) {
    let files;
    try {
      files = await listSnapshotFiles(name);
    } catch {
      files = [];
    }
    if (files.length === 0) return { ok: false, error: "no_snapshot" };
    let targetFile;
    if (toVersion !== undefined) {
      targetFile = files.find((f) => f === `${toVersion}.json`);
    } else {
      targetFile = files.sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]))[0];
    }
    if (!targetFile) return { ok: false, error: "no_snapshot" };
    const res = await resources.read({
      kind: "local-file",
      path: path.join(dataDir, "snapshots", name, targetFile),
    });
    const snap = JSON.parse(contentToStr(res?.content));
    const doc = await read(name);
    const next = { ...snap, version: doc.version + 1, updatedAt: nowIso() };
    await write(name, next);
    await snapshot(name, next.version);
    await bump(name);
    return { ok: true, data: next };
  }

  async function listSnapshots(name) {
    const files = await listSnapshotFiles(name);
    return files
      .map((f) => Number(f.split(".")[0]))
      .sort((a, b) => b - a);
  }

  async function bump(name) {
    const updates = await read("updates");
    const key = UPDATES_KEYS[name] || name;
    const next = { ...updates, [key]: (updates[key] || 0) + 1 };
    await write("updates", next);
    return next;
  }

  /** 镜像替换（Zotero 同步专用）：按 keyField 全量同步 */
  async function upsertByKey(name, keyField, items, extraKeep = []) {
    const doc = await read(name);
    const existing = doc.entries || [];
    const kept = [...existing.filter((e) => !e[keyField]), ...extraKeep];
    const replaced = items.filter((e) => e[keyField]).length;
    const next = {
      ...doc,
      entries: [...kept, ...items],
      version: doc.version + 1,
      updatedAt: nowIso(),
    };
    await write(name, next);
    await snapshot(name, next.version);
    await bump(name);
    return { ok: true, data: next, replaced };
  }

  return {
    read,
    write,
    update,
    append,
    compact,
    upsertByKey,
    rollback,
    listSnapshots,
    bump,
    getUpdates: () => read("updates"),
    now: nowIso,
  };
}
