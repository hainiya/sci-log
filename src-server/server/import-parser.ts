/**
 * 批量导入解析器（2026-08-14）：仪器表格粘贴 → worklog 记录
 *
 * 输入形态：TSV/CSV 粘贴（Excel 直接复制即 TSV），表头行 + 数据行，一行一个温度点。
 * 输出形态：同一次测量（同日期 + 同样品号）的 N 行合并为一条记录，
 *   fields 用键名带温度形态（ZT@823K），复用 metrics.js 既有解析链（测试 13/21 已验证）。
 *
 * 设计要点：
 * - 纯函数、无 LLM、无外部依赖，便于单元测试与 esbuild 打包。
 * - 表头识别：日期/样品/体系/备注/温度/指标列（METRIC_DEFS keyRe 命中）+ 未知列进 fields。
 * - 表头括号单位（Seebeck(μV/K)）：单元格为纯数字时拼进值串，unitNorm 换算免费生效。
 * - 温度归一：单元格自带单位（823K/550°C/550℃）优先；裸数字按表头单位暗示
 *   （T(°C) → °C 归一，否则按 K）统一归一为整数 K，与 metrics.js 提取层一致。
 * - 错误行：日期格式错 / 指标值非数字 → errors 带物理行号，跳过不阻断其他行。
 */
import { METRIC_DEFS } from "./metrics.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COL = {
  date: /^(date|日期)$/i,
  sampleId: /^(sampleid|sample|样品|样品号|样品编号|试样)$/i,
  system: /^(system|体系|材料体系|材料)$/i,
  content: /^(content|备注|说明|内容|note|notes)$/i,
  temp: /^(t|temp|temperature|温度|测试温度)$/i,
};

/** 表头 → { base, unitHint }：剥括号单位（Seebeck(μV/K) / T(K) / 电导率（S/cm））
 * @param {unknown} raw
 * @returns {{ base: string, unitHint: string }}
 */
function headerInfo(raw: unknown): { base: string, unitHint: string } {
  const h = String(raw ?? "").trim();
  const m = h.match(/^([^(（]+)[(（]([^)）]+)[)）]$/);
  if (m) return { base: m[1].trim(), unitHint: m[2].trim() };
  return { base: h, unitHint: "" };
}

/** @param {unknown} v @returns {boolean} */
function isBareNumber(v: unknown): boolean {
  return /^[-+]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v));
}

/** 温度单元格解析：归一为整数 K。单元格自带单位优先；裸数字按表头单位暗示。
 * @param {unknown} cell
 * @param {string} headerHint
 * @returns {number|null}
 */
function parseTempValue(cell: unknown, headerHint: string): number|null {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  const k = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*K$/i);
  if (k) return Math.round(Number(k[1]));
  const c = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:°\s*C|℃|摄氏度)$/i);
  if (c) return Math.round(Number(c[1]) + 273.15);
  const bare = s.match(/^(-?\d+(?:\.\d+)?)$/);
  if (bare) {
    if (/°\s*C|℃|摄氏/i.test(headerHint || "")) return Math.round(Number(bare[1]) + 273.15);
    return Math.round(Number(bare[1]));
  }
  return null;
}

/** 剥离单元格首尾引号（CSV "..." / 中文全角引号） @param {unknown} s @returns {string} */
function stripQuotes(s: unknown): string {
  let v = String(s ?? "").trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("“") && v.endsWith("”")))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** 分隔符检测：tab 优先（Excel 粘贴），其次半角逗号，再次全角逗号
 * @param {string} headerLine
 * @returns {string}
 */
function detectDelimiter(headerLine: string): string {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(",")) return ",";
  if (headerLine.includes("，")) return "，";
  return "\t";
}

/** 引号感知切分：遇 " 进入引号态，"" 为转义双引号，delimiter 在引号外才切分（O-11）
 * @param {unknown} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function splitRow(line: unknown, delimiter: string): string[] {
  const s = String(line ?? "");
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 1; // 跳过转义引号第二个
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c: any) => stripQuotes(c));
}

/**
 * 解析粘贴文本。
 * @param {string} text 粘贴的表格文本（表头行 + 数据行）
 * @param {{today?: string}} [opts] 日期缺省值（YYYY-MM-DD）
 * @returns {{records: Array<{date: string, sampleId: string, system: string, contentParts: string[], fields: import("./types.ts").MetricField[]}>, errors: Array<{line: number, reason: string}>, summary: {rows: number, records: number, points: number, errorRows: number}}}
 */
export function parseMetricTable(text: string, opts: {today?: string}  = {}): {records: Array<{date: string, sampleId: string, system: string, contentParts: string[], fields: import("./types.ts").MetricField[]}>, errors: Array<{line: number, reason: string}>, summary: {rows: number, records: number, points: number, errorRows: number}} {
  const today = DATE_RE.test(opts?.today || "") ? opts.today : new Date().toISOString().slice(0, 10);
  const lines = String(text ?? "").split(/\r?\n/).filter((l: any) => l.trim() !== "");
  /** @type {Array<{date: string, sampleId: string, system: string, contentParts: string[], fields: import("./types.ts").MetricField[]}>} */
  const records: Array<{date: string, sampleId: string, system: string, contentParts: string[], fields: import("./types.ts").MetricField[]}> = [];
  /** @type {Array<{line: number, reason: string}>} */
  const errors = [];
  if (lines.length < 2) {
    return { records, errors: [{ line: 0, reason: "需要表头行 + 至少一行数据" }], summary: { rows: 0, records: 0, points: 0, errorRows: 1 } };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitRow(lines[0], delimiter);

  // 列识别：date / sampleId / system / content / temp / 指标列 / 未知列
  const colType = [];
  const colUnit = [];
  for (const raw of headers) {
    const { base, unitHint } = headerInfo(raw);
    let type = "field"; // 未知列默认进 fields
    if (COL.date.test(base)) type = "date";
    else if (COL.sampleId.test(base)) type = "sampleId";
    else if (COL.system.test(base)) type = "system";
    else if (COL.content.test(base)) type = "content";
    else if (COL.temp.test(base)) type = "temp";
    else if (METRIC_DEFS.some((def: any) => def.keyRe.test(base))) type = "metric";
    colType.push(type);
    colUnit.push(unitHint);
  }

  // 分组：同 (date, sampleId) 合并为一条记录
  const groups = new Map();
  let rows = 0;

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 物理行号（表头为第 1 行）
    const cells = splitRow(lines[i], delimiter);
    if (cells.every((c: any) => c === "")) continue;
    rows += 1;

    // 日期
    let date = null;
    let dateInvalid = false;
    for (let j = 0; j < colType.length; j++) {
      if (colType[j] === "date" && cells[j]) {
        const v = cells[j].trim();
        if (DATE_RE.test(v)) date = v;
        else {
          dateInvalid = true;
          errors.push({ line: lineNo, reason: `日期格式错误: ${v}（应为 YYYY-MM-DD）` });
        }
        break;
      }
    }
    if (dateInvalid) continue; // 日期格式错的整行跳过
    if (date === null) date = today; // 无日期列或日期列空 → 缺省今天

    // 样品号 / 体系 / 备注
    let sampleId = "";
    let system = "";
    const contentParts = [];
    // 温度列（取第一个非空）
    let tempK = null;
    for (let j = 0; j < colType.length; j++) {
      const v = cells[j] ? cells[j].trim() : "";
      if (!v) continue;
      if (colType[j] === "sampleId") sampleId = v;
      else if (colType[j] === "system") system = v;
      else if (colType[j] === "content") contentParts.push(v);
      else if (colType[j] === "temp" && tempK == null) {
        const t = parseTempValue(v, colUnit[j]);
        if (t == null) {
          errors.push({ line: lineNo, reason: `温度无法解析: ${v}` });
        } else {
          tempK = t;
        }
      }
    }

    // 指标列 + 未知列 → fields
    const fields = [];
    let rowHasValue = false;
    for (let j = 0; j < colType.length; j++) {
      const v = cells[j] ? cells[j].trim() : "";
      if (!v) continue;
      if (colType[j] === "metric") {
        const headerBase = headerInfo(headers[j]).base;
        if (!isBareNumber(v)) {
          // 非纯数字：以数字开头的值视为带单位/描述（'0.38 mV/K'），parseValueUnit 自行解析；否则报错
          if (/^[-+]?\d/.test(v)) {
            fields.push({ k: tempK != null ? `${headerBase}@${tempK}K` : headerBase, v });
            rowHasValue = true;
          } else {
            errors.push({ line: lineNo, reason: `指标值非数字: ${headerBase}=${v}` });
          }
        } else if (Number.isFinite(Number(v))) {
          const withUnit = colUnit[j] ? `${v} ${colUnit[j]}` : v;
          fields.push({ k: tempK != null ? `${headerBase}@${tempK}K` : headerBase, v: withUnit });
          rowHasValue = true;
        } else {
          errors.push({ line: lineNo, reason: `指标值非数字: ${headerBase}=${v}` });
        }
      } else if (colType[j] === "field") {
        fields.push({ k: headerInfo(headers[j]).base, v });
        rowHasValue = true;
      }
    }
    if (!rowHasValue && fields.length === 0) {
      // 整行没有有效数据（仅日期/样品信息行）也跳过，避免空记录
      continue;
    }

    const key = `${date}|${sampleId}`;
    if (!groups.has(key)) {
      groups.set(key, { date, sampleId, system, contentParts, fields: [] });
    }
    const g = groups.get(key);
    if (!g.system && system) g.system = system;
    g.fields.push(...fields);
  }

  const mergedRecords = [...groups.values()];
  const points = mergedRecords.reduce((n: any, r: any) => n + r.fields.length, 0);
  return {
    records: mergedRecords,
    errors,
    summary: { rows, records: mergedRecords.length, points, errorRows: errors.length },
  };
}
