import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { MetricsChart, MetricSeries, MetricPoint, PALETTE } from '../components/MetricsChart';
import { IconFlask, IconChevronDown, IconChevronRight, IconChevronUp, IconWarning } from '../components/Icons';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
  /** 未识别体系记录「补标注」回调（任务 6 在 Panel.tsx 接线：跳转实验记录 tab 并打开编辑弹窗） */
  onEditWorklog?: (entryId: string) => void;
};

type UnrecognizedItem = {
  entryId: string;
  date: string;
  sampleId?: string | null;
  content?: string;
};

/** 未识别材料体系警告条（规格 3.4）：不进图、不计指标，可展开逐条补标注 */
function UnrecognizedWarnBar({ count, items, open, onToggle, onEdit }: { count: number; items: UnrecognizedItem[]; open: boolean; onToggle: () => void; onEdit: (entryId: string) => void }) {
  if (count === 0) return null;
  return (
    <div className="mrc-metrics-warn">
      <button type="button" className="mrc-metrics-warn-head" onClick={onToggle}>
        <span><IconWarning size={14} /> {count} 条实验记录未识别材料体系</span>
        <span className="mrc-metrics-warn-toggle">{open ? <IconChevronUp size={13} /> : <IconChevronRight size={13} />}{open ? ' 收起' : ' 查看'}</span>
      </button>
      {open && (
        <div className="mrc-metrics-warn-list">
          {items.map((u, i) => (
            <div key={u.entryId || i} className="mrc-metrics-warn-item">
              <span className="mrc-metrics-warn-meta">
                {u.date}
                {u.sampleId && <> · <IconFlask size={11} /> {u.sampleId}</>}
              </span>
              <span className="mrc-metrics-warn-content">{u.content || '（无摘要）'}</span>
              <button
                type="button"
                className="mrc-btn small"
                disabled={!u.entryId}
                onClick={() => onEdit(u.entryId)}
                title="跳转到实验记录并打开编辑"
              >
                ✏️ 补标注
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtTemp(t: number, u?: string | null): string {
  if (u === 'C') return `${t}°C`;
  return `${t}${u || ''}`;
}

/**
 * 指标趋势面板（P1→深化）：从后端 /metrics/series 拉取按材料体系分组、按时间排序的性能数值，
 * 绘制趋势曲线，叠加「文献基准」与用户自设「目标值」参考线；
 * 深化：温度筛选（全部温度 = 深浅 + 断线，选中温度 = 同色连续）、单位未标注空心点、
 * 未识别体系警告条（补标注回调）、文献基准温度可比提示。
 */
export function MetricsPanel({ state, onStateChange, showToast, onEditWorklog }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<string | null>(null);
  // 温度筛选携带单位（同数值不同单位的温度不混筛，如 100K vs 100°C）
  const [tempFilter, setTempFilter] = useState<{ temp: number; tempUnit: string | null } | null>(null);
  const [showUnrecognized, setShowUnrecognized] = useState(false);

  const wlVer = state?.worklog?.version;
  const litVer = state?.literature?.version;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getMetrics()
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
        setMetric((prev) => {
          const order: string[] = (r?.order as string[]) || Object.keys(r?.metrics || {});
          if (prev && order.includes(prev)) return prev;
          return order[0] || null;
        });
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wlVer, litVer]);

  const metrics = data?.metrics || {};
  const order: string[] = (data?.order as string[]) || Object.keys(metrics);
  const baseline = data?.baseline || {};
  const targets = state?.settings?.metricTargets || {};
  const unrecognized: UnrecognizedItem[] = data?.totals?.unrecognized || [];

  const selected = metric ? metrics[metric] : null;

  const series: MetricSeries[] = useMemo(() => {
    if (!selected) return [];
    const systems = selected.systems ?? {}; // 后端 shape 变动兜底，避免渲染期 TypeError 白屏
    return Object.entries(systems).map(([system, points]) => ({
      system,
      points: points as MetricSeries['points'],
    }));
  }, [selected]);

  // 温度去重集合（按 tempUnit 分组显示，如 823K / 150°C）
  const temps = useMemo(() => {
    if (!selected) return [];
    const map = new Map<string, { temp: number; tempUnit: string | null }>();
    for (const pts of Object.values(selected.systems ?? {})) {
      for (const p of pts as MetricPoint[]) {
        if (p.temp == null) continue;
        const key = `${p.temp}|${p.tempUnit || ''}`;
        if (!map.has(key)) map.set(key, { temp: p.temp, tempUnit: p.tempUnit || null });
      }
    }
    return [...map.values()].sort((a, b) => a.temp - b.temp);
  }, [selected]);

  // entryId → 内容 lookup（tooltip 内容前 40 字溯源），从 state.worklog 反查
  const entryContent = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of state?.worklog?.entries || []) {
      if (e?.id) m.set(e.id, String(e?.content || ''));
    }
    return (id: string) => m.get(id) || '';
  }, [wlVer]);

  const baselineObj = metric ? (baseline[metric] ?? null) : null;

  // 规格 3.5：文献基准温度可比提示（|Δtemp| ≤ 50K 视为可比，启发式阈值）
  // 空心点（unit null）不参与基准比较（规格 3.2）；文案回传实际最近数据点温度
  const baselineNote = useMemo(() => {
    if (!baselineObj || baselineObj.temp == null || !selected) return null;
    const bt = baselineObj.temp as number;
    let nearest: MetricPoint | null = null;
    let nearestDelta = Infinity;
    for (const pts of Object.values(selected.systems ?? {})) {
      for (const p of pts as MetricPoint[]) {
        if (tempFilter != null && p.temp !== tempFilter.temp) continue;
        if (p.temp == null || p.unit == null) continue;
        const d = Math.abs(p.temp - bt);
        if (d < nearestDelta) {
          nearestDelta = d;
          nearest = p;
        }
      }
    }
    const b = fmtTemp(bt, baselineObj.tempUnit);
    if (!nearest) {
      return {
        text: `文献基准 @${b}，当前数据点温度缺失或单位未标注，谨慎对比`,
        comparable: false,
      };
    }
    const comparable = nearestDelta <= 50;
    const p = fmtTemp(nearest.temp as number, nearest.tempUnit);
    return {
      text: comparable
        ? `文献基准 @${b} 与本体系 @${p} 数据点可比`
        : `文献基准 @${b}，与最近数据点 @${p} 温度差异大，谨慎对比`,
      comparable,
    };
  }, [baselineObj, selected, tempFilter]);

  const [targetDraft, setTargetDraft] = useState<string | null>(null); // 未提交的草稿（null=未编辑，显示服务端值）

  const commitTarget = async () => {
    if (targetDraft == null || !metric) return;
    const val = targetDraft;
    setTargetDraft(null);
    if (val.trim() === '') {
      const next = { ...targets };
      delete next[metric];
      try {
        await api.saveMetricTargets(next);
        await onStateChange();
      } catch (e: any) {
        showToast(`保存失败：${e.message}`, { error: true });
      }
      return;
    }
    const num = Number(val);
    if (Number.isNaN(num)) {
      showToast('目标值格式无效');
      return;
    }
    try {
      await api.saveMetricTargets({ ...targets, [metric]: num });
      await onStateChange();
      showToast('目标值已保存');
    } catch (e: any) {
      showToast(`保存失败：${e.message}`, { error: true });
    }
  };

  // 未识别体系警告条（规格 3.4）：不进图、不计指标，提示补标注
  const warnBar = (
    <UnrecognizedWarnBar
      count={unrecognized.length}
      items={unrecognized}
      open={showUnrecognized}
      onToggle={() => setShowUnrecognized((v) => !v)}
      onEdit={(entryId) => onEditWorklog?.(entryId)}
    />
  );

  if (loading) {
    return (
      <div className="mrc-panel-section">
        <div className="mrc-loading">加载指标中…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mrc-panel-section mrc-error">指标加载失败：{error}</div>
    );
  }
  if (order.length === 0) {
    return (
      <div className="mrc-metrics">
        {warnBar}
        <div className="mrc-panel-section">
          <div className="mrc-section-head">
            <span className="mrc-section-title">指标趋势</span>
          </div>
          <div className="mrc-empty">
            还没有性能指标参数。在实验记录的「实验数据」里写下如
            <code>ZT=0.9 @ 823K</code>、<code>功率因子=1.2</code> 即可，AI 巡检会自动抽取并汇总成趋势曲线。
            <div className="mrc-empty-example">
              <span className="mrc-chip mini">ZT @ 823K</span>
              <span className="mrc-chip mini">功率因子</span>
              <span className="mrc-chip mini">Seebeck 系数</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const unit = selected?.unit || '';
  const targetVal = metric ? targets[metric] : undefined;

  return (
    <div className="mrc-metrics">
      {warnBar}

      <div className="mrc-panel-section">
        <div className="mrc-section-head">
          <span className="mrc-section-title">指标趋势</span>
          <span className="mrc-count">{data?.totals?.withMetrics ?? 0} 条记录含指标</span>
        </div>
        <div className="mrc-metric-chips">
          {order.map((k) => (
            <button
              key={k}
              className={`mrc-chip ${metric === k ? 'active' : ''}`}
              onClick={() => {
                setMetric(k);
                setTempFilter(null); // 切换指标后温度筛选重置
                setTargetDraft(null); // 切换指标丢弃未提交草稿
              }}
              title={metrics[k]?.label}
            >
              {metrics[k]?.label}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="mrc-panel-section">
          {/* 温度筛选 chips（规格 3.1）：全部温度 / 数据点实际温度去重集合 */}
          <div className="mrc-metric-temps">
            <span className="mrc-metric-temps-label">测试温度</span>
            <button
              type="button"
              className={`mrc-chip ${tempFilter == null ? 'active' : ''}`}
              onClick={() => setTempFilter(null)}
            >
              全部温度
            </button>
            {temps.map((t) => (
              <button
                key={`${t.temp}|${t.tempUnit || ''}`}
                type="button"
                className={`mrc-chip ${tempFilter?.temp === t.temp && tempFilter?.tempUnit === t.tempUnit ? 'active' : ''}`}
                onClick={() => setTempFilter({ temp: t.temp, tempUnit: t.tempUnit })}
              >
                {fmtTemp(t.temp, t.tempUnit)}
              </button>
            ))}
          </div>

          <MetricsChart
            metricLabel={selected.label}
            unit={unit}
            series={series}
            baseline={baselineObj}
            target={targetVal ?? null}
            tempFilter={tempFilter}
            entryContent={entryContent}
          />

          {baselineNote && (
            <div className={`mrc-metric-baseline-note${baselineNote.comparable ? ' comparable' : ''}`}>
              {baselineNote.text}
            </div>
          )}

          <div className="mrc-metric-legend">
            {Object.entries(selected.systems ?? {}).map(([system, points], i) => {
              const all = points as MetricPoint[];
              // 温度筛选后图例同步只看该温度的点（含单位匹配）
              const pts = tempFilter == null ? all : all.filter((p) => p.temp === tempFilter.temp && p.tempUnit === tempFilter.tempUnit);
              const color = PALETTE[i % PALETTE.length];
              return (
                <div key={system} className="mrc-metric-row">
                  <span className="mrc-metric-dot" style={{ background: color }} />
                  <span className="mrc-metric-sys">{system}</span>
                  {pts.length === 0 ? (
                    <span className="mrc-metric-sub">
                      {tempFilter != null ? `无 ${fmtTemp(tempFilter.temp, tempFilter.tempUnit)} 数据` : '—'}
                    </span>
                  ) : (
                    <>
                      <span className="mrc-metric-val">
                        {pts[pts.length - 1].value}
                        {unit}
                      </span>
                      <span
                        className={`mrc-metric-delta ${
                          pts.length > 1 && pts[pts.length - 1].value > pts[0].value ? 'up' : ''
                        } ${pts.length > 1 && pts[pts.length - 1].value < pts[0].value ? 'down' : ''}`}
                      >
                        {pts.length > 1
                          ? ((pts[pts.length - 1].value > pts[0].value
                              ? '▲'
                              : pts[pts.length - 1].value < pts[0].value
                                ? '▼ '
                                : '— ') +
                            Math.abs(pts[pts.length - 1].value - pts[0].value).toFixed(2))
                          : '—'}
                      </span>
                      <span className="mrc-metric-sub">
                        首 {pts[0].value}
                        {unit} · {pts.length} 点
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mrc-metric-target">
            <label>
              目标值（{selected.label}
              {unit ? ` ${unit}` : ''}）：
            </label>
            <input
              type="number"
              step="any"
              placeholder="留空不绘制"
              value={targetDraft ?? targetVal ?? ''}
              onChange={(e) => setTargetDraft(e.target.value)}
              onBlur={commitTarget}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            {baselineObj != null && (
              <span className="mrc-metric-baseline">
                文献基准：{baselineObj.value}
                {unit}
                {baselineObj.temp != null ? ` @ ${fmtTemp(baselineObj.temp, baselineObj.tempUnit)}` : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
