/**
 * 指标时间线提取（P1→深化）：从实验记录抽取材料性能数值，按材料体系分组、按时间排序，
 * 并从文献库抽取 record/peak 语境下的基准值。
 *
 * 设计要点（数据治理深化，规格 docs/superpowers/specs/2026-08-06-metrics-deepening-design.md 一、五、七章）：
 * - 纯函数、无 LLM、无外部依赖，便于单元测试与 esbuild 打包。
 * - fields 存储形态兼容：triage 落库为数组 [{k, v}]，早期/手动写入可能为对象 {k: v}，
 *   这里统一归一化为对象。
 * - 字段判定顺序：① 指标白名单 keyRe 命中 → 取数并单位归一化（优先于黑名单，保护「功率因子」类字段）；
 *   ② 工艺黑名单（完全匹配，大小写不敏感）→ 排除；③ 其余字段跳过，不参与任何提取。
 * - entry.data 兜底：valueRe 全局匹配，一条记录同一指标可产出多个点（多温度点全抽）；
 *   content 完全不参与数字提取（避免「3 炉都失败了」的裸数字误收）。
 * - 单位归一化：每指标 unitNorm 表（base + variants 系数）。值串解析数值与单位 token，
 *   换算成功 → value 归一化、unit 保留解析到的原始单位串（tooltip 溯源）；
 *   解析不到单位 → unit: null（空心点、不连线、不参与基准比较）。
 * - 测试温度：① 字段名含「测试温度/温度」的记录级值优先；② 指标值附近 ±40 字窗口（值后优先）；
 *   温度统一归一为整数 K（550°C → 823K）：K/°C 混用会把同一物理温度拆成不相交的点，
 *   归一后筛选/连线/去重全部按数值比较，下游零改动且同温自动合并。
 * - 体系识别：entry.system 显式字段优先；兜底 SYSTEM_DEFS 扫 fields 值 + data + content（content 分句剔除引用语境句，防「与 SnSe 文献对比」误判）；
 *   识别不到 → totals.unrecognized（不进图、不计指标），供面板提示补标注。
 */

/** 规范指标字典：key 稳定、label/unit 用于面板展示、keyRe 命中字段键、valueRe 兜底 entry.data、unitNorm 单位归一化 */
// CN_RE：指标关键词与数值之间的可选连接词（"ZT of 2.5" / "功率因子 达到 2.0" / "Seebeck系数为 210" 等）
const CN_RE = '(?:of|达到|为|是|[:=])?';

export const METRIC_DEFS = [
  {
    key: 'zt',
    label: '热电优值 ZT',
    unit: '',
    unitNorm: { base: '', variants: { '': 1 } }, // ZT 无量纲：无单位是合法态（非空心），其他指标无单位才是 unit null
    keyRe: /ZT|热电优值|figure of merit/i,
    valueRe:
      new RegExp(`(?:^|[^A-Za-z0-9])ZT\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
  {
    key: 'pf',
    label: '功率因子 PF',
    unit: 'μW·cm⁻¹·K⁻²',
    unitNorm: { base: 'μW·cm⁻¹·K⁻²', variants: { 'μW·cm⁻¹·K⁻²': 1, 'mW/(m·K²)': 10, 'mW/mK²': 10 } },
    keyRe: /功率因子|power factor|PF/i,
    valueRe:
      new RegExp(`功率因子\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])PF\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
  {
    key: 'sigma',
    label: '电导率 σ',
    unit: 'S·cm⁻¹',
    unitNorm: { base: 'S·cm⁻¹', variants: { 'S·cm⁻¹': 1, 'S/cm': 1, 'S/m': 0.01, 'mS/cm': 0.001 } },
    keyRe: /电导率|conductivity|σ/i,
    valueRe:
      new RegExp(`电导率\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])σ\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
  {
    key: 'seebeck',
    label: 'Seebeck 系数 S',
    unit: 'μV·K⁻¹',
    unitNorm: { base: 'μV·K⁻¹', variants: { 'μV·K⁻¹': 1, 'μV/K': 1, 'mV/K': 1000, 'V/K': 1e6 } },
    keyRe: /seebeck|塞贝克/i,
    valueRe:
      new RegExp(`seebeck\\s*系数?\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|塞贝克\\s*系数?\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
  {
    key: 'kappa',
    label: '热导率 κ',
    unit: 'W·m⁻¹·K⁻¹',
    unitNorm: { base: 'W·m⁻¹·K⁻¹', variants: { 'W·m⁻¹·K⁻¹': 1, 'W/(m·K)': 1, 'W/mK': 1, 'W/m·K': 1, 'mW/(cm·K)': 0.1, 'mW/cmK': 0.1, 'W/(cm·K)': 100 } },
    keyRe: /热导率|thermal conductivity|κ/i,
    valueRe:
      new RegExp(`热导率\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)|(?:^|[^A-Za-z0-9])κ\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
  {
    key: 'n',
    label: '载流子浓度 n',
    unit: 'cm⁻³',
    unitNorm: { base: 'cm⁻³', variants: { 'cm⁻³': 1, '/cm³': 1, 'cm-3': 1 } },
    keyRe: /载流子浓度|carrier concentration/i,
    valueRe:
      new RegExp(`载流子浓度\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?\\d+)?)`, 'i'),
  },
  {
    key: 'mu',
    label: '迁移率 μ',
    unit: 'cm²·V⁻¹·s⁻¹',
    unitNorm: { base: 'cm²·V⁻¹·s⁻¹', variants: { 'cm²·V⁻¹·s⁻¹': 1, 'm²/(V·s)': 1e4, 'm²/V·s': 1e4 } },
    keyRe: /迁移率|mobility/i,
    valueRe: new RegExp(`迁移率\\s*${CN_RE}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
  },
];

/** 工艺参数黑名单：字段 key 完全匹配（大小写不敏感）即排除，不参与任何提取。不做包含匹配，避免误杀「测试温度」等性能上下文字段。 */
const BLACKLIST_KEYS = [
  '退火温度', '生长温度', '保温温度', '升温速率', '降温速率',
  '保温时间', '升温时间', '降温时间', '压力', '气氛', '电流', '电压',
  '转速', '加热功率', '射频功率', '升温', '保温', '冷却',
  '弯折次数', '循环次数',
];

/** 变化量词排除：字段名含这些词时即使 keyRe 命中也不算指标值（「Seebeck系数衰减率 2.6%」是变化量，不是 Seebeck 值） */
const CHANGE_WORDS = ['衰减率', '变化率', '增幅', '降幅', '衰减量', '变化量', '衰减', '增加', '降低', '提升幅度'];

/** 材料体系识别兜底：命中即归为该体系。顺序即优先级（先具体后泛化）。仅扫 fields 值 + data，不扫 content。 */
const SYSTEM_DEFS = [
  { name: 'SnSe', aliases: [/\bSnSe\b/i, /硒化锡/i, /硒化亚锡/i] },
  { name: 'SnS₂', aliases: [/\bSnS[₂2]\b/i, /二硫化锡/i] },
  { name: 'SnS', aliases: [/\bSnS\b(?![\d₂])/i, /硫化锡/i, /硫化亚锡/i] },
  { name: 'Bi₂Te₃', aliases: [/\bBi2?Te3\b/i, /Bi₂Te₃/i, /碲化铋/i] },
  { name: 'PbSe', aliases: [/\bPbSe\b/i, /硒化铅/i] },
  { name: 'MnTe', aliases: [/\bMnTe\b/i, /碲化锰/i] },
  { name: 'Cu₂Se', aliases: [/\bCu2?Se\b/i, /Cu₂Se/i, /硒化亚铜/i] },
  { name: 'Ag₂Se', aliases: [/\bAg2?Se\b/i, /Ag₂Se/i] },
  { name: 'PEDOT/导电聚合物', aliases: [/\bPEDOT/i, /导电聚合物/i, /polymer/i, /PEDOT:PSS/i] },
  { name: '碳材料', aliases: [/碳纳米管/i, /\bCNT\b/i, /石墨烯/i, /\bGraphene\b/i] },
  { name: '无机/有机复合', aliases: [/杂化/i, /复合/i, /hybrid/i, /composite/i] },
];

const UNLABELED = '未标注';

function normalizeFields(fields) {
  if (Array.isArray(fields)) {
    const out = {};
    for (const f of fields) {
      if (f && typeof f.k === 'string' && f.k.trim()) out[f.k.trim()] = String(f.v ?? '').trim();
    }
    return out;
  }
  if (fields && typeof fields === 'object') return fields;
  return {};
}

/** 科学计数法归一：1.2×10^19 / 1.2x10^19 / 1.2*10^19 / 1.2e19 / 1.2E19 统一可被 parseFloat 直接解析 */
function normalizeSci(str) {
  return String(str || '')
    .replace(/×\s*10\s*\^/gi, 'e')
    .replace(/[xX]\s*10\s*\^/gi, 'e')
    .replace(/\*\s*10\s*\^/gi, 'e');
}

function entryDate(entry) {
  const raw = entry?.createdAt || entry?.date;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return { ts: d.getTime(), date: fmtDate(d) };
    }
  }
  return { ts: 0, date: String(entry?.date || '') };
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 在文本片段中匹配测试温度并统一归一为整数 K（550°C → 823K）。数字前不允许是数字或小数点，避免「38 mV/K」被误抽为 38K。
 * 归一理由：K/°C 双标度混存会让同一物理温度在筛选（精确匹配）与连线（temp 相等）中互相不可见。 */
function matchTemp(str) {
  const k = str.match(/(?:^|[^\d.])@?\s*(\d{2,4})\s*°?\s*K\b/i);
  if (k) return { temp: Number(k[1]), unit: 'K' };
  const c = str.match(/(-?\d{1,4})\s*(?:°\s*C|℃)(?![A-Za-z])/i) || str.match(/(-?\d{1,4})\s*摄氏度/i);
  if (c) return { temp: Math.round(Number(c[1]) + 273.15), unit: 'K' };
  return null;
}

/** 在 atIndex 附近 ±40 字窗口内抽取测试温度；优先值之后的窗口（避免「ZT=0.9 @ 823K，ZT=0.5 @ 300K」第二个点误取 823K）。
 * atIndex 约定为数值末尾（匹配 m[0] 可能含前导换行/标点，不能直接用 exec.index）。
 * 窗口截断在行边界（\n）：data 多行文本时不同行的温度不串扰（「电导率=620S/m」不会误取上一行「ZT=0.7@823K」）。 */
function extractTemp(str, atIndex) {
  if (typeof str !== 'string' || !str) return null;
  if (atIndex != null) {
    const lineEndIdx = str.indexOf('\n', atIndex);
    const rightEnd = lineEndIdx === -1 ? str.length : lineEndIdx;
    const right = str.slice(atIndex, Math.min(rightEnd, atIndex + 40));
    const t = matchTemp(right);
    if (t) return t;
    const lineStartIdx = str.lastIndexOf('\n', atIndex - 1);
    const leftStart = Math.max(lineStartIdx + 1, atIndex - 40);
    // left 只查值前（右侧已由 right 窗口覆盖，避免二次命中旧温度）
    return matchTemp(str.slice(leftStart, atIndex));
  }
  return matchTemp(str.slice(0, 200));
}

/**
 * 从值字符串提取数值并做单位归一化。
 * @param {string} str 字段值或 data 匹配片段 + 单位 token
 * @param {{unitNorm?: {base?: string, variants?: Record<string, number>}}} metric
 * @param {string} [anchor] 关键词锚（fields 路径传字段名）：优先取锚之后紧邻的数值，
 *   避免描述性前缀数字（“823K 时 ZT 1.2”取 823、“样品3 的 ZT 2.1”取 3）静默入库；
 *   锚未命中（如后缀形态“1.2（ZT）”）时回退取第一个数字，与 data 路径行为一致。
 * @returns {{value: number, unit: (string|null), raw: string}|null}
 *   unit：换算成功时保留解析到的原始单位串（供 tooltip 溯源）；解析不到单位才是 null（空心点）。
 */
function parseValueUnit(str, metric, anchor) {
  const raw = String(str ?? '').trim();
  const norm = normalizeSci(raw);
  let numStr = null;
  if (anchor) {
    const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anchored = norm.match(new RegExp(`${esc}\\s*[=:：]?\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`));
    if (anchored) numStr = anchored[1];
  }
  if (numStr == null) {
    // 无锚时先剔除温度结构（823K / 550°C / 300 K）：描述性值串「823K 时测得 1.2」不再把温度当指标值；
    // 单位换算 token 不受影响（mW/mK² 的 K 前无数字）。
    const withoutTemp = norm.replace(/\d+(?:\.\d+)?\s*(?:°?\s*K|°\s*C|℃)(?![A-Za-z])/gi, '');
    const nm = withoutTemp.match(/(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!nm) return null;
    numStr = nm[1];
  }
  const num = parseFloat(numStr);
  if (!Number.isFinite(num)) return null;
  const variants = metric?.unitNorm?.variants || {};
  const keys = Object.keys(variants).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    // IEEE754 长尾规范化（0.8 × 0.1 = 0.08000000000000002 → 0.08）
    if (norm.includes(k)) return { value: Number((num * variants[k]).toPrecision(12)), unit: k, raw };
  }
  return { value: Number(num.toPrecision(12)), unit: null, raw };
}

/** 记录级测试温度：字段 key 精确为「测试温度」或「温度」才收（避免烧结温度/真空退火温度等含「温度」的工艺字段被当作测试条件） */
function recordLevelTemp(fieldsObj) {
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    if (!/^(测试温度|温度)$/.test(String(k).trim())) continue;
    const t = extractTemp(String(v ?? ''), null);
    if (t) return t;
  }
  return null;
}

/** 体系识别：entry.system 显式字段优先；兜底 SYSTEM_DEFS 扫 fields 值 + data + content。
 * content 按 [。；;\n] 分句，剔除引用语境句（对比/文献/参考/综述…），再参与匹配——
 * 「配置Bi2Te3单晶生长」可识别，「与 SnSe 文献对比，本炉失败」不误判。 */
function detectSystem(entry, fieldsObj) {
  const explicit = entry?.system;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const parts = [];
  for (const v of Object.values(fieldsObj || {})) parts.push(String(v ?? ''));
  if (entry?.data) parts.push(String(entry.data));
  if (entry?.content) {
    for (const sent of String(entry.content).split(/[。；;\n]+/)) {
      const s = sent.trim();
      if (!s) continue;
      if (/对比|比较|文献|参考|参照|类似|相似|基于|综述|查阅|阅读|相比|借鉴|论文|文章/.test(s)) continue;
      parts.push(s);
    }
  }
  const text = parts.join('\n');
  for (const sys of SYSTEM_DEFS) {
    if (sys.aliases.some((re) => { re.lastIndex = 0; return re.test(text); })) return sys.name;
  }
  return UNLABELED;
}

/** 从正则匹配结果取最后一个数值捕获组（支持多分支 alternation） */
function numFromMatch(m) {
  if (!m) return null;
  for (let i = m.length - 1; i >= 1; i--) {
    const s = m[i];
    if (typeof s === 'string' && /^[0-9]/.test(s)) {
      const n = parseFloat(s);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function summarize(str, max) {
  const s = String(str || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
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

/**
 * 核心：从实验记录构建指标时间序列。
 * @returns {{ ok:true, metrics:object, order:string[], baseline:object,
 *             totals:{entries:number, withMetrics:number, unrecognized:Array<{entryId, date, sampleId, content}>} }}
 */
export function buildMetricsSeries(worklogEntries = [], literatureEntries = []) {
  const series = {};
  const withMetrics = new Set();
  const unrecognized = [];
  const seen = new Set();

  for (const e of worklogEntries || []) {
    const fieldsObj = normalizeFields(e?.fields);
    const system = detectSystem(e, fieldsObj);
    const { ts, date } = entryDate(e);
    const recTemp = recordLevelTemp(fieldsObj);
    const isUnlabeled = system === UNLABELED;

    // 去重：同 entryId + 指标 + 温度 + 值 只收一个（fields 与 data 双抽、重复书写均不重复计）
    const addPoint = (metric, point) => {
      const dk = `${e?.id || ''}|${metric.key}|${point.temp ?? ''}|${point.tempUnit ?? ''}|${point.value}`;
      if (seen.has(dk)) return;
      seen.add(dk);
      if (e?.id) withMetrics.add(e.id); // 有指标点即计入（含未识别体系，供 unrecognized 判定）
      if (isUnlabeled) return; // 未识别体系：不进图、不计指标
      pushPoint(series, metric, system, point);
    };

    // ① fields 逐字段判定：白名单 keyRe 命中 → 取数换算（优先于黑名单）；黑名单命中 → 排除；其余字段跳过
    // 直接遍历原始 fields（数组形态保序，同 key 多值不互相覆盖——多温度点全抽的 fields 形态，如两个 ZT 字段）
    const fieldList = Array.isArray(e?.fields)
      ? e.fields.map((f) => ({ k: String(f?.k ?? '').trim(), v: String(f?.v ?? '').trim() })).filter((f) => f.k && f.v)
      : Object.entries(fieldsObj).map(([k, v]) => ({ k: k.trim(), v: String(v ?? '').trim() })).filter((f) => f.k && f.v);
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
        // 变化量词排除：字段名含衰减率/变化率等 → 跳过（值不是指标本身）
        if (CHANGE_WORDS.some((w) => k.includes(w))) {
          continue;
        }
        // 传字段名作锚：优先取「ZT=1.2」形态紧邻数值，防描述性前缀数字（823K 时 ZT 1.2）误收
        const pv = parseValueUnit(val, hit, k);
        if (pv) {
          let temp = null;
          let tempUnit = null;
          if (recTemp) {
            temp = recTemp.temp;
            tempUnit = recTemp.unit;
          } else {
            // 键名可能带温度（巡检提取「ZT@823K=0.7」形态）：键 + 值一起扫，避免温度丢失
            const t = extractTemp(`${k} ${val}`, null);
            if (t) {
              temp = t.temp;
              tempUnit = t.unit;
            }
          }
          addPoint(hit, {
            date, ts, value: pv.value, raw: pv.raw, unit: pv.unit,
            temp, tempUnit, entryId: e?.id || null, sampleId: e?.sampleId || null,
          });
        }
        continue;
      }
      if (BLACKLIST_KEYS.some((kw) => kw.toLowerCase() === k.toLowerCase())) continue;
      // 其余字段：跳过
    }

    // ② entry.data 兜底：valueRe 全局匹配，一条记录同一指标可产出多个点（多温度全抽）；content 不参与
    if (e?.data && typeof e.data === 'string') {
      for (const metric of METRIC_DEFS) {
        const re = new RegExp(metric.valueRe.source, metric.valueRe.flags.includes('g') ? metric.valueRe.flags : `${metric.valueRe.flags}g`);
        let m;
        while ((m = re.exec(e.data)) !== null) {
          if (numFromMatch(m) == null) continue;
          const tail = e.data.slice(m.index + m[0].length);
          const unitTok = (tail.match(/^\s*([^\s,，;；。、]+)/) || ['', ''])[1] || '';
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
            date, ts, value: pv.value, raw: pv.raw, unit: pv.unit,
            temp, tempUnit, entryId: e?.id || null, sampleId: e?.sampleId || null,
          });
        }
      }
    }

    if (isUnlabeled && withMetrics.has(e?.id)) {
      unrecognized.push({
        entryId: e?.id || null,
        date,
        sampleId: e?.sampleId || null,
        content: summarize(e?.content, 60),
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
      unrecognized,
    },
  };
}

/**
 * 从文献库抽取基准值：仅当数值出现在 record/peak/最高 等语境下才计入，
 * 取同指标所有命中中的最大值。保守，避免把正文任意提及的数值当成基准。
 * 顺带抽取基线值的测试温度（@823K / at 823 K / at 650 °C，°C 归一为 K），供面板提示温度可比性。
 * @returns {Record<string, {value: number, temp: (number|null), tempUnit: (string|null)}|null>}
 */
export function extractLiteratureBaseline(literatureEntries = []) {
  const baseline = {};
  const RECORD_CTX =
    /最高|记录|record|peak|state[- ]of[- ]the[- ]art|可达|up to|高达|创|突破|最优|benchmark|world/i;
  for (const metric of METRIC_DEFS) {
    let best = null;
    let bestTemp = null;
    let bestTempUnit = null;
    for (const e of literatureEntries || []) {
      const corpus = `${e?.title || ''} ${e?.abstractNote || ''} ${e?.abstract || ''} ${e?.abstractEn || ''}`;
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
            bestTempUnit = 'K';
          } else if (tC) {
            bestTemp = Math.round(Number(tC[1]) + 273.15);
            bestTempUnit = 'K';
          }
        }
      }
    }
    baseline[metric.key] = best == null ? null : { value: best, temp: bestTemp, tempUnit: bestTempUnit };
  }
  return baseline;
}

/**
 * 指标序列过滤（analyze_metrics 工具的纯函数核心）：
 * 按指标 key / 材料体系 / 测试温度（精确匹配）/ 日期范围（点 ts 毫秒比较）过滤后返回
 * 与 /metrics/series 同构的结构；不做趋势判断、不写库。空入参原样返回。
 * @param {{metrics?: object, order?: string[], baseline?: object, totals?: object}} data buildMetricsSeries 的返回值
 * @param {{metric?: string, system?: string, temp?: number, from?: string, to?: string}} [opts]
 */
export function filterSeries(data, opts = {}) {
  const { metric, system, temp, from, to } = opts || {};
  const metrics = {};
  for (const [mk, m] of Object.entries(data?.metrics || {})) {
    if (metric && mk !== metric) continue;
    const systems = {};
    for (const [sk, pts] of Object.entries(m.systems || {})) {
      if (system && sk !== system) continue;
      const filtered = pts.filter((p) => {
        if (temp != null && p.temp !== Number(temp)) return false;
        if (from) { const t = new Date(from).getTime(); if (!Number.isNaN(t) && p.ts < t) return false; }
        if (to) { const t = new Date(to).getTime(); if (!Number.isNaN(t) && p.ts > t) return false; }
        return true;
      });
      if (filtered.length) systems[sk] = filtered;
    }
    if (Object.keys(systems).length) {
      // count 同步为过滤后点数（原 build 全量 count 在过滤后失真，会误导「样本不足」判断）
      const count = Object.values(systems).reduce((n, pts) => n + pts.length, 0);
      metrics[mk] = { ...m, systems, count };
    }
  }
  return { metrics, order: data?.order || [], baseline: data?.baseline || {}, totals: data?.totals || {} };
}
