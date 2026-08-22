import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Props = {
  state: any;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

function draftFromPlan(plan: any) {
  return {
    title: plan.title || '',
    hypothesis: plan.hypothesis || '',
    route: plan.route || '',
    milestones: Array.isArray(plan.milestones) ? plan.milestones.join('\n') : '',
  };
}

export function PlanPanel({ state, onStateChange, showToast }: Props) {
  const plan = state?.plan || {};
  const [draft, setDraft] = useState(() => draftFromPlan(plan));
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState({ background: '', problem: '', data: '' });
  const [guiding, setGuiding] = useState(false);
  // 用户开始编辑后不再被后台刷新覆盖；未编辑时跟随最新 state（否则 AI 改方案后保存必撞版本冲突）
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftFromPlan(plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.version, plan.updatedAt]);

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
    setSaving(true);
    try {
      const data = {
        title: draft.title,
        hypothesis: draft.hypothesis,
        route: draft.route,
        milestones: draft.milestones.split('\n').map((m: string) => m.trim()).filter(Boolean),
      };
      await api.write('plan', plan.version, data);
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
      <div className="mrc-actions">
        <button className="mrc-btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存方案'}</button>
        {!isEmptyPlan && (
          <button className="mrc-btn" onClick={() => { if (window.confirm('清空表单开始新建方案？保存后覆盖当前方案（面板编辑直接落库，不走提案）。')) { dirtyRef.current = true; setDraft({ title: '', hypothesis: '', route: '', milestones: '' }); } }}>🆕 新建方案</button>
        )}
        <button className="mrc-btn" onClick={() => api.rollback('plan').then(async () => { dirtyRef.current = false; await onStateChange(); showToast('已回退到上一版本'); }).catch((e) => showToast(e.message, { error: true }))}>↩ 回退上一版</button>
      </div>
      <div className="mrc-hint">保存直接落库（面板人工编辑不经过提案）；AI 修改方案会走提案确认。</div>
    </div>
  );
}
