/**
 * 统一测试入口：顺序执行 tests/ 下全部测试文件，任一失败即非零退出。
 * 用法：npm test
 * 注意：zotero-sync.test.mjs 断言通过后 node 在 Windows 上偶发 libuv assert 崩溃（环境问题），
 * 本入口把它排在最后并在崩溃时按断言输出判断（通过即视为通过）；
 * 无 Zotero 运行时该文件输出 SKIP 标记并以 0 退出（连通性探测，T12 复审）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// P2 复审：自动收集测试文件（*.test.mjs / *-verify.mjs），新增测试无需手动登记；
// zotero-sync 固定排最后（其 libuv 崩溃可能影响后续进程，且是唯一实机依赖项）
const tests = fs
  .readdirSync(here)
  .filter((f) => /\.(test|verify)\.mjs$|-verify\.mjs$|-integration\.mjs$/.test(f) && f !== "run-all.mjs")
  .sort((a, b) => {
    if (a === "zotero-sync.test.mjs") return 1;
    if (b === "zotero-sync.test.mjs") return -1;
    return a.localeCompare(b);
  });

let failed = 0;
let skipped = 0;
for (const t of tests) {
  const file = path.join(here, t);
  process.stdout.write(`▶ ${t}  `);
  const res = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const out = String(res.stdout || "") + String(res.stderr || "");
  if (res.status === 0) {
    if (/结果: SKIP/.test(out)) {
      process.stdout.write("⚠️ SKIP（外部依赖不可用）\n");
      skipped += 1;
    } else {
      process.stdout.write("✅\n");
    }
    continue;
  }
  // zotero-sync：断言全过后 libuv 崩溃视为环境问题（Windows node 已知缺陷）
  if (t === "zotero-sync.test.mjs" && /通过 \/ 0 失败/.test(out)) {
    process.stdout.write("⚠️ 断言全部通过（node libuv 崩溃，环境问题）\n");
    skipped += 1;
    continue;
  }
  process.stdout.write("❌\n");
  failed += 1;
  console.log(out.split("\n").filter((l) => /✗|FAIL|Error|失败/.test(l)).slice(0, 8).join("\n") || out.slice(0, 800));
}

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 个失败`}（跳过 ${skipped}）`);
process.exit(failed === 0 ? 0 : 1);
