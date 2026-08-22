import { Component, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HanaThemeProvider } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';
import './panel.css';
import { api, hana } from './api';
import { LiteraturePanel } from './panels/LiteraturePanel';
import { WorklogPanel } from './panels/WorklogPanel';
import { SchedulePanel } from './panels/SchedulePanel';
import { MetricsPanel } from './panels/MetricsPanel';
import { SettingsDrawer } from './settings/SettingsDrawer';
import { Dashboard } from './components/Dashboard';

const POLL_INTERVAL_MS = 15_000;

type MainTab = 'schedule' | 'worklog' | 'metrics' | 'literature';

const TABS: { key: MainTab; label: string }[] = [
  { key: 'schedule', label: '📅 日程' },
  { key: 'worklog', label: '🧪 实验记录' },
  { key: 'metrics', label: '📈 指标趋势' },
  { key: 'literature', label: '📚 文献库' },
];

/** 渲染期错误兜底：React 19 无 error boundary 时渲染错误会卸载整个 root（白屏且不可恢复） */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mrc-error" style={{ margin: 16, padding: 16 }}>
          <div>面板渲染出错：{String(this.state.error?.message || this.state.error)}</div>
          <button className="mrc-btn" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Panel() {
  const surface = document.getElementById('root')?.dataset.surface || 'page';
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<MainTab>('schedule');
  const [pendingEditEntryId, setPendingEditEntryId] = useState<string | null>(null); // 跨 tab 补标注：待打开编辑弹窗的 worklog 条目 id
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 宿主原生 toast（@hana/plugin-sdk hana.toast.show）：替代自建 DOM toast
  const showToast = (message: string, opts?: { error?: boolean }) => {
    void hana.toast.show({ message, type: opts?.error ? 'error' : 'info', duration: opts?.error ? 12000 : 4000 });
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
                <span className="mrc-badge warn" title="绑定后会话中的讨论会自动触发 Zotero 同步；面板导出也依赖绑定">未绑定会话</span>
              )}
            </span>
          </div>
          <div className="mrc-header-actions">
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
              onGoSchedule={() => {}}
            />
            <div className="mrc-hint">完整功能请打开插件页面（日程 / 实验记录 / 指标趋势 / 文献库）。</div>
          </main>
        ) : (
          <>
            <Dashboard
              state={state}
              onStateChange={loadState}
              showToast={showToast}
              onGoSchedule={() => goTab('schedule')}
            />

            <nav className="mrc-main-tabs">
              {TABS.map((t) => (
                <button key={t.key} className={`mrc-main-tab ${tab === t.key ? 'active' : ''}`} onClick={() => goTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </nav>

            <main className="mrc-main">
              {tab === 'schedule' && <SchedulePanel state={state} onStateChange={loadState} showToast={showToast} />}
              {tab === 'worklog' && (
                <WorklogPanel
                  state={state}
                  onStateChange={loadState}
                  showToast={showToast}
                  editEntryId={pendingEditEntryId}
                  onConsumeEditEntryId={() => setPendingEditEntryId(null)}
                />
              )}
              {tab === 'metrics' && (
                <MetricsPanel
                  state={state}
                  onStateChange={loadState}
                  showToast={showToast}
                  onEditWorklog={(entryId) => { setPendingEditEntryId(entryId); setTab('worklog'); }}
                />
              )}
              {tab === 'literature' && <LiteraturePanel state={state} onStateChange={loadState} showToast={showToast} />}
            </main>
          </>
        )}

        {settingsOpen && (
          <SettingsDrawer
            state={state}
            onClose={() => setSettingsOpen(false)}
            onStateChange={loadState}
            showToast={showToast}
          />
        )}
      </div>
    </HanaThemeProvider>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ErrorBoundary><Panel /></ErrorBoundary>);
