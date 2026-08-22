import { useState } from 'react';
import { api } from '../api';
import { GanttChart, type GanttTask, type ActualBlock } from '../components/GanttChart';
import { CalendarView, type CalendarEvent } from '../components/CalendarView';
import { ConfirmButton } from '../components/ConfirmButton';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function SchedulePanel({ state, onStateChange, showToast }: Props) {
  const gantt = state?.gantt || { version: 0, tasks: [] };
  const calendar = state?.calendar || { version: 0, events: [] };
  const tasks: GanttTask[] = gantt.tasks || [];

  // 从实验记录投影实际时间线（只读，改记录自动同步；记录删除自动消失）
  const actuals: ActualBlock[] = (state?.worklog?.entries || [])
    .filter((e: any) => e.durationHours > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) && (e.startDate == null || /^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate))))
    .map((e: any) => {
      const start = e.startDate ?? e.date;
      const days = Math.max(0, Math.ceil(Number(e.durationHours) / 24) - 1);
      // 本地日期拼接（与 GanttChart addDays/fmt 一致），避免 UTC+8 下 toISOString 少一天
      const d = new Date(start + 'T00:00:00');
      d.setDate(d.getDate() + days);
      const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { id: 'act_' + e.id, name: String(e.content || '').slice(0, 20), start, end, kind: 'actual' as const };
    });
  const events: CalendarEvent[] = calendar.events || [];
  const [newTaskName, setNewTaskName] = useState('');
  const [tab, setTab] = useState<'gantt' | 'calendar'>('gantt');
  // 滑块拖动中只改本地预览，松手才落库（避免拖动过程连续写盘的版本冲突风暴）
  const [sliderPreview, setSliderPreview] = useState<{ id: string; value: number } | null>(null);

  const saveGantt = async (nextTasks: GanttTask[]) => {
    try {
      await api.write('gantt', gantt.version, { tasks: nextTasks });
      await onStateChange();
    } catch (err: any) {
      showToast(err.message.includes('version_conflict') ? '数据已被更新，已刷新' : `保存失败：${err.message}`, { error: true });
      await onStateChange();
    }
  };

  const saveCalendar = async (nextEvents: CalendarEvent[]) => {
    try {
      await api.write('calendar', calendar.version, { events: nextEvents });
      await onStateChange();
    } catch (err: any) {
      showToast(err.message.includes('version_conflict') ? '数据已被更新，已刷新' : `保存失败：${err.message}`, { error: true });
      await onStateChange();
    }
  };

  const addTask = async () => {
    const name = newTaskName.trim();
    if (!name) return;
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const d = new Date(now.getTime() + 7 * 86400000);
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await saveGantt([...tasks, { id: newId('task'), name, start, end, dependsOn: [], progress: 0, tags: [] }]);
    setNewTaskName('');
  };

  const deleteTask = async (id: string) => {
    await saveGantt(tasks.filter((t) => t.id !== id));
  };

  const setProgress = async (id: string, progress: number) => {
    await saveGantt(tasks.map((t) => (t.id === id ? { ...t, progress: Math.min(100, Math.max(0, progress)) } : t)));
  };

  const toggleTask = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    await setProgress(id, (t?.progress || 0) >= 100 ? 0 : 100);
  };

  return (
    <div className="mrc-schedule">
      <div className="mrc-panel-section">
        <div className="mrc-tabs">
          <button className={`mrc-tab ${tab === 'gantt' ? 'active' : ''}`} onClick={() => setTab('gantt')}>甘特图</button>
          <button className={`mrc-tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>日历</button>
        </div>

        {tab === 'gantt' && (
          <div className="mrc-gantt-wrap">
            {tasks.length === 0 && actuals.length === 0 ? (
              <div className="mrc-empty">还没有任务。在下方任务清单添加，即可在甘特图排期。</div>
            ) : (
              <GanttChart tasks={tasks} actuals={actuals} onSave={saveGantt} />
            )}
          </div>
        )}

        {tab === 'calendar' && (
          <CalendarView events={events} tasks={tasks} onSave={saveCalendar} />
        )}
      </div>

      <div className="mrc-schedule-side">
        <div className="mrc-panel-section">
          <div className="mrc-section-head">
            <span className="mrc-section-title">任务清单</span>
            <span className="mrc-count">{tasks.length}</span>
          </div>
          <div className="mrc-field-row">
            <input
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              placeholder="新任务名称…"
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
            />
            <button className="mrc-btn primary" onClick={addTask} disabled={!newTaskName.trim()}>添加</button>
          </div>
          {tasks.length === 0 && <div className="mrc-empty">还没有任务。添加后可在甘特图调整时间。</div>}
          <div className="mrc-tasklist">
            {tasks.map((task) => {
              const shownProgress = sliderPreview?.id === task.id ? sliderPreview.value : task.progress || 0;
              return (
              <div key={task.id} className="mrc-task-row">
                <input
                  type="checkbox"
                  checked={shownProgress >= 100}
                  onChange={() => toggleTask(task.id)}
                  title="标记完成"
                />
                <span className={`mrc-task-name ${shownProgress >= 100 ? 'done' : ''}`} title={task.name}>{task.name}</span>
                <input
                  className="mrc-task-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={shownProgress}
                  onChange={(e) => setSliderPreview({ id: task.id, value: Number(e.target.value) })}
                  onPointerUp={() => {
                    if (sliderPreview?.id === task.id) {
                      void setProgress(task.id, sliderPreview.value);
                      setSliderPreview(null);
                    }
                  }}
                  onKeyUp={() => {
                    // 键盘改值的键（Home/End/PageUp/PageDown/方向键）都会触发 onChange 写预览，统一提交并清理，
                    // 避免只认方向键导致其他键改的进度永不落库（复审 U3）
                    if (sliderPreview?.id === task.id) {
                      void setProgress(task.id, sliderPreview.value);
                      setSliderPreview(null);
                    }
                  }}
                  title={`进度 ${shownProgress}%`}
                />
                <span className="mrc-task-progress">{shownProgress}%</span>
                <span className="mrc-task-date">{task.start || '?'} ~ {task.end || '?'}</span>
                <ConfirmButton label="删" className="mrc-btn small danger" onConfirm={() => deleteTask(task.id)} title="删除任务" />
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
