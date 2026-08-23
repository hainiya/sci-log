/**
 * 数据层 store 单元测试（2026-08-23）
 * 直接 import createStore（仅依赖 node:fs/path，无任何 @hana import），
 * 在临时目录真实写入 JSON，验证：
 *  - 基础读写与默认结构兜底
 *  - 乐观锁：版本匹配写入、version+1、推进 updates 水位线
 *  - 乐观锁：版本不匹配 → version_conflict，返回最新数据
 *  - 字符串 version 归一化边界（防永久 version_conflict 锁死写入）
 *  - append 去重（doi/title 指纹）
 *  - upsertByKey 镜像全量替换（Zotero 同步，保留无 key 条目）
 *  - snapshot / rollback 回退
 *  - snapshot 修剪（最多 MAX_SNAPSHOTS）
 * 运行：node tests/store.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, MAX_SNAPSHOTS } from "../src-server/server/store.ts";

function freshStore() {
  return createStore(mkdtempSync(join(tmpdir(), "mrc-store-")));
}

test("read 默认结构兜底：空库读出默认 version/entries", () => {
  const s = freshStore();
  const d = s.read("worklog");
  assert.equal(d.version, 0);
  assert.deepEqual(d.entries, []);
  assert.equal(s.read("literature").entries.length, 0);
});

test("write/read 基础往返", () => {
  const s = freshStore();
  s.write("worklog", { version: 0, entries: [{ id: "a", content: "x" }] });
  assert.equal(s.read("worklog").entries.length, 1);
});

test("update 乐观锁：版本匹配成功，version+1 且推进水位线", () => {
  const s = freshStore();
  const r = s.update("worklog", 0, () => ({ entries: [{ id: "a", content: "x" }] }));
  assert.equal(r.ok, true);
  assert.equal(r.data.entries.length, 1);
  assert.equal(r.data.version, 1);
  assert.equal(s.getUpdates().worklog, 1); // bump 水位线
});

test("update 乐观锁：版本不匹配 → conflict 并返回最新数据", () => {
  const s = freshStore();
  s.update("worklog", 0, () => ({ entries: [{ id: "a" }] })); // v1
  const r = s.update("worklog", 0, () => ({ entries: [] })); // 用过期的 version 0
  assert.equal(r.ok, false);
  assert.equal(r.error, "version_conflict");
  assert.equal(r.data.version, 1); // 返回最新
  assert.equal(r.data.entries.length, 1);
});

test("update 字符串 version 归一化（防永久锁死）", () => {
  const s = freshStore();
  s.write("worklog", { version: "5", entries: [{ id: "a" }] }); // 模拟字符串版本损坏
  const r = s.update("worklog", 5, () => ({ entries: [{ id: "a" }] })); // 期望数值 5
  assert.equal(r.ok, true); // read 时归一为 number 5 → 匹配
  assert.equal(r.data.version, 6);
});

test("append 去重：按 doi/title 指纹跳过重复项", () => {
  const s = freshStore();
  const a = s.append("literature", [{ doi: "10.1/aa", title: "A" }]);
  assert.equal(a.ok, true);
  assert.equal(a.appended, 1);
  const b = s.append("literature", [{ doi: "10.1/aa", title: "B" }]); // doi 与已有重复
  assert.equal(b.ok, true);
  assert.equal(b.appended, 0);
  assert.equal(s.read("literature").entries.length, 1);
});

test("upsertByKey 镜像全量替换（Zotero 同步）：替换有 key 条目、保留无 key 条目", () => {
  const s = freshStore();
  s.write("literature", {
    version: 0,
    entries: [
      { zoteroKey: "Z1", title: "old", doi: "10.1" },
      { doi: "10.9", title: "keep-me" }, // 无 zoteroKey，应保留
    ],
  });
  const r = s.upsertByKey("literature", "zoteroKey", [{ zoteroKey: "Z2", title: "new", doi: "10.2" }]);
  assert.equal(r.ok, true);
  assert.equal(r.replaced, 1); // 源自 items 的 keyed 条目数
  const entries = r.data.entries;
  assert.ok(!entries.some((e) => e.zoteroKey === "Z1"), "旧 Z1 应被替换");
  assert.ok(entries.some((e) => e.zoteroKey === "Z2"), "新 Z2 应存在");
  assert.ok(entries.some((e) => e.doi === "10.9"), "无 key 条目应保留");
  assert.equal(r.data.version, 1);
});

test("snapshot/rollback 回退到指定快照版本", () => {
  const s = freshStore();
  s.update("worklog", 0, () => ({ entries: [{ id: "a" }] })); // v1
  s.update("worklog", 1, () => ({ entries: [{ id: "a" }, { id: "b" }] })); // v2
  assert.equal(s.read("worklog").entries.length, 2);
  const rb = s.rollback("worklog", 1); // 回到 v1
  assert.equal(rb.ok, true);
  const d = s.read("worklog");
  assert.equal(d.version, 3); // 回退后 version+1
  assert.equal(d.entries.length, 1); // 只剩 a
});

test("snapshot 修剪：最多保留 MAX_SNAPSHOTS 个快照", () => {
  const s = freshStore();
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    s.update("worklog", i, () => ({ entries: [{ id: String(i) }] }));
  }
  const snaps = s.listSnapshots("worklog");
  assert.ok(snaps.length <= MAX_SNAPSHOTS, `snapshots=${snaps.length} 应 ≤ ${MAX_SNAPSHOTS}`);
});
