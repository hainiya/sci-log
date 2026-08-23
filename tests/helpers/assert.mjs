/**
 * 轻量断言 harness（O-6 单一化）：此前 analyze-metrics/import-parser/metrics/sources
 * 各自重复实现 assert/assert.equal/assert.deepEqual（含 console 计数 + 退出码），现统一至此。
 * 因为 run-all.mjs 用 spawnSync 把每个测试文件跑在独立进程里，模块级 pass/fail 在各进程互不干扰。
 * 保留 assert.equal/assert.deepEqual 属性形式，调用点无需改动。
 * 用法：import { assert, assertFinish, assertSummary } from './helpers/assert.mjs';
 */
let pass = 0;
let fail = 0;

export function assert(cond, msg) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error('  ✗ FAIL:', msg);
  }
}

assert.equal = (actual, expected, msg) =>
  assert(actual === expected, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
assert.ok = (cond, msg) => assert(cond, msg);
assert.deepEqual = (actual, expected, msg) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);

/** 结束：有失败则非零退出（run-all.mjs 据 status 判定） */
export function assertFinish() {
  process.exit(fail > 0 ? 1 : 0);
}

/** 汇总文案（用于结果输出） */
export function assertSummary() {
  return `${pass} 通过 / ${fail} 失败`;
}
