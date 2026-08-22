/**
 * 实验记录 AI 巡检（闭环核心）
 *
 * 触发点：UI/工具写入 worklog 后异步执行（fire-and-forget）
 * 职责：
 *  1. 找出自上次巡检以来的新增记录（meta.aiReviewedAt 水位线，失败不推进）
 *  2. 逐条调 LLM 巡检：参数结构化 + 文献关联 + 甘特进度推断 + 日程识别 + 方案对比
 *  3. 结果全部生成提案（worklog/gantt/calendar），由用户确认后生效
 *  4. 方案对比观察写入 reviews（只读留痕）
 */
import { triageWorkEntry } from "./llm.js";
import { createProposal } from "./proposals.js";

let running = false; // 进程内并发锁：同一时刻只跑一轮巡检

const BATCH_MAX = 3; // 每轮最多巡检条数（每条一次 LLM 调用）

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {object} ctx 宿主上下文
 * @param {object} store 数据存储
 * @param {object} options { force }  force=true 时重巡检最近 BATCH_MAX 条
 */
export async function triageWorklog(ctx, store, { force = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const worklog = store.read("worklog");
    const entries = worklog.entries || [];
    if (entries.length === 0) return { triaged: 0 };
    const meta = worklog.meta || {};
    const since = meta.aiReviewedAt || null;
    // 未巡检 = 新增（createdAt > 水位线）；force 时取最近几条
    const pending = force
      ? entries.slice(-BATCH_MAX)
      : entries
          .filter((e) => !since || String(e.createdAt || "") > since)
          .slice(-BATCH_MAX);
    if (pending.length === 0) return { triaged: 0 };

    const plan = store.read("plan");
    const gantt = store.read("gantt");
    const literature = store.read("literature");
    const today = localToday();

    let triaged = 0;
    let proposals = 0;
    const noteLines = [];
    let reviewedAt = since; // 逐条推进水位线：失败的条目不推进

    for (const entry of pending) {
      let out;
      try {
        out = await triageWorkEntry(ctx, { entries: [entry], plan, gantt, literature, today });
      } catch (err) {
        ctx?.log?.warn(`triageWorklog [${entry.id}] LLM 失败，保留待重试: ${err?.message || err}`);
        break; // 本条失败 → 后续条目不处理，水位线停在已成功处
      }
      if (!out) {
        ctx?.log?.warn(`triageWorklog [${entry.id}] 解析失败，保留待重试`);
        break;
      }
      triaged += 1;

      // 1. worklog 富化提案（fields/citations，仅当有内容）
      if (out.fields.length > 0 || out.citations.length > 0) {
        const reasonParts = [];
        if (out.fields.length) reasonParts.push(`提取参数 ${out.fields.length} 项`);
        if (out.citations.length) reasonParts.push(`关联文献 ${out.citations.length} 篇`);
        try {
          createProposal(store, {
            target: "worklog",
            action: "update",
            diff: { id: entry.id, fields: out.fields, citations: out.citations },
            reason: `AI 巡检（${entry.date || today}）：${reasonParts.join("、")}`,
            baseVersion: worklog.version,
            meta: { auto: true, kind: "triage", worklogEntryId: entry.id },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog worklog proposal failed: ${err?.message || err}`);
        }
      }

      // 2. 甘特进度提案（LLM 推断任务关联）
      for (const tp of out.taskProgress) {
        try {
          createProposal(store, {
            target: "gantt",
            action: "update",
            diff: { id: tp.taskId, progress: tp.progress },
            reason: `AI 巡检「${String(entry.content || "").slice(0, 40)}」→ 任务进度 ${tp.progress}%（${tp.reason}）`,
            baseVersion: store.read("gantt").version,
            meta: { auto: true, kind: "triage", worklogEntryId: entry.id },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog gantt proposal failed: ${err?.message || err}`);
        }
      }

      // 3. 日程提案（记录中明确的未来安排）
      for (const ev of out.events) {
        try {
          createProposal(store, {
            target: "calendar",
            action: "create",
            diff: { title: ev.title, date: ev.date, startTime: ev.startTime, type: ev.type },
            reason: `AI 巡检识别安排：${ev.title}（${ev.date}${ev.startTime ? " " + ev.startTime : ""}；${ev.reason || "来自实验记录"}）`,
            baseVersion: store.read("calendar").version,
            meta: { auto: true, kind: "triage", worklogEntryId: entry.id },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog calendar proposal failed: ${err?.message || err}`);
        }
      }

      // 4. 方案对比观察 → reviews 留痕（只读，不走提案）
      if (out.planNote) {
        noteLines.push(`[${entry.date || today}] ${out.planNote}`);
      }

      reviewedAt = entry.createdAt || store.now();
    }

    // 推进水位线（仅已成功巡检的条目不重跑）
    if (triaged > 0) {
      store.update("worklog", undefined, (cur) => ({
        ...cur,
        meta: { ...(cur.meta || {}), aiReviewedAt: reviewedAt, aiReviewedCount: (cur.meta?.aiReviewedCount || 0) + triaged },
      }));
    }

    // 方案对比观察落 reviews（只读审查记录）
    if (noteLines.length > 0) {
      try {
        store.update("reviews", undefined, (cur) => ({
          entries: [
            ...(cur.entries || []),
            {
              id: `rev_triage_${Date.now().toString(36)}`,
              date: store.now(),
              target: "worklog",
              report: noteLines.join("\n"),
              auto: true,
              createdAt: store.now(),
            },
          ],
        }));
      } catch (err) {
        ctx?.log?.warn(`triageWorklog reviews append failed: ${err?.message || err}`);
      }
    }

    return { triaged, proposals, skipped: false };
  } finally {
    running = false;
  }
}
