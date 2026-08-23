/**
 * 共享日期/时间工具（DRY）：此前 CalendarView/GanttChart/MetricsChart/Dashboard/WorklogPanel
 * 各自重复实现了 fmt/pad/todayStr/addDays/dayIndex/dateToMs/fmtDateShort/formatLogTime，现统一到此。
 * 全部为本地时区、纯函数、无宿主依赖，便于单测。
 */

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地当前日期 → YYYY-MM-DD */
export function todayStr(): string {
  return fmt(new Date());
}

/** Date → YYYY-MM-DD（本地时区） */
export function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function dayIndex(dateStr: string | null, min: Date): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Math.max(0, Math.round((d.getTime() - min.getTime()) / 86400000));
}

export function dateToMs(date: string): number {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** YYYY-MM-DD → MM/DD（用于 X 轴短标签）；非法输入原样返回 */
export function fmtDateShort(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return date || '';
  return `${m[2]}/${m[3]}`;
}

/** 条目 → 展示时间（YYYY-MM-DD HH:mm）；无 createdAt 时回退 date */
export function formatLogTime(e: any): string {
  if (e.createdAt) {
    const d = new Date(e.createdAt);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return e.date || '';
}
