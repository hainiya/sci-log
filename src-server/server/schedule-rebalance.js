/**
 * #P0 日程闭环：滞后再平衡 + 失败重做提案
 *
 * 两个纯函数（无 LLM 调用，低开销），供 log-work.js（工具路径）、
 * triage.js（面板后台路径）、index.js（周期定时器）复用：
 *   - rebalanceSchedule：任务滞后时沿 dependsOn 拓扑顺延下游 + 插缓冲 + 同步关联日历
 *   - proposeRedoTask：实验记录识别失败时，复制原任务排「重做」甘特任务 + 日历事件
 *
 * 所有写操作经 createProposal 走提案确认，不直落库。
 */
import { createProposal } from "./proposals.js";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const BUFFER_DAYS = 2; // 顺延/重做时插入的缓冲天数

export function parseDate(s) {
  if (!DATE_RE.test(String(s || ""))) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}
export function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}
export function addDays(dt, n) {
  const base = dt instanceof Date ? dt : parseDate(dt);
  if (!base) return null;
  const r = new Date(base.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
export function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/**
 * 滞后再平衡：
 *  1. 计算每张任务的滞后天数（progress<100 且 end < today → 至少 1 天，叠加缓冲）
 *  2. 沿 dependsOn 拓扑顺序，使下游任务的 start 不早于上游新 end + 1 天
 *  3. 对实际发生位移的任务，生成甘特 update 提案；关联日历事件同步顺延
 *  4. 去重：已存在相同待确认提案则跳过
 * @returns {{ proposals: number, skipped: boolean }}
 */
export function rebalanceSchedule(ctx, store) {
  const gantt = store.read("gantt");
  const tasks = gantt.tasks || [];
  if (tasks.length === 0) return { proposals: 0, skipped: true };

  const today = parseDate(new Date().toISOString().slice(0, 10));
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // 计算依赖深度（拓扑排序依据），存在环时退化为 0
  const depth = new Map();
  const getDepth = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    const deps = (t?.dependsOn || []).filter((d) => byId.has(d));
    const d = deps.length ? Math.max(...deps.map((dep) => getDepth(dep, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  tasks.forEach((t) => getDepth(t.id));
  const ordered = [...tasks].sort((a, b) => depth.get(a.id) - depth.get(b.id));

  // 计算每张任务的新起止日期
  const newStart = new Map();
  const newEnd = new Map();
  for (const t of ordered) {
    const s = parseDate(t.start);
    const e = parseDate(t.end);
    if (!s || !e) {
      newStart.set(t.id, t.start);
      newEnd.set(t.id, t.end);
      continue;
    }
    const prog = Number(t.progress) || 0;
    let shiftSelf = 0;
    if (prog < 100 && e < today) {
      shiftSelf = Math.max(1, diffDays(today, e) + BUFFER_DAYS);
    }
    // 依赖约束：start 不早于上游新 end + 1 天
    let earliestStart = s;
    for (const dep of t.dependsOn || []) {
      const de = newEnd.get(dep);
      if (!de) continue;
      const need = addDays(de, 1);
      if (need > earliestStart) earliestStart = need;
    }
    let finalStart = earliestStart;
    if (shiftSelf > 0) {
      const shifted = addDays(s, shiftSelf);
      if (shifted > finalStart) finalStart = shifted;
    }
    const dur = Math.max(1, diffDays(e, s));
    newStart.set(t.id, fmtDate(finalStart));
    newEnd.set(t.id, fmtDate(addDays(finalStart, dur)));
  }

  const pending = store.read("proposals").entries || [];
  const calendarEvents = store.read("calendar").events || [];
  const hasPendingGantt = (id, key, val) =>
    pending.some(
      (p) => p.status === "pending" && p.target === "gantt" && p.action === "update" && p.diff?.id === id && String(p.diff?.[key]) === String(val)
    );
  const hasPendingCal = (id, val) =>
    pending.some(
      (p) => p.status === "pending" && p.target === "calendar" && p.action === "update" && p.diff?.id === id && String(p.diff?.date) === String(val)
    );

  let proposals = 0;
  for (const t of tasks) {
    const ns = newStart.get(t.id);
    const ne = newEnd.get(t.id);
    if (ns === t.start && ne === t.end) continue; // 无位移
    if (hasPendingGantt(t.id, "start", ns) && hasPendingGantt(t.id, "end", ne)) continue;
    try {
      createProposal(store, {
        target: "gantt",
        action: "update",
        diff: { id: t.id, start: ns, end: ne },
        reason: `AI 滞后再平衡：上游任务延期，顺延「${t.name || t.id}」起止日期（含 ${BUFFER_DAYS} 天缓冲）`,
        baseVersion: gantt.version,
        meta: { auto: true, kind: "rebalance" },
      });
      proposals += 1;

      // 同步关联日历事件
      const shift = diffDays(parseDate(ns), parseDate(t.start || ns) || parseDate(ns));
      for (const ev of calendarEvents) {
        if (ev.taskId !== t.id) continue;
        const ed = parseDate(ev.date);
        if (!ed) continue;
        const ndate = fmtDate(addDays(ed, shift));
        if (ndate === ev.date) continue;
        if (hasPendingCal(ev.id, ndate)) continue;
        try {
          createProposal(store, {
            target: "calendar",
            action: "update",
            diff: { id: ev.id, date: ndate },
            reason: `AI 滞后再平衡：关联任务「${t.name || t.id}」顺延，日历事件同步至 ${ndate}`,
            baseVersion: store.read("calendar").version,
            meta: { auto: true, kind: "rebalance" },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`rebalance calendar proposal failed: ${err?.message || err}`);
        }
      }
    } catch (err) {
      ctx?.log?.warn(`rebalance gantt proposal failed: ${err?.message || err}`);
    }
  }
  return { proposals };
}

/**
 * 失败重做提案：复制原任务生成「重做」甘特任务（progress 0、dependsOn 原任务、带缓冲）
 * 并排一个日历事件。同一原任务已有待确认重做提案时跳过。
 * @returns {number} 生成的提案数
 */
export function proposeRedoTask(ctx, store, { taskId, reason, worklogEntryId, today }) {
  const gantt = store.read("gantt");
  const task = (gantt.tasks || []).find((t) => t.id === taskId);
  if (!task) return 0;

  const td = parseDate(today) || parseDate(new Date().toISOString().slice(0, 10));
  const s = parseDate(task.start);
  const e = parseDate(task.end);
  const dur = s && e ? Math.max(1, diffDays(e, s)) : 7;
  const startNew = fmtDate(addDays(td, BUFFER_DAYS));
  const endNew = fmtDate(addDays(startNew, dur));

  const pending = store.read("proposals").entries || [];
  if (
    pending.some(
      (p) => p.status === "pending" && p.target === "gantt" && p.action === "create" && p.meta?.kind === "redo" && p.meta?.sourceTaskId === taskId
    )
  ) {
    return 0;
  }

  let count = 0;
  try {
    const newTaskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    createProposal(store, {
      target: "gantt",
      action: "create",
      diff: {
        id: newTaskId,
        name: `${task.name || "任务"}（重做）`,
        start: startNew,
        end: endNew,
        dependsOn: [taskId],
        progress: 0,
        tags: ["重做", "AI巡检"],
        meta: { milestoneRef: task.meta?.milestoneRef || null },
      },
      reason: `AI 巡检识别实验未达预期 → 重做任务「${task.name || taskId}」：${reason || "来自实验记录"}`,
      baseVersion: gantt.version,
      meta: { auto: true, kind: "redo", sourceTaskId: taskId, worklogEntryId },
    });
    count += 1;

    createProposal(store, {
      target: "calendar",
      action: "create",
      diff: {
        title: `重做：${task.name || "任务"}`,
        date: startNew,
        startTime: null,
        endTime: null,
        type: "experiment",
        taskId: newTaskId,
      },
      reason: `重做任务「${task.name || taskId}」起始日（含 ${BUFFER_DAYS} 天缓冲）`,
      baseVersion: store.read("calendar").version,
      meta: { auto: true, kind: "redo", sourceTaskId: taskId, worklogEntryId },
    });
    count += 1;
  } catch (err) {
    ctx?.log?.warn(`proposeRedoTask failed: ${err?.message || err}`);
  }
  return count;
}
