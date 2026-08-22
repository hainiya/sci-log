/**
 * 提案-确认 API（routes/proposals.js，挂载前缀 /proposals）
 * 面板 Diff 视图：[✅ 接受] [❌ 拒绝（填理由）] [✏️ 改后接受]
 */
import { createStore } from "../server/store.js";
import {
  acceptProposal,
  acceptModifiedProposal,
  rejectProposal,
} from "../server/proposals.js";
import { generateMilestoneSchedule } from "../server/milestone-schedule.js";

export default function registerProposalsRoutes(app, ctx) {
  const store = createStore(ctx.dataDir);

  /** #6 里程碑联动：方案提案确认后，异步派生甘特/日历提案（fire-and-forget） */
  function maybeDeriveMilestones(proposal) {
    if (!proposal || proposal.target !== "plan") return;
    const milestones = proposal.diff?.milestones;
    if (!Array.isArray(milestones) || milestones.length === 0) return;
    generateMilestoneSchedule(ctx, store, proposal.diff, proposal.id).catch((err) =>
      ctx?.log?.warn(`milestone schedule derive failed: ${err?.message || err}`)
    );
  }

  app.get("/proposals", (c) => c.json(store.read("proposals")));

  /** 接受 */
  app.post("/proposals/:id/accept", async (c) => {
    const id = c.req.param("id");
    const result = acceptProposal(store, id);
    if (!result.ok) {
      if (result.error === "version_conflict") {
        return c.json({ error: "version_conflict", data: result.data }, 409);
      }
      return c.json({ error: result.error }, 404);
    }
    maybeDeriveMilestones(result.proposal);
    return c.json({ ok: true, data: result.data });
  });

  /** 拒绝（含理由） */
  app.post("/proposals/:id/reject", async (c) => {
    const id = c.req.param("id");
    let body = {};
    try {
      body = await c.req.json();
    } catch {}
    const result = rejectProposal(store, id, body?.reason || "");
    if (!result.ok) return c.json({ error: result.error }, 404);
    return c.json({ ok: true, proposal: result.proposal });
  });

  /** C5：批量接受同类（target+action 相同的待确认提案，逐个乐观锁接受） */
  app.post("/proposals/accept-batch", async (c) => {
    let body = {};
    try {
      body = await c.req.json();
    } catch {}
    const target = body?.target;
    const action = body?.action;
    if (!target || !action) return c.json({ error: "missing_target_or_action" }, 400);

    const doc = store.read("proposals");
    const group = (doc.entries || []).filter(
      (p) => p.status === "pending" && p.target === target && p.action === action
    );
    let accepted = 0;
    const failed = [];
    for (const p of group) {
      const result = acceptProposal(store, p.id);
      if (result.ok) {
        accepted += 1;
        maybeDeriveMilestones(result.proposal);
      } else failed.push({ id: p.id, error: result.error });
    }
    return c.json({ ok: true, accepted, failed, total: group.length });
  });

  /** 改后接受 */
  app.post("/proposals/:id/accept-modified", async (c) => {
    const id = c.req.param("id");
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body?.diff) return c.json({ error: "missing_diff" }, 400);
    const result = acceptModifiedProposal(store, id, body.diff);
    if (!result.ok) {
      if (result.error === "version_conflict") {
        return c.json({ error: "version_conflict", data: result.data }, 409);
      }
      return c.json({ error: result.error }, 404);
    }
    return c.json({ ok: true, data: result.data });
  });
}
