import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsDrawer } from '../../ui/settings/SettingsDrawer';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getBinding: vi.fn(),
    zoteroStatus: vi.fn(),
    saveAutoTriage: vi.fn(),
    saveSearchWindow: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    reprobeZotero: vi.fn(),
  },
}));
vi.mock('../../ui/api', () => ({ api: mockApi }));

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getBinding.mockResolvedValue({ sessionId: null });
  mockApi.zoteroStatus.mockResolvedValue({ ok: true, total: 127 });
  mockApi.saveAutoTriage.mockResolvedValue({ ok: true });
  mockApi.saveSearchWindow.mockResolvedValue({ ok: true });
});

describe('SettingsDrawer', () => {
  it('渲染设置面板（Zotero 连接 / 会话绑定 / 检索窗口 / AI 巡检）', async () => {
    render(<SettingsDrawer state={{ settings: { searchYearWindow: 5 }, config: { autoTriage: true } }} onClose={vi.fn()} onStateChange={vi.fn()} showToast={vi.fn()} />);
    expect(screen.getByText(/检索设置/)).toBeInTheDocument();
    expect(screen.getByText(/Zotero 连接/)).toBeInTheDocument();
    expect(screen.getByText('未绑定会话')).toBeInTheDocument();
  });

  it('切换 AI 巡检开关 → api.saveAutoTriage', async () => {
    render(<SettingsDrawer state={{ settings: { searchYearWindow: 5 }, config: { autoTriage: true } }} onClose={vi.fn()} onStateChange={vi.fn()} showToast={vi.fn()} />);
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() => expect(mockApi.saveAutoTriage).toHaveBeenCalledWith(false));
  });
});
