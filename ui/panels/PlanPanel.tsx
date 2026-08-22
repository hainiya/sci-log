import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Markdown } from '../components/Markdown';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

/** 里程碑转可读文本：对象元素（{id,name,date,criteria}）拼为「name（date）：criteria」，字符串原样 */
function milestoneToText(m: any): string {
  if (m && typeof m === 'object') {
    const parts = [String(m.name ?? m.title ?? '').trim()];
    if (m.date) parts[0] += `（${m.date}）`;
    const criteria = String(m.criteria ?? '').trim();
    if (criteria) parts.push(criteria);
    return parts.join('：');
  }
  return String(m ?? '');
}

function draftFromPlan(plan: any) {
  return {
    title: plan.title || '',
    hypothesis: plan.hypothesis || '',
    route: plan.route || '',
    milestones: Array.isArray(plan.milestones) ? plan.milestones.map(milestoneToText).join('\n') : '',
  };
}

const CHANGE_TYPES = [
  { key: 'material', label: '改材料' },
  { key: 'process', label: '改工艺' },
  { key: 'scope', label: '范围调整' },
  { key: 'direction', label: '大改方向' },
  { key: 'other', label: '其他' },
];

export function PlanPanel({ state, onStateChange, showToast }: Props) {
  const plan = state?.plan || {};
  const [draft, setDraft] = useState(() => draftFromPlan(plan));
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState({ background: '', problem: '', data: '' });
  const [guiding, setGuiding] = useState(false);
  // 用户开始编辑后不再被后台刷新覆盖；未编辑时跟随最新 state（否则 AI 改方案后保存必撞版本冲突）
  const dirtyRef = useRef(false);
  // 新建方案两段式确认（沙箱 iframe 中 window.confirm 会被静默拦截）
  const [confirmNew, setConfirmNew] = useState(false);
  // 变更说明（演进史标注，可折叠可不填）
  const [showChange, setShowChange] = useState(false);
  const [changeTypes, setChangeTypes] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [changeExperimentKeys, setChangeExperimentKeys] = useState<string[]>([]);
  // 演进史
  const [evoOpen, setEvoOpen] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [viewContent, setViewContent] = useState<any>(null);
  const [rollbackTarget, setRollbackTarget] = useState<any>(null);
  const [evoBusy, setEvoBusy] = useState(false);

  // P1-2：文献对照评估卡片状态
  const [assessing, setAssessing] = useState(false);
  const [assessZoom, setAssessZoom] = useState(false);
  const assessment = state?.assessment || {};
  const assessStale =
    assessment.updatedAt &&
    (assessment.planVersion !== plan.version ||
      assessment.literatureVersion !== (state?.literature?.version ?? null));

  const recentWork = useMemo(() => {
    const now = Date.now();
    return (state?.worklog?.entries || [])
      .filter((e: any) => {
        const d = new Date(e.date).getTime();
        return Number.isFinite(d) && now - d <= 14 * 864e5 && now - d >= 0;
      })
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  }, [state?.worklog]);

  const worklogMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of state?.worklog?.entries || []) if (e.id) m.set(e.id, e);
    return m;
  }, [state?.worklog]);

  const planEvo = (state as any)?.['plan-evolution'] || {};

  const evoItems = useMemo((): any[] => {
    const entries: any[] = planEvo.entries || [];
    const snapshots: number[] = planEvo.snapshots || [];
    const byVersion = new Map<number, any>(entries.map((e: any) => [e.version, e] as [number, any]));
    const versions = new Set<number>([...snapshots, ...byVersion.keys()]);
    return [...versions]
      .sort((a, b) => b - a)
      .map((v) => byVersion.get(v) || { version: v, at: null, by: 'history', types: [], reason: '', experimentKeys: [] });
  }, [planEvo]);

  // 快照集合：判断某版本是否仍可回退/查看（被 prune 的版本已无快照）
  const snapshotSet = useMemo(() => new Set<number>(planEvo.snapshots || []), [planEvo]);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftFromPlan(plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.version, plan.updatedAt]);

  const runAssess = async (force = false) => {
    const litCount = state?.literature?.entries?.length ?? 0;
    if (litCount === 0) {
      showToast('文献库为空，无法对照评估', { error: true });
      return;
    }
    setAssessing(true);
    try {
      const r = await api.assessPlan(force);
      await onStateChange();
      if (r.reused) {
        showToast('评估结果仍是最新，已复用');
      } else {
        const extra = r.proposals > 0 ? `，${r.proposals} 个方案修改提案已生成` : '';
        showToast(`对照评估完成${extra}`);
      }
    } catch (err: any) {
      showToast(`评估失败：${err.message}`, { error: true });
    } finally {
      setAssessing(false);
    }
  };

  const update = (patch: Partial<typeof draft>) => {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  // 方案为空时显示引导卡
  const isEmptyPlan = !String(plan.title || '').trim() && !String(plan.hypothesis || '').trim();

  const generateDraft = async () => {
    setGuiding(true);
    try {
      const r = await api.proposalDraft(guide);
      dirtyRef.current = true;
      setDraft({
        title: r.draft.title,
        hypothesis: r.draft.hypothesis || '',
        route: r.draft.route || '',
        milestones: (r.draft.milestones || []).join('\n'),
      });
      await onStateChange();
      showToast(r.applied ? '草案已直接生效' : `草案已生成，提案 ${r.proposalId || ''} 待确认（在「提案确认」中接受后生效）`);
    } catch (err: any) {
      showToast(`草案生成失败：${err.message}`, { error: true });
    } finally {
      setGuiding(false);
    }
  };

  const save = async () => {
    if (!String(draft.title || '').trim() || !String(draft.hypothesis || '').trim()) {
      showToast('题目和研究假设不能为空', { error: true });
      return;
    }
    setSaving(true);
    try {
      const data = {
        title: draft.title,
        hypothesis: draft.hypothesis,
        route: draft.route,
        milestones: draft.milestones.split('\n').map((m: string) => m.trim()).filter(Boolean),
      };
      await api.savePlan(plan.version, data, showChange ? { types: changeTypes, reason: changeReason, experimentKeys: changeExperimentKeys } : undefined);
      setShowChange(false);
      setChangeTypes([]);
      setChangeReason('');
      setChangeExperimentKeys([]);
      dirtyRef.current = false;
      await onStateChange();
      showToast('方案已保存');
    } catch (err: any) {
      showToast(err.message.includes('version_conflict') ? '数据已被更新，已为你刷新，请重新编辑' : `保存失败：${err.message}`, { error: true });
      dirtyRef.current = false;
      onStateChange();
    } finally {
      setSaving(false);
    }
  };

  const openVersion = async (v: number) => {
    setEvoBusy(true);
    try {
      const r = await api.getPlanSnapshot(v);
      setViewContent(r.content || null);
      setViewVersion(v);
    } catch (err: any) {
      showToast(err.message?.includes('no_snapshot') ? '该版本历史内容已归档清理' : `读取失败：${err.message}`, { error: true });
    } finally {
      setEvoBusy(false);
    }
  };

  const doRollbackTo = async (v: number) => {
    setRollbackTarget(null);
    setEvoBusy(true);
    try {
      await api.rollbackTo(v);
      dirtyRef.current = false;
      await onStateChange();
      showToast(`已回退到 v${v}`);
    } catch (err: any) {
      showToast(`回退失败：${err.message}`, { error: true });
    } finally {
      setEvoBusy(false);
    }
  };

  return (
    <div className="mrc-plan-editor mrc-panel-section">
      {isEmptyPlan && (
        <div className="mrc-guide-card">
          <div className="mrc-section-head">
            <span className="mrc-section-title">🚀 建立研究方案</span>
          </div>
          <p className="mrc-drawer-hint">方案是分析/建议/审查的共同输入。填几个问题，AI 帮你生成草案（走提案确认）；也可以直接填写下方表单手动创建，保存即生效。</p>
          <div className="mrc-field">
            <label>课题背景</label>
            <textarea rows={2} value={guide.background} onChange={(e) => setGuide({ ...guide, background: e.target.value })} placeholder="例如：SnSe 基热电材料晶格热导率与载流子输运的协同优化…" />
          </div>
          <div className="mrc-field">
            <label>要解决的问题</label>
            <textarea rows={2} value={guide.problem} onChange={(e) => setGuide({ ...guide, problem: e.target.value })} placeholder="例如：目前 ZT 值受限于…，需要解决…" />
          </div>
          <div className="mrc-field">
            <label>手头数据 / 已有条件（可选）</label>
            <textarea rows={2} value={guide.data} onChange={(e) => setGuide({ ...guide, data: e.target.value })} placeholder="例如：已有区熔炉、文献库 52 篇热电文献…" />
          </div>
          <button className="mrc-btn primary" onClick={generateDraft} disabled={guiding || (!guide.background.trim() && !guide.problem.trim())}>
            {guiding ? '生成中…' : '✨ 生成方案草案'}
          </button>
        </div>
      )}
      <div className="mrc-field">
        <label>研究题目</label>
        <input value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="例如：高效稳定钙钛矿太阳能电池的界面工程研究" />
      </div>
      <div className="mrc-field">
        <label>研究假设</label>
        <textarea rows={3} value={draft.hypothesis} onChange={(e) => update({ hypothesis: e.target.value })} placeholder="提出你的科学假设…" />
      </div>
      <div className="mrc-field">
        <label>技术路线</label>
        <textarea rows={6} value={draft.route} onChange={(e) => update({ route: e.target.value })} placeholder="实验/计算/表征路线，每行一步…" />
      </div>
      <div className="mrc-field">
        <label>里程碑（每行一个）</label>
        <textarea rows={4} value={draft.milestones} onChange={(e) => update({ milestones: e.target.value })} placeholder="M1: 文献调研完成&#10;M2: 器件制备工艺稳定…" />
      </div>
      <div className="mrc-evo-block">
        <button className="mrc-btn small" onClick={() => setShowChange(!showChange)}>
          📝 {showChange ? '收起变更说明' : '填写变更说明（可选）'}
        </button>
        {showChange && (
          <div className="mrc-evo-panel">
            <div className="mrc-evo-types">
              {CHANGE_TYPES.map((t) => (
                <button
                  key={t.key}
                  className={`mrc-chip ${changeTypes.includes(t.key) ? 'active' : ''}`}
                  onClick={() =>
                    setChangeTypes((prev) => (prev.includes(t.key) ? prev.filter((k) => k !== t.key) : [...prev, t.key]))
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              className="mrc-evo-reason"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="变更原因（一句话，例如：8/3 实验发现薄膜开裂，调整退火温度）"
            />
            {recentWork.length > 0 && (
              <div className="mrc-evo-experiments">
                <div className="mrc-evo-label">关联实验（变更前 14 天内，可多选）：</div>
                {recentWork.map((w: any) => (
                  <label key={w.id} className="mrc-evo-exp">
                    <input
                      type="checkbox"
                      checked={changeExperimentKeys.includes(w.id)}
                      onChange={(e) =>
                        setChangeExperimentKeys((prev) =>
                          e.target.checked ? [...prev, w.id] : prev.filter((k) => k !== w.id)
                        )
                      }
                    />
                    <span>{w.date} · {String(w.content || '').slice(0, 40)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mrc-actions">
        <button className="mrc-btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存方案'}</button>
        {!isEmptyPlan &&
          (confirmNew ? (
            <span className="mrc-inline-confirm">
              <span className="mrc-confirm-tip">清空表单开始新建？（保存后覆盖当前方案，不走提案）</span>
              <button
                className="mrc-btn danger"
                onClick={() => {
                  setConfirmNew(false);
                  dirtyRef.current = true;
                  setDraft({ title: '', hypothesis: '', route: '', milestones: '' });
                  showToast('表单已清空，写下你的研究假设后保存');
                }}
              >
                确认清空
              </button>
              <button className="mrc-btn" onClick={() => setConfirmNew(false)}>
                取消
              </button>
            </span>
          ) : (
            <button className="mrc-btn" onClick={() => setConfirmNew(true)}>
              🆕 新建方案
            </button>
          ))}
        <button className="mrc-btn" onClick={() => api.rollback('plan').then(async () => { dirtyRef.current = false; await onStateChange(); showToast('已回退到上一版本'); }).catch((e) => showToast(e.message, { error: true }))}>↩ 回退上一版</button>
      </div>
      <div className="mrc-hint">保存直接落库（面板人工编辑不经过提案）；AI 修改方案会走提案确认。</div>

      <div className="mrc-panel-section mrc-evo-history">
        <div className="mrc-section-head">
          <span className="mrc-section-title">📜 方案演进史</span>
          <span className="mrc-head-actions">
            <button className="mrc-btn small" onClick={() => setEvoOpen(!evoOpen)}>
              {evoOpen ? '收起' : '展开'}
            </button>
          </span>
        </div>
        {evoOpen && (
          <div className="mrc-evo-list">
            {evoItems.length === 0 && (
              <div className="mrc-empty">暂无变更记录。保存方案时可填写「变更说明」；AI 修改方案会自动记录。</div>
            )}
            {evoItems.map((item) => (
              <div key={item.version} className={`mrc-evo-item ${item.version === plan.version ? 'latest' : ''}`}>
                <div className="mrc-evo-item-head">
                  <span className="mrc-evo-ver">v{item.version}</span>
                  <span className="mrc-evo-at">{item.at ? new Date(item.at).toLocaleString('zh-CN') : '（历史未标注）'}</span>
                  <span className="mrc-evo-by">
                    {item.by === 'ai' ? '🤖 AI' : item.by === 'rollback' ? '↩ 回退' : item.by === 'user' ? '✍️ 手动' : ''}
                  </span>
                  {item.types && item.types.length > 0 ? (
                    item.types.map((t: string) => (
                      <span key={t} className="mrc-chip">{CHANGE_TYPES.find((c) => c.key === t)?.label || t}</span>
                    ))
                  ) : (
                    <span className="mrc-evo-unlabeled">未标注变更</span>
                  )}
                  <span className="mrc-head-actions">
                    <button className="mrc-btn small" onClick={() => openVersion(item.version)}>查看此版本</button>
                    {item.version !== plan.version && snapshotSet.has(item.version) && (
                      <button className="mrc-btn small" onClick={() => setRollbackTarget(item)}>回退到此版</button>
                    )}
                  </span>
                </div>
                {item.reason && <div className="mrc-evo-reason-text">{item.reason}</div>}
                {item.experimentKeys && item.experimentKeys.length > 0 && (
                  <div className="mrc-evo-exps">
                    关联实验：
                    {item.experimentKeys.map((k: string) => {
                      const w = worklogMap.get(k);
                      return w ? (
                        <span key={k} className="mrc-chip">{w.date} {String(w.content || '').slice(0, 24)}</span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rollbackTarget && (
        <div className="mrc-inline-confirm mrc-evo-rollback-confirm">
          <span className="mrc-confirm-tip">确认回退到 v{rollbackTarget.version}？当前方案内容将被该版本覆盖（可再次回退恢复）。</span>
          <button className="mrc-btn small danger" onClick={() => doRollbackTo(rollbackTarget.version)} disabled={evoBusy}>确认回退</button>
          <button className="mrc-btn small" onClick={() => setRollbackTarget(null)}>取消</button>
        </div>
      )}

      {viewVersion !== null && (
        <div className="mrc-drawer-mask" onClick={() => { setViewVersion(null); setViewContent(null); }}>
          <div className="mrc-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mrc-drawer-head">
              <span>方案 v{viewVersion}（只读）</span>
              <span className="mrc-head-actions">
                <button className="mrc-btn small" onClick={() => { setViewVersion(null); setViewContent(null); }}>关闭</button>
              </span>
            </div>
            <div className="mrc-report-modal-body">
              {viewContent ? (
                <div className="mrc-plan-readonly">
                  <div className="mrc-field"><label>研究题目</label><div>{viewContent.title || '（空）'}</div></div>
                  <div className="mrc-field"><label>研究假设</label><div style={{ whiteSpace: 'pre-wrap' }}>{viewContent.hypothesis || '（空）'}</div></div>
                  <div className="mrc-field"><label>技术路线</label><div style={{ whiteSpace: 'pre-wrap' }}>{viewContent.route || '（空）'}</div></div>
                  <div className="mrc-field"><label>里程碑</label><div style={{ whiteSpace: 'pre-wrap' }}>{Array.isArray(viewContent.milestones) ? viewContent.milestones.map(milestoneToText).join('\n') : viewContent.milestones || '（空）'}</div></div>
                </div>
              ) : (
                <div className="mrc-empty">读取中…</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mrc-panel-section mrc-assess-block">
        <div className="mrc-section-head">
          <span className="mrc-section-title">文献对照评估</span>
          {assessment.updatedAt && (
            <span className="mrc-report-time">评估于 {new Date(assessment.updatedAt).toLocaleString('zh-CN')}</span>
          )}
          {assessment.planVersion != null && assessment.literatureVersion != null && (
            <span className="mrc-report-snapshot" title="本次评估的生成基准">
              基于 方案 v{assessment.planVersion} · 文献库 v{assessment.literatureVersion}
            </span>
          )}
          {assessStale && (
            <span
              className="mrc-report-stale"
              title={`研究方案或文献库自评估后已变动（当前：方案 v${plan.version ?? '?'} · 文献库 v${state?.literature?.version ?? '?'}，结论可能不再准确，建议重评`}
            >
              已过期，建议重评
            </span>
          )}
          <span className="mrc-head-actions">
            {assessment.content && (
              <button className="mrc-btn small" onClick={() => setAssessZoom(true)}>放大阅读</button>
            )}
            <button className="mrc-btn small" onClick={() => runAssess(true)} disabled={assessing} title="忽略新鲜度强制重评">
              {assessing ? '评估中…' : '强制重评'}
            </button>
            <button className="mrc-btn small primary" onClick={() => runAssess(false)} disabled={assessing}>
              {assessing ? '评估中…' : '对照评估'}
            </button>
          </span>
        </div>
        {(assessment.gaps || []).length > 0 && (
          <div className="mrc-gap-row">
            <span className="mrc-template-label">研究 gap：</span>
            {assessment.gaps.map((g: string, i: number) => (
              <span key={i} className="mrc-chip gap">{g}</span>
            ))}
          </div>
        )}
        {assessment.content ? (
          <div className="mrc-report-body">
            <Markdown text={assessment.content} />
          </div>
        ) : (
          <div className="mrc-empty">
            尚未评估。点击「对照评估」，AI 会拿你的研究假设/技术路线与文献库逐条对照，产出假设-证据对照表、技术路线可行性与研究 gap 陈述（评估需消耗一次模型调用，仅在你主动触发时运行）。
          </div>
        )}
      </div>

      {assessZoom && assessment.content && (
        <div className="mrc-drawer-mask" onClick={() => setAssessZoom(false)}>
          <div className="mrc-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mrc-drawer-head">
              <span>文献对照评估</span>
              <span className="mrc-head-actions">
                <button className="mrc-btn small" onClick={() => setAssessZoom(false)}>关闭</button>
              </span>
            </div>
            <div className="mrc-report-modal-body">
              <Markdown text={assessment.content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
