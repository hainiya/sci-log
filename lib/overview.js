/**
 * 工作台概览数据（只读）：面板 /state 路由用
 * - 从 store 读各文档，返回轻量概览（计数 + 最近记录，不含文献全文）
 */
import { createStore } from "./store.js";

export async function buildOverview(dataDir, resources) {
  const store = createStore(dataDir, resources);
  const [worklog, gantt, calendar, literature, settings] = await Promise.all([
    store.read("worklog"),
    store.read("gantt"),
    store.read("calendar"),
    store.read("literature"),
    store.read("settings"),
  ]);

  const entries = worklog.entries || [];
  const recent = entries
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      date: e.date,
      content: String(e.content || "").slice(0, 80),
      kind: e.kind || "worklog",
      system: e.system || null,
      durationHours: e.durationHours ?? null,
    }));

  const tasks = (gantt.tasks || [])
    .slice()
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      name: t.name,
      start: t.start,
      end: t.end,
      progress: t.progress ?? 0,
    }));

  const events = (calendar.events || [])
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .filter((e) => e.date >= new Date().toISOString().slice(0, 10))
    .slice(0, 10)
    .map((e) => ({ id: e.id, title: e.title, date: e.date, type: e.type || "default" }));

  const litEntries = literature.entries || [];
  const litTotal = litEntries.length;
  const zoteroMirror = litEntries.filter((e) => e.zoteroKey).length;

  return {
    counts: {
      worklog: entries.length,
      gantt: tasks.length,
      ganttTotal: (gantt.tasks || []).length,
      calendar: events.length,
      calendarTotal: (calendar.events || []).length,
      literature: litTotal,
      zoteroMirror,
    },
    recent,
    tasks,
    events,
    meta: {
      worklogUpdatedAt: worklog.updatedAt,
      ganttUpdatedAt: gantt.updatedAt,
      literatureUpdatedAt: literature.updatedAt,
      zoteroLastSyncAt: settings?.zoteroLastSyncAt || null,
      zoteroCount: settings?.zoteroCount ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
}
