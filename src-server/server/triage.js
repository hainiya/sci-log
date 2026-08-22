/**
 * 实验记录 AI 巡检（闭环核心）
 *
 * 触发点：UI/工具写入 worklog 后异步执行（fire-and-forget）
 * 职责：
 *  1. 找出自上次巡检以来的新增记录（meta.aiReviewedAt 水位线，失败不推进）
 *  2. 逐条调 LLM 巡检：参数结构化 + 文献关联 + 甘特进度推断 + 日程识别
 *  3. 结果直接写库（去提案）：worklog 富化、时长、甘特进度、日程，AI 写即生效
 *
 * 实验记录中心化改造后：不再生成提案，不再写 reviews 留痕，不做方案对比/重做/再平衡。
 */
import { triageWorkEntry } from "./llm.js";

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
    // 同毫秒补捞（P1-4 复审）：水位线是 createdAt 字符串严格大于，同一毫秒写入的多条记录
    // 中除最后一条外会被永久跳过巡检；用 aiReviewedIds 记录水位线时刻已处理的 id，
    // createdAt === since 但未在集合内的记录仍纳入本轮（每轮 ≤ BATCH_MAX 条，无增长压力）
    const reviewedIds = new Set(meta.aiReviewedIds || []);
    // 未巡检 = 新增（createdAt > 水位线，或同毫秒未被处理）；force 时取最近几条
    const pending = force
      ? entries.slice(-BATCH_MAX)
      : entries
          .filter((e) => {
            if (!since) return true;
            const t = String(e.createdAt || "");
            if (t > since) return true;
            if (t === since && !reviewedIds.has(e.id)) return true;
            return false;
          })
          .slice(-BATCH_MAX);
    if (pending.length === 0) return { triaged: 0 };

    const gantt = store.read("gantt");
    const literature = store.read("literature");
    const today = localToday();

    let triaged = 0;
    let updated = 0;
    let reviewedAt = since; // 逐条推进水位线：失败的条目不推进
    const successIds = []; // 本轮成功巡检的条目 id（写回 aiReviewedIds 供同毫秒补捞判重）

    for (const entry of pending) {
      let out;
      try {
        out = await triageWorkEntry(ctx, { entries: [entry], gantt, literature, today });
      } catch (err) {
        ctx?.log?.warn(`triageWorklog [${entry.id}] LLM 失败，保留待重试: ${err?.message || err}`);
        break; // 本条失败 → 后续条目不处理，水位线停在已成功处
      }
      if (!out) {
        ctx?.log?.warn(`triageWorklog [${entry.id}] 解析失败，保留待重试`);
        break;
      }
      triaged += 1;
      successIds.push(entry.id);

      // 1. worklog 富化（fields/citations/system，直接写库），仅当有内容
      //    体系提取：无 system 字段的旧记录也因巡检获得体系回填；同值防重
      const systemChanged = out.system && entry.system !== out.system;
      if (out.fields.length > 0 || out.citations.length > 0 || systemChanged) {
        try {
          store.update("worklog", undefined, (cur) => ({
            entries: (cur.entries || []).map((e) =>
              e.id === entry.id
                ? {
                    ...e,
                    ...(out.fields.length > 0 ? { fields: out.fields } : {}),
                    ...(out.citations.length > 0 ? { citations: out.citations } : {}),
                    ...(systemChanged ? { system: out.system } : {}),
                  }
                : e
            ),
          }));
          updated += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog worklog enrich failed: ${err?.message || err}`);
        }
      }

      // 1.5 时长补全：记录未填时长且巡检提取到明确时长 → 直接写库（甘特实际时间线）
      if (out.durationHours && !entry.durationHours) {
        try {
          store.update("worklog", undefined, (cur) => ({
            entries: (cur.entries || []).map((e) =>
              e.id === entry.id
                ? { ...e, durationHours: out.durationHours, ...(out.startDate ? { startDate: out.startDate } : {}) }
                : e
            ),
          }));
          updated += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog duration enrich failed: ${err?.message || err}`);
        }
      }

      // 2. 甘特进度（LLM 推断任务关联，直接写库）
      for (const tp of out.taskProgress) {
        try {
          store.update("gantt", undefined, (cur) => ({
            tasks: (cur.tasks || []).map((t) => (t.id === tp.taskId ? { ...t, progress: tp.progress } : t)),
          }));
          updated += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog gantt progress failed: ${err?.message || err}`);
        }
      }

      // 3. 日程（记录中明确的未来安排，直接写库追加）
      for (const ev of out.events) {
        try {
          store.append("calendar", [
            {
              id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
              title: ev.title,
              date: ev.date,
              startTime: ev.startTime,
              endTime: null,
              type: ev.type,
              taskId: null,
            },
          ]);
          updated += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog calendar append failed: ${err?.message || err}`);
        }
      }

      reviewedAt = entry.createdAt || store.now();
    }

    // 推进水位线（仅已成功巡检的条目不重跑；aiReviewedIds 记录水位线时刻已处理的 id）
    if (triaged > 0) {
      store.update("worklog", undefined, (cur) => {
        const entries = cur.entries || [];
        const prevIds = Array.isArray(cur.meta?.aiReviewedIds) ? cur.meta.aiReviewedIds : [];
        const tickIds = new Set(entries.filter((e) => String(e.createdAt || "") === reviewedAt).map((e) => e.id));
        const kept = [...new Set([...prevIds, ...successIds])].filter((id) => tickIds.has(id));
        return {
          ...cur,
          meta: {
            ...(cur.meta || {}),
            aiReviewedAt: reviewedAt,
            aiReviewedIds: kept,
            aiReviewedCount: (cur.meta?.aiReviewedCount || 0) + triaged,
          },
        };
      });
    }

    return { triaged, updated, skipped: false };
  } finally {
    running = false;
  }
}
