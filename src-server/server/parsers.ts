/**
 * 轻量题录解析器：RIS / BibTeX / EndNote（.enw / .txt）
 * 不引入任何外部依赖。无法解析的扩展名（如 .caj）由上层识别并标注。
 * 全文提取已迁移至 Zotero fulltext API（见 sources.js，2026-08-07）
 */
import fs from "node:fs";
import path from "node:path";

/** @param {unknown} value @returns {string} */
function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** @param {unknown} text @returns {string} */
function firstLine(text: unknown): string {
  const line = String(text || "").split(/\r?\n/).find((l: any) => l.trim());
  return line ? line.trim() : "";
}

/** @param {unknown} text @returns {string|null} */
function guessYear(text: unknown): string|null {
  const match = String(text || "").match(/(?:19|20)\d{2}(?!\d)/);
  return match ? match[0] : null;
}

/** 从任意文本中提取 DOI
 * @param {unknown} text
 * @returns {string|null}
 */
export function extractDoi(text: unknown): string|null {
  const match = String(text || "").match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
  return match ? match[0].replace(/[.;]$/, "") : null;
}

/** RIS 解析：TY/.../ER 块
 * @param {unknown} text
 * @returns {Array<import("./types.ts").LiteratureEntry>}
 */
export function parseRis(text: unknown): Array<import("./types.ts").LiteratureEntry> {
  const records = [];
  const blocks = String(text || "").split(/\r?\nER\s*[- ]/);
  for (const block of blocks) {
    
    const fields: Record<string, string[]> = {};
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9]{1,2})\s*-\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim();
      if (!fields[key]) fields[key] = [];
      fields[key].push(value);
    }
    if (!fields.TY) continue;
    const title = normalizeText((fields.TI || fields.T1 || []).join(" "));
    if (!title) continue;
    const year = fields.PY?.[0] || fields.Y1?.[0] || guessYear(fields.DA?.[0]);
    records.push({
      title,
      authors: (fields.AU || []).map(normalizeText).filter(Boolean),
      year: year || null,
      venue: normalizeText((fields.JO || fields.T2 || fields.BT || fields.JF || []).join(" ")),
      volume: fields.VL?.[0] || null,
      issue: fields.IS?.[0] || null,
      pages: fields.SP?.[0] ? `${fields.SP[0]}${fields.EP?.[0] ? `-${fields.EP[0]}` : ""}` : null,
      doi: fields.DO?.[0] || null,
      url: fields.UR?.[0] || fields.L1?.[0] || null,
      abstract: normalizeText((fields.AB || []).join(" ")),
      keywords: (fields.KW || []).map(normalizeText).filter(Boolean),
      type: fields.TY?.[0] || "misc",
    });
  }
  return records;
}

/** BibTeX 解析：@type{key, field = {...}}（花括号平衡扫描，支持嵌套）
 * @param {unknown} text
 * @returns {Array<import("./types.ts").LiteratureEntry>}
 */
export function parseBibtex(text: unknown): Array<import("./types.ts").LiteratureEntry> {
  const records = [];
  const src = String(text || "");
  let i = 0;
  while (i < src.length) {
    // 找 @type{ 开头
    const at = src.indexOf("@", i);
    if (at === -1) break;
    const open = src.indexOf("{", at + 1);
    if (open === -1) break;
    const type = src.slice(at + 1, open).trim().toLowerCase();
    // 找 key（到第一个逗号或 }）
    const keyEnd = src.indexOf(",", open + 1);
    const braceEnd = src.indexOf("}", open + 1);
    const boundary = keyEnd === -1 ? braceEnd : Math.min(keyEnd, braceEnd);
    const key = src.slice(open + 1, boundary).trim();
    if (!type || !key) {
      i = open + 1;
      continue;
    }
    if (keyEnd === -1 || boundary === braceEnd) {
      i = open + 1;
      continue;
    }
    // 从条目开括号起扫描花括号深度，回到 0 即条目结束（正确处理字段值嵌套）
    let depth = 0;
    let end = -1;
    for (let j = open; j < src.length; j++) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    const fieldsRaw = src.slice(keyEnd + 1, end);
    // 字段扫描：支持嵌套花括号值（LaTeX 命令/化学式）、引号值、裸数字
    
    const fields: Record<string, string> = {};
    let pos = 0;
    while (pos < fieldsRaw.length) {
      while (pos < fieldsRaw.length && /[\s,]/.test(fieldsRaw[pos])) pos++;
      if (pos >= fieldsRaw.length) break;
      const nameMatch = /^(\w+)\s*=\s*/.exec(fieldsRaw.slice(pos));
      if (!nameMatch) {
        pos++;
        continue;
      }
      const name = nameMatch[1].toLowerCase();
      pos += nameMatch[0].length;
      let val = "";
      const ch = fieldsRaw[pos];
      if (ch === "{") {
        let depth = 0;
        let j = pos;
        for (; j < fieldsRaw.length; j++) {
          if (fieldsRaw[j] === "{") depth++;
          else if (fieldsRaw[j] === "}") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        val = fieldsRaw.slice(pos + 1, j - 1);
        pos = j;
      } else if (ch === '"') {
        const qEnd = fieldsRaw.indexOf('"', pos + 1);
        if (qEnd === -1) {
          pos = fieldsRaw.length;
          continue;
        }
        val = fieldsRaw.slice(pos + 1, qEnd);
        pos = qEnd + 1;
      } else {
        const numM = /^(\d+)/.exec(fieldsRaw.slice(pos));
        if (numM) {
          val = numM[1];
          pos += numM[1].length;
        } else {
          pos++;
          continue;
        }
      }
      fields[name] = val;
    }
    const title = normalizeText(fields.title || "");
    if (title) {
      let authors = [];
      const authorStr = fields.author || fields.editor || "";
      authors = String(authorStr)
        .split(/\s+and\s+/i)
        .map((a: any) => normalizeText(a))
        .filter(Boolean);
      records.push({
        title,
        authors,
        year: fields.year || null,
        venue: normalizeText(fields.journal || fields.booktitle || fields.publisher || ""),
        volume: fields.volume || null,
        issue: fields.number || null,
        pages: fields.pages || null,
        doi: fields.doi || null,
        url: fields.url || null,
        abstract: normalizeText(fields.abstract || ""),
        keywords: (fields.keywords || "")
          .split(/[;,]/)
          .map((k: any) => normalizeText(k))
          .filter(Boolean),
        type,
      });
    }
    i = end + 1;
  }
  return records;
}

/** EndNote 标签格式解析（多为 .enw，也兼容 RefWorks 的 RT 开头）
 * @param {unknown} text
 * @returns {Array<import("./types.ts").LiteratureEntry>}
 */
export function parseEndnote(text: unknown): Array<import("./types.ts").LiteratureEntry> {
  const records = [];
  const blocks = String(text || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    
    const fields: Record<string, string[]> = {};
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9]+)\s+(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const value = m[2].trim();
      if (!fields[key]) fields[key] = [];
      fields[key].push(value);
    }
    const title = normalizeText((fields.TI || fields.T1 || fields.AB || []).join(" "));
    if (!title) continue;
    records.push({
      title,
      authors: (fields.AU || []).map(normalizeText).filter(Boolean),
      year: fields.PY?.[0] || guessYear(fields.YR?.[0]),
      venue: normalizeText((fields.JO || fields.JF || fields.T2 || []).join(" ")),
      volume: fields.VL?.[0] || null,
      issue: fields.IS?.[0] || null,
      pages: fields.SP?.[0] || null,
      doi: fields.DO?.[0] || null,
      url: fields.UR?.[0] || null,
      abstract: normalizeText((fields.AB || []).join(" ")),
      keywords: (fields.KW || []).map(normalizeText).filter(Boolean),
      type: "misc",
    });
  }
  return records;
}

export const SUPPORTED_EXTENSIONS = new Set([".ris", ".bib", ".bibtex", ".enw", ".txt"]);

/** @param {string} ext @returns {"ris"|"bibtex"|"endnote"|"txt"|null} */
export function detectFormat(ext: string): "ris"|"bibtex"|"endnote"|"txt"|null {
  if (ext === ".ris") return "ris";
  if (ext === ".bib" || ext === ".bibtex") return "bibtex";
  if (ext === ".enw") return "endnote";
  if (ext === ".txt") return "txt";
  return null;
}

/** 解析一个题录文件内容（按扩展名路由）
 * @param {string} fileName
 * @param {unknown} content
 * @returns {Array<import("./types.ts").LiteratureEntry>}
 */
export function parseFileContent(fileName: string, content: unknown): Array<import("./types.ts").LiteratureEntry> {
  const ext = path.extname(fileName).toLowerCase();
  const format = detectFormat(ext);
  if (format === "ris") return parseRis(content);
  if (format === "bibtex") return parseBibtex(content);
  if (format === "endnote") return parseEndnote(content);
  if (format === "txt") {
    // .txt 可能是任何格式，逐个尝试
    const ris = parseRis(content);
    if (ris.length > 0) return ris;
    const bib = parseBibtex(content);
    if (bib.length > 0) return bib;
    const enw = parseEndnote(content);
    if (enw.length > 0) return enw;
    // 纯文本：按单条标题启发式识别
    const lines = String(content).split(/\r?\n/).filter((l: any) => l.trim());
    if (lines.length > 0) {
      const year = guessYear(lines[0]);
      return [
        {
          title: normalizeText(lines[0]),
          authors: [],
          year,
          venue: "",
          doi: extractDoi(content),
          url: null,
          abstract: normalizeText(lines.slice(1).join(" ")),
          keywords: [],
          type: "misc",
        },
      ];
    }
  }
  return [];
}

/** 从 PDF 文件名提取元数据（仅文件名启发式，不解析全文）
 * @param {string} fileName
 * @returns {{title: string, year: string|null, fileName: string}}
 */
export function metadataFromPdfFileName(fileName: string): {title: string, year: string|null, fileName: string} {
  const base = path.basename(fileName, path.extname(fileName));
  const clean = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const year = guessYear(clean);
  // 常见命名：作者-年份-标题 或 标题(年份).pdf
  let title = clean.replace(/\s*\(?\s*(19|20)\d{2}\s*\)?\s*$/, "").trim();
  // 作者前缀：Li2023_xxx / Wang_2023_xxx 等命名中的作者名+年份
  title = title.replace(/^[A-Z][A-Za-z\-]*(?:19|20)\d{2}\s+/, "").trim();
  // 孤立年份残留
  title = title.replace(/\s*\(?\s*(19|20)\d{2}\s*\)?\s*$/, "").trim();
  return {
    title: title || clean,
    year,
    fileName: path.basename(fileName),
  };
}

/** 从文件读取并解析题录
 * @param {string} filePath
 * @returns {Array<import("./types.ts").LiteratureEntry>}
 */
export function parseFile(filePath: string): Array<import("./types.ts").LiteratureEntry> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseFileContent(path.basename(filePath), content);
  } catch (err) {
    return [];
  }
}
