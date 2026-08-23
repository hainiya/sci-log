/**
 * WorklogPanel 编辑保存交互测试（档 A：Vitest + RTL + jsdom，mock 掉宿主 api）
 * 目标：验证「编辑一条记录 → 保存修改」确实：
 *  1) 以最新 worklog version 调用 api.write('worklog', version, {entries:[patch]})
 *  2) 只 patch 被编辑的那条，其它字段（system/sampleId 等）保留
 *  3) 成功后关闭编辑弹窗并触发刷新
 * 这直接守护近期「编辑无法保存」的回归。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorklogPanel } from '../../ui/panels/WorklogPanel';

// vi.mock 会被 hoist 到文件顶部，factory 不能引用顶层变量；用 vi.hoisted 定义 mock api
const { mockApi } = vi.hoisted(() => ({
  mockApi: { write: vi.fn(), importWorklog: vi.fn(), getWorklog: vi.fn() },
}));
vi.mock('../../ui/api', () => ({ api: mockApi }));

function makeState() {
  return {
    worklog: {
      version: 3,
      entries: [
        {
          id: 'w1',
          content: '原始内容',
          sampleId: 'S-1',
          system: 'SnSe',
          data: null,
          durationHours: '',
          startDate: '',
          createdAt: '2026-08-22T10:00:00.000Z',
        },
      ],
      updatedAt: null,
    },
    gantt: { version: 1, tasks: [], updatedAt: null },
  };
}

function renderPanel() {
  const onStateChange = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const utils = render(
    <WorklogPanel state={makeState() as any} onStateChange={onStateChange} showToast={showToast} editEntryId={null} onConsumeEditEntryId={vi.fn()} />
  );
  return { onStateChange, showToast, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.write.mockResolvedValue({ ok: true });
});

describe('WorklogPanel 编辑保存', () => {
  it('编辑后保存 → 以最新 version 调用 api.write 并 patch 该条（保留其它字段）', async () => {
    renderPanel();
    // 打开编辑弹窗
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByPlaceholderText('内容'), { target: { value: '修改后的内容' } });
    fireEvent.click(screen.getByText('保存修改'));

    await waitFor(() => expect(mockApi.write).toHaveBeenCalled());
    expect(mockApi.write).toHaveBeenCalledWith(
      'worklog',
      3, // 最新 version
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'w1', content: '修改后的内容', system: 'SnSe', sampleId: 'S-1' }),
        ]),
      })
    );
  });

  it('保存成功后关闭编辑弹窗并触发刷新', async () => {
    const { onStateChange } = renderPanel();
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByPlaceholderText('内容'), { target: { value: '改了' } });
    fireEvent.click(screen.getByText('保存修改'));

    await waitFor(() => expect(mockApi.write).toHaveBeenCalled());
    await waitFor(() => expect(onStateChange).toHaveBeenCalled());
    // 编辑弹窗已收起（不再出现「保存修改」）
    expect(screen.queryByText('保存修改')).not.toBeInTheDocument();
  });
});
