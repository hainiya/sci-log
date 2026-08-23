import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulePanel } from '../../ui/panels/SchedulePanel';

const { mockApi } = vi.hoisted(() => ({ mockApi: { write: vi.fn() } }));
vi.mock('../../ui/api', () => ({ api: mockApi }));

function makeState() {
  return {
    gantt: { version: 1, tasks: [] },
    calendar: { version: 0, events: [] },
    worklog: { version: 0, entries: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.write.mockResolvedValue({ ok: true });
});

describe('SchedulePanel', () => {
  it('渲染甘特/日历 tab 与任务清单', () => {
    render(<SchedulePanel state={makeState()} onStateChange={vi.fn()} showToast={vi.fn()} />);
    expect(screen.getByText('甘特图')).toBeInTheDocument();
    expect(screen.getByText('日历')).toBeInTheDocument();
    expect(screen.getByText('任务清单')).toBeInTheDocument();
  });

  it('添加任务 → api.write(gantt, version, {tasks:[...]})', async () => {
    render(<SchedulePanel state={makeState()} onStateChange={vi.fn()} showToast={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('新任务名称…'), { target: { value: '新任务' } });
    fireEvent.click(screen.getByText('添加'));
    await waitFor(() => expect(mockApi.write).toHaveBeenCalled());
    expect(mockApi.write).toHaveBeenCalledWith('gantt', 1, expect.objectContaining({
      tasks: expect.arrayContaining([expect.objectContaining({ name: '新任务', start: expect.any(String), progress: 0 })]),
    }));
  });
});
