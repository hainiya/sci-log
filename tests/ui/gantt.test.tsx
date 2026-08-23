import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GanttChart } from '../../ui/components/GanttChart';

describe('GanttChart', () => {
  it('渲染计划任务/实际时间线/图例', () => {
    render(
      <GanttChart
        tasks={[{ id: 't1', name: '合成薄膜', start: '2026-08-01', end: '2026-08-05', progress: 50, kind: 'plan' }]}
        actuals={[{ id: 'a1', name: '实际实验', start: '2026-08-02', end: '2026-08-03', kind: 'actual' }]}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText('合成薄膜')).toBeInTheDocument();
    expect(screen.getByText('◆ 实际实验')).toBeInTheDocument();
    expect(screen.getByText('计划任务')).toBeInTheDocument();
    expect(screen.getByText('实际时间线')).toBeInTheDocument();
  });

  it('渲染缩放档位（周/月/季度）', () => {
    render(<GanttChart tasks={[]} onSave={vi.fn()} />);
    expect(screen.getByText('周')).toBeInTheDocument();
    expect(screen.getByText('月')).toBeInTheDocument();
    expect(screen.getByText('季度')).toBeInTheDocument();
  });
});
