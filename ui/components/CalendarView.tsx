import { useMemo, useState } from 'react';

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  type?: string;
  taskId?: string | null;
};

type Props = {
  events: CalendarEvent[];
  tasks: { id: string; name: string }[];
  onSave: (events: CalendarEvent[]) => Promise<void>;
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function CalendarView({ events, tasks, onSave }: Props) {
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', time: '', taskId: '' });

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const list: { date: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(cursor.year, cursor.month, -startOffset + 1 + i);
      list.push({ date: fmt(d), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(cursor.year, cursor.month, day);
      list.push({ date: fmt(d), day, inMonth: true });
    }
    while (list.length % 7 !== 0) {
      const d = new Date(cursor.year, cursor.month + 1, list.length - startOffset - daysInMonth + 1);
      list.push({ date: fmt(d), day: d.getDate(), inMonth: false });
    }
    return list;
  }, [cursor]);

  const byDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (!ev.date) continue;
      (map[ev.date] = map[ev.date] || []).push(ev);
    }
    return map;
  }, [events]);

  const prevMonth = () => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const nextMonth = () => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));

  const addEvent = async (date: string) => {
    const title = form.title.trim();
    if (!title) return;
    const task = tasks.find((t) => t.id === form.taskId);
    await onSave([
      ...events,
      {
        id: `evt_${Date.now().toString(36)}`,
        title,
        date,
        startTime: form.time || null,
        taskId: form.taskId || null,
        type: task ? 'task' : 'default',
      },
    ]);
    setAdding(null);
    setForm({ title: '', time: '', taskId: '' });
  };

  const deleteEvent = async (id: string) => {
    await onSave(events.filter((e) => e.id !== id));
  };

  return (
    <div className="mrc-calendar">
      <div className="mrc-calendar-head">
        <button className="mrc-btn small" onClick={prevMonth}>‹</button>
        <span className="mrc-calendar-title">{cursor.year} 年 {cursor.month + 1} 月</span>
        <button className="mrc-btn small" onClick={nextMonth}>›</button>
        <button className="mrc-btn small" onClick={() => { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }); }}>今天</button>
      </div>
      <div className="mrc-calendar-weekdays">
        {WEEKDAYS.map((w) => <div key={w} className="mrc-cal-weekday">{w}</div>)}
      </div>
      <div className="mrc-calendar-grid">
        {cells.map((cell) => {
          const dayEvents = byDate[cell.date] || [];
          const isToday = cell.date === today;
          return (
            <div key={cell.date} className={`mrc-cal-cell ${cell.inMonth ? '' : 'muted'} ${isToday ? 'today' : ''} ${adding === cell.date ? 'adding' : ''}`} onClick={() => setAdding(cell.date)}>
              <div className="mrc-cal-daynum">{cell.day}</div>
              {dayEvents.slice(0, 2).map((ev) => (
                <div key={ev.id} className={`mrc-cal-event type-${ev.type || 'default'}`} title={ev.title}>
                  {ev.startTime ? `${ev.startTime} ` : ''}{ev.title}
                  <button className="mrc-cal-del" onClick={(e) => { e.stopPropagation(); deleteEvent(ev.id); }}>×</button>
                </div>
              ))}
              {dayEvents.length > 2 && <div className="mrc-cal-more">+{dayEvents.length - 2}</div>}
              {adding === cell.date && (
                <div className="mrc-cal-add" onClick={(e) => e.stopPropagation()}>
                  <div className="mrc-cal-add-title">{cell.date} 添加日程</div>
                  <input autoFocus placeholder="日程标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addEvent(cell.date)} />
                  <div className="mrc-cal-add-row">
                    <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                    <select value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
                      <option value="">不关联</option>
                      {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="mrc-cal-add-actions">
                    <button className="mrc-btn primary small" onClick={() => addEvent(cell.date)}>添加</button>
                    <button className="mrc-btn small" onClick={() => { setAdding(null); setForm({ title: '', time: '', taskId: '' }); }}>取消</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
