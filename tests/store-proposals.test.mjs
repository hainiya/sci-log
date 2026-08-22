// 数据层 + 提案机制单元验证（临时脚本，验证后删除）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src-server/server/store.js";
import { createProposal, acceptProposal, rejectProposal, acceptModifiedProposal, applyProposal, pruneHistory } from "../src-server/server/proposals.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrc-test-"));
const store = createStore(dataDir);
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name} ${extra}`); failures++; }
}

// 1. 默认结构
const plan0 = store.read("plan");
check("plan 默认结构", plan0.version === 0 && Array.isArray(plan0.milestones));

// 2. 乐观锁：版本匹配写入成功
const r1 = store.update("plan", 0, () => ({ title: "测试方案" }));
check("乐观锁 version=0 写入成功", r1.ok && r1.data.version === 1 && r1.data.title === "测试方案");

// 3. 乐观锁：版本过期拒绝
const r2 = store.update("plan", 0, () => ({ title: "旧版本覆盖" }));
check("乐观锁过期版本被拒绝", !r2.ok && r2.error === "version_conflict" && r2.data.version === 1);

// 4. 快照生成
const snaps = store.listSnapshots("plan");
check("快照已生成", snaps.includes(1));

// 5. 回退（最新快照是 version 1：title=测试方案）
const rb = store.rollback("plan");
check("回退成功", rb.ok && rb.data.title === "测试方案");

// 6. literature 追加式 + 去重（DOI/标题级）
const a1 = store.append("literature", [
  { id: "x1", title: "Perovskite Solar Cells", doi: "10.1000/abc" },
  { id: "x2", title: "Second Paper", doi: "10.1000/def" },
]);
const a2 = store.append("literature", [
  { id: "x3", title: "Perovskite Solar Cells (dupe)", doi: "10.1000/abc" },
]);
const a3 = store.append("literature", [
  { id: "x4", title: "Second Paper", doi: null, url: "https://example.com/p2" },
]);
check("追加式写入去重（DOI 级）", a1.appended === 2 && a2.appended === 0 && a3.appended === 0, `appended: ${a1.appended}/${a2.appended}/${a3.appended}`);
check("literature 版本推进", store.read("literature").version === 1);

// 7. 提案创建
const p1 = createProposal(store, { target: "plan", action: "update", diff: { title: "AI 建议方案" }, reason: "测试提案", baseVersion: store.read("plan").version });
check("提案创建成功", p1.entry && p1.entry.status === "pending" && !p1.applied);

// 8. 提案接受
const acc = acceptProposal(store, p1.entry.id);
check("提案接受后落库", acc.ok && store.read("plan").title === "AI 建议方案");
const p1After = store.read("proposals").entries.find((e) => e.id === p1.entry.id);
check("提案状态 accepted", p1After.status === "accepted");

// 9. 重复接受被拒
const acc2 = acceptProposal(store, p1.entry.id);
check("重复接受被拒", !acc2.ok && acc2.error === "not_pending");

// 10. 提案拒绝 + rejected 归档
const p2 = createProposal(store, { target: "worklog", action: "create", diff: { id: "w1", content: "记录" }, reason: "测试记录提案", baseVersion: store.read("worklog").version });
const rej = rejectProposal(store, p2.entry.id, "这个记录不需要");
check("拒绝成功", rej.ok && rej.proposal.status === "rejected");
const rejected = store.read("rejected");
check("拒绝理由归档", rejected.entries.length === 1 && rejected.entries[0].reason === "这个记录不需要");

// 11. 改后接受
const p3 = createProposal(store, { target: "calendar", action: "create", diff: { id: "c1", title: "组会", date: "2026-08-10" }, reason: "测试日程", baseVersion: store.read("calendar").version });
const mod = acceptModifiedProposal(store, p3.entry.id, { id: "c1", title: "组会（改期）", date: "2026-08-11" });
check("改后接受生效", mod.ok && store.read("calendar").events[0].title === "组会（改期）" && store.read("calendar").events[0].date === "2026-08-11");

// 12. 版本冲突：P2 语义——baseVersion 过期时 create 自动重放（不再拒绝）；
//     update/delete 目标条目仍存在时重放，条目已删除时保持冲突拒绝
const p4 = createProposal(store, { target: "gantt", action: "create", diff: { id: "g1", name: "任务A" }, reason: "冲突测试", baseVersion: store.read("gantt").version });
store.update("gantt", store.read("gantt").version, () => ({ tasks: [{ id: "other", name: "他人任务" }] })); // 外部修改推进版本
const acc4 = acceptProposal(store, p4.entry.id);
check("过期 create 自动重放成功", acc4.ok && store.read("gantt").tasks.some((t) => t.id === "g1"));

// 12b. 过期 update：目标条目仍存在 → 重放成功
const p5 = createProposal(store, { target: "gantt", action: "update", diff: { id: "g1", name: "任务A-改名" }, reason: "改名", baseVersion: store.read("gantt").version - 1 });
const acc5 = acceptProposal(store, p5.entry.id);
check("过期 update 条目存在重放成功", acc5.ok && store.read("gantt").tasks.find((t) => t.id === "g1").name === "任务A-改名");

// 12c. 过期 delete：目标条目已不存在 → 保持冲突拒绝
const p6 = createProposal(store, { target: "gantt", action: "delete", diff: { id: "gone", name: "已删" }, reason: "删已删", baseVersion: store.read("gantt").version - 1 });
const acc6 = acceptProposal(store, p6.entry.id);
check("过期 delete 条目不存在仍拒绝", !acc6.ok && acc6.error === "version_conflict");

// 13. 水位线
const updates = store.getUpdates();
check("水位线推进", updates.proposals >= 4 && updates.plan >= 1 && updates.literature >= 1);

// 14. autoApprove 直落
const pa = createProposal(store, { target: "worklog", action: "create", diff: { id: "w2", content: "自动" }, reason: "白名单直落", baseVersion: store.read("worklog").version }, { autoApprove: true });
check("autoApprove 直落库", pa.applied && store.read("worklog").entries.some((e) => e.id === "w2"));

// 15. 损坏文件自愈
fs.writeFileSync(path.join(dataDir, "gantt.json"), "{broken json");
const ganttRecovered = store.read("gantt");
check("损坏 JSON 自愈", ganttRecovered.version === 0 && Array.isArray(ganttRecovered.tasks));

// 16. V6 幂等键：create 提案的 diff.meta 注入 proposalId，重复 apply 不重复入库（两步写崩溃窗口闭合）
{
  const before = store.read("gantt").tasks.length;
  const p = createProposal(store, { target: "gantt", action: "create", diff: { name: "幂等任务" }, reason: "幂等测试" });
  check("create 提案注入 meta.proposalId", !!p.entry.diff.meta?.proposalId && p.entry.diff.meta.proposalId === p.entry.id);
  const first = acceptProposal(store, p.entry.id);
  check("首次接受落库", first.ok && store.read("gantt").tasks.length === before + 1);
  // 模拟崩溃窗口：标记失败后提案仍 pending，再次 apply（直接重放）→ 幂等跳过
  const doc = store.read("proposals");
  store.write("proposals", { ...doc, entries: doc.entries.map((e) => (e.id === p.entry.id ? { ...e, status: "pending" } : e)) });
  const replay = applyProposal(store, { ...p.entry, baseVersion: store.read("gantt").version });
  check("重放幂等：不重复入库", replay.applied === false && store.read("gantt").tasks.length === before + 1);
  check("幂等条目带 proposalId", store.read("gantt").tasks.some((t) => t.meta?.proposalId === p.entry.id));
}

// 17. pruneHistory 有界化：resolved 超限修剪，pending 全保留；rejected 超限修剪
{
  const base = store.read("proposals");
  const fakeResolved = Array.from({ length: 230 }, (_, i) => ({
    id: `p_fake_${i}`,
    target: "gantt",
    action: "create",
    diff: { id: `t_fake_${i}` },
    reason: "灌数据",
    status: "accepted",
    createdAt: `2026-07-01T00:00:0${i % 10}Z`,
    resolvedAt: `2026-08-0${1 + (i % 7)}T00:00:00Z`,
  }));
  store.write("proposals", { ...base, entries: [...base.entries, ...fakeResolved] });
  const rej = store.read("rejected");
  const fakeRejected = Array.from({ length: 250 }, (_, i) => ({
    id: `r_fake_${i}`, target: "gantt", action: "create", summary: "x", reason: "y", createdAt: `2026-08-0${1 + (i % 7)}T00:00:00Z`,
  }));
  store.write("rejected", { ...rej, entries: [...(rej.entries || []), ...fakeRejected] });
  pruneHistory(store);
  const afterP = store.read("proposals");
  const resolvedAfter = afterP.entries.filter((e) => e.status !== "pending");
  const pendingAfter = afterP.entries.filter((e) => e.status === "pending");
  check("resolved 修剪到 ≤200", resolvedAfter.length <= 200);
  check("pending 全保留", pendingAfter.length === base.entries.filter((e) => e.status === "pending").length);
  check("rejected 修剪到 ≤100", store.read("rejected").entries.length <= 100);
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
