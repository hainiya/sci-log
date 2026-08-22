/**
 * appendLiteratureLog 日志化单元测试（2026-08-22）
 * 不依赖 @hana，可独立于完整测试套件运行：node tests/literature-log.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { appendLiteratureLog } from "../src-server/server/literature-log.js";
import { createStore } from "../src-server/server/store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litlog-"));
  return { store: createStore(dir), dir };
}

test("appendLiteratureLog writes one worklog entry for new items", () => {
  const { store, dir } = tempStore();
  const newEntries = [
    { title: "SnSe thermoelectric", year: 2024, authors: ["A"], source: "zotero" },
    { title: "PbTe doping", year: 2023, authors: ["B"], source: "zotero" },
  ];
  const res = appendLiteratureLog(store, newEntries, "scan-abc");
  const wl = store.read("worklog");
  assert.equal(res.appended, 1);
  assert.equal(wl.entries.length, 1);
  const rec = wl.entries[0];
  assert.ok(rec.content.includes("新增 2 篇"));
  assert.ok(rec.content.includes("SnSe thermoelectric"));
  assert.equal(rec.kind, "literature-log");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appendLiteratureLog is idempotent for same scanId", () => {
  const { store, dir } = tempStore();
  const newEntries = [{ title: "X", year: 2024, source: "zotero" }];
  appendLiteratureLog(store, newEntries, "scan-x");
  const res2 = appendLiteratureLog(store, newEntries, "scan-x");
  const wl = store.read("worklog");
  assert.equal(res2.appended, 0);
  assert.equal(wl.entries.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appendLiteratureLog skips empty newEntries", () => {
  const { store, dir } = tempStore();
  const res = appendLiteratureLog(store, [], "scan-none");
  assert.equal(res.appended, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
