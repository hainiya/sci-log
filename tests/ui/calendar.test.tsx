import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarView } from '../../ui/components/CalendarView';

describe('CalendarView', () => {
  it('渲染当前月份标题、事件，及 worklog 日期绿点', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const today = `${y}-${String(m).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    render(
      <CalendarView
        events={[{ id: 'e1', title: '组会', date: today }]}
        tasks={[]}
        onSave={vi.fn()}
        worklogDates={[today]}
      />
    );
    expect(screen.getByText(`${y} 年 ${m} 月`)).toBeInTheDocument();
    expect(screen.getByText('组会')).toBeInTheDocument();
    expect(screen.getByTitle('当天有实验记录')).toBeInTheDocument();
  });

  it('点击格子添加日程 → 触发 onSave', async () => {
    const onSave = vi.fn();
    const { container } = render(<CalendarView events={[]} tasks={[{ id: 't1', name: '任务A' }]} onSave={onSave} />);
    const todayCell = container.querySelector('.mrc-cal-cell.today') as HTMLElement;
    fireEvent.click(todayCell);
    fireEvent.change(screen.getByPlaceholderText('日程标题'), { target: { value: '新日程' } });
    fireEvent.click(screen.getByText('添加'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});
