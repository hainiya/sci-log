import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsPanel } from '../../ui/panels/MetricsPanel';

const { mockApi } = vi.hoisted(() => ({ mockApi: { getMetrics: vi.fn() } }));
vi.mock('../../ui/api', () => ({ api: mockApi }));

const seriesData = {
  order: ['ZT'],
  metrics: {
    ZT: { systems: { SnSe: [{ date: '2026-08-01', value: 0.86, unit: 'ZT', temp: 823 }] } },
  },
  baseline: {},
  totals: { unrecognized: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getMetrics.mockResolvedValue(seriesData);
});

describe('MetricsPanel', () => {
  it('拉取指标数据并渲染图表（单位/数据点标注）', async () => {
    render(
      <MetricsPanel
        state={{ worklog: { entries: [], version: 0 }, literature: { version: 0 }, settings: {} }}
        onStateChange={vi.fn()}
        showToast={vi.fn()}
      />
    );
    await waitFor(() => expect(mockApi.getMetrics).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('0.86').length).toBeGreaterThanOrEqual(1));
  });

  it('未识别体系警告条可点击补标注', async () => {
    mockApi.getMetrics.mockResolvedValue({ ...seriesData, totals: { unrecognized: [{ entryId: 'w1', date: '2026-08-01', sampleId: 'S-1' }] } });
    const onEditWorklog = vi.fn();
    render(
      <MetricsPanel
        state={{ worklog: { entries: [{ id: 'w1', content: '某条记录', date: '2026-08-01' }], version: 0 }, literature: { version: 0 }, settings: {} }}
        onStateChange={vi.fn()}
        showToast={vi.fn()}
        onEditWorklog={onEditWorklog}
      />
    );
    await waitFor(() => expect(screen.getByText(/未识别/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/查看/));
    // 存在对应条目的「补标注」按钮
    const btn = screen.getByText(/补标注/);
    fireEvent.click(btn);
    expect(onEditWorklog).toHaveBeenCalledWith('w1');
  });
});
