import { useEffect, useState } from 'react';
import { api } from '../api';
import { ConfirmButton } from '../components/ConfirmButton';

type Props = {
  state: any;
  onClose: () => void;
  onStateChange: () => Promise<void>;
  showToast: (msg: string, opts?: { error?: boolean }) => void;
};

export function SettingsDrawer({ state, onClose, onStateChange, showToast }: Props) {
  const [binding, setBinding] = useState<any>(null);
  const [rejected, setRejected] = useState<any[]>([]);
  const [zotero, setZotero] = useState<any>(null);
  const [probing, setProbing] = useState(false);
  const [yearWindow, setYearWindow] = useState<number>(Number((state as any)?.settings?.searchYearWindow) || 5);
  // 巡检开关：默认 true；宿主配置优先（state.config 已含 autoTriage，兼容链在服务端组装）
  const [autoTriage, setAutoTriage] = useState<boolean>((state as any)?.config?.autoTriage ?? true);

  const loadZotero = () => {
    api.zoteroStatus().then(setZotero).catch(() => {});
  };

  useEffect(() => {
    api.getBinding().then(setBinding).catch(() => {});
    api.getRejected().then((r) => setRejected(r.entries || [])).catch(() => {});
    loadZotero();
  }, []);

  const reprobeZotero = async () => {
    setProbing(true);
    try {
      setZotero(await api.reprobeZotero());
    } catch (err: any) {
      showToast(`探测失败：${err.message}`);
    } finally {
      setProbing(false);
    }
  };

  const saveYearWindow = async () => {
    const y = Math.round(Number(yearWindow));
    if (!Number.isFinite(y) || y < 1 || y > 30) {
      showToast('年份窗口需为 1-30 的整数', { error: true });
      return;
    }
    await api.saveSearchWindow(y);
    setYearWindow(y);
    showToast(`检索年份窗口已保存：近 ${y} 年`);
  };

  const bindCurrent = async () => {
    const sessionId = state?.sessionId;
    if (!sessionId) {
      showToast('当前面板未能获取会话标识，请在对话中让助手执行 manage_plan 等操作完成绑定');
      return;
    }
    try {
      await api.bind(sessionId, null);
      setBinding(await api.getBinding());
      showToast('已绑定当前会话');
    } catch (err: any) {
      showToast(`绑定失败：${err.message}`);
    }
  };

  const unbind = async () => {
    await api.unbind();
    setBinding(await api.getBinding());
    showToast('已解除绑定');
  };

  const clearRejected = async () => {
    await api.clearRejected();
    setRejected([]);
    showToast('拒绝记录已清空');
    await onStateChange();
  };

  return (
    <div className="mrc-drawer-mask" onClick={onClose}>
      <div className="mrc-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="mrc-drawer-head">
          <span>⚙️ 设置</span>
          <button className="mrc-btn small" onClick={onClose}>✕</button>
        </div>

        <section className="mrc-drawer-section">
          <h4>📚 Zotero 连接</h4>
          <p className="mrc-drawer-hint">Zotero 本地库以只读镜像同步进文献库，分析报告会纳入 Zotero 条目。</p>
          {zotero?.ok ? (
            <div className="mrc-folder-row">
              <span>🟢 已连接（{zotero.total ?? 0} 条）</span>
            </div>
          ) : (
            <div className="mrc-folder-row">
              <span className="mrc-zotero-error">🔴 未连接：{zotero?.error || '未知状态'}</span>
            </div>
          )}
          <button className="mrc-btn small" onClick={reprobeZotero} disabled={probing}>{probing ? '探测中…' : '重试探测'}</button>
        </section>

        <section className="mrc-drawer-section">
          <h4>🔗 会话绑定管理</h4>
          <p className="mrc-drawer-hint">绑定后，lifecycle 会监听该会话的研究方向讨论并自动搜集文献（受 autoCollectEnabled 开关控制）。</p>
          {binding?.sessionId ? (
            <div className="mrc-folder-row">
              <span>已绑定：{binding.sessionId.slice(0, 18)}…（{binding.source === 'auto' ? '自动' : '手动'}，{binding.boundAt ? new Date(binding.boundAt).toLocaleString('zh-CN') : ''}）</span>
              <button className="mrc-btn small danger" onClick={unbind}>解除绑定</button>
            </div>
          ) : (
            <div className="mrc-folder-row">
              <span>未绑定会话</span>
              <button className="mrc-btn" onClick={bindCurrent}>绑定当前会话</button>
            </div>
          )}
        </section>

        <section className="mrc-drawer-section">
          <h4>🔍 检索设置</h4>
          <p className="mrc-drawer-hint">在线检索与自动搜集文献时的默认时间范围（收集方向由检索词决定，时间由此窗口限定）。</p>
          <div className="mrc-folder-row">
            <span>默认检索窗口</span>
            <input
              type="number"
              min={1}
              max={30}
              className="mrc-year-input"
              value={yearWindow}
              onChange={(e) => setYearWindow(Number(e.target.value))}
            />
            <span>近 N 年</span>
            <button className="mrc-btn small" onClick={saveYearWindow}>保存</button>
          </div>
        </section>

        <section className="mrc-drawer-section">
          <h4>🤖 AI 巡检</h4>
          <p className="mrc-drawer-hint">每次实验记录写入后自动 AI 巡检（参数结构化/文献关联/甘特进度/日程/时长提取），生成提案待你确认。关闭后仍可手动巡检。</p>
          <label className="mrc-switch-row">
            <input
              type="checkbox"
              checked={autoTriage}
              onChange={async (e) => {
                // 仅在用户 toggle 事件时回写端点（服务端 body?.enabled === true 逐字判定）
                const v = e.target.checked;
                try {
                  await api.saveAutoTriage(v);
                } catch (err: any) {
                  showToast(`自动巡检设置保存失败：${err.message}`, { error: true });
                  return;
                }
                setAutoTriage(v);
                showToast(v ? '自动巡检已开启' : '自动巡检已关闭');
                await onStateChange();
              }}
            />
            <span>实验记录自动巡检</span>
          </label>
        </section>

        <section className="mrc-drawer-section">
          <h4>🚫 拒绝记录（{rejected.length}）</h4>
          <p className="mrc-drawer-hint">AI 生成提案/建议时会参考最近 5 条拒绝记录，避免重复提议。</p>
          {rejected.length === 0 && <div className="mrc-empty">暂无拒绝记录</div>}
          {rejected.slice(-5).reverse().map((r) => (
            <div key={r.id} className="mrc-rejected-row">
              <div className="mrc-rejected-summary">{r.summary}</div>
              <div className="mrc-rejected-reason">理由：{r.reason}</div>
            </div>
          ))}
          {rejected.length > 0 && (
            <ConfirmButton label="清空拒绝记录" className="mrc-btn small danger" onConfirm={clearRejected} title="清空后 AI 将不再参考这些拒绝理由" />
          )}
        </section>
      </div>
    </div>
  );
}
