import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HanaThemeProvider } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';
import './panel.css';
import { api, hana } from './api';
import { LiteraturePanel } from './panels/LiteraturePanel';
import { PlanPanel } from './panels/PlanPanel';
import { WorklogPanel } from './panels/WorklogPanel';
import { ProposalsPanel } from './panels/ProposalsPanel';
import { SchedulePanel } from './panels/SchedulePanel';
import { SettingsDrawer } from './settings/SettingsDrawer';
import { Dashboard } from './components/Dashboard';

const POLL_INTERVAL_MS = 15_000;

type MainTab = 'literature' | 'plan' | 'worklog' | 'schedule' | 'proposals';

const TABS: { key: MainTab; label: string }[] = [
  { key: 'literature', label: '📚 文献库' },
  { key: 'plan', label: '🧭 研究方案' },
  { key: 'worklog', label: '🧪 实验记录' },
  { key: 'schedule', label: '📅 日程' },
  { key: 'proposals', label: '📋 提案确认' },
];

function Panel() {
  const surface = document.getElementById('root')?.dataset.surface || 'page';
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<MainTab>('literature');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const toastTimer = useRef<any>(null);

  const showToast = (message: string, opts?: { error?: boolean }) => {
    setToast({ msg: message, error: !!opts?.error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    // 错误提示停留更久，且可点击关闭——版本冲突这类需要行动的提示不能一闪而过
    toastTimer.current = setTimeout(() => setToast(null), opts?.error ? 12000 : 4000);
  };

  const loadState = async () => {
    try {
      const data = await api.getState();
      setState(data);
      setSince(data.updates || {});
      setError(null);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // 轮询增量
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const changes = await api.getChanges(sinceRef.current);
        if (Object.keys(changes.changed || {}).length > 0) {
          await loadState();
        }
      } catch {}
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const sinceRef = useRef(since);
  sinceRef.current = since;

  useEffect(() => {
    loadState();
    hana.ready();
    hana.ui.resize({ height: surface === 'widget' ? 420 : 780 });
  }, [surface]);

  const pendingProposals = useMemo(() => {
    const entries = state?.proposals?.entries || [];
    return entries.filter((p: any) => p.status === 'pending');
  }, [state]);

  const goTab = (t: MainTab) => setTab(t);

  return (
    <HanaThemeProvider mode="inherit" className="mrc-panel">
      <div className="mrc-app" data-surface={surface}>
        <header className="mrc-header">
          <div className="mrc-header-title">
            <span className="mrc-logo">🧪</span>
            <span>科研工作</span>
            <span className="mrc-binding">
              {state?.binding?.sessionId ? (
                <span className="mrc-badge ok">已绑定会话</span>
              ) : (
                <span className="mrc-badge warn" title="绑定后会话中的研究方向讨论会自动触发文献搜集；面板导出也依赖绑定">未绑定会话</span>
              )}
            </span>
          </div>
          <div className="mrc-header-actions">
            <button className="mrc-btn" disabled={scanning} onClick={() => { setScanning(true); api.scan().then((r) => showToast(`扫描完成：发现 ${r.found ?? 0} 条，入库 ${r.appended ?? 0} 条`)).catch((e) => showToast(e.message, { error: true })).finally(() => setScanning(false)); }}>
              {scanning ? '⏳ 扫描中…' : '🔄 扫描文献'}
            </button>
            <button className="mrc-btn" onClick={() => setSettingsOpen(true)}>⚙️ 设置</button>
          </div>
        </header>

        {error && <div className="mrc-error">加载失败：{error} <button className="mrc-btn" onClick={loadState}>重试</button></div>}

        {loading ? (
          <div className="mrc-loading">加载中…</div>
        ) : surface === 'widget' ? (
          /* widget 窄条：只放最该随手看到的东西 */
          <main className="mrc-widget">
            <Dashboard
              state={state}
              onStateChange={loadState}
              showToast={showToast}
              onGoProposals={() => {}}
              onGoSchedule={() => {}}
            />
            <div className="mrc-hint">完整功能请打开插件页面（文献 / 方案 / 实验记录 / 日程）。</div>
          </main>
        ) : (
          <>
            <Dashboard
              state={state}
              onStateChange={loadState}
              showToast={showToast}
              onGoProposals={() => goTab('proposals')}
              onGoSchedule={() => goTab('schedule')}
            />

            <nav className="mrc-main-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`mrc-main-tab ${tab === t.key ? 'active' : ''} ${t.key === 'proposals' && pendingProposals.length > 0 ? 'has-badge' : ''}`}
                  onClick={() => goTab(t.key)}
                >
                  {t.label}
                  {t.key === 'proposals' && pendingProposals.length > 0 && <span className="mrc-tab-badge">{pendingProposals.length}</span>}
                </button>
              ))}
            </nav>

            <main className="mrc-main">
              {tab === 'literature' && <LiteraturePanel state={state} onStateChange={loadState} showToast={showToast} />}
              {tab === 'plan' && <PlanPanel state={state} onStateChange={loadState} showToast={showToast} />}
              {tab === 'worklog' && <WorklogPanel state={state} onStateChange={loadState} showToast={showToast} />}
              {tab === 'schedule' && <SchedulePanel state={state} onStateChange={loadState} showToast={showToast} />}
              {tab === 'proposals' && (
                <div className="mrc-panel-section">
                  <ProposalsPanel state={state} onStateChange={loadState} showToast={showToast} />
                </div>
              )}
            </main>
          </>
        )}

        {surface !== 'widget' && pendingProposals.length > 0 && tab !== 'proposals' && (
          <div className="mrc-proposal-float" onClick={() => goTab('proposals')}>
            📋 {pendingProposals.length} 个待确认提案 →
          </div>
        )}

        {settingsOpen && (
          <SettingsDrawer
            state={state}
            onClose={() => setSettingsOpen(false)}
            onStateChange={loadState}
            showToast={showToast}
          />
        )}

        {toast && (
          <div className={`mrc-toast ${toast.error ? 'error' : ''}`} onClick={() => setToast(null)} title="点击关闭">
            {toast.msg}
          </div>
        )}
      </div>
    </HanaThemeProvider>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Panel />);
