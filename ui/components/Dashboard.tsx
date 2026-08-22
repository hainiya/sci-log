import { useMemo } from 'react';
import { api } from '../api';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
  onGoSchedule: () => void;
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本周起始 ISO（周一） */
function weekStartIso() {
  const now = new Date();
  const day = now.getDay() || 7; // 周日=7
  const start = new Date(now.getTime() - (day - 1) * 86400000);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * 今日概览：打开面板第一眼看到的东西。
 * 今日进行中任务（可勾选）、临期任务、今日日程、本周统计（基于 state 直接计算）。
 */
export function Dashboard({ state, onStateChange, showToast, onGoSchedule }: Props) {
  const tasks: any[] = state?.gantt?.tasks || [];
  const events: any[] = state?.calendar?.events || [];
  const today = todayStr();

  const { todayTasks, dueSoon } = useMemo(() => {
    const active = tasks.filter((t) => (t.progress || 0) < 100);
    const inRange = active.filter((t) => (t.start || '9999') <= today && (t.end || '0000') >= today);
    const soon = active
      .filter((t) => t.end && t.end >= today)
      .map((t) => ({ task: t, daysLeft: Math.round((new Date(t.end).getTime() - new Date(today).getTime()) / 86400000) }))
      .filter((x) => x.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft);
    return { todayTasks: inRange, dueSoon: soon };
  }, [tasks, today]);

  const todayEvents = useMemo(() => events.filter((e) => e.date === today), [events, today]);

  // 本周统计：基于 state 直接计算（实验记录中心化后移除 weekSummary 端点的依赖）
  const week = useMemo(() => {
    const startIso = weekStartIso();
    const inWeek = (iso: string | undefined) => iso && iso >= startIso;
    const worklog = state?.worklog?.entries || [];
    const literature = state?.literature?.entries || [];
    const workCount = worklog.filter((e: any) => inWeek(e.createdAt)).length;
    const litCount = literature.filter((e: any) => inWeek(e.addedAt)).length;
    const avgProgress = tasks.length > 0 ? Math.round(tasks.reduce((s: number, t: any) => s + (Number(t.progress) || 0), 0) / tasks.length) : 0;
    return { workCount, litCount, avgProgress };
  }, [state, tasks]);

  const completeTask = async (id: string) => {
    try {
      await api.write('gantt', state.gantt.version, {
        tasks: tasks.map((t) => (t.id === id ? { ...t, progress: 100 } : t)),
      });
      await onStateChange();
      showToast('任务已完成 🎉');
    } catch (err: any) {
      showToast(err.message.includes('version_conflict') ? '数据已被更新，已刷新' : `保存失败：${err.message}`, { error: true });
      await onStateChange();
    }
  };

  return (
    <div className="mrc-dashboard">
      <div className="mrc-dash-card mrc-dash-today">
        <div className="mrc-dash-title">📌 今日任务 <span className="mrc-count">{todayTasks.length}</span></div>
        {todayTasks.length === 0 && <div className="mrc-dash-empty">今天没有进行中的任务</div>}
        {todayTasks.slice(0, 4).map((t) => (
          <div key={t.id} className="mrc-dash-task">
            <input type="checkbox" title="标记完成" onChange={() => completeTask(t.id)} />
            <span className="mrc-dash-task-name" title={t.name}>{t.name}</span>
            <span className="mrc-dash-task-progress">{t.progress || 0}%</span>
          </div>
        ))}
        {todayTasks.length > 4 && <button className="mrc-dash-more" onClick={onGoSchedule}>还有 {todayTasks.length - 4} 项 →</button>}
      </div>

      <div className="mrc-dash-card">
        <div className="mrc-dash-title">⏰ 临期 / 今日日程</div>
        {dueSoon.length === 0 && todayEvents.length === 0 && <div className="mrc-dash-empty">7 天内没有到期的任务</div>}
        {dueSoon.slice(0, 3).map(({ task, daysLeft }) => (
          <div key={task.id} className="mrc-dash-line" title={`${task.start} ~ ${task.end}`}>
            <span className={`mrc-due-badge ${daysLeft <= 1 ? 'urgent' : ''}`}>{daysLeft === 0 ? '今天截止' : `${daysLeft} 天`}</span>
            <span className="mrc-dash-line-text">{task.name}</span>
          </div>
        ))}
        {todayEvents.slice(0, 2).map((e) => (
          <div key={e.id} className="mrc-dash-line">
            <span className="mrc-due-badge event">{e.startTime || '日程'}</span>
            <span className="mrc-dash-line-text">{e.title}</span>
          </div>
        ))}
        {(dueSoon.length > 3 || todayEvents.length > 2) && <button className="mrc-dash-more" onClick={onGoSchedule}>查看日程 →</button>}
      </div>

      <div className="mrc-dash-card mrc-dash-week">
        <div className="mrc-dash-title">🗓️ 本周</div>
        <div className="mrc-dash-week-grid">
          <div><b>{week.workCount ?? 0}</b><span>实验记录</span></div>
          <div><b>{week.litCount ?? 0}</b><span>文献新增</span></div>
          <div><b>{week.avgProgress ?? 0}%</b><span>平均进度</span></div>
        </div>
      </div>
    </div>
  );
}
