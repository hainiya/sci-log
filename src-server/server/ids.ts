/**
 * 统一 id 生成（O-9）：此前 log-work.js / manage-schedule.js 各自实现 newId，
 * 而 commitDraft / CalendarView.addEvent / WorklogPanel.save 用 `prefix_${Date.now().toString(36)}`
 * 无随机后缀——同毫秒连写两条会撞 id。此处用时间戳 + Math.random 兜底（不依赖 crypto），统一一处。
 */
export function newId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
