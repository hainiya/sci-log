/**
 * 方案演进史（plan-evolution.json）写入
 * 元数据索引：方案每次成功变更追加一条 {version, at, by, types, reason, experimentKeys}
 * 写入失败不阻塞主流程（与快照同策略，调用方 try/catch 不强制）
 */
export function appendPlanEvolution(store, { version, by, types = [], reason = "", experimentKeys = [] }) {
  try {
    const doc = store.read("plan-evolution");
    const entries = [
      ...(doc.entries || []),
      { version, at: store.now(), by, types, reason, experimentKeys },
    ];
    store.write("plan-evolution", { ...doc, entries });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
