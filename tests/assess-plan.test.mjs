import test from "node:test";
import assert from "node:assert/strict";
import { mergeMilestoneDiff } from "../src-server/tools/assess-plan.js";

test("部分里程碑 diff：按 id 合并保留未涉及里程碑", () => {
  const current = [
    { id: "M1", name: "单晶生长", date: "2026-07-30", criteria: "XRD 纯相" },
    { id: "M2", name: "厚膜工艺", date: "2026-08-10", criteria: "Rc<10Ω" },
    { id: "M3", name: "集成演示", date: "2026-08-15", criteria: "输出>5μW" },
  ];
  const diff = {
    hypothesis: "新假设",
    milestones: [{ id: "M3", name: "集成演示", date: "2026-08-15", criteria: "输出>5μW（需先热阻分析）" }],
  };
  const merged = mergeMilestoneDiff(diff, current);
  assert.equal(merged.milestones.length, 3, "M1/M2/M3 应完整保留");
  assert.equal(merged.milestones[2].criteria, "输出>5μW（需先热阻分析）", "M3 判据被覆盖");
  assert.deepEqual(merged.milestones[0], current[0], "M1 未被改动");
  assert.deepEqual(merged.milestones[1], current[1], "M2 未被改动");
  assert.equal(merged.hypothesis, "新假设", "其他字段原样透传");
});

test("新增里程碑 id：追加而非覆盖", () => {
  const current = [{ id: "M1", name: "单晶生长", date: "2026-07-30" }];
  const diff = {
    milestones: [{ id: "M2", name: "器件集成", date: "2026-08-20" }],
  };
  const merged = mergeMilestoneDiff(diff, current);
  assert.equal(merged.milestones.length, 2);
  assert.equal(merged.milestones[0].id, "M1");
  assert.equal(merged.milestones[1].id, "M2");
});

test("diff 无 milestones：原样返回", () => {
  const diff = { hypothesis: "仅改假设" };
  assert.equal(mergeMilestoneDiff(diff, [{ id: "M1" }]), diff);
  assert.equal(mergeMilestoneDiff(null, [{ id: "M1" }]), null);
});

test("完整替换语义保持：diff 含全部里程碑时全部覆盖", () => {
  const current = [{ id: "M1", name: "旧", date: "2026-07-01" }];
  const diff = {
    milestones: [
      { id: "M1", name: "新 M1", date: "2026-07-15" },
      { id: "M2", name: "新 M2", date: "2026-09-01" },
    ],
  };
  const merged = mergeMilestoneDiff(diff, current);
  assert.equal(merged.milestones.length, 2);
  assert.equal(merged.milestones[0].name, "新 M1", "同 id 被覆盖");
  assert.equal(merged.milestones[1].id, "M2");
});
