/**
 * AI 主导生成实验记录 —— parseDraft 纯函数单元测试（2026-08-22）
 * parseDraft 位于 src-server/server/worklog-parse.js（无任何 @hana import），
 * 因此本文件可在 node --test 下独立加载，无需宿主环境。
 * 运行：node --test tests/worklog-gen.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft } from "../src-server/server/worklog-parse.ts";

test("parseDraft: 合法 JSON 输出被解析为草稿", () => {
  const raw =
    '{"content":"做了旋涂，得到PEDOT薄膜","sampleId":"PEDOT-01","system":"PEDOT/导电聚合物","data":"温度: 60\\n旋涂转速: 3000","taskId":"t_1","durationHours":2.5,"startDate":"2026-08-22"}';
  const d = parseDraft(raw);
  assert.ok(d, "应解析出草稿对象");
  assert.equal(d.content, "做了旋涂，得到PEDOT薄膜");
  assert.equal(d.sampleId, "PEDOT-01");
  assert.equal(d.system, "PEDOT/导电聚合物");
  assert.equal(d.data, "温度: 60\n旋涂转速: 3000");
  assert.equal(d.taskId, "t_1");
  assert.equal(d.durationHours, 2.5);
  assert.equal(d.startDate, "2026-08-22");
});

test("parseDraft: content 缺失 → 返回 null", () => {
  assert.equal(parseDraft('{"sampleId":"x"}'), null);
});

test("parseDraft: 非 JSON → 返回 null（不抛）", () => {
  assert.equal(parseDraft("这不是json"), null);
});

test("parseDraft: 字段为 null 时保留 null、非法时长/日期归 null", () => {
  const d = parseDraft('{"content":"记录一下","durationHours":"abc","taskId":null,"startDate":"bad"}');
  assert.ok(d, "content 合法应产出草稿");
  assert.equal(d.content, "记录一下");
  assert.equal(d.durationHours, null);
  assert.equal(d.taskId, null);
  assert.equal(d.startDate, null);
});
