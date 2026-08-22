/**
 * B1 三路采样测试（tests/llm-sampling.test.mjs）
 * 用法：node tests/llm-sampling.test.mjs
 * 纯函数测试，无需 LLM/插件环境。
 */
import { sampleLiterature } from "../src-server/server/llm.js";

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name} ${detail}`); }
}

console.log("== B1 三路采样测试 ==");

// 构造 120 条：60 条老文献（2020 前）、30 条中、30 条新（2024+）；部分高引；部分与方案关键词相关
const entries = [];
const T = (i) => new Date(Date.UTC(2025, 0, 1) - i * 30 * 86400000).toISOString();
for (let i = 0; i < 120; i++) {
  const year = i < 60 ? 2015 + (i % 5) : i < 90 ? 2020 + (i % 4) : 2024 + (i % 2);
  entries.push({
    id: `e${i}`,
    title: i % 7 === 0 ? `Perovskite solar cell stability study ${i}` : `Paper title number ${i}`,
    year: String(year),
    addedAt: T(i),
    doi: i % 3 === 0 ? `10.1000/paper.${i}` : null,
    citationCount: i % 5 === 0 ? 500 - i : 10,
    abstract: i % 7 === 0 ? "interface engineering of perovskite solar cells for stability" : "",
    keywords: [],
  });
}

const planText = "高效稳定钙钛矿太阳能电池的界面工程研究";
const sampled = sampleLiterature(entries, planText);

ok("输出 <= 80 条", sampled.length <= 80, `(${sampled.length})`);
ok("输出 > 50 条（覆盖三路）", sampled.length > 50, `(${sampled.length})`);

// 路1：最新条目在内（i 小 = 新）
const newest = sampled.find((e) => e.id === "e0");
ok("含最新条目", !!newest);

// 路2：高引条目在内（citationCount=500 的：i=0,5,10...；0 已占，找 i=5）
const highCite = sampled.find((e) => e.id === "e5" && e.citationCount === 495);
ok("含高引条目", !!highCite);

// 路3：与方案关键词相关（i%7===0 的钙钛矿条目应至少有 1 条进采样）
const relevant = sampled.filter((e) => e.title.includes("Perovskite"));
ok("含关键词相关条目", relevant.length >= 1, `(${relevant.length})`);

// 去重：无重复指纹（doi 优先）
const fps = sampled.map((e) => (e.doi ? `doi=${e.doi}` : `title=${e.title.toLowerCase()}`));
ok("指纹无重复", new Set(fps).size === fps.length);

// 老文献（2020 前）应能被高引/相关路径带进来（slice(-80) 旧实现做不到：80 条内全是 2022+）
const oldCount = sampled.filter((e) => Number(e.year) < 2020).length;
ok("含 2020 前老文献", oldCount >= 1, `(${oldCount})`);

// 空输入 / 少量输入边界
ok("空输入返回空", Array.isArray(sampleLiterature([])) && sampleLiterature([]).length === 0);
ok("<=80 原样返回", sampleLiterature(entries.slice(0, 50)).length === 50);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
