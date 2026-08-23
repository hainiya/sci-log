/**
 * O-1 回归测试：log_work 传给 nextStepAdvice 的 worklog 中，刚记录的新条目只能出现一次。
 * 修复前 step6 用 `[...store.read("worklog").entries, worklogEntry]` 手动追加，而 step3 已把
 * worklogEntry 写入 store，导致该条目在 LLM 上下文重复（污染下一步建议）。
 * 现改用 `store.read("worklog")` 取最新（已含新条目）。此源级断言防护该编码模式被写回。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src-server', 'tools', 'log-work.ts'), 'utf-8');

test('O-1：step6 直接 store.read 取最新 worklog，不重复追加新条目', () => {
  assert.match(
    src,
    /const worklogWithNew = store\.read\("worklog"\);/,
    '应直接用 store.read("worklog") 取最新（step3 已写入，避免重复追加）'
  );
  assert.doesNotMatch(
    src,
    /entries: \[\.\.\.\(store\.read\("worklog"\)\.entries \|\| \[\]\), worklogEntry\],/,
    '不应存在“把已写入的新条目再手动追加”的重复模式'
  );
});
