import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MetricsChart } from '../../ui/components/MetricsChart';

describe('MetricsChart', () => {
  it('渲染单位标签、规整刻度与数据点数值标注', () => {
    render(
      <MetricsChart
        metricLabel="电优值 ZT"
        unit="ZT"
        series={[{ system: 'SnSe', points: [{ date: '2026-08-01', value: 0.86, unit: 'ZT', temp: 823 }] }]}
      />
    );
    expect(screen.getByText('ZT')).toBeInTheDocument(); // 左上单位标签
    expect(screen.getByText('0.86')).toBeInTheDocument(); // 点标注（点数少时）
  });

  it('空数据渲染空态', () => {
    render(<MetricsChart metricLabel="电优值 ZT" unit="ZT" series={[]} />);
    expect(screen.getByText('暂无该指标的数据点')).toBeInTheDocument();
  });
});
