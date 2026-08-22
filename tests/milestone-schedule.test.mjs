/**
 * 里程碑派生去重与演进同步单元测试（内存 store mock + derive 注入，无需宿主）
 * 验证：同编号里程碑文本演进 → update 而非重复 create；无变化幂等；日历同步
 *
 * 用法：node tests/milestone-schedule.test.mjs
 */
import { generateMilestoneSchedule } from "../src-server/server/milestone-schedule.js";

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

function makeStore(initial = {}) {
  const data = {
    gantt: { version: 0, tasks: [] },
    calendar: { version: 0, events: [] },
    proposals: { version: 0, entries: [] },
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
    _data: data,
  };
}

const noopCtx = { log: { warn() {}, info() {} } };

const planV1 = {
  milestones: [
    "M1: 掺杂配方筛选完成",
    "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K）",
    "M3: 双掺杂优化实现 ZT≥1.2@773K",
  ],
};

const planV2 = {
  milestones: [
    "M1: 掺杂配方筛选完成（HPHT 快速筛选，XRD 确认纯相）",
    "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K，中间验证节点）",
    "M3: 双掺杂优化实现 ZT≥1.2@773K（最终目标）",
  ],
};

const itemsV1 = [
  { milestone: "M1: 掺杂配方筛选完成", taskName: "M1 掺杂配方筛选", start: "2026-08-06", end: "2026-08-27", eventTitle: "M1 完成", eventDate: "2026-08-27", eventType: "deadline" },
  { milestone: "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K）", taskName: "M2 区熔烧结工艺优化", start: "2026-08-28", end: "2026-09-18", eventTitle: "M2 完成", eventDate: "2026-09-18", eventType: "deadline" },
  { milestone: "M3: 双掺杂优化实现 ZT≥1.2@773K", taskName: "M3 双掺杂性能优化", start: "2026-09-19", end: "2026-10-10", eventTitle: "M3 完成", eventDate: "2026-10-10", eventType: "deadline" },
];

const itemsV2 = [
  { milestone: "M1: 掺杂配方筛选完成（HPHT 快速筛选，XRD 确认纯相）", taskName: "M1 掺杂配方筛选（HPHT）", start: "2026-08-06", end: "2026-08-30", eventTitle: "M1 完成（HPHT）", eventDate: "2026-08-30", eventType: "deadline" },
  { milestone: "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K，中间验证节点）", taskName: "M2 区熔烧结工艺优化", start: "2026-08-31", end: "2026-09-18", eventTitle: "M2 完成", eventDate: "2026-09-18", eventType: "deadline" },
  { milestone: "M3: 双掺杂优化实现 ZT≥1.2@773K（最终目标）", taskName: "M3 双掺杂性能优化", start: "2026-09-19", end: "2026-10-10", eventTitle: "M3 完成", eventDate: "2026-10-10", eventType: "deadline" },
];

// 已接受的 v1 派生任务（模拟用户已确认 create 提案后的落库状态）
function acceptedV1Tasks() {
  return [
    { id: "task_m1", name: "M1 掺杂配方筛选", start: "2026-08-06", end: "2026-08-27", dependsOn: [], meta: { milestoneRef: "M1: 掺杂配方筛选完成" } },
    { id: "task_m2", name: "M2 区熔烧结工艺优化", start: "2026-08-28", end: "2026-09-18", dependsOn: ["task_m1"], meta: { milestoneRef: "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K）" } },
    { id: "task_m3", name: "M3 双掺杂性能优化", start: "2026-09-19", end: "2026-10-10", dependsOn: ["task_m2"], meta: { milestoneRef: "M3: 双掺杂优化实现 ZT≥1.2@773K" } },
  ];
}
function acceptedV1Events() {
  return [
    { id: "evt_m1", title: "M1 完成", date: "2026-08-27", type: "deadline", taskId: "task_m1", meta: { milestoneRef: "M1: 掺杂配方筛选完成" } },
    { id: "evt_m2", title: "M2 完成", date: "2026-09-18", type: "deadline", taskId: "task_m2", meta: { milestoneRef: "M2: 区熔+烧结工艺稳定（ZT≥0.8@823K）" } },
    { id: "evt_m3", title: "M3 完成", date: "2026-10-10", type: "deadline", taskId: "task_m3", meta: { milestoneRef: "M3: 双掺杂优化实现 ZT≥1.2@773K" } },
  ];
}

console.log("== 测试1：首次派生（无已有任务）→ create 提案 ==");
{
  const store = makeStore();
  const r = await generateMilestoneSchedule(noopCtx, store, planV1, "p_src1", async () => ({ items: itemsV1 }));
  assert(r.proposals === 6, `6 提案（3 任务 + 3 事件），实际 ${r.proposals}`);
  const creates = store._data.proposals.entries.filter((p) => p.action === "create");
  assert(creates.length === 6, "全部为 create");
  assert(creates.every((p) => p.target === "gantt" || p.target === "calendar"), "target 正确");
  const ganttCreates = creates.filter((p) => p.target === "gantt");
  assert(ganttCreates[1].diff.dependsOn[0] === ganttCreates[0].diff.id, "链式依赖");
  const calCreates = creates.filter((p) => p.target === "calendar");
  assert(calCreates.every((p) => p.diff.meta?.milestoneRef), "日历事件 diff 带 meta.milestoneRef（去重键写入，防演进重复创建）");
}

console.log("== 测试2：同编号里程碑文本演进 → update 而非重复 create ==");
{
  // task_m1 带额外既有 meta（redo sourceTaskId 追溯），验证演进 update 合并而非覆盖
  const store = makeStore({
    gantt: { version: 3, tasks: acceptedV1Tasks().map((t) =>
      t.id === "task_m1" ? { ...t, meta: { ...t.meta, sourceTaskId: "redo_x" } } : t
    ) },
    calendar: { version: 2, events: acceptedV1Events() },
  });
  const r = await generateMilestoneSchedule(noopCtx, store, planV2, "p_src2", async () => ({ items: itemsV2 }));
  const props = store._data.proposals.entries;
  assert(props.every((p) => p.action === "update"), `全部为 update（无重复 create），实际 actions: ${props.map((p) => p.action).join(",")}`);
  assert(r.proposals >= 3, `M1 任务/事件 + M2 任务演进（3+），实际 ${r.proposals}`);
  assert(props.length === 3, `3 个 update（M1 任务、M1 事件、M2 任务），实际 ${props.length}`);
  const m1Task = props.find((p) => p.target === "gantt" && p.diff.id === "task_m1");
  assert(m1Task?.diff.name === "M1 掺杂配方筛选（HPHT）", "M1 任务名演进");
  assert(m1Task?.diff.end === "2026-08-30", "M1 任务结束日演进");
  assert(m1Task?.diff.meta?.milestoneRef === "M1: 掺杂配方筛选完成（HPHT 快速筛选，XRD 确认纯相）", "milestoneRef 更新为新里程碑文本");
  assert(m1Task?.diff.meta?.sourceTaskId === "redo_x", "演进 update 合并保留既有 meta（sourceTaskId 不丢）");
  const m2Task = props.find((p) => p.target === "gantt" && p.diff.id === "task_m2");
  assert(m2Task?.diff.start === "2026-08-31", "M2 任务开始日演进");
  assert(!props.some((p) => p.diff.id === "task_m3"), "M3 无变化不生成提案（幂等）");
}

console.log("== 测试3：无变化再跑 → 0 提案（幂等） ==");
{
  const store = makeStore({
    gantt: { version: 3, tasks: acceptedV1Tasks() },
    calendar: { version: 2, events: acceptedV1Events() },
  });
  const r = await generateMilestoneSchedule(noopCtx, store, planV1, "p_src3", async () => ({ items: itemsV1 }));
  assert(r.proposals === 0, `无变化 0 提案，实际 ${r.proposals}`);
  assert(store._data.proposals.entries.length === 0, "未产生任何提案");
}

console.log("== 测试4：中文编号里程碑归一 ==");
{
  const items = [
    { milestone: "里程碑 一：单晶生长", taskName: "单晶生长", start: "2026-08-06", end: "2026-08-20", eventTitle: "单晶完成", eventDate: "2026-08-20", eventType: "deadline" },
  ];
  const store = makeStore({
    gantt: { version: 1, tasks: [{ id: "task_m1", name: "单晶生长", start: "2026-08-06", end: "2026-08-20", dependsOn: [], meta: { milestoneRef: "里程碑 一：单晶生长" } }] },
    calendar: { version: 1, events: [{ id: "evt_m1", title: "单晶完成", date: "2026-08-20", type: "deadline", taskId: "task_m1", meta: { milestoneRef: "里程碑 一：单晶生长" } }] },
  });
  const r = await generateMilestoneSchedule(noopCtx, store, { milestones: ["里程碑 一：单晶生长"] }, "p_src4", async () => ({ items }));
  assert(r.proposals === 0, `中文编号同里程碑无变化 0 提案，实际 ${r.proposals}`);
  const items2 = [
    { milestone: "里程碑 一：单晶生长（Bridgman 优化）", taskName: "单晶生长（Bridgman）", start: "2026-08-06", end: "2026-08-25", eventTitle: "单晶完成", eventDate: "2026-08-25", eventType: "deadline" },
  ];
  const r2 = await generateMilestoneSchedule(noopCtx, store, { milestones: ["里程碑 一：单晶生长（Bridgman 优化）"] }, "p_src5", async () => ({ items: items2 }));
  const upd = store._data.proposals.entries.filter((p) => p.action === "update");
  assert(r2.proposals === 2, `中文编号演进 → 任务+事件各 1 update，实际 ${r2.proposals}`);
  const gUpd = upd.find((p) => p.target === "gantt");
  assert(gUpd?.diff.end === "2026-08-25", "中文编号演进 → 任务 update 生效");
  assert(upd.some((p) => p.target === "calendar"), "中文编号演进 → 事件 update 生效");
}

console.log("== 测试5：M1.5 不撞 M1 键（编号精度） ==");
{
  const store = makeStore({
    gantt: { version: 3, tasks: [{ id: "task_m1", name: "M1 掺杂配方筛选", start: "2026-08-06", end: "2026-08-27", dependsOn: [], meta: { milestoneRef: "M1: 掺杂配方筛选完成" } }] },
    calendar: { version: 2, events: [{ id: "evt_m1", title: "M1 完成", date: "2026-08-27", type: "deadline", taskId: "task_m1", meta: { milestoneRef: "M1: 掺杂配方筛选完成" } }] },
  });
  const items = [
    { milestone: "M1.5: 掺杂配方中期验证", taskName: "M1.5 中期验证", start: "2026-08-20", end: "2026-08-25", eventTitle: "M1.5 完成", eventDate: "2026-08-25", eventType: "deadline" },
  ];
  const r = await generateMilestoneSchedule(noopCtx, store, { milestones: ["M1.5: 掺杂配方中期验证"] }, "p_src6", async () => ({ items }));
  const props = store._data.proposals.entries;
  assert(r.proposals === 2, `M1.5 为新里程碑 → 任务+事件 create，实际 ${r.proposals}`);
  assert(props.every((p) => p.action === "create"), "M1.5 不撞 M1 键，走 create 而非误 update");
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
