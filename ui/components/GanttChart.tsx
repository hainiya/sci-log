import { useEffect, useMemo, useRef, useState } from 'react';
import { dayIndex, addDays, fmt } from '../lib/dates';

export type GanttTask = {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  dependsOn?: string[];
  progress?: number;
  tags?: string[];
  kind?: 'plan';
};

export type ActualBlock = {
  id: string;
  name: string;
  start: string;
  end: string;
  kind: 'actual';
};

type Props = {
  tasks: GanttTask[];
  actuals?: ActualBlock[];
  onSave: (tasks: GanttTask[]) => Promise<void>;
};

const BAR_HEIGHT = 26;
const ROW_GAP = 8;
const HEADER_HEIGHT = 28;
const LEFT_PAD = 150;

/** 缩放档位：周视图看细节，季度视图看学期全貌 */
const ZOOMS = {
  week: { label: '周', dayW: 40, tickStep: 1 },
  month: { label: '月', dayW: 18, tickStep: 7 },
  quarter: { label: '季度', dayW: 6, tickStep: 30 },
} as const;
type ZoomKey = keyof typeof ZOOMS;


export function GanttChart({ tasks, actuals = [], onSave }: Props) {
  const [zoom, setZoom] = useState<ZoomKey>('month');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<GanttTask | null>(null);
  // 拖拽期间只维护本地预览，mouseUp 时才落库一次（避免每帧写盘引发的版本冲突风暴）
  const [dragPreview, setDragPreview] = useState<GanttTask[] | null>(null);
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize-start' | 'resize-end'; startDay: number; endDay: number; mouseX: number; dayAtMouse: number } | null>(null);
  // 拖拽开始时冻结时间轴范围，避免网格随拖拽跳动
  const boundsRef = useRef<{ min: Date; max: Date; rangeDays: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const dayW = ZOOMS[zoom].dayW;
  const tickStep = ZOOMS[zoom].tickStep;

  // 渲染数据源：拖拽中用本地预览，否则用 props
  const source = dragPreview ?? tasks;

  const { min, rangeDays, rows } = useMemo(() => {
    const b = boundsRef.current;
    const dates = [
      ...source.flatMap((t) => [t.start, t.end]),
      ...actuals.flatMap((a) => [a.start, a.end]),
    ].filter(Boolean) as string[];
    const today = new Date();
    const min = b?.min ?? new Date(Math.min(...dates.map((d) => new Date(d).getTime()), today.getTime() - 7 * 86400000));
    const max = b?.max ?? new Date(Math.max(...dates.map((d) => new Date(d).getTime()), today.getTime() + 7 * 86400000));
    const rangeDays = b?.rangeDays ?? Math.max(14, Math.round((max.getTime() - min.getTime()) / 86400000) + 1);
    const rows = [...source, ...actuals]
      .slice()
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
      .map((t) => ({
        task: t,
        startDay: dayIndex(t.start, min),
        endDay: dayIndex(t.end, min),
      }));
    return { min, rangeDays, rows };
  }, [source, actuals]);

  const width = LEFT_PAD + rangeDays * dayW;

  const ticks = useMemo(() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    for (let i = 0; i <= rangeDays; i++) {
      const d = addDays(min, i);
      if (tickStep === 1) {
        // 周视图：每日刻度，每周一加粗，1 号标月份
        const label = d.getDate() === 1 ? `${d.getMonth() + 1}月` : d.getDay() === 1 ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getDate()}`;
        out.push({ x: LEFT_PAD + i * dayW, label, major: d.getDay() === 1 || d.getDate() === 1 });
      } else if (tickStep === 7) {
        // 月视图：每周一刻度
        if (d.getDay() === 1 || i === 0) {
          out.push({ x: LEFT_PAD + i * dayW, label: d.getDate() === 1 ? `${d.getMonth() + 1}月` : `${d.getMonth() + 1}/${d.getDate()}`, major: d.getDate() <= 7 });
        }
      } else {
        // 季度视图：每月 1 号刻度
        if (d.getDate() === 1 || i === 0) {
          out.push({ x: LEFT_PAD + i * dayW, label: `${d.getFullYear() % 100}年${d.getMonth() + 1}月`, major: true });
        }
      }
    }
    return out;
  }, [min, rangeDays, dayW, tickStep]);

  const saveTasks = async (next: GanttTask[]) => {
    await onSave(next);
  };

  const startDrag = (e: React.MouseEvent, id: string, mode: 'move' | 'resize-start' | 'resize-end') => {
    const row = rows.find((r) => r.task.id === id);
    if (!row) return;
    e.preventDefault();
    // 坐标基准统一为 svg（与 onMove 的 currentTarget 一致）：onMouseDown 绑在任务条 rect 上，
    // 其 rect.left 含 LEFT_PAD + startDay*dayW 偏移，直接使用会在首次 move 时产生 startDay 级跳变并落库错误日期
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    boundsRef.current = { min, max: addDays(min, rangeDays), rangeDays };
    dragRef.current = {
      id,
      mode,
      startDay: row.startDay,
      endDay: row.endDay,
      mouseX: e.clientX,
      dayAtMouse: Math.round((e.clientX - svgRect.left - LEFT_PAD) / dayW),
    };
    setDragPreview(tasks.map((t) => ({ ...t })));
  };

  const onMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dayAtMouse = Math.round((e.clientX - rect.left - LEFT_PAD) / dayW);
    const delta = dayAtMouse - drag.dayAtMouse;
    let s = drag.startDay;
    let en = drag.endDay;
    if (drag.mode === 'move') {
      s = drag.startDay + delta;
      en = drag.endDay + delta;
    } else if (drag.mode === 'resize-start') {
      s = Math.min(drag.endDay, drag.startDay + delta);
    } else {
      en = Math.max(drag.startDay, drag.endDay + delta);
    }
    const sDate = addDays(boundsRef.current!.min, Math.max(0, s));
    const enDate = addDays(boundsRef.current!.min, Math.max(0, en));
    setDragPreview((prev) =>
      (prev ?? tasks).map((t) => (t.id !== drag.id ? t : { ...t, start: fmt(sDate), end: fmt(enDate) }))
    );
  };

  const endDrag = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    boundsRef.current = null;
    const preview = dragPreview;
    setDragPreview(null);
    if (drag && preview) {
      await saveTasks(preview);
    }
  };

  const startEdit = (task: GanttTask) => {
    setEditing(task.id);
    setForm({ ...task });
  };

  const submitEdit = async () => {
    if (!form) return;
    const next = tasks.map((t) => (t.id === form.id ? { ...t, ...form } : t));
    await saveTasks(next);
    setEditing(null);
    setForm(null);
  };

  const todayX = LEFT_PAD + dayIndex(fmt(new Date()), min) * dayW;

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 2);
  };

  // 进入时默认定位到「今天」附近（避免停在时间轴最左端，看到一屏过去的历史）
  useEffect(() => {
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div className="mrc-gantt">
      <div className="mrc-gantt-toolbar">
        <div className="mrc-gantt-zoom">
          {(Object.keys(ZOOMS) as ZoomKey[]).map((k) => (
            <button key={k} className={`mrc-chip ${zoom === k ? 'active' : ''}`} onClick={() => setZoom(k)}>
              {ZOOMS[k].label}
            </button>
          ))}
        </div>
        <button className="mrc-btn small" onClick={scrollToToday}>◎ 回到今天</button>
        <span className="mrc-gantt-legend">
          <span className="mrc-gantt-legend-item"><i className="sw plan" />计划任务</span>
          <span className="mrc-gantt-legend-item"><i className="sw progress" />进度</span>
          <span className="mrc-gantt-legend-item"><i className="sw actual" />实际时间线</span>
        </span>
        <span className="mrc-hint">拖动改期 · 两端缩放 · 双击编辑</span>
      </div>
      <div className="mrc-gantt-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          className="mrc-gantt-svg"
          width={width}
          height={HEADER_HEIGHT + rows.length * (BAR_HEIGHT + ROW_GAP) + 8}
          onMouseMove={onMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          {/* 网格与刻度 */}
          <line x1={LEFT_PAD} y1={0} x2={LEFT_PAD} y2={HEADER_HEIGHT + rows.length * (BAR_HEIGHT + ROW_GAP)} stroke="var(--mrc-border, #ddd)" />
          {ticks.map((tick) => (
            <g key={tick.x}>
              <line x1={tick.x} y1={tick.major ? 0 : HEADER_HEIGHT - 8} x2={tick.x} y2={HEADER_HEIGHT + rows.length * (BAR_HEIGHT + ROW_GAP)} stroke="var(--mrc-border, #ddd)" opacity={tick.major ? 0.9 : 0.5} />
              <text x={tick.x + 3} y={HEADER_HEIGHT - 8} fontSize={11} fill="var(--mrc-text-dim, #888)">{tick.label}</text>
            </g>
          ))}
          {/* 今天线 */}
          <line x1={todayX} y1={0} x2={todayX} y2={HEADER_HEIGHT + rows.length * (BAR_HEIGHT + ROW_GAP)} stroke="var(--mrc-accent, #e08a3c)" strokeDasharray="3 3" opacity={0.7} />

          {/* 任务行 */}
          {rows.map((row, i) => {
            const y = HEADER_HEIGHT + i * (BAR_HEIGHT + ROW_GAP);
            const x = LEFT_PAD + row.startDay * dayW;
            const w = Math.max(dayW, (row.endDay - row.startDay + 1) * dayW);
            const task = row.task;
            return (
              <g key={row.task.id}>
                <text x={LEFT_PAD - 8} y={y + BAR_HEIGHT / 2 + 4} fontSize={12} textAnchor="end" fill="var(--mrc-text, #333)" className="mrc-gantt-label">
                  {task.kind === 'actual' ? '◆ ' : ''}{task.name}
                </text>
                {task.kind === 'actual' ? (
                  <g>
                    <rect
                      x={x} y={y} width={w} height={BAR_HEIGHT} rx={5}
                      fill="var(--mrc-actual, #2e9e6b)"
                      opacity={0.55}
                    >
                      <title>{`${task.name}（实际时间线）`}</title>
                    </rect>
                    {w > 70 && task.name && (
                      <text
                        x={x + 6}
                        y={y + BAR_HEIGHT / 2 + 3}
                        fontSize={10}
                        fill="#fff"
                        opacity={0.9}
                        pointerEvents="none"
                      >
                        {task.name.slice(0, Math.max(3, Math.floor((w - 14) / 7)))}
                      </text>
                    )}
                  </g>
                ) : (
                  <>
                    <rect
                      x={x} y={y} width={w} height={BAR_HEIGHT} rx={5}
                      fill="var(--mrc-accent-soft, #f4d9b8)"
                      stroke="var(--mrc-accent, #e08a3c)"
                      cursor="move"
                      onMouseDown={(e) => startDrag(e, task.id, 'move')}
                      onDoubleClick={() => startEdit(task)}
                    />
                    <rect
                      x={x} y={y} width={Math.max(2, w * (task.progress || 0) / 100)} height={BAR_HEIGHT} rx={5}
                      fill="var(--mrc-accent, #e08a3c)" opacity={0.55}
                      pointerEvents="none"
                    />
                    <rect x={x - 3} y={y} width={6} height={BAR_HEIGHT} fill="transparent" cursor="ew-resize"
                      onMouseDown={(e) => { e.stopPropagation(); startDrag(e, task.id, 'resize-start'); }} />
                    <rect x={x + w - 3} y={y} width={6} height={BAR_HEIGHT} fill="transparent" cursor="ew-resize"
                      onMouseDown={(e) => { e.stopPropagation(); startDrag(e, task.id, 'resize-end'); }} />
                  </>
                )}
                {task.kind === 'actual'
                  ? <text x={x + w + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={11} fill="var(--mrc-actual, #2e9e6b)">实际 {Math.max(1, row.endDay - row.startDay + 1)} 天</text>
                  : <text x={x + w + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={11} fill="var(--mrc-text-dim, #888)">{task.progress || 0}%</text>}
              </g>
            );
          })}
        </svg>
      </div>

      {editing && form && (
        <div className="mrc-gantt-edit">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="任务名" />
          <input type="date" value={form.start || ''} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <span>→</span>
          <input type="date" value={form.end || ''} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          <select
            value={form.dependsOn?.[0] || ''}
            onChange={(e) => setForm({ ...form, dependsOn: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">无依赖</option>
            {tasks.filter((t) => t.id !== form.id).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input type="number" min={0} max={100} value={form.progress ?? 0} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} placeholder="进度%" />
          <button className="mrc-btn primary" onClick={submitEdit}>保存</button>
          <button className="mrc-btn" onClick={() => { setEditing(null); setForm(null); }}>取消</button>
        </div>
      )}
    </div>
  );
}
