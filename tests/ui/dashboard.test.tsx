import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dashboard } from '../../ui/components/Dashboard';

const { mockApi } = vi.hoisted(() => ({ mockApi: { write: vi.fn() } }));
vi.mock('../../ui/api', () => ({ api: mockApi }));

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeState() {
  const today = todayIso();
  return {
    gantt: { version: 1, tasks: [{ id: 't1', name: '合成实验', start: today, end: today, progress: 50 }] },
    calendar: { version: 0, events: [] },
    worklog: { version: 0, entries: [] },
    literature: { version: 0, entries: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.write.mockResolvedValue({ ok: true });
});

describe('Dashboard', () => {
  it('page 视图渲染今日任务与本周统计', () => {
    render(<Dashboard state={makeState()} onStateChange={vi.fn()} showToast={vi.fn()} onGoSchedule={vi.fn()} />);
    expect(screen.getByText(/今日任务/)).toBeInTheDocument();
    expect(screen.getAllByText('合成实验').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('本周')).toBeInTheDocument();
  });

  it('勾选今日任务 → api.write(gantt,...) 标为完成', async () => {
    render(<Dashboard state={makeState()} onStateChange={vi.fn()} showToast={vi.fn()} onGoSchedule={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(mockApi.write).toHaveBeenCalled());
    expect(mockApi.write).toHaveBeenCalledWith('gantt', 1, expect.objectContaining({
      tasks: expect.arrayContaining([expect.objectContaining({ id: 't1', progress: 100 })]),
    }));
  });

  it('compact（widget）视图只渲染本周统计 + 今日状态行', () => {
    render(<Dashboard state={makeState()} onStateChange={vi.fn()} showToast={vi.fn()} onGoSchedule={vi.fn()} compact />);
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText(/今日 1 项进行中/)).toBeInTheDocument();
    expect(screen.queryByText('今日任务')).not.toBeInTheDocument();
  });
});
