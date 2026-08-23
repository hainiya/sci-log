import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLogTime } from '../lib/dates';
import { newId } from '../lib/ids';
import { api } from '../api';
import { ConfirmButton } from '../components/ConfirmButton';

// 材料体系预设（与 src-server/server/metrics.js SYSTEM_DEFS / 巡检提示词一致，共 11 项；「无机/有机复合」为斜杠分隔）
const SYSTEM_PRESETS = ['SnSe', 'SnS₂', 'SnS', 'Bi₂Te₃', 'PbSe', 'MnTe', 'Cu₂Se', 'Ag₂Se', 'PEDOT/导电聚合物', '碳材料', '无机/有机复合'];

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
  /** 外部请求编辑指定条目 id（如指标面板「✏️ 补标注」跳转）；消费后应经 onConsumeEditEntryId 清空，防重复触发 */
  editEntryId?: string | null;
  onConsumeEditEntryId?: () => void;
};

// 常用结构化参数模板（材料实验高频字段），一键填入「实验数据」
const PARAM_TEMPLATES = [
  { label: '烧结', text: '温度(°C): \n时间(h): \n气氛: \n质量(mg): ' },
  { label: '旋涂', text: '前驱体: \n摩尔比: \n溶剂: \n旋涂转速(rpm): ' },
  { label: '表征', text: '退火温度(°C): \n退火时间(min): \nPL强度(a.u.): \nXRD物相: ' },
];

// ── 本地日期工具（避免 UTC 日期偏移） ──
/** 条目 → 展示文本（YYYY-MM-DD HH:mm） */

export function WorklogPanel({ state, onStateChange, showToast, editEntryId, onConsumeEditEntryId }: Props) {
  const entries: any[] = state?.worklog?.entries || [];
  const ganttTasks: any[] = state?.gantt?.tasks || [];
  const [content, setContent] = useState('');
  const [data, setData] = useState('');
  const [system, setSystem] = useState('');
  const [sampleId, setSampleId] = useState<string | null>(null); // null = 用自动建议值
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState('');
  const [saving, setSaving] = useState(false);
  // 手动记录表单默认折叠（AI 记录为主，手动仅补充/纠错），点「记录工作」标题或「＋记录」展开
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [durationHours, setDurationHours] = useState(''); // 时长（小时，可选；填写后甘特图投影实际时间线）
  const [startDate, setStartDate] = useState(''); // 开始日期（YYYY-MM-DD，可选，缺省为记录日期）
  const [editingId, setEditingId] = useState<string | null>(null);
  // 列表正文「展开全文 / 收起」状态（默认截断，长记录才需要展开）
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [editDraft, setEditDraft] = useState<{ content: string; data: string; sampleId: string; system: string; durationHours: string; startDate: string }>({ content: '', data: '', sampleId: '', system: '', durationHours: '', startDate: '' });
  // 批量导入（仪器表格粘贴 → 合并记录）
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);

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

  // 外部请求编辑（如指标面板「✏️ 补标注」跳转）：清空搜索过滤确保目标条目渲染，
  // 打开编辑弹窗并滚动聚焦到该条记录；随后清空请求防重复触发；找不到则忽略
  useEffect(() => {
    if (!editEntryId) return;
    const entry = entries.find((e) => e.id === editEntryId);
    if (entry) {
      if (search) setSearch(''); // 清掉检索词，避免目标条目被过滤掉
      setEditingId(entry.id);
      setEditDraft({ content: entry.content || '', data: entry.data || '', sampleId: entry.sampleId || '', system: entry.system || '', durationHours: entry.durationHours ?? '', startDate: entry.startDate || '' });
      // 等列表重渲染后滚动到该条记录（避免从头下滑找）
      setTimeout(() => {
        document.getElementById(`mrc-log-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
    onConsumeEditEntryId?.();
  }, [editEntryId]);

  // ── worklog 写入：只用 PUT /worklog（新增/编辑共用，确定可用）──
  // 首次用当前快照 version 提交；若乐观锁冲突(409)，响应会带回最新 doc，
  // 用它在最新数据上重新 patch 后再写（最多重试 2 次），避免「编辑无法保存」卡死。
  // 不额外依赖 GET /worklog，排除该请求挂起/失败导致保存整体失败。
  const lastConflictDocRef = useRef<any>(null);
  const writeWorklog = async (updater: (latest: any[]) => any[], okMsg: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let base: { version: number; entries: any[] };
      if (attempt === 0) {
        base = { version: state.worklog?.version, entries: state.worklog?.entries || [] };
      } else {
        const conflict = lastConflictDocRef.current;
        if (!conflict || !conflict.entries) {
          showToast('数据已被其他更新占用，请刷新后重试', { error: true });
          return false;
        }
        base = { version: conflict.version, entries: conflict.entries || [] };
      }
      const next = updater(base.entries);
      try {
        await api.write('worklog', base.version, { entries: next });
        lastConflictDocRef.current = null;
        await onStateChange();
        showToast(okMsg);
        return true;
      } catch (err: any) {
        if (err?.message?.includes('version_conflict') && err?.data && attempt < 2) {
          lastConflictDocRef.current = err.data; // 409 携带最新 doc，基于它重试
          continue;
        }
        showToast(err?.message?.includes('version_conflict')
          ? '数据持续被其他更新占用，请稍后再试'
          : `保存失败：${err?.message || String(err)}${err?.detail ? `（${err.detail}）` : ''}`, { error: true });
        await onStateChange();
        return false;
      }
    }
    return false;
  };

  const save = async () => {
    if (!content.trim() && !data.trim()) return;
    // 记录日期 = 提交当天（不再提供表单字段）；开始日期可选，缺省即从记录当天开始
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地时区）
    const dhNum = durationHours.trim() === '' ? null : Number(durationHours.trim());
    if (dhNum !== null && (!Number.isFinite(dhNum) || dhNum <= 0)) {
      showToast('时长必须为正数（小时）', { error: true });
      return;
    }
    if (startDate && startDate > todayStr) {
      showToast('开始日期不能晚于今天', { error: true });
      return;
    }
    setSaving(true);
    try {
      const finalSampleId = (sampleId ?? suggestSampleId()).trim() || null;
      const ok = await writeWorklog(
        (latest) => [
          ...latest,
          {
            id: newId("work"),
            sampleId: finalSampleId,
            system: system.trim() || null,
            date: todayStr,
            content: content.trim(),
            data: data.trim() || null,
            taskId: taskId || null,
            durationHours: dhNum,
            startDate: startDate.trim() || null,
            createdAt: new Date().toISOString(),
          },
        ],
        `实验记录已保存${finalSampleId ? `（${finalSampleId}）` : ''}，AI 巡检中，稍后在「实验记录」中查看关联文献/进度/日程建议`
      );
      if (ok && taskId && progress !== '') {
        await api.write('gantt', state.gantt.version, {
          tasks: ganttTasks.map((t) => (t.id === taskId ? { ...t, progress: Math.min(100, Math.max(0, Number(progress) || 0)) } : t)),
        }).catch(() => {});
        await onStateChange();
      }
      if (ok) { setContent(''); setData(''); setSystem(''); setProgress(''); setTaskId(''); setSampleId(null); setDurationHours(''); setStartDate(''); }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: any) => {
    setEditingId(entry.id);
    setEditDraft({ content: entry.content || '', data: entry.data || '', sampleId: entry.sampleId || '', system: entry.system || '', durationHours: entry.durationHours ?? '', startDate: entry.startDate || '' });
  };

  const saveEdit = async (id: string) => {
    // 编辑以「纠错 AI 记录」为主：不得因 AI 遗留的非法时长/日期值拦截保存。
    // 非法时长归一为 null（甘特图不投影）；日期仅做格式校验，不拦截未来值（用户可下次改回）。
    const rawDur = String(editDraft.durationHours ?? '').trim();
    const dhNum = rawDur === '' ? null : Number(rawDur);
    const dhValid = dhNum === null || (Number.isFinite(dhNum) && dhNum > 0);
    const finalDh = dhValid ? dhNum : null;
    const startDate = String(editDraft.startDate ?? '').trim() || null;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      showToast('开始日期格式有误（应为 YYYY-MM-DD）', { error: true });
      return;
    }
    const ok = await writeWorklog(
      (latest) => latest.map((e) =>
        e.id === id
          ? { ...e, content: editDraft.content.trim(), data: editDraft.data.trim() || null, sampleId: editDraft.sampleId.trim() || null, system: editDraft.system.trim() || null, editedAt: new Date().toISOString(), durationHours: finalDh, startDate }
          : e
      ),
      '记录已更新'
    );
    if (ok) setEditingId(null);
  };

  const remove = async (id: string) => {
    await writeWorklog((latest) => latest.filter((e) => e.id !== id), '记录已删除');
  };

  const runImportPreview = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const res = await api.importWorklog(importText, true);
      setImportPreview(res);
    } catch (err: any) {
      showToast(`解析失败：${err.message}`, { error: true });
    } finally {
      setImporting(false);
    }
  };

  const runImportConfirm = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const res = await api.importWorklog(importText, false);
      if (res.ok) {
        const skipNote = res.skippedRows > 0 ? `，${res.skippedRows} 行因格式错误跳过` : '';
        showToast(`已导入 ${res.imported} 条记录（${res.points} 个指标点）${skipNote}`);
        setImportText('');
        setImportPreview(null);
        setShowImport(false);
        await onStateChange();
      } else {
        showToast(res.error === 'no_valid_rows' ? '没有有效数据行可导入' : '导入失败', { error: true });
      }
    } catch (err: any) {
      showToast(`导入失败：${err.message}`, { error: true });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mrc-worklog">
      <div className="mrc-panel-section">
        <button type="button" className="mrc-accordion-head" onClick={() => setShowForm((v) => !v)} title="AI 自动记录为主；需要补充或修改 AI 记错的地方时手动添加">
          <span className="mrc-section-title">✍️ 手动记录</span>
          <span className="mrc-hint">AI 记录为主 · 手动仅补充 / 纠错</span>
          <span className="mrc-accordion-toggle">{showForm ? '收起 ▴' : '展开 ▾'}</span>
        </button>
        {showForm && (
        <>
        <div className="mrc-form-group">
          <div className="mrc-form-group-title">基本信息</div>
          <div className="mrc-field">
            <label>今天做了什么？</label>
            <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：合成了 CsPbI3 薄膜，退火 150°C 后 PL 强度提升…" />
          </div>
          <div className="mrc-field">
            <label>材料体系（可选）</label>
            <span className="mrc-field-hint">用于指标趋势归类；可自由输入，或从预设中选择</span>
            <input
              list="mrc-system-preset"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="如 SnSe、Bi₂Te₃…"
            />
            <datalist id="mrc-system-preset">
              {SYSTEM_PRESETS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="mrc-form-group">
          <div className="mrc-form-group-title">参数与数据</div>
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
        </div>
        <div className="mrc-form-group">
          <div className="mrc-form-group-title">排期与关联</div>
          <div className="mrc-field">
            <label>时长（小时，可选；填写后甘特图投影实际时间线）</label>
            <input type="number" min={0.1} step={0.1} value={durationHours} onChange={(e) => setDurationHours(e.target.value)} placeholder="例如：244" />
            {durationHours.trim() !== '' && Number(durationHours) > 0 && (
              <span className="mrc-hint">≈ {(Number(durationHours) / 24).toFixed(1)} 天</span>
            )}
          </div>
          <div className="mrc-field">
            <label>开始日期（可选）</label>
            <span className="mrc-field-hint">决定甘特图实际条起点；留空则从记录当天开始</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
        </div>
        <div className="mrc-worklog-actions">
          <button className="mrc-btn primary" onClick={save} disabled={saving || (!content.trim() && !data.trim())}>
            {saving ? '保存中…' : '记录本次工作'}
          </button>
          <button className="mrc-btn" onClick={() => setShowImport((v) => !v)} title="粘贴仪器导出的表格，批量导入指标数据">
            📥 批量导入
          </button>
        </div>
        {showImport && (
          <div className="mrc-import-box">
            <div className="mrc-import-help">
              粘贴仪器导出的表格（Excel 直接复制即可）：第一行为表头（日期 / 样品 / 温度 / ZT / Seebeck…），一行一个温度点。
              同日期同样品号自动合并为一条记录；温度列支持 823K / 550°C / 裸数字（表头 T(°C) 按摄氏归一）。
            </div>
            <textarea
              rows={5}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportPreview(null);
              }}
              placeholder={'date\tsampleId\tsystem\t温度\tZT\tSeebeck\n2026-08-14\tS-1\tSnSe\t823\t0.9\t380\n2026-08-14\tS-1\tSnSe\t873\t0.7\t320'}
            />
            {importPreview && (
              <div className="mrc-import-preview">
                <div className="mrc-import-summary">
                  将导入 {importPreview.summary.records} 条记录 / {importPreview.summary.points} 个指标点（共 {importPreview.summary.rows} 行）
                </div>
                {importPreview.records.map((r: any, i: number) => (
                  <div key={i} className="mrc-import-record">
                    <span className="mrc-import-date">{r.date}</span>
                    {r.sampleId && <span className="mrc-log-sample">🧪 {r.sampleId}</span>}
                    {r.system && <span className="mrc-chip mini">{r.system}</span>}
                    <span className="mrc-import-fields">{r.fields.map((f: any) => f.k).join('、')}</span>
                  </div>
                ))}
                {importPreview.errors.length > 0 && (
                  <div className="mrc-import-errors">
                    {importPreview.errors.map((e: any, i: number) => (
                      <div key={i} className="mrc-import-error">第 {e.line} 行：{e.reason}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mrc-import-actions">
              <button className="mrc-btn small" onClick={runImportPreview} disabled={importing || !importText.trim()}>
                {importing ? '解析中…' : '解析预览'}
              </button>
              {importPreview && importPreview.summary.records > 0 && (
                <button className="mrc-btn primary small" onClick={runImportConfirm} disabled={importing}>
                  {importing ? '导入中…' : `确认导入 ${importPreview.summary.records} 条`}
                </button>
              )}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      <div className="mrc-panel-section">
        <div className="mrc-section-head">
          <span className="mrc-section-title">🧪 实验记录</span>
          <span className="mrc-count">{entries.length}</span>
          <button className="mrc-btn small primary" onClick={() => setShowForm(true)} title="手动补充 / 批量导入">＋ 记录</button>
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
            <article key={entry.id} id={`mrc-log-${entry.id}`} className={`mrc-log-entry ${editingId === entry.id ? 'editing' : ''}`}>
              {editingId === entry.id ? (
                <div className="mrc-log-edit">
                  <div className="mrc-field-row">
                    <input value={editDraft.sampleId} onChange={(e) => setEditDraft({ ...editDraft, sampleId: e.target.value })} placeholder="样品编号" />
                  </div>
                  <div className="mrc-field-row">
                    <input list="mrc-system-preset" value={editDraft.system} onChange={(e) => setEditDraft({ ...editDraft, system: e.target.value })} placeholder="材料体系（如 SnSe）" />
                  </div>
                  <div className="mrc-field-row">
                    <input type="number" min={0.1} step={0.1} value={editDraft.durationHours} onChange={(e) => setEditDraft({ ...editDraft, durationHours: e.target.value })} placeholder="时长（小时，可选）" title="填写后甘特图投影实际时间线" />
                  </div>
                  <div className="mrc-field">
                    <label>开始日期（可选）</label>
                    <span className="mrc-field-hint">决定甘特图实际条起点；留空则从记录当天开始</span>
                    <input type="date" value={editDraft.startDate} onChange={(e) => setEditDraft({ ...editDraft, startDate: e.target.value })} />
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
                    {entry.system && <span className="mrc-chip mini" title="材料体系">{entry.system}</span>}
                    {entry.taskId && <span className="mrc-log-task">#{entry.taskId}</span>}
                    {entry.editedAt && <span className="mrc-log-edited" title={`编辑于 ${new Date(entry.editedAt).toLocaleString('zh-CN')}`}>已编辑</span>}
                    <span className="mrc-log-actions">
                      <button className="mrc-btn small" onClick={() => startEdit(entry)}>编辑</button>
                      <ConfirmButton label="删" className="mrc-btn small danger" onConfirm={() => remove(entry.id)} title="删除这条记录" />
                    </span>
                  </div>
                  {(() => {
                    const text = String(entry.content || '');
                    const expandedRow = expandedRows.has(entry.id);
                    return (
                      <div className="mrc-log-content">
                        {expandedRow || text.length <= 180 ? text : text.slice(0, 180) + '…'}
                        {text.length > 180 && (
                          <button className="mrc-link-btn" onClick={() => toggleRow(entry.id)}>
                            {expandedRow ? ' 收起' : ' 展开全文'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {entry.fields && Object.keys(entry.fields).length > 0 && (
                    <div className="mrc-log-fields">
                      {Object.entries(
                        Array.isArray(entry.fields)
                          ? Object.fromEntries(entry.fields.map((f: any) => [f?.k, f?.v]))
                          : entry.fields
                      ).map(([k, v]) => (
                        <span key={k} className="mrc-log-field">{k}: <b>{v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</b></span>
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
