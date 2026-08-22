import { useMemo } from 'react';

/**
 * 数据点（后端 /metrics/series 契约，见 src-server/server/metrics.js）：
 * - value 一律归一化到基准单位；unit === null 表示单位未标注（空心点、不连线、不参与基准比较）
 * - temp / tempUnit：测试温度上下文（null = 温度未标注）
 * - raw：原始记录串（tooltip 溯源）；entryId / sampleId：溯源信息
 */
export type MetricPoint = {
  date: string;
  ts?: number;
  value: number;
  raw?: string;
  unit?: string | null;
  temp?: number | null;
  tempUnit?: string | null;
  entryId?: string | null;
  sampleId?: string | null;
};
export type MetricSeries = { system: string; points: MetricPoint[] };

/** 文献基准（深化后为对象：value + 可选温度上下文，不再是裸 number） */
export type MetricBaseline = {
  value: number;
  temp?: number | null;
  tempUnit?: string | null;
} | null;

type Props = {
  metricLabel: string;
  unit: string;
  series: MetricSeries[];
  baseline?: MetricBaseline;
  target?: number | null;
  /** 温度筛选：非 null 时只画该温度的点（含单位匹配）并统一原色；null = 全部温度（深浅 + 断线） */
  tempFilter?: { temp: number; tempUnit: string | null } | null;
  /** entryId → 记录内容（tooltip 前 40 字摘要），由 MetricsPanel 提供 */
  entryContent?: (entryId: string) => string;
};

// 体系配色：在浅色主题下清晰可辨，作为数据序列色（非主题色）
export const PALETTE = [
  '#e08a3c',
  '#3b82f6',
  '#10b981',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#f59e0b',
  '#6366f1',
];

const W = 680;
const PAD = { left: 50, right: 16, top: 16, bottom: 32 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = 260 - PAD.top - PAD.bottom;
// 未筛选温度时，同体系点按 temp 映射明度：温度越高越深（亮度越低）
const L_HIGH = 0.76;
const L_LOW = 0.34;

function dateToMs(date: string): number {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function fmtTick(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(digits).replace(/\.?0+$/, '');
}

function fmtDateShort(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return date || '';
  return `${m[2]}/${m[3]}`;
}

function fmtTemp(t: number, u?: string | null): string {
  if (u === 'C') return `${t}°C`;
  return `${t}${u || ''}`;
}

/** hex → HSL（明度插值用） */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** tooltip 溯源：归一值+基准单位、原记录值、温度、样品号、记录 id、内容前 40 字 */
function tooltipText(
  system: string,
  p: MetricPoint,
  metricLabel: string,
  unit: string,
  entryContent?: (entryId: string) => string
): string {
  const lines = [
    `${system} · ${p.date}`,
    `${metricLabel}: ${fmtTick(p.value)}${unit ? ' ' + unit : ''}`,
  ];
  if (p.raw) lines.push(`原记录: ${p.raw}`);
  if (p.temp != null) lines.push(`温度: ${fmtTemp(p.temp, p.tempUnit)}`);
  else lines.push('温度: 温度未标注');
  if (p.unit == null) lines.push('单位未标注，未参与连线与基准比较');
  if (p.sampleId) lines.push(`样品: ${p.sampleId}`);
  if (p.entryId) lines.push(`记录: ${p.entryId}`);
  const c = entryContent && p.entryId ? String(entryContent(p.entryId) || '').replace(/\s+/g, ' ').trim() : '';
  if (c) lines.push(`内容: ${c.length > 40 ? c.slice(0, 40) + '…' : c}`);
  return lines.join('\n');
}

export function MetricsChart({ metricLabel, unit, series, baseline, target, tempFilter, entryContent }: Props) {
  // 温度筛选：只保留该温度的点（连线恢复、同色）
  const visible = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points:
          tempFilter == null
            ? s.points
            : s.points.filter((p) => p.temp === tempFilter.temp && p.tempUnit === tempFilter.tempUnit),
      })),
    [series, tempFilter]
  );

  const { scales, yTicks, xTicks, allPoints, tempsPresent, hollowPresent } = useMemo(() => {
    const all: MetricPoint[] = [];
    let tempsPresent = false;
    let hollowPresent = false;
    for (const s of visible) {
      for (const p of s.points) {
        all.push(p);
        if (p.temp != null) tempsPresent = true;
        if (p.unit == null) hollowPresent = true;
      }
    }
    const values = all.map((p) => p.value);
    if (baseline != null) values.push(baseline.value);
    if (target != null) values.push(target);

    let yMin = values.length ? Math.min(...values) : 0;
    let yMax = values.length ? Math.max(...values) : 1;
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.12;
    yMin -= pad;
    yMax += pad;
    if (yMin < 0 && Math.min(...all.map((p) => p.value)) >= 0) yMin = 0; // 非负指标不画负轴

    const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
    const yOf = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;

    const ms = all.map((p) => dateToMs(p.date)).filter((x) => x > 0);
    let xMin = ms.length ? Math.min(...ms) : Date.now();
    let xMax = ms.length ? Math.max(...ms) : Date.now();
    if (xMin === xMax) {
      xMin -= 86400000;
      xMax += 86400000;
    }
    const xOf = (date: string) => {
      const t = dateToMs(date);
      if (t <= 0) return PAD.left;
      return PAD.left + ((t - xMin) / (xMax - xMin || 1)) * PLOT_W;
    };

    // X 刻度：最多 5 个，均匀分布
    const xTicks: { x: number; label: string }[] = [];
    const N = Math.min(5, all.length || 1);
    for (let i = 0; i < N; i++) {
      const frac = N === 1 ? 0 : i / (N - 1);
      const t = xMin + frac * (xMax - xMin);
      xTicks.push({ x: PAD.left + frac * PLOT_W, label: fmtDateShort(new Date(t).toISOString().slice(0, 10)) });
    }

    return { scales: { yOf, xOf }, yTicks, xTicks, allPoints: all, tempsPresent, hollowPresent };
  }, [visible, baseline, target]);

  const { yOf, xOf } = scales;

  if (allPoints.length === 0) {
    return <div className="mrc-chart-empty">暂无该指标的数据点</div>;
  }

  return (
    <>
      <svg
        className="mrc-metrics-chart"
        viewBox={`0 0 ${W} 260`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${metricLabel} 时间线`}
      >
        {/* 网格 + Y 刻度 */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yOf(v)} x2={W - PAD.right} y2={yOf(v)} stroke="var(--mrc-border, #ddd)" opacity={i === 0 ? 0.9 : 0.4} />
            <text x={PAD.left - 6} y={yOf(v) + 3} fontSize={10} textAnchor="end" fill="var(--mrc-text-dim, #888)">
              {fmtTick(v)}
            </text>
          </g>
        ))}
        {/* X 刻度 */}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={260 - PAD.bottom + 16} fontSize={10} textAnchor="middle" fill="var(--mrc-text-dim, #888)">
            {t.label}
          </text>
        ))}
        <text x={PAD.left - 6} y={PAD.top - 4} fontSize={10} textAnchor="end" fill="var(--mrc-text-dim, #888)">
          {unit || metricLabel}
        </text>

        {/* 文献基准虚线（新结构：对象，含 value/temp） */}
        {baseline != null && (
          <g>
            <line x1={PAD.left} y1={yOf(baseline.value)} x2={W - PAD.right} y2={yOf(baseline.value)} stroke="#9ca3af" strokeWidth={1.2} strokeDasharray="6 4" />
            <text x={W - PAD.right} y={yOf(baseline.value) - 4} fontSize={10} textAnchor="end" fill="#9ca3af">
              文献基准 {fmtTick(baseline.value)}
              {baseline.temp != null ? ` @${fmtTemp(baseline.temp, baseline.tempUnit)}` : ''}
            </text>
          </g>
        )}
        {/* 用户目标虚线 */}
        {target != null && (
          <g>
            <line x1={PAD.left} y1={yOf(target)} x2={W - PAD.right} y2={yOf(target)} stroke="#10b981" strokeWidth={1.2} strokeDasharray="2 4" />
            <text x={W - PAD.right} y={yOf(target) + 12} fontSize={10} textAnchor="end" fill="#10b981">
              目标 {fmtTick(target)}
            </text>
          </g>
        )}

        {/* 各体系折线 */}
        {visible.map((s, i) => {
          const color = PALETTE[i % PALETTE.length];
          const baseHsl = hexToHsl(color);
          const pts = s.points;
          const temps = pts.filter((p) => p.temp != null).map((p) => p.temp as number);
          const tMin = temps.length ? Math.min(...temps) : null;
          const tMax = temps.length ? Math.max(...temps) : null;

          // 未筛选温度态：同体系点按 temp 映射明度（temp 越高越深）；筛选后统一原色；无 temp 的点用原色
          const colorOf = (p: MetricPoint): string => {
            if (tempFilter == null && tMin != null && tMax != null && p.temp != null) {
              const f = tMax === tMin ? 1 : (p.temp - tMin) / (tMax - tMin);
              const l = L_HIGH - f * (L_HIGH - L_LOW);
              return `hsl(${baseHsl.h.toFixed(1)} ${(baseHsl.s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
            }
            return color;
          };

          // 连线规则：相邻两点仅当双方都有单位（unit != null）且 temp 相同（含双方都 null）才连线；
          // 单位未标注点不连前后线段；温度跳变处断线
          const canLink = (a: MetricPoint, b: MetricPoint) => a.unit != null && b.unit != null && a.temp === b.temp;
          const segs: MetricPoint[][] = [];
          let cur: MetricPoint[] = [];
          for (let j = 0; j < pts.length; j++) {
            cur.push(pts[j]);
            if (j < pts.length - 1 && !canLink(pts[j], pts[j + 1])) {
              segs.push(cur);
              cur = [];
            }
          }
          if (cur.length) segs.push(cur);

          return (
            <g key={s.system}>
              {segs.map((seg, k) => (
                <polyline
                  key={k}
                  points={seg.map((p) => `${xOf(p.date).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={colorOf(seg[0])}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {pts.map((p, j) => {
                const c = colorOf(p);
                return (
                  <circle
                    key={j}
                    cx={xOf(p.date)}
                    cy={yOf(p.value)}
                    r={p.unit == null ? 4 : 3.5}
                    fill={p.unit == null ? 'none' : c}
                    stroke={c}
                    strokeWidth={p.unit == null ? 2 : 1}
                  >
                    <title>{tooltipText(s.system, p, metricLabel, unit, entryContent)}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* 维度说明 */}
      {((tempsPresent && tempFilter == null) || hollowPresent) && (
        <div className="mrc-chart-hint">
          {tempsPresent && tempFilter == null && <span>温度跳变处断线 · 颜色越深温度越高</span>}
          {hollowPresent && <span>○ 空心点 = 单位未标注，未参与连线与基准比较</span>}
        </div>
      )}
    </>
  );
}
