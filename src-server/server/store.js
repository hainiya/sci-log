/**
 * 数据层：JSON 数据文件 + 乐观锁 + 追加式写入 + 版本快照 + 水位线
 *
 * 并发规则：
 * - 所有可编辑文件顶层含 version，任何写入都必须携带读取时的 version
 * - version 匹配 → 写入、version+1、生成快照、推进 updates.json 水位线
 * - version 不匹配 → 拒绝写入，返回最新数据
 * - literature.json 追加式写入（append），删除/修改走乐观锁
 * - 保留最近 MAX_SNAPSHOTS 个版本快照，可一键回退
 */
import fs from "node:fs";
import path from "node:path";

export const MAX_SNAPSHOTS = 20;
export const LITERATURE_COMPACT_THRESHOLD = 500;

const DEFAULT_DOC = {
  gantt: () => ({ version: 0, tasks: [], updatedAt: null }),
  calendar: () => ({ version: 0, events: [], updatedAt: null }),
  literature: () => ({ version: 0, entries: [], updatedAt: null, lastCompactedAt: null }),
  worklog: () => ({ version: 0, entries: [], updatedAt: null }),
  binding: () => ({ sessionId: null, sessionPath: null, boundAt: null, source: null }),
  updates: () => ({ literature: 0, worklog: 0, gantt: 0, calendar: 0 }),
  settings: () => ({ updatedAt: null }),
  // D1：Zotero collection 映射（只读镜像），走版本锁 + 快照
  collections: () => ({ version: 0, collections: [], updatedAt: null }),
};

export const UPDATES_KEYS = {
  gantt: "gantt",
  calendar: "calendar",
  worklog: "worklog",
  literature: "literature",
};

function filePathFor(dataDir, name) {
  return path.join(dataDir, `${name}.json`);
}

function snapshotDirFor(dataDir, name) {
  return path.join(dataDir, "snapshots", name);
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      // 损坏文件：备份后重建，保证面板可用
      try {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {}
    }
    return fallback();
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });

  function read(name) {
    const doc = readJson(filePathFor(dataDir, name), DEFAULT_DOC[name]);
    // 结构兜底：新字段缺失时补默认
    const defaults = DEFAULT_DOC[name]();
    const merged = { ...defaults, ...doc };
    // version 类型归一化（P1-2 复审）：文件里 version 被写成字符串（"5"）时，
    // update 的严格 !== 比较会永久 version_conflict 锁死所有写入；这里强制数值化 + 告警
    if (typeof merged.version !== "number") {
      if (merged.version != null) {
        // store 层无 log 注入通道，用 console 告警（进程可见）
        console.warn(`[store] ${name} version 类型异常（${typeof merged.version}），已归一化为数值`);
      }
      merged.version = Number(merged.version) || 0;
    }
    return merged;
  }

  function write(name, data) {
    atomicWrite(filePathFor(dataDir, name), `${JSON.stringify(data, null, 2)}\n`);
    return data;
  }

  function snapshot(name, version) {
    try {
      const doc = read(name);
      const dir = snapshotDirFor(dataDir, name);
      atomicWrite(path.join(dir, `${version}.json`), JSON.stringify(doc, null, 2));
      pruneSnapshots(name);
    } catch (err) {
      // 快照失败不阻塞主流程
    }
  }

  function pruneSnapshots(name) {
    const dir = snapshotDirFor(dataDir, name);
    if (!fs.existsSync(dir)) return;
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    if (files.length <= MAX_SNAPSHOTS) return;
    const sorted = files.sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
    for (const f of sorted.slice(0, files.length - MAX_SNAPSHOTS)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }

  /**
   * 乐观锁更新：version 匹配才允许写入
   * @returns {{ ok: true, data } | { ok: false, error: "version_conflict", data: 最新 }}
   */
  function update(name, expectedVersion, mutator) {
    const doc = read(name);
    if (expectedVersion !== undefined && doc.version !== expectedVersion) {
      return { ok: false, error: "version_conflict", data: doc };
    }
    const next = { ...doc, ...mutator(doc), version: doc.version + 1, updatedAt: nowIso() };
    write(name, next);
    snapshot(name, next.version);
    bump(name);
    return { ok: true, data: next };
  }

  /**
   * 追加式写入（literature 专用）：新条目 append 到 entries 尾部
   * 去重：对已有 entries 按 dedupeKeys 提取指纹，跳过重复项
   */
  function append(name, items, dedupeKeys = ["doi", "title"]) {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: true, data: read(name), appended: 0 };
    }
    const doc = read(name);
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
      // 任一键（DOI/标题）与已有条目匹配即视为重复
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
    write(name, next);
    snapshot(name, next.version);
    bump(name);
    if (next.entries.length >= LITERATURE_COMPACT_THRESHOLD) {
      compact(name);
    }
    return { ok: true, data: next, appended: fresh.length };
  }

  /** 压实：去重 + 重建索引 */
  function compact(name) {
    const doc = read(name);
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
      write(name, next);
      return;
    }
    const next = {
      ...doc,
      entries,
      version: doc.version + 1,
      updatedAt: nowIso(),
      lastCompactedAt: nowIso(),
    };
    write(name, next);
    snapshot(name, next.version);
  }

  /** 回退到指定快照版本（或上一版本） */
  function rollback(name, toVersion) {
    const dir = snapshotDirFor(dataDir, name);
    const target = toVersion !== undefined ? `${toVersion}.json` : null;
    let snapshotFile = null;
    if (target) {
      const p = path.join(dir, target);
      if (fs.existsSync(p)) snapshotFile = p;
    } else {
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      } catch {}
      if (files.length > 0) {
        const latest = files.sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]))[0];
        snapshotFile = path.join(dir, latest);
      }
    }
    if (!snapshotFile) return { ok: false, error: "no_snapshot" };
    const snap = JSON.parse(fs.readFileSync(snapshotFile, "utf-8"));
    const doc = read(name);
    const next = { ...snap, version: doc.version + 1, updatedAt: nowIso() };
    write(name, next);
    snapshot(name, next.version);
    bump(name);
    return { ok: true, data: next };
  }

  function listSnapshots(name) {
    const dir = snapshotDirFor(dataDir, name);
    if (!fs.existsSync(dir)) return [];
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => Number(f.split(".")[0]))
        .sort((a, b) => b - a);
    } catch {
      return [];
    }
  }

  /** 推进水位线 */
  function bump(name) {
    const updates = read("updates");
    const key = UPDATES_KEYS[name] || name;
    const next = { ...updates, [key]: (updates[key] || 0) + 1 };
    write("updates", next);
    return next;
  }

  function setUpdate(key, value) {
    const updates = read("updates");
    const next = { ...updates, [key]: value };
    write("updates", next);
    return next;
  }

  /**
   * 镜像替换（Zotero 同步专用）：按 keyField 全量同步
   * 库中所有 keyField 非空的条目被 items 整体替换（以源为准），
   * keyField 为空的条目（在线/工作区）不受影响；
   * extraKeep 列表（如 E4 zoteroGone 失效镜像）附加保留。
   * 总是 bump 版本一次（让巡检触发条件覆盖 Zotero 更新）。
   * @returns {{ ok: true, data, replaced: number }}
   */
  function upsertByKey(name, keyField, items, extraKeep = []) {
    const doc = read(name);
    const existing = doc.entries || [];
    const kept = [...existing.filter((e) => !e[keyField]), ...extraKeep];
    const replaced = items.filter((e) => e[keyField]).length;
    const next = {
      ...doc,
      entries: [...kept, ...items],
      version: doc.version + 1,
      updatedAt: nowIso(),
    };
    write(name, next);
    snapshot(name, next.version);
    bump(name);
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
    setUpdate,
    getUpdates: () => read("updates"),
    now: nowIso,
  };
}
