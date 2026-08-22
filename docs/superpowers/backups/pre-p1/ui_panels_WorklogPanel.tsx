import { useMemo, useState } from 'react';
import { api } from '../api';
import { ConfirmButton } from '../components/ConfirmButton';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

// 常用结构化参数模板（材料实验高频字段），一键填入「实验数据」
const PARAM_TEMPLATES = [
  { label: '烧结', text: '温度(°C): \n时间(h): \n气氛: \n质量(mg): ' },
  { label: '旋涂', text: '前驱体: \n摩尔比: \n溶剂: \n旋涂转速(rpm): ' },
  { label: '表征', text: '退火温度(°C): \n退火时间(min): \nPL强度(a.u.): \nXRD物相: ' },
];

// ── 本地时间 <-> datetime-local 输入框 / ISO 互转（避免 UTC 日期偏移） ──
function pad(n: number) { return String(n).padStart(2, '0'); }

/** 本地当前时间 → input value（YYYY-MM-DDTHH:mm） */
function nowLocalInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 本地时间字符串 → ISO（本地时区转 UTC） */
function localInputToISO(v: string): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 条目 → input value：优先 createdAt（历史完整时刻），否则 date */
function entryToLocalInput(e: any): string {
  const d = e.createdAt ? new Date(e.createdAt) : new Date(`${e.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return nowLocalInput();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 条目 → 展示文本（YYYY-MM-DD HH:mm） */
function formatLogTime(e: any): string {
  if (e.createdAt) {
    const d = new Date(e.createdAt);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return e.date || '';
}

export function WorklogPanel({ state, onStateChange, showToast }: Props) {
  const entries: any[] = state?.worklog?.entries || [];
  const ganttTasks: any[] = state?.gantt?.tasks || [];
  const [content, setContent] = useState('');
  const [data, setData] = useState('');
  const [sampleId, setSampleId] = useState<string | null>(null); // null = 用自动建议值
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [logAt, setLogAt] = useState(nowLocalInput()); // 记录时间（可自行设置，默认当前）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ content: string; data: string; sampleId: string; time: string }>({ content: '', data: '', sampleId: '', time: nowLocalInput() });

  // 自动生成样品编号：S-YYYYMMDD-NN
  const suggestSampleId = () => {
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const seq = String((entries.filter((e) => e.sampleId && e.sampleId.includes(day)).length || 0) + 1).padStart(2, '0');
    return `S-${day}-${seq}`;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 按记录时间降序（createdAt 完整时间，旧条目回退 date）
    const list = [...entries].sort((a, b) =>
      (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || '')
    );
    if (!q) return list.slice(0, 50);
    return list.filter((e) =>
      (e.sampleId || '').toLowerCase().includes(q) ||
      (e.content || '').toLowerCase().includes(q) ||
      (e.data || '').toLowerCase().includes(q)
    );
  }, [entries, search]);

  const writeEntries = async (next: any[], okMsg: string) => {
    try {
      await api.write('worklog', state.worklog.version, { entries: next });
      await onStateChange();
      showToast(okMsg);
      return true;
    } catch (err: any) {
      showToast(err.message.includes('version_conflict') ? '数据已被更新，已为你刷新' : `保存失败：${err.message}`, { error: true });
      onStateChange();
      return false;
    }
  };

  const save = async () => {
    if (!content.trim() && !data.trim()) return;
    setSaving(true);
    try {
      const finalSampleId = (sampleId ?? suggestSampleId()).trim() || null;
      const ok = await writeEntries(
        [
          ...entries,
          {
            id: `work_${Date.now().toString(36)}`,
            sampleId: finalSampleId,
            date: logAt.slice(0, 10),
            content: content.trim(),
            data: data.trim() || null,
            taskId: taskId || null,
            createdAt: localInputToISO(logAt),
          },
        ],
        `实验记录已保存${finalSampleId ? `（${finalSampleId}）` : ''}，AI 巡检中，稍后可在「提案确认」查看关联文献/进度/日程建议`
      );
      if (ok && taskId && progress !== '') {
        await api.write('gantt', state.gantt.version, {
          tasks: ganttTasks.map((t) => (t.id === taskId ? { ...t, progress: Math.min(100, Math.max(0, Number(progress) || 0)) } : t)),
        }).catch(() => {});
        await onStateChange();
      }
      if (ok) { setContent(''); setData(''); setProgress(''); setTaskId(''); setSampleId(null); setLogAt(nowLocalInput()); }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: any) => {
    setEditingId(entry.id);
    setEditDraft({ content: entry.content || '', data: entry.data || '', sampleId: entry.sampleId || '', time: entryToLocalInput(entry) });
  };

  const saveEdit = async (id: string) => {
    const ok = await writeEntries(
      entries.map((e) =>
        e.id === id
          ? { ...e, content: editDraft.content.trim(), data: editDraft.data.trim() || null, sampleId: editDraft.sampleId.trim() || null, date: editDraft.time.slice(0, 10), createdAt: localInputToISO(editDraft.time), editedAt: new Date().toISOString() }
          : e
      ),
      '记录已更新'
    );
    if (ok) setEditingId(null);
  };

  const remove = async (id: string) => {
    await writeEntries(entries.filter((e) => e.id !== id), '记录已删除');
  };

  return (
    <div className="mrc-worklog">
      <div className="mrc-panel-section">
        <div className="mrc-section-head">
          <span className="mrc-section-title">✍️ 记录工作</span>
        </div>
        <div className="mrc-field">
          <label>时间（可自行设置，默认当前；补录昨日实验可直接改）</label>
          <input type="datetime-local" value={logAt} onChange={(e) => setLogAt(e.target.value)} />
        </div>
        <div className="mrc-field">
          <label>今天做了什么？</label>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：合成了 CsPbI3 薄膜，退火 150°C 后 PL 强度提升…" />
        </div>
        <div className="mrc-field">
          <label>实验数据 / 工艺参数（可选）</label>
          <textarea rows={2} value={data} onChange={(e) => setData(e.target.value)} placeholder={"结构化参数可分行：温度(°C): 150\n时间(h): 2"} />
          <div className="mrc-template-row">
            <span className="mrc-template-label">快捷模板：</span>
            {PARAM_TEMPLATES.map((tpl) => (
              <button key={tpl.label} className="mrc-btn small" onClick={() => setData((d) => (d ? d + '\n' : '') + tpl.text)}>{tpl.label}</button>
            ))}
          </div>
        </div>
        <div className="mrc-field-row">
          <input
            value={sampleId ?? suggestSampleId()}
            onChange={(e) => setSampleId(e.target.value)}
            placeholder="样品编号（可自定义，如 CSP-01）"
            title="样品编号可自定义，便于按体系追溯"
          />
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">关联任务（可选）</option>
            {ganttTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {taskId && (
            <input type="number" min={0} max={100} placeholder="任务进度 %" value={progress} onChange={(e) => setProgress(e.target.value)} />
          )}
        </div>
        <div className="mrc-worklog-actions">
          <button className="mrc-btn primary" onClick={save} disabled={saving || (!content.trim() && !data.trim())}>
            {saving ? '保存中…' : '记录本次工作'}
          </button>
        </div>
      </div>

      <div className="mrc-panel-section">
        <div className="mrc-section-head">
          <span className="mrc-section-title">🧪 实验记录</span>
          <span className="mrc-count">{entries.length}</span>
          <input
            className="mrc-worklog-search"
            placeholder="按样品编号 / 内容检索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mrc-list">
          {entries.length === 0 && <div className="mrc-empty">还没有实验记录。记录工作后，可让助手审查研究进展。</div>}
          {entries.length > 0 && filtered.length === 0 && <div className="mrc-empty">没有匹配「{search}」的记录。</div>}
          {filtered.map((entry) => (
            <article key={entry.id} className="mrc-log-entry">
              {editingId === entry.id ? (
                <div className="mrc-log-edit">
                  <div className="mrc-field-row">
                    <input type="datetime-local" value={editDraft.time} onChange={(e) => setEditDraft({ ...editDraft, time: e.target.value })} title="记录时间" />
                    <input value={editDraft.sampleId} onChange={(e) => setEditDraft({ ...editDraft, sampleId: e.target.value })} placeholder="样品编号" />
                  </div>
                  <textarea rows={3} value={editDraft.content} onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })} placeholder="内容" />
                  <textarea rows={2} value={editDraft.data} onChange={(e) => setEditDraft({ ...editDraft, data: e.target.value })} placeholder="数据 / 参数" />
                  <div className="mrc-actions">
                    <button className="mrc-btn primary small" onClick={() => saveEdit(entry.id)}>保存修改</button>
                    <button className="mrc-btn small" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mrc-log-head">
                    <span className="mrc-log-date">{formatLogTime(entry)}</span>
                    {entry.sampleId && <span className="mrc-log-sample" title="样品编号">🧪 {entry.sampleId}</span>}
                    {entry.taskId && <span className="mrc-log-task">#{entry.taskId}</span>}
                    {entry.editedAt && <span className="mrc-log-edited" title={`编辑于 ${new Date(entry.editedAt).toLocaleString('zh-CN')}`}>已编辑</span>}
                    <span className="mrc-log-actions">
                      <button className="mrc-btn small" onClick={() => startEdit(entry)}>编辑</button>
                      <ConfirmButton label="删" className="mrc-btn small danger" onConfirm={() => remove(entry.id)} title="删除这条记录" />
                    </span>
                  </div>
                  <div className="mrc-log-content">{entry.content}</div>
                  {entry.fields && Object.keys(entry.fields).length > 0 && (
                    <div className="mrc-log-fields">
                      {Object.entries(entry.fields).map(([k, v]) => (
                        <span key={k} className="mrc-log-field">{k}: <b>{String(v)}</b></span>
                      ))}
                    </div>
                  )}
                  {entry.citations && entry.citations.length > 0 && (
                    <div className="mrc-log-citations">📎 关联文献：{entry.citations.join('、')}</div>
                  )}
                  {entry.data && <pre className="mrc-log-data">{entry.data}</pre>}
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
