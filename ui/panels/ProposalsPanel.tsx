import { useMemo, useState } from 'react';
import { api } from '../api';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

const STALE_DAYS = 7;
function isStale(p: any) {
  if (!p?.createdAt) return false;
  const t = Date.parse(p.createdAt);
  if (!t) return false;
  return Date.now() - t > STALE_DAYS * 86400000;
}

const TARGET_LABELS: Record<string, string> = {
  plan: '研究方案',
  gantt: '甘特图',
  calendar: '日历',
  worklog: '实验记录',
  literature: '文献库',
};

const FIELD_LABELS: Record<string, Record<string, string>> = {
  plan: { title: '题目', hypothesis: '研究假设', route: '技术路线', milestones: '里程碑' },
  gantt: { name: '任务名', start: '开始', end: '结束', progress: '进度', dependsOn: '依赖' },
  calendar: { title: '标题', date: '日期', type: '类型' },
  worklog: { content: '内容', date: '记录日期', data: '实验数据', sampleId: '样品编号', system: '材料体系', durationHours: '实验时长', startDate: '开始日期', taskId: '关联任务', planVersion: '方案版本', fields: '参数', citations: '关联文献', createdAt: '创建时间', editedAt: '编辑时间', id: '记录 ID' },
  literature: { title: '标题', status: '状态' },
};

/** 展示层隐藏的内部标识（不参与 diff 渲染，但保留在数据与编辑 draft 中） */
const HIDDEN_DIFF_KEYS: Record<string, string[]> = {
  worklog: ['id', 'createdAt', 'planVersion', 'editedAt'],
  literature: ['createdAt'],
};

function labelFor(target: string, key: string) {
  return FIELD_LABELS[target]?.[key] || key;
}

function valueText(v: any): string {
  if (v == null) return '（空）';
  if (Array.isArray(v)) {
    if (v.length === 0) return '（空）';
    return v
      .map((x) => {
        if (x && typeof x === 'object') {
          const label = x.name ?? x.title ?? x.text;
          if (label != null) return String(label) + (x.date ? `（${x.date}）` : '');
          return JSON.stringify(x);
        }
        return String(x);
      })
      .join(' / ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 数组转可编辑文本：对象元素 JSON 保真（改后接受不丢 date/criteria/id），普通元素原样 */
function arrayToText(v: any[]): string {
  return v
    .map((x) => {
      if (x && typeof x === 'object') return JSON.stringify(x);
      return String(x);
    })
    .join('\n');
}

/** 判断是否为 [{k, v}] 参数数组（AI 巡检提取的实验参数） */
function isFieldArray(v: any): v is { k: string; v: unknown }[] {
  return Array.isArray(v) && v.length > 0 && v.every((f: any) => f && typeof f === 'object' && 'k' in f && 'v' in f);
}

/** 展示行：fields 展开为「参数名: 值」、过滤内部标识；value 保留原始结构供渲染器处理 */
type DisplayRow = { label: string; value: any; rawKey?: string };
function displayRows(target: string, diff: any): DisplayRow[] {
  if (!diff || typeof diff !== 'object') return [];
  const hidden = HIDDEN_DIFF_KEYS[target] || [];
  const rows: DisplayRow[] = [];
  for (const [k, v] of Object.entries(diff)) {
    if (hidden.includes(k)) continue;
    if (k === 'fields' && isFieldArray(v)) {
      for (const f of v) rows.push({ label: String(f.k), value: f.v, rawKey: k });
      continue;
    }
    rows.push({ label: labelFor(target, k), value: v, rawKey: k });
  }
  return rows;
}

/** 实验记录内容上下文：AI 巡检 update 提案定位到具体记录，避免只看到 id */
function worklogContext(state: any, diff: any): string | null {
  const id = diff?.id;
  if (!id) return null;
  const e = (state?.worklog?.entries || []).find((x: any) => x.id === id);
  const text = e?.content ? String(e.content) : e?.sampleId ? `样品 ${e.sampleId}` : null;
  if (!text) return null;
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

/** 把 diff 拍平成 {key, value} 列表，支持一层嵌套对象 */
function flattenDiff(diff: any): { key: string; value: any }[] {
  if (!diff || typeof diff !== 'object') return [];
  const out: { key: string; value: any }[] = [];
  for (const [k, v] of Object.entries(diff)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as any)) {
        out.push({ key: `${k}.${k2}`, value: v2 });
      }
    } else {
      out.push({ key: k, value: v });
    }
  }
  return out;
}

export function ProposalsPanel({ state, onStateChange, showToast }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing] = useState<{ id: string; draft: Record<string, any>; arrayKeys?: Set<string> } | null>(null);

  const pending = (state?.proposals?.entries || []).filter((p: any) => p.status === 'pending');

  // Zotero key → 标题（citations 从 key 渲染成可读文献标题）
  const litTitleMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of state?.literature?.entries || []) {
      if (e?.zoteroKey && e?.title) m.set(e.zoteroKey, String(e.title));
    }
    return m;
  }, [state?.literature?.entries]);

  const accept = async (id: string) => {
    setBusyId(id);
    const proposal = pending.find((p: any) => p.id === id);
    const wasEmptyPlan =
      proposal?.target === 'plan' &&
      !String(state?.plan?.title || '').trim() &&
      !String(state?.plan?.hypothesis || '').trim();
    try {
      await api.acceptProposal(id);
      await onStateChange();
      showToast('提案已接受并生效');
      if (wasEmptyPlan) {
        try {
          const scan = await api.scan();
          showToast(`方案已建立，自动搜集文献 ${scan.found ?? 0} 条`);
          await api.refreshReport().catch(() => {});
          await onStateChange();
        } catch {}
      }
    } catch (err: any) {
      if (String(err.message).includes('version_conflict')) {
        showToast('数据已被更新，请刷新后由 AI 重新生成提案', { error: true });
      } else {
        showToast(`接受失败：${err.message}`, { error: true });
      }
      await onStateChange();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    setBusyId(id);
    try {
      await api.rejectProposal(id, rejectReason.trim());
      setRejecting(null);
      setRejectReason('');
      await onStateChange();
      showToast('提案已拒绝（理由已归档，后续建议会参考）');
    } catch (err: any) {
      showToast(`拒绝失败：${err.message}`, { error: true });
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (id: string, diff: any) => {
    const draft: Record<string, any> = {};
    const arrayKeys = new Set<string>();
    for (const { key, value } of flattenDiff(diff)) {
      if (key === 'fields' && isFieldArray(value)) {
        // 参数数组以「参数名: 值」每行展开，提交时再解析还原（避免 diff 结构破坏）
        draft[key] = value.map((f: any) => `${f.k}: ${f.v}`).join('\n');
        arrayKeys.add(key);
      } else if (Array.isArray(value)) {
        draft[key] = arrayToText(value);
        arrayKeys.add(key);
      } else {
        draft[key] = value;
      }
    }
    setEditing({ id, draft, arrayKeys });
  };

  const acceptModified = async () => {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      // 还原数组字段（按换行拆分；仅还原原值为数组的字段，避免 content/route 等多行字符串被误拆）
      const diff: any = {};
      for (const [k, v] of Object.entries(editing.draft)) {
        if (k === 'fields' && typeof v === 'string') {
          // 还原 [{k, v}] 参数数组（每行「参数名: 值」，首个冒号分割）
          const lines = v.split('\n').map((s) => s.trim()).filter(Boolean);
          if (lines.length > 0) {
            diff[k] = lines.map((line) => {
              const i = line.indexOf(': ');
              return i > 0 ? { k: line.slice(0, i), v: line.slice(i + 2) } : { k: line, v: '' };
            });
            continue;
          }
        }
        if (typeof v === 'string' && editing.arrayKeys?.has(k)) {
          const lines = v.split('\n').map((s) => s.trim()).filter(Boolean);
          // 对象数组以 JSON 行保真还原（改后接受不丢 date/criteria/id）；普通字符串行还原为字符串数组
          diff[k] = lines.map((line) => {
            if (line.startsWith('{')) {
              try {
                return JSON.parse(line);
              } catch {
                return line;
              }
            }
            return line;
          });
          continue;
        }
        diff[k] = v;
      }
      await api.acceptModifiedProposal(editing.id, diff);
      setEditing(null);
      await onStateChange();
      showToast('已按修改内容生效');
    } catch (err: any) {
      showToast(`失败：${err.message}`, { error: true });
    } finally {
      setBusyId(null);
    }
  };

  const groups = useMemo(() => {
    const g: Record<string, { target: string; action: string; count: number }> = {};
    for (const p of pending) {
      const key = `${p.target}:${p.action}`;
      if (!g[key]) g[key] = { target: p.target, action: p.action, count: 0 };
      g[key].count += 1;
    }
    return Object.values(g).filter((x) => x.count > 1);
  }, [pending]);

  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState<string | null>(null);
  const acceptBatch = async (target: string, action: string) => {
    setBatchBusy(`${target}:${action}`);
    setBatchConfirm(null);
    try {
      const r = await api.acceptProposalBatch(target, action);
      await onStateChange();
      showToast(`批量接受完成：${r.accepted}/${r.total} 生效${r.failed.length > 0 ? `，${r.failed.length} 因版本冲突跳过` : ''}`);
    } catch (err: any) {
      showToast(`批量接受失败：${err.message}`, { error: true });
    } finally {
      setBatchBusy(null);
    }
  };

  if (pending.length === 0) {
    return <div className="mrc-empty">没有待确认的提案。AI 对面板内容的修改会先在这里等你确认。</div>;
  }

  return (
    <div className="mrc-proposals">
      {groups.length > 0 && (
        <div className="mrc-batch-row">
          {groups.map((g) => (
            <div key={`${g.target}:${g.action}`} className="mrc-batch-group">
              <button
                className="mrc-btn small"
                disabled={batchBusy !== null}
                onClick={() => setBatchConfirm(`${g.target}:${g.action}`)}
              >
                {batchBusy === `${g.target}:${g.action}` ? '接受中…' : `⚡ 接受全部 ${TARGET_LABELS[g.target] || g.target}·${g.action}（${g.count}）`}
              </button>
              {batchConfirm === `${g.target}:${g.action}` && (
                <span className="mrc-batch-confirm">
                  <span className="mrc-batch-confirm-text">确认接受这 {g.count} 条？</span>
                  <button
                    className="mrc-btn small danger"
                    disabled={batchBusy !== null}
                    onClick={() => acceptBatch(g.target, g.action)}
                  >
                    确认接受
                  </button>
                  <button className="mrc-btn small" onClick={() => setBatchConfirm(null)}>
                    取消
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {pending.map((proposal: any) => {
        const isCreate = proposal.action === 'create';
        return (
          <article key={proposal.id} className="mrc-proposal">
            <div className="mrc-proposal-head">
              <span className={`mrc-chip mini target-${proposal.target}`}>{TARGET_LABELS[proposal.target] || proposal.target}</span>
              <span className="mrc-chip mini">{proposal.action}</span>
              <span className="mrc-proposal-id">{proposal.id}</span>
              {isStale(proposal) && <span className="mrc-chip mini stale" title="提案已等待超过 7 天">⏰ 超 7 天</span>}
            </div>
            {proposal.reason && <div className="mrc-proposal-reason">💬 {proposal.reason}</div>}
            {proposal.target === 'worklog' && !isCreate && (() => { const ctx = worklogContext(state, proposal.diff); return ctx ? <div className="mrc-proposal-context">📝 {ctx}</div> : null; })()}

            {editing?.id === proposal.id ? (
              (() => {
                const ed = editing as { id: string; draft: Record<string, any> };
                return (
              <div className="mrc-proposal-edit">
                {Object.entries(ed.draft).map(([key, val]) => (
                  <div key={key} className="mrc-field">
                    <label>{labelFor(proposal.target, key)}</label>
                    {key === 'id' ? (
                      <input value={String(val ?? '')} disabled />
                    ) : (
                      <textarea rows={3} value={String(val ?? '')} onChange={(e) => setEditing({ id: ed.id, draft: { ...ed.draft, [key]: e.target.value } })} />
                    )}
                  </div>
                ))}
                <div className="mrc-actions">
                  <button className="mrc-btn primary" disabled={busyId === proposal.id} onClick={acceptModified}>应用修改</button>
                  <button className="mrc-btn" onClick={() => setEditing(null)}>取消</button>
                </div>
              </div>
                );
              })()
            ) : (
              <>
                <div className={`mrc-proposal-diff ${isCreate ? 'is-create' : 'is-update'}`}>
                  {displayRows(proposal.target, proposal.diff).length === 0 && <div className="mrc-diff-row"><span className="mrc-diff-key">（无字段变更）</span></div>}
                  {displayRows(proposal.target, proposal.diff).map(({ label, value, rawKey }, i) => {
                    let text = valueText(value);
                    if (rawKey === 'citations' && Array.isArray(value)) {
                      // 关联文献：Zotero key → 标题（未入库的 key 保留原文）
                      text = value.map((k) => litTitleMap.get(String(k)) || String(k)).join('、') || '（空）';
                    } else if (rawKey === 'durationHours' && typeof value === 'number') {
                      text = `${value} 小时`;
                    }
                    return (
                      <div key={label + ':' + i} className="mrc-diff-row">
                        <span className="mrc-diff-key">{label}</span>
                        <span className="mrc-diff-val">
                          {isCreate ? <span className="mrc-diff-add">＋ {text}</span> : <span className="mrc-diff-new">→ {text}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mrc-actions">
                  <button className="mrc-btn primary" disabled={busyId === proposal.id} onClick={() => accept(proposal.id)}>✅ 接受</button>
                  <button className="mrc-btn" disabled={busyId === proposal.id} onClick={() => { setRejecting(proposal.id); }}>❌ 拒绝</button>
                  <button className="mrc-btn" disabled={busyId === proposal.id} onClick={() => startEdit(proposal.id, proposal.diff)}>✏️ 改后接受</button>
                </div>
                {rejecting === proposal.id && (
                  <div className="mrc-proposal-reject">
                    <input
                      placeholder="拒绝理由（将用于避免重复提议）"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="mrc-actions">
                      <button className="mrc-btn danger" disabled={busyId === proposal.id} onClick={() => reject(proposal.id)}>确认拒绝</button>
                      <button className="mrc-btn" onClick={() => { setRejecting(null); setRejectReason(''); }}>取消</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
