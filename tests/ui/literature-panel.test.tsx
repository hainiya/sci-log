import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiteraturePanel } from '../../ui/panels/LiteraturePanel';

const { mockApi } = vi.hoisted(() => ({ mockApi: { zoteroStatus: vi.fn() } }));
vi.mock('../../ui/api', () => ({ api: mockApi }));

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.zoteroStatus.mockResolvedValue({ ok: true, total: 127 });
});

describe('LiteraturePanel', () => {
  it('渲染文献条目并拉取 Zotero 状态', async () => {
    const state = {
      literature: { version: 0, entries: [{ id: 'p1', title: '高性能热电材料研究', year: 2023, source: 'zotero', authors: ['张三'] }] },
      collections: { collections: [] },
    };
    render(<LiteraturePanel state={state} onStateChange={vi.fn()} showToast={vi.fn()} />);
    expect(screen.getByText(/高性能热电材料/)).toBeInTheDocument();
    await waitFor(() => expect(mockApi.zoteroStatus).toHaveBeenCalled());
  });

  it('未连接时显示离线状态', async () => {
    mockApi.zoteroStatus.mockResolvedValue({ ok: false, error: 'unreachable' });
    render(
      <LiteraturePanel state={{ literature: { entries: [], version: 0 }, collections: { collections: [] } }} onStateChange={vi.fn()} showToast={vi.fn()} />
    );
    await waitFor(() => expect(mockApi.zoteroStatus).toHaveBeenCalled());
  });
});
