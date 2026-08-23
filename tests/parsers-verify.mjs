import { parseRis, parseBibtex, metadataFromPdfFileName, extractDoi } from "../src-server/server/parsers.ts";

const out = [];
// 1. RIS
const ris = "TY  - JOUR\nAU  - Kim, J\nTI  - Perovskite solar cells\nPY  - 2023\nJO  - Nature\nDO  - 10.1038/nature123\nER  -";
const r = parseRis(ris);
out.push(["RIS", r.length === 1 && r[0].title === "Perovskite solar cells" && r[0].year === "2023" && r[0].doi === "10.1038/nature123"]);

// 2. BibTeX（嵌套花括号 + 引号值）
const bib = '@article{deep1, title = {{Unraveling} stability {of} perovskites}, author = "Smith, A and Li, B", year = {2022}}';
const b = parseBibtex(bib);
out.push(["BibTeX 嵌套花括号", b.length === 1 && b[0].title === "{Unraveling} stability {of} perovskites" && b[0].authors.length === 2]);

// 3. PDF 文件名（年份在词中/词尾/无年份）
const p1 = metadataFromPdfFileName("Li2023_HighPerformancePerovskite.pdf");
const p2 = metadataFromPdfFileName("Perovskite_stability_2024_review.pdf");
const p3 = metadataFromPdfFileName("thesis_final.pdf");
out.push(["PDF 年份提取", p1.year === "2023" && p2.year === "2024" && p3.year === null]);
out.push(["PDF 标题清洗", !p1.title.includes("Li2023") && p1.title.includes("HighPerformancePerovskite")]);

// 4. DOI 提取（URL 包裹 / 裸 DOI）
const d1 = extractDoi("https://doi.org/10.1002/adma.202200001");
const d2 = extractDoi("10.1038/s41586-023-05878-9");
out.push(["DOI 提取", d1 === "10.1002/adma.202200001" && d2 === "10.1038/s41586-023-05878-9"]);

let allOk = true;
for (const [name, ok] of out) {
  console.log((ok ? "✅" : "❌"), name);
  if (!ok) allOk = false;
}
console.log(allOk ? "parsers 全部通过" : "parsers 存在失败");
process.exit(allOk ? 0 : 1);
