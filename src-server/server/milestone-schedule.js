/**
 * #6 里程碑联动：研究方案确认后，把里程碑派生为甘特任务 + 日历里程碑事件
 *
 * 触发点：方案提案被接受（确认）后，异步（fire-and-forget）执行
 * 职责：
 *  1. 调 LLM 把里程碑拆成甘特任务（链式依赖）+ 日历节点（deriveScheduleFromPlan）
 *  2. 为每个里程碑生成甘特任务提案 + 日历事件提案，由用户确认后生效
 *  3. 去重：已存在基于同一里程碑文本的甘特任务/日历事件则跳过，避免重复提案
 */
import { deriveScheduleFromPlan as defaultDerive } from "./llm.js";
import { createProposal } from "./proposals.js";

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeMilestone(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 去重键：带编号的里程碑（M1/M2…或里程碑 一/1…）用编号做键（方案演进后文本变化仍算同一里程碑），无编号回退全文 */
function milestoneKey(text) {
  const n = normalizeMilestone(text);
  const m = n.match(/^(m\s*\d+(?:\.\d+)?)/) || n.match(/^(里程碑\s*[一二三四五六七八九十0-9]+(?:\.[0-9]+)?)/);
  return m ? m[0].replace(/\s+/g, "") : n;
}

/**
 * @param {object} ctx 宿主上下文（含 bus/pluginDir/log）
 * @param {object} store 数据存储
 * @param {object} plan 已确认方案（含 milestones）
 * @param {string} sourceProposalId 触发来源的方案提案 id（用于 meta 追溯）
 */
export async function generateMilestoneSchedule(ctx, store, plan, sourceProposalId, derive = defaultDerive) {
  const milestones = Array.isArray(plan?.milestones) ? plan.milestones : [];
  if (milestones.length === 0) return { items: 0, proposals: 0, skipped: true };

  const today = localToday();
  const { items } = await derive(ctx, { plan, today });
  if (!items || items.length === 0) return { items: 0, proposals: 0, skipped: true };

  // 去重：已存在基于同一里程碑编号的甘特任务 / 日历事件则演进同步（见下）
  const gantt = store.read("gantt");
  const calendar = store.read("calendar");

  let proposals = 0;
  let prevTaskId = null;
  const usedRefs = new Set();

  for (const it of items) {
    const ref = milestoneKey(it.milestone);
    if (!ref || usedRefs.has(ref)) continue; // 同一里程碑不重复处理
    usedRefs.add(ref);

    // 1. 甘特任务（链式依赖上一个任务）
    const existingTask = (gantt.tasks || []).find((t) => milestoneKey(t.meta?.milestoneRef || "") === ref);
    if (!existingTask) {
      const taskId = newId("task");
      try {
        createProposal(store, {
          target: "gantt",
          action: "create",
          diff: {
            id: taskId,
            name: it.taskName,
            start: it.start,
            end: it.end,
            dependsOn: prevTaskId ? [prevTaskId] : [],
            progress: 0,
            tags: ["里程碑派生"],
            meta: { milestoneRef: it.milestone },
          },
          reason: `方案里程碑派生甘特任务：${it.taskName}（来自「${it.milestone}」）`,
          baseVersion: store.read("gantt").version,
          meta: { auto: true, kind: "milestone", planProposalId: sourceProposalId, milestoneRef: it.milestone },
        });
        proposals += 1;
        prevTaskId = taskId;
      } catch (err) {
        ctx?.log?.warn(`milestone gantt proposal failed: ${err?.message || err}`);
      }
    } else {
      // 已有同编号里程碑任务：依赖链接到它；方案演进导致名称/时间变化时生成 update 同步（避免重复建第二套）
      prevTaskId = existingTask.id;
      if (existingTask.name !== it.taskName || existingTask.start !== it.start || existingTask.end !== it.end) {
        try {
          // meta 合并而非覆盖：保留任务已有元数据（redo sourceTaskId / proposalId 追溯等），只更新 milestoneRef
          const existingMeta = existingTask.meta || {};
          createProposal(store, {
            target: "gantt",
            action: "update",
            diff: {
              id: existingTask.id,
              name: it.taskName,
              start: it.start,
              end: it.end,
              meta: { ...existingMeta, milestoneRef: it.milestone },
            },
            reason: `方案里程碑演进同步：${it.taskName}（来自「${it.milestone}」）`,
            baseVersion: store.read("gantt").version,
            meta: { auto: true, kind: "milestone", planProposalId: sourceProposalId, milestoneRef: it.milestone },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`milestone gantt update failed: ${err?.message || err}`);
        }
      }
    }

    // 2. 日历里程碑事件
    const existingEvent = (calendar.events || []).find((e) => milestoneKey(e.meta?.milestoneRef || "") === ref);
    if (!existingEvent && it.eventDate) {
      try {
        createProposal(store, {
          target: "calendar",
          action: "create",
          diff: {
            title: it.eventTitle,
            date: it.eventDate,
            startTime: null,
            endTime: null,
            type: it.eventType,
            taskId: prevTaskId,
            meta: { milestoneRef: it.milestone },
          },
          reason: `方案里程碑派生日历节点：${it.eventTitle}（${it.eventDate}）`,
          baseVersion: store.read("calendar").version,
          meta: { auto: true, kind: "milestone", planProposalId: sourceProposalId, milestoneRef: it.milestone },
        });
        proposals += 1;
      } catch (err) {
        ctx?.log?.warn(`milestone calendar proposal failed: ${err?.message || err}`);
      }
    } else if (existingEvent && it.eventDate && (existingEvent.title !== it.eventTitle || existingEvent.date !== it.eventDate)) {
      // 里程碑演进：日历事件同步更新
      try {
        createProposal(store, {
          target: "calendar",
          action: "update",
          diff: { id: existingEvent.id, title: it.eventTitle, date: it.eventDate, type: it.eventType, taskId: prevTaskId },
          reason: `方案里程碑演进同步日历节点：${it.eventTitle}（${it.eventDate}）`,
          baseVersion: store.read("calendar").version,
          meta: { auto: true, kind: "milestone", planProposalId: sourceProposalId, milestoneRef: it.milestone },
        });
        proposals += 1;
      } catch (err) {
        ctx?.log?.warn(`milestone calendar update failed: ${err?.message || err}`);
      }
    }
  }

  if (proposals > 0) {
    ctx?.log?.info(`milestone schedule derived: ${proposals} proposal(s) from ${items.length} milestone(s)`);
  }
  return { items: items.length, proposals, skipped: false };
}
