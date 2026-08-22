/**
 * P0 日程闭环单元测试（内存 store mock，无需宿主）
 * 验证：rebalanceSchedule 滞后顺延 + proposeRedoTask 失败重做
 *
 * 用法：node tests/schedule-rebalance.test.mjs
 */
import { rebalanceSchedule, proposeRedoTask, BUFFER_DAYS } from "../src-server/server/schedule-rebalance.js";

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error("  ✗ FAIL:", msg);
  }
}
function iso(d) {
  return d.toISOString().slice(0, 10);
}
function addDaysIso(s, n) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function makeStore(initial = {}) {
  const data = {
    gantt: { version: 0, tasks: [] },
    calendar: { version: 0, events: [] },
    proposals: { version: 0, entries: [] },
    worklog: { version: 0, entries: [] },
    ...initial,
  };
  return {
    read: (n) => data[n] || { version: 0 },
    update: (n, _ver, mut) => {
      const cur = data[n] || { version: 0 };
      const next = { ...cur, ...(mut ? mut(cur) : {}), version: (cur.version || 0) + 1, updatedAt: new Date().toISOString() };
      data[n] = next;
      return { ok: true, data: next };
    },
    append: () => ({ ok: true, appended: 0, data }),
    now: () => new Date().toISOString(),
  };
}

const noopCtx = { log: { warn() {}, info() {} } };
const today = new Date();
const past10 = iso(new Date(today.getTime() - 10 * 86400000));
const past5 = iso(new Date(today.getTime() - 5 * 86400000));
const fut1 = iso(new Date(today.getTime() + 1 * 86400000));
const fut5 = iso(new Date(today.getTime() + 5 * 86400000));
const fut6 = iso(new Date(today.getTime() + 6 * 86400000));
const fut10 = iso(new Date(today.getTime() + 10 * 86400000));
const fut20 = iso(new Date(today.getTime() + 20 * 86400000));
const fut30 = iso(new Date(today.getTime() + 30 * 86400000));

console.log("== 测试1：滞后再平衡（沿 dependsOn 顺延下游 + 同步关联日历）==");
{
  const store = makeStore({
    gantt: {
      version: 0,
      tasks: [
        { id: "T1", name: "合成", start: past10, end: past5, progress: 0, dependsOn: [] },
        { id: "T2", name: "表征", start: fut1, end: fut5, progress: 0, dependsOn: ["T1"] },
        { id: "T3", name: "测试", start: fut6, end: fut10, progress: 0, dependsOn: ["T2"] },
      ],
    },
    calendar: { version: 0, events: [{ id: "E1", title: "表征日", date: fut1, taskId: "T2" }] },
    proposals: { version: 0, entries: [] },
  });

  const rb = rebalanceSchedule(noopCtx, store);
  const proposals = store.read("proposals").entries;
  const gUpdates = proposals.filter((p) => p.target === "gantt" && p.action === "update");
  const cUpdates = proposals.filter((p) => p.target === "calendar" && p.action === "update");

  assert(rb.proposals >= 4, `应至少生成 4 条提案（T1/T2/T3 + E1），实际 ${rb.proposals}`);

  const t1 = gUpdates.find((p) => p.diff.id === "T1");
  const t2 = gUpdates.find((p) => p.diff.id === "T2");
  assert(t1 && t1.diff.end > past5, "T1（滞后）的 end 应顺延到 past5 之后");
  assert(t2 && t2.diff.start > fut1, "T2 依赖 T1，start 应顺延到原 fut1 之后");

  // 关联日历事件应同步顺延
  const e1 = cUpdates.find((p) => p.diff.id === "E1");
  assert(e1 && e1.diff.date > fut1, "关联日历事件 E1 应随 T2 顺延");

  // 去重：再次运行不应新增相同提案
  const before = proposals.length;
  const rb2 = rebalanceSchedule(noopCtx, store);
  assert(store.read("proposals").entries.length === before, "重复运行再平衡不应新增提案（去重生效）");
}

console.log("== 测试2：失败重做提案 ==");
{
  const store = makeStore({
    gantt: {
      version: 0,
      tasks: [{ id: "X1", name: "水热合成", start: past10, end: past5, progress: 0, dependsOn: [] }],
    },
    calendar: { version: 0, events: [] },
    proposals: { version: 0, entries: [] },
  });

  const n = proposeRedoTask(noopCtx, store, {
    taskId: "X1",
    reason: "产物开裂",
    worklogEntryId: "w1",
    today: iso(today),
  });
  assert(n === 2, `应生成 2 条提案（重做任务 + 日历事件），实际 ${n}`);

  const proposals = store.read("proposals").entries;
  const gCreate = proposals.find((p) => p.target === "gantt" && p.action === "create");
  const cCreate = proposals.find((p) => p.target === "calendar" && p.action === "create");
  assert(gCreate && gCreate.diff.name.includes("重做"), "重做任务名应含『重做』");
  assert(gCreate && JSON.stringify(gCreate.diff.dependsOn) === JSON.stringify(["X1"]), "重做任务应依赖原任务 X1");
  assert(gCreate && gCreate.diff.progress === 0, "重做任务进度应为 0");
  assert(gCreate && gCreate.diff.start === addDaysIso(iso(today), BUFFER_DAYS), "重做任务 start 应为今天+缓冲");
  assert(cCreate && cCreate.diff.taskId === gCreate.diff.id, "重做日历事件应关联新任务");
  assert(cCreate && cCreate.diff.type === "experiment", "重做日历事件类型应为 experiment");

  // 去重：同一原任务再次调用不应重复生成
  const n2 = proposeRedoTask(noopCtx, store, { taskId: "X1", reason: "再次", worklogEntryId: "w2", today: iso(today) });
  assert(n2 === 0, "同一原任务重复调用不应再生成重做提案（去重生效）");
}

console.log("== 测试3：无滞后时不生成提案 ==");
{
  const future = iso(new Date(today.getTime() + 15 * 86400000));
  const future2 = iso(new Date(today.getTime() + 25 * 86400000));
  const store = makeStore({
    gantt: { version: 0, tasks: [{ id: "G1", name: "正常任务", start: future, end: future2, progress: 0, dependsOn: [] }] },
    calendar: { version: 0, events: [] },
    proposals: { version: 0, entries: [] },
  });
  const rb = rebalanceSchedule(noopCtx, store);
  assert(rb.proposals === 0, `无滞后任务不应生成提案，实际 ${rb.proposals}`);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
