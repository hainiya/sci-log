/**
 * O-8 体系清单一致性测试：材料体系标准名在 metrics.js SYSTEM_DEFS、前端 WorklogPanel.SYSTEM_PRESETS、
 * 与 prompts/worklog-triage.md 的 system 枚举三处必须保持一致（改体系不再高风险漏改其一）。
 * 运行：node --test tests/consistency.test.mjs（或 npm test 由 run-all.mjs 收集）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SYSTEM_NAMES } from '../src-server/server/metrics.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

test('O-8：三处体系清单一致（metrics.SYSTEM_DEFS / WorklogPanel.SYSTEM_PRESETS / prompt 枚举）', () => {
  // 1) 前端 WorklogPanel.SYSTEM_PRESETS 与 metrics.SYSTEM_NAMES 一致
  const panelSrc = readFileSync(join(root, 'ui', 'panels', 'WorklogPanel.tsx'), 'utf8');
  const m = panelSrc.match(/SYSTEM_PRESETS = \[(.*?)\];/s);
  assert.ok(m, 'WorklogPanel 应定义 SYSTEM_PRESETS 数组');
  const presets = JSON.parse('[' + m[1].replace(/'/g, '"') + ']');
  assert.deepEqual(
    [...presets].sort(),
    [...SYSTEM_NAMES].sort(),
    'SYSTEM_PRESETS 与 metrics.SYSTEM_NAMES 应完全一致'
  );

  // 2) prompt 的 system 标准名枚举应包含每一个 SYSTEM_NAMES
  const triageSrc = readFileSync(join(root, 'prompts', 'worklog-triage.md'), 'utf8');
  const enumLine = triageSrc.match(/标准名之一[^\）\n]+/);
  assert.ok(enumLine, 'prompt 应含 system 标准名枚举');
  for (const name of SYSTEM_NAMES) {
    assert.ok(enumLine[0].includes(name), `prompt 枚举应包含体系「${name}」`);
  }
});

test('O-8：体系清单项数为 11', () => {
  assert.equal(SYSTEM_NAMES.length, 11);
});
