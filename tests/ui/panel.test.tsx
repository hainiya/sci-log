/**
 * Panel 顶层挂载冒烟测试（档 A）：Panel.tsx 用 createRoot 自挂载到 #root，
 * 依赖 @hana/plugin-components 的 HanaThemeProvider 与 @hana/plugin-sdk 的 hana。
 * 这里 mock 掉两者，并提供 #root，验证：
 *  - page surface：渲染完整页面（主 tab「日程 / 指标趋势」等）
 *  - widget surface：渲染精简视图（compact，无主 tab）
 * 用 vi.resetModules 让每个用例独立重新挂载到新的 #root。
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHana } = vi.hoisted(() => ({
  mockHana: { api: { fetch: vi.fn() }, toast: { show: vi.fn() }, ready: vi.fn(), ui: { resize: vi.fn() } },
}));
vi.mock('@hana/plugin-sdk', () => ({ hana: mockHana }));
vi.mock('@hana/plugin-components', () => ({ HanaThemeProvider: ({ children }: any) => children }));

const emptyState = {
  gantt: { version: 0, tasks: [] },
  calendar: { version: 0, events: [] },
  worklog: { version: 0, entries: [] },
  literature: { version: 0, entries: [] },
  settings: {},
  config: {},
};

async function mount(surface: 'page' | 'widget') {
  document.body.innerHTML = `<div id="root" data-surface="${surface}"></div>`;
  mockHana.api.fetch.mockResolvedValue({ ok: true, json: async () => emptyState });
  await import('../../ui/Panel'); // 触发自挂载
}

describe('Panel 顶层挂载', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('page surface：渲染主 tab（header 已随精简移除）', async () => {
    await mount('page');
    expect(await screen.findByText('指标趋势')).toBeInTheDocument();
    expect((await screen.findAllByText(/日程/)).length).toBeGreaterThanOrEqual(1);
  });

  it('widget surface：渲染精简视图（无主 tab）', async () => {
    await mount('widget');
    expect(await screen.findByText(/完整功能请打开插件页面/)).toBeInTheDocument();
    expect(screen.queryByText('📅 日程')).not.toBeInTheDocument();
  });
});
