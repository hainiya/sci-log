var CN_RE = "(?:of|\u8FBE\u5230|\u4E3A|\u662F|[:=])?";
var METRIC_DEFS = [
  {
    key: "zt",
    label: "\u70ED\u7535\u4F18\u503C ZT",
    unit: "",
    unitNorm: { base: "", variants: { "": 1 } },
    // ZT 无量纲：无单位是合法态（非空心），其他指标无单位才是 unit null
    keyRe: /ZT|热电优值|figure of merit/i,
    valueRe: new RegExp(`(?:^|[^A-Za-z0-9])ZT\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  },
  {
    key: "pf",
    label: "\u529F\u7387\u56E0\u5B50 PF",
    unit: "\u03BCW\xB7cm\u207B\xB9\xB7K\u207B\xB2",
    unitNorm: { base: "\u03BCW\xB7cm\u207B\xB9\xB7K\u207B\xB2", variants: { "\u03BCW\xB7cm\u207B\xB9\xB7K\u207B\xB2": 1, "mW/(m\xB7K\xB2)": 10, "mW/mK\xB2": 10 } },
    keyRe: /功率因子|power factor|PF/i,
    valueRe: new RegExp(`\u529F\u7387\u56E0\u5B50\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])PF\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  },
  {
    key: "sigma",
    label: "\u7535\u5BFC\u7387 \u03C3",
    unit: "S\xB7cm\u207B\xB9",
    unitNorm: { base: "S\xB7cm\u207B\xB9", variants: { "S\xB7cm\u207B\xB9": 1, "S/cm": 1, "S/m": 0.01, "mS/cm": 1e-3 } },
    keyRe: /电导率|conductivity|σ/i,
    valueRe: new RegExp(`\u7535\u5BFC\u7387\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])\u03C3\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  },
  {
    key: "seebeck",
    label: "Seebeck \u7CFB\u6570 S",
    unit: "\u03BCV\xB7K\u207B\xB9",
    unitNorm: { base: "\u03BCV\xB7K\u207B\xB9", variants: { "\u03BCV\xB7K\u207B\xB9": 1, "\u03BCV/K": 1, "mV/K": 1e3, "V/K": 1e6 } },
    keyRe: /seebeck|塞贝克/i,
    valueRe: new RegExp(`seebeck\\s*\u7CFB\u6570?\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|\u585E\u8D1D\u514B\\s*\u7CFB\u6570?\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  },
  {
    key: "kappa",
    label: "\u70ED\u5BFC\u7387 \u03BA",
    unit: "W\xB7m\u207B\xB9\xB7K\u207B\xB9",
    unitNorm: { base: "W\xB7m\u207B\xB9\xB7K\u207B\xB9", variants: { "W\xB7m\u207B\xB9\xB7K\u207B\xB9": 1, "W/(m\xB7K)": 1, "W/mK": 1, "W/m\xB7K": 1, "mW/(cm\xB7K)": 0.1, "mW/cmK": 0.1, "W/(cm\xB7K)": 100 } },
    keyRe: /热导率|thermal conductivity|κ/i,
    valueRe: new RegExp(`\u70ED\u5BFC\u7387\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])\u03BA\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  },
  {
    key: "n",
    label: "\u8F7D\u6D41\u5B50\u6D53\u5EA6 n",
    unit: "cm\u207B\xB3",
    unitNorm: { base: "cm\u207B\xB3", variants: { "cm\u207B\xB3": 1, "/cm\xB3": 1, "cm-3": 1 } },
    keyRe: /载流子浓度|carrier concentration/i,
    valueRe: new RegExp(`\u8F7D\u6D41\u5B50\u6D53\u5EA6\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?\\d+)?)`, "i")
  },
  {
    key: "mu",
    label: "\u8FC1\u79FB\u7387 \u03BC",
    unit: "cm\xB2\xB7V\u207B\xB9\xB7s\u207B\xB9",
    unitNorm: { base: "cm\xB2\xB7V\u207B\xB9\xB7s\u207B\xB9", variants: { "cm\xB2\xB7V\u207B\xB9\xB7s\u207B\xB9": 1, "m\xB2/(V\xB7s)": 1e4, "m\xB2/V\xB7s": 1e4 } },
    keyRe: /迁移率|mobility/i,
    valueRe: new RegExp(`\u8FC1\u79FB\u7387\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  }
];
var BLACKLIST_KEYS = [
  "\u9000\u706B\u6E29\u5EA6",
  "\u751F\u957F\u6E29\u5EA6",
  "\u4FDD\u6E29\u6E29\u5EA6",
  "\u5347\u6E29\u901F\u7387",
  "\u964D\u6E29\u901F\u7387",
  "\u4FDD\u6E29\u65F6\u95F4",
  "\u5347\u6E29\u65F6\u95F4",
  "\u964D\u6E29\u65F6\u95F4",
  "\u538B\u529B",
  "\u6C14\u6C1B",
  "\u7535\u6D41",
  "\u7535\u538B",
  "\u8F6C\u901F",
  "\u52A0\u70ED\u529F\u7387",
  "\u5C04\u9891\u529F\u7387",
  "\u5347\u6E29",
  "\u4FDD\u6E29",
  "\u51B7\u5374",
  "\u5F2F\u6298\u6B21\u6570",
  "\u5FAA\u73AF\u6B21\u6570"
];
var CHANGE_WORDS = ["\u8870\u51CF\u7387", "\u53D8\u5316\u7387", "\u589E\u5E45", "\u964D\u5E45", "\u8870\u51CF\u91CF", "\u53D8\u5316\u91CF", "\u8870\u51CF", "\u589E\u52A0", "\u964D\u4F4E", "\u63D0\u5347\u5E45\u5EA6"];
var SYSTEM_DEFS = [
  { name: "SnSe", aliases: [/\bSnSe\b/i, /硒化锡/i, /硒化亚锡/i] },
  { name: "SnS\u2082", aliases: [/\bSnS[₂2]\b/i, /二硫化锡/i] },
  { name: "SnS", aliases: [/\bSnS\b(?![\d₂])/i, /硫化锡/i, /硫化亚锡/i] },
  { name: "Bi\u2082Te\u2083", aliases: [/\bBi2?Te3\b/i, /Bi₂Te₃/i, /碲化铋/i] },
  { name: "PbSe", aliases: [/\bPbSe\b/i, /硒化铅/i] },
  { name: "MnTe", aliases: [/\bMnTe\b/i, /碲化锰/i] },
  { name: "Cu\u2082Se", aliases: [/\bCu2?Se\b/i, /Cu₂Se/i, /硒化亚铜/i] },
  { name: "Ag\u2082Se", aliases: [/\bAg2?Se\b/i, /Ag₂Se/i] },
  { name: "PEDOT/\u5BFC\u7535\u805A\u5408\u7269", aliases: [/\bPEDOT/i, /导电聚合物/i, /polymer/i, /PEDOT:PSS/i] },
  { name: "\u78B3\u6750\u6599", aliases: [/碳纳米管/i, /\bCNT\b/i, /石墨烯/i, /\bGraphene\b/i] },
  { name: "\u65E0\u673A/\u6709\u673A\u590D\u5408", aliases: [/杂化/i, /复合/i, /hybrid/i, /composite/i] }
];
var SYSTEM_NAMES = SYSTEM_DEFS.map((s) => s.name);
var UNLABELED = "\u672A\u6807\u6CE8";
function normalizeFields(fields) {
  if (Array.isArray(fields)) {
    const out = {};
    for (const f of fields) {
      if (f && typeof f.k === "string" && f.k.trim()) out[f.k.trim()] = String(f.v ?? "").trim();
    }
    return out;
  }
  if (fields && typeof fields === "object") return fields;
  return {};
}
function normalizeSci(str) {
  return String(str || "").replace(/×\s*10\s*\^/gi, "e").replace(/[xX]\s*10\s*\^/gi, "e").replace(/\*\s*10\s*\^/gi, "e");
}
function entryDate(entry) {
  const raw = entry?.createdAt || entry?.date;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return { ts: d.getTime(), date: fmtDate(d) };
    }
  }
  return { ts: 0, date: String(entry?.date || "") };
}
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function matchTemp(str) {
  const k = str.match(/(?:^|[^\d.])@?\s*(\d{2,4})\s*°?\s*K\b/i);
  if (k) return { temp: Number(k[1]), unit: "K" };
  const c = str.match(/(-?\d{1,4})\s*(?:°\s*C|℃)(?![A-Za-z])/i) || str.match(/(-?\d{1,4})\s*摄氏度/i);
  if (c) return { temp: Math.round(Number(c[1]) + 273.15), unit: "K" };
  return null;
}
function extractTemp(str, atIndex) {
  if (typeof str !== "string" || !str) return null;
  if (atIndex != null) {
    const lineEndIdx = str.indexOf("\n", atIndex);
    const rightEnd = lineEndIdx === -1 ? str.length : lineEndIdx;
    const right = str.slice(atIndex, Math.min(rightEnd, atIndex + 40));
    const t = matchTemp(right);
    if (t) return t;
    const lineStartIdx = str.lastIndexOf("\n", atIndex - 1);
    const leftStart = Math.max(lineStartIdx + 1, atIndex - 40);
    return matchTemp(str.slice(leftStart, atIndex));
  }
  return matchTemp(str.slice(0, 200));
}
function parseValueUnit(str, metric, anchor) {
  const raw = String(str ?? "").trim();
  const norm = normalizeSci(raw);
  let numStr = null;
  if (anchor) {
    const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchored = norm.match(new RegExp(`${esc}\\s*[=:\uFF1A]?\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`));
    if (anchored) numStr = anchored[1];
  }
  if (numStr == null) {
    const withoutTemp = norm.replace(/\d+(?:\.\d+)?\s*(?:°?\s*K|°\s*C|℃)(?![A-Za-z])/gi, "");
    const nm = withoutTemp.match(/(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!nm) return null;
    numStr = nm[1];
  }
  const num = parseFloat(numStr);
  if (!Number.isFinite(num)) return null;
  const variants = metric?.unitNorm?.variants || {};
  const keys = Object.keys(variants).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (norm.includes(k)) return { value: Number((num * variants[k]).toPrecision(12)), unit: k, raw };
  }
  return { value: Number(num.toPrecision(12)), unit: null, raw };
}
function recordLevelTemp(fieldsObj) {
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    if (!/^(测试温度|温度)$/.test(String(k).trim())) continue;
    const t = extractTemp(String(v ?? ""), null);
    if (t) return t;
  }
  return null;
}
function detectSystem(entry, fieldsObj) {
  const explicit = entry?.system;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const parts = [];
  for (const v of Object.values(fieldsObj || {})) parts.push(String(v ?? ""));
  if (entry?.data) parts.push(String(entry.data));
  if (entry?.content) {
    for (const sent of String(entry.content).split(/[。；;\n]+/)) {
      const s = sent.trim();
      if (!s) continue;
      if (/对比|比较|文献|参考|参照|类似|相似|基于|综述|查阅|阅读|相比|借鉴|论文|文章/.test(s)) continue;
      parts.push(s);
    }
  }
  const text = parts.join("\n");
  for (const sys of SYSTEM_DEFS) {
    if (sys.aliases.some((re) => {
      re.lastIndex = 0;
      return re.test(text);
    })) return sys.name;
  }
  return UNLABELED;
}
function numFromMatch(m) {
  if (!m) return null;
  for (let i = m.length - 1; i >= 1; i--) {
    const s = m[i];
    if (typeof s === "string" && /^[0-9]/.test(s)) {
      const n = parseFloat(s);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function summarize(str, max) {
  const s = String(str || "").trim().replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}
function pushPoint(series, metric, system, point) {
  let m = series[metric.key];
  if (!m) {
    m = { key: metric.key, label: metric.label, unit: metric.unit, systems: {}, count: 0 };
    series[metric.key] = m;
  }
  if (!m.systems[system]) m.systems[system] = [];
  m.systems[system].push(point);
  m.count += 1;
}
function buildMetricsSeries(worklogEntries = [], literatureEntries = []) {
  const series = {};
  const withMetrics = /* @__PURE__ */ new Set();
  const unrecognized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const e of worklogEntries || []) {
    const fieldsObj = normalizeFields(e?.fields);
    const system = detectSystem(e, fieldsObj);
    const { ts, date } = entryDate(e);
    const recTemp = recordLevelTemp(fieldsObj);
    const isUnlabeled = system === UNLABELED;
    const addPoint = (metric, point) => {
      const dk = `${e?.id || ""}|${metric.key}|${point.temp ?? ""}|${point.tempUnit ?? ""}|${point.value}`;
      if (seen.has(dk)) return;
      seen.add(dk);
      if (e?.id) withMetrics.add(e.id);
      if (isUnlabeled) return;
      pushPoint(series, metric, system, point);
    };
    const fieldList = Array.isArray(e?.fields) ? e.fields.map((f) => ({ k: String(f?.k ?? "").trim(), v: String(f?.v ?? "").trim() })).filter((f) => f.k && f.v) : Object.entries(fieldsObj).map(([k, v]) => ({ k: k.trim(), v: String(v ?? "").trim() })).filter((f) => f.k && f.v);
    for (const { k, v } of fieldList) {
      const val = v;
      let hit = null;
      for (const metric of METRIC_DEFS) {
        if (metric.keyRe.test(k)) {
          hit = metric;
          break;
        }
      }
      if (hit) {
        if (CHANGE_WORDS.some((w) => k.includes(w))) {
          continue;
        }
        const pv = parseValueUnit(val, hit, k);
        if (pv) {
          let temp = null;
          let tempUnit = null;
          if (recTemp) {
            temp = recTemp.temp;
            tempUnit = recTemp.unit;
          } else {
            const t = extractTemp(`${k} ${val}`, null);
            if (t) {
              temp = t.temp;
              tempUnit = t.unit;
            }
          }
          addPoint(hit, {
            date,
            ts,
            value: pv.value,
            raw: pv.raw,
            unit: pv.unit,
            temp,
            tempUnit,
            entryId: e?.id || null,
            sampleId: e?.sampleId || null
          });
        }
        continue;
      }
      if (BLACKLIST_KEYS.some((kw) => kw.toLowerCase() === k.toLowerCase())) continue;
    }
    if (e?.data && typeof e.data === "string") {
      for (const metric of METRIC_DEFS) {
        const re = new RegExp(metric.valueRe.source, metric.valueRe.flags.includes("g") ? metric.valueRe.flags : `${metric.valueRe.flags}g`);
        let m;
        while ((m = re.exec(e.data)) !== null) {
          if (numFromMatch(m) == null) continue;
          const tail = e.data.slice(m.index + m[0].length);
          const unitTok = (tail.match(/^\s*([^\s,，;；。、]+)/) || ["", ""])[1] || "";
          const pv = parseValueUnit(`${m[0]}${unitTok}`, metric);
          if (!pv) continue;
          let temp = null;
          let tempUnit = null;
          if (recTemp) {
            temp = recTemp.temp;
            tempUnit = recTemp.unit;
          } else {
            const t = extractTemp(e.data, m.index + m[0].length);
            if (t) {
              temp = t.temp;
              tempUnit = t.unit;
            }
          }
          addPoint(metric, {
            date,
            ts,
            value: pv.value,
            raw: pv.raw,
            unit: pv.unit,
            temp,
            tempUnit,
            entryId: e?.id || null,
            sampleId: e?.sampleId || null
          });
        }
      }
    }
    if (isUnlabeled && withMetrics.has(e?.id)) {
      unrecognized.push({
        entryId: e?.id || null,
        date,
        sampleId: e?.sampleId || null,
        content: summarize(e?.content, 60)
      });
    }
  }
  const metrics = {};
  const order = [];
  for (const def of METRIC_DEFS) {
    const m = series[def.key];
    if (!m) continue;
    for (const sys of Object.keys(m.systems)) {
      m.systems[sys].sort((a, b) => a.ts - b.ts);
    }
    metrics[def.key] = m;
    order.push(def.key);
  }
  const baseline = extractLiteratureBaseline(literatureEntries);
  return {
    ok: true,
    metrics,
    order,
    baseline,
    totals: {
      entries: (worklogEntries || []).length,
      withMetrics: withMetrics.size,
      unrecognized
    }
  };
}
function extractLiteratureBaseline(literatureEntries = []) {
  const baseline = {};
  const RECORD_CTX = /最高|记录|record|peak|state[- ]of[- ]the[- ]art|可达|up to|高达|创|突破|最优|benchmark|world/i;
  for (const metric of METRIC_DEFS) {
    let best = null;
    let bestTemp = null;
    let bestTempUnit = null;
    for (const e of literatureEntries || []) {
      const corpus = `${e?.title || ""} ${e?.abstractNote || ""} ${e?.abstract || ""} ${e?.abstractEn || ""}`;
      const m = metric.valueRe.exec(corpus);
      if (!m) continue;
      const num = numFromMatch(m);
      if (num == null) continue;
      const snippet = corpus.slice(Math.max(0, m.index - 40), m.index + 60);
      if (RECORD_CTX.test(snippet)) {
        if (best == null || num > best) {
          best = num;
          const tK = snippet.match(/@\s*(\d{2,4})\s*K\b/i) || snippet.match(/\bat\s+(\d{2,4})\s*K\b/i);
          const tC = snippet.match(/@\s*(-?\d{1,4})\s*(?:°\s*C|℃)(?![A-Za-z])/i) || snippet.match(/\bat\s+(-?\d{1,4})\s*(?:°\s*C|℃)(?![A-Za-z])/i);
          if (tK) {
            bestTemp = Number(tK[1]);
            bestTempUnit = "K";
          } else if (tC) {
            bestTemp = Math.round(Number(tC[1]) + 273.15);
            bestTempUnit = "K";
          }
        }
      }
    }
    baseline[metric.key] = best == null ? null : { value: best, temp: bestTemp, tempUnit: bestTempUnit };
  }
  return baseline;
}
function filterSeries(data, opts = {}) {
  const { metric, system, temp, from, to } = opts || {};
  const metrics = {};
  for (const [mk, m] of Object.entries(data?.metrics || {})) {
    if (metric && mk !== metric) continue;
    const systems = {};
    for (const [sk, pts] of Object.entries(m.systems || {})) {
      if (system && sk !== system) continue;
      const filtered = pts.filter((p) => {
        if (temp != null && p.temp !== Number(temp)) return false;
        if (from) {
          const t = new Date(from).getTime();
          if (!Number.isNaN(t) && p.ts < t) return false;
        }
        if (to) {
          const t = new Date(to).getTime();
          if (!Number.isNaN(t) && p.ts > t) return false;
        }
        return true;
      });
      if (filtered.length) systems[sk] = filtered;
    }
    if (Object.keys(systems).length) {
      const count = Object.values(systems).reduce((n, pts) => n + pts.length, 0);
      metrics[mk] = { ...m, systems, count };
    }
  }
  return { metrics, order: data?.order || [], baseline: data?.baseline || {}, totals: data?.totals || {} };
}

export { METRIC_DEFS, SYSTEM_NAMES, buildMetricsSeries, extractLiteratureBaseline, filterSeries };
