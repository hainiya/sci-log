/**
 * 提案-确认机制（全局核心）
 * AI 的任何写操作不直接改数据，先生成 Proposal 存入 proposals.json，
 * 用户确认后才落库。拒绝的提案归档 rejected.json（含理由），
 * 后续 AI 生成提案时注入最近 5 条同类拒绝记录。
 */
import crypto from "node:crypto";
import { appendPlanEvolution } from "./evolution.js";

const TARGETS = new Set(["plan", "gantt", "calendar", "worklog", "literature"]);

/** 各目标的可编辑容器字段（plan 为对象，其余为条目数组） */
function containerField(target) {
  if (target === "gantt") return "tasks";
  if (target === "calendar") return "events";
  return "entries"; // worklog / literature
}

/** V3：为 create 条目自动生成 id（前缀按目标区分，与工具层格式一致） */
function entryIdFor(target) {
  const prefix = target === "gantt" ? "task" : target === "calendar" ? "evt" : target === "literature" ? "lit" : "work";
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newId() {
  return `p_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * 生成提案
 * @param {object} store
 * @param {object} proposal { target, action, diff, reason, baseVersion, meta }
 * @param {object} options { autoApprove }  autoApprove=true 时直接落库跳过提案
 */
export function createProposal(store, proposal, options = {}) {
  const { target, action, diff: rawDiff, reason, baseVersion, meta } = proposal || {};
  if (!TARGETS.has(target)) throw new Error(`proposal target must be one of: ${[...TARGETS].join(", ")}`);
  if (!["create", "update", "delete"].includes(action)) {
    throw new Error('proposal action must be "create" | "update" | "delete"');
  }

  // V3 修复：create 条目无 id 时在提案层自动补，保证 diff 与落库一致（审计可见），
  // 覆盖 triage / redo / review SUGGESTIONS 等所有调用方（P1 系统性根除）
  let diff = rawDiff || {};
  if (action === "create" && target !== "plan" && !diff.id) {
    diff = { ...diff, id: entryIdFor(target) };
  }

  const doc = store.read(target);
  const entryId = newId();
  // V6 幂等键：create 类提案把 proposalId 注入 diff.meta（plan 除外——plan 顶层无 meta 字段）。
  // accept 的两步写（先落库后标记）崩溃窗口内重放时，applyProposal 按该键去重，杜绝重复入库。
  if (action === "create" && target !== "plan") {
    diff = { ...diff, meta: { ...(diff.meta || {}), proposalId: entryId } };
  }
  const entry = {
    id: entryId,
    target,
    action,
    diff,
    reason: reason || "",
    baseVersion: baseVersion ?? doc.version,
    meta: meta || {},
    status: "pending",
    createdAt: store.now(),
  };

  if (options.autoApprove) {
    const result = applyProposal(store, entry);
    return { entry, ...result };
  }

  const updateResult = store.update("proposals", undefined, (current) => ({
    entries: [...(current.entries || []), entry],
  }));
  if (!updateResult.ok) throw new Error("proposals update failed");
  return { entry, applied: false };
}

/** 应用提案到目标文件（乐观锁校验 baseVersion） */
export function applyProposal(store, proposal) {
  const { target, action, diff, baseVersion } = proposal;
  const container = containerField(target);

  // V6 幂等键：create 类提案（plan 除外）的 diff.meta 带 proposalId（createProposal 注入）。
  // 目标容器已有同键条目 → 视为已应用，重放不再重复入库（闭合 accept 两步写崩溃窗口）。
  if (action === "create" && target !== "plan" && diff?.meta?.proposalId) {
    const doc = store.read(target);
    const exists = (doc[container] || []).some((e) => e.meta?.proposalId === diff.meta.proposalId);
    if (exists) return { ok: true, data: doc, applied: false };
  }

  // V5 修复：Zotero 只读镜像条目不可经提案路径修改/删除（与 API 层 PUT 只读保护对齐；
  // 镜像条目无 id 字段，需同时按 zoteroKey 匹配）
  if (target === "literature" && action !== "create") {
    const doc = store.read(target);
    const entry = (doc.entries || []).find(
      (e) => (e.id && e.id === diff.id) || (e.zoteroKey && e.zoteroKey === diff.zoteroKey)
    );
    if (entry?.readOnly) {
      return { ok: false, error: "readonly_source", data: doc };
    }
  }

  const applyMutator = (doc) => {
    if (action === "create") {
      if (target === "plan") {
        return { ...doc, ...diff };
      }
      // V3 兜底：create 条目无 id 时自动补（防御直接调 applyProposal 的路径）
      const item = { ...diff };
      if (!item.id) item.id = entryIdFor(target);
      return { [container]: [...(doc[container] || []), item] };
    }
    if (action === "update") {
      const { id } = diff;
      if (target === "plan") {
        return { ...doc, ...diff };
      }
      // V4 修复：非 plan 的无 id update 拒绝（原逻辑会整体替换 doc 顶层字段）
      if (!id) throw new Error("target_entry_missing_id");
      const { id: _omit, ...patch } = diff;
      const list = doc[container] || [];
      if (!list.some((entry) => entry.id === id)) {
        throw new Error(`target_entry_not_found:${id}`);
      }
      return {
        [container]: list.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry
        ),
      };
    }
    if (action === "delete") {
      const { id } = diff;
      if (target === "plan") {
        return { ...doc, title: "", hypothesis: "", route: "", milestones: [] };
      }
      // V4 修复：非 plan 的无 id delete 拒绝（原逻辑会误删所有无 id 条目）
      if (!id) throw new Error("target_entry_missing_id");
      const list = doc[container] || [];
      if (!list.some((entry) => entry.id === id)) {
        throw new Error(`target_entry_not_found:${id}`);
      }
      return { [container]: list.filter((entry) => entry.id !== id) };
    }
    return doc;
  };

  if (target === "literature" && action === "create") {
    // literature 追加式写入
    const item = { ...diff };
    if (!item.id) item.id = entryIdFor(target);
    const result = store.append("literature", [item]);
    return { ok: result.ok, data: result.data, applied: result.appended === 1 };
  }

  let result;
  try {
    result = store.update(target, baseVersion, applyMutator);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("target_entry_not_found")) {
      // P2：update/delete 目标条目已不存在时明确报错，避免静默空操作
      return { ok: false, error: "entry_not_found", data: store.read(target) };
    }
    if (msg.includes("target_entry_missing_id")) {
      // V4：非 plan 的 update/delete 缺少 id 时明确报错
      return { ok: false, error: "entry_missing_id", data: store.read(target) };
    }
    throw err;
  }
  if (!result.ok) {
    return { ok: false, error: result.error, data: result.data };
  }
  if (target === "plan") {
    const ev = proposal.meta?.evolution;
    appendPlanEvolution(store, {
      version: result.data.version,
      by: "ai",
      types: Array.isArray(ev?.types)
        ? ev.types.filter((t) => ["material", "process", "scope", "direction", "other"].includes(t))
        : [],
      reason: ev?.reason || proposal.reason || "",
    });
  }
  return { ok: true, data: result.data, applied: true };
}

/**
 * P2 修复：baseVersion 过期时自动用最新版本重放，解决批量同 target 提案连环 409。
 * 安全边界：create 总是可重放；update/delete 仅当目标条目仍存在时可重放；
 * 目标条目已不存在时保持原冲突结果，交由调用方处理。
 */
function applyWithRetry(store, proposal) {
  let result = applyProposal(store, proposal);
  if (result.ok || result.error !== "version_conflict") return { result, proposal };
  const { target, action, diff } = proposal;
  const replayable =
    action === "create" ||
    target === "plan" ||
    (() => {
      const container = containerField(target);
      const doc = store.read(target);
      return (doc[container] || []).some((e) => e.id === diff.id);
    })();
  if (!replayable) return { result, proposal };
  const refreshed = { ...proposal, baseVersion: store.read(target).version };
  const retried = applyProposal(store, refreshed);
  return { result: retried, proposal: refreshed };
}

/** 接受提案 */
export function acceptProposal(store, proposalId) {
  const doc = store.read("proposals");
  const proposal = (doc.entries || []).find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, error: "not_found" };
  if (proposal.status !== "pending") return { ok: false, error: "not_pending" };

  const { result, proposal: applied } = applyWithRetry(store, proposal);
  if (!result.ok) {
    // baseVersion 过期且不可安全重放：提案保持 pending，返回最新数据供重新生成
    return { ok: false, error: result.error, data: result.data };
  }

  const nextDoc = store.update("proposals", doc.version, (current) => ({
    entries: (current.entries || []).map((p) =>
      p.id === proposalId
        ? { ...p, status: "accepted", baseVersion: applied.baseVersion, resolvedAt: store.now() }
        : p
    ),
  }));
  pruneHistory(store);
  return { ok: true, data: result.data, proposal: nextDoc.data.entries.find((p) => p.id === proposalId) };
}

/** 拒绝提案（含理由，归档到 rejected.json） */
export function rejectProposal(store, proposalId, reason = "") {
  const doc = store.read("proposals");
  const proposal = (doc.entries || []).find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, error: "not_found" };
  if (proposal.status !== "pending") return { ok: false, error: "not_pending" };

  // 归档幂等：已归档过的同 id 不再重复写入（reject 两步写崩溃窗口重放时避免重复归档）
  const rejectedDoc = store.read("rejected");
  const alreadyArchived = (rejectedDoc.entries || []).some((e) => e.id === proposalId);
  if (!alreadyArchived) {
    store.update("rejected", undefined, (current) => ({
      entries: [
        ...(current.entries || []),
        {
          id: proposal.id,
          target: proposal.target,
          action: proposal.action,
          summary: proposal.reason || JSON.stringify(proposal.diff || {}).slice(0, 300),
          reason: reason || "（未填写理由）",
          createdAt: store.now(),
        },
      ],
    }));
  }

  const nextDoc = store.update("proposals", doc.version, (current) => ({
    entries: (current.entries || []).map((p) =>
      p.id === proposalId
        ? { ...p, status: "rejected", rejectReason: reason || "", resolvedAt: store.now() }
        : p
    ),
  }));
  pruneHistory(store);
  return {
    ok: true,
    proposal: nextDoc.data.entries.find((p) => p.id === proposalId),
  };
}

/** 改后接受：diff 替换后落库 */
export function acceptModifiedProposal(store, proposalId, modifiedDiff) {
  const doc = store.read("proposals");
  const proposal = (doc.entries || []).find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, error: "not_found" };
  if (proposal.status !== "pending") return { ok: false, error: "not_pending" };

  // V6 补漏：create 类提案的幂等键在用户改后 diff 中可能被覆盖，重放仍会重复入库；
  // 仅 create 时把 proposal.diff 里的 proposalId 合并回改后 diff（update/delete 重放已有存在性保护）
  if (proposal.action === "create" && proposal.target !== "plan") {
    const originalProposalId = proposal.diff?.meta?.proposalId;
    if (originalProposalId) {
      modifiedDiff = {
        ...modifiedDiff,
        meta: { ...(modifiedDiff?.meta || {}), proposalId: originalProposalId },
      };
    }
  }

  const modified = { ...proposal, diff: modifiedDiff };
  const { result, proposal: applied } = applyWithRetry(store, modified);
  if (!result.ok) return { ok: false, error: result.error, data: result.data };

  store.update("proposals", doc.version, (current) => ({
    entries: (current.entries || []).map((p) =>
      p.id === proposalId
        ? { ...p, status: "accepted", diff: modifiedDiff, baseVersion: applied.baseVersion, resolvedAt: store.now(), modified: true }
        : p
    ),
  }));
  pruneHistory(store);
  return { ok: true, data: result.data };
}

/**
 * 已解决提案有界化（P1-4）：accepted/rejected 条目只追加不回收，长期运行无限膨胀。
 * 保留最近 MAX_RESOLVED 条已解决提案；拒绝归档保留最近 MAX_REJECTED 条，
 * 但修剪水位线是 2×（超一倍才修剪，避免边界抖动）。历史快照体系
 * snapshots/proposals 保留最近 20 个版本的轨迹，更早版本随快照轮转淘汰。
 */
const MAX_RESOLVED = 200;
const MAX_REJECTED = 100;
const REJECTED_TRIM_WATERMARK = MAX_REJECTED * 2;

export function pruneHistory(store) {
  const doc = store.read("proposals");
  const entries = doc.entries || [];
  const pending = entries.filter((p) => p.status === "pending");
  const resolved = entries.filter((p) => p.status !== "pending");
  if (resolved.length > MAX_RESOLVED) {
    const sorted = [...resolved].sort((a, b) =>
      String(b.resolvedAt || b.createdAt || "").localeCompare(String(a.resolvedAt || a.createdAt || ""))
    );
    store.update("proposals", doc.version, (cur) => ({
      entries: [...pending, ...sorted.slice(0, MAX_RESOLVED)],
    }));
  }
  const rdoc = store.read("rejected");
  if ((rdoc.entries || []).length > REJECTED_TRIM_WATERMARK) {
    const sorted = [...(rdoc.entries || [])].sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
    store.update("rejected", rdoc.version, (cur) => ({ entries: sorted.slice(0, MAX_REJECTED) }));
  }
}
