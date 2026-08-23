/**
 * 统一 id 生成（O-9 前端同构）：与 src-server/server/ids.js 一致，
 * 供 SchedulePanel / CalendarView / WorklogPanel 在新增任务/日程/记录时生成唯一 id。
 */
export function newId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
