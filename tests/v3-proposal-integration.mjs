/**
 * V3 提案全链路集成验证（源码级，临时目录，不污染真实数据）：
 * 与路由层相同的调用形状（acceptProposal/rejectProposal/acceptModifiedProposal）
 */
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../src-server/server/store.js";
import { createProposal, acceptProposal, rejectProposal, acceptModifiedProposal } from "../src-server/server/proposals.js";

const dir = mkdtempSync(path.join(tmpdir(), "mrc-v3-"));
const store = createStore(dir);
const out = [];

// 1. 生成提案（与工具相同调用形状）
const ganttDiff = { id: "task_x", name: "界面修饰层制备", start: "2026-08-05", end: "2026-08-19", dependsOn: [], progress: 0, tags: [] };
const p1 = createProposal(store, { target: "gantt", action: "create", diff: ganttDiff, reason: "新增甘特任务", baseVersion: store.read("gantt").version });
out.push(["提案生成 pending", p1.entry.status === "pending" && !p1.applied]);

// 2. 接受 → gantt.json 落库 + 状态 accepted + 快照 + 水位线
const a1 = acceptProposal(store, p1.entry.id);
const gantt = store.read("gantt");
const snapDir = path.join(dir, "snapshots", "gantt");
const snapFiles = readdirSync(snapDir);
out.push(["接受后落库", a1.ok && gantt.tasks.length === 1 && gantt.tasks[0].name === "界面修饰层制备"]);
out.push(["接受后状态", store.read("proposals").entries.find((e) => e.id === p1.entry.id).status === "accepted"]);
out.push(["快照生成", snapFiles.length >= 1 && snapFiles.includes("1.json")]);
out.push(["水位线推进", store.read("updates").gantt >= 1]);

// 3. 重复接受被拒
out.push(["重复接受被拒", !acceptProposal(store, p1.entry.id).ok]);

// 4. 拒绝带理由 → 归档
const p2 = createProposal(store, { target: "calendar", action: "create", diff: { id: "evt_y", title: "组会", date: "2026-08-07" }, reason: "新增日程", baseVersion: store.read("calendar").version });
const r1 = rejectProposal(store, p2.entry.id, "时间冲突，改到周四");
const rejected = store.read("rejected");
out.push(["拒绝归档含理由", r1.ok && rejected.entries.some((e) => e.id === p2.entry.id && e.reason === "时间冲突，改到周四")]);
out.push(["拒绝后未落库", store.read("calendar").events.length === 0]);

// 5. 改后接受
const p3 = createProposal(store, { target: "calendar", action: "create", diff: { id: "evt_z", title: "组会", date: "2026-08-06" }, reason: "改期日程", baseVersion: store.read("calendar").version });
const a3 = acceptModifiedProposal(store, p3.entry.id, { id: "evt_z", title: "组会（周四）", date: "2026-08-06" });
out.push(["改后接受生效", a3.ok && store.read("calendar").events[0].title === "组会（周四）"]);

// 6. baseVersion 过期（P2 语义：create 自动重放成功，不再拒绝）
const stale = createProposal(store, { target: "gantt", action: "create", diff: { id: "task_s", name: "过期任务" }, reason: "旧版本提案", baseVersion: 0 });
const a4 = acceptProposal(store, stale.entry.id);
out.push(["过期 create 自动重放成功", a4.ok && store.read("gantt").tasks.some((t) => t.id === "task_s")]);

// 7. literature 追加式去重（同 DOI 拒绝重复入库）
const lit1 = acceptProposal(store, createProposal(store, { target: "literature", action: "create", diff: { doi: "10.1002/x", title: "A", year: "2022" }, reason: "文献 A" }).entry.id);
const lit2 = acceptProposal(store, createProposal(store, { target: "literature", action: "create", diff: { doi: "10.1002/x", title: "A 重复" }, reason: "文献 A 重复" }).entry.id);
out.push(["literature DOI 去重", store.read("literature").entries.length === 1]);

let allOk = true;
for (const [name, ok] of out) {
  console.log((ok ? "✅" : "❌"), name);
  if (!ok) allOk = false;
}
console.log(allOk ? "V3 提案全链路通过" : "V3 存在失败");
rmSync(dir, { recursive: true, force: true });
process.exit(allOk ? 0 : 1);
