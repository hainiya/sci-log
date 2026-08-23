/**
 * api 封装单测（档 B/A）：mock @hana/plugin-sdk 的 hana.api.fetch，
 * 验证 request 路径约定（不带 api/ 前缀）、写接口的 method/body/version、
 * 以及非 2xx 时的错误抛出（携带 error / data）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHana } = vi.hoisted(() => ({ mockHana: { api: { fetch: vi.fn() } } }));
vi.mock('@hana/plugin-sdk', () => ({ hana: mockHana }));

import { api } from '../../ui/api';

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getState 使用无前缀路径请求', async () => {
    mockHana.api.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const r = await api.getState();
    expect(mockHana.api.fetch).toHaveBeenCalledWith('state', undefined);
    expect(r.ok).toBe(true);
  });

  it('write 带上 method=PUT 与 {version,data} body', async () => {
    mockHana.api.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await api.write('worklog', 3, { entries: [] });
    expect(mockHana.api.fetch).toHaveBeenCalledWith('worklog', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ version: 3, data: { entries: [] } }),
    }));
  });

  it('非 2xx 抛出携带 error 的 Error（含冲突 data）', async () => {
    mockHana.api.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'version_conflict', data: { version: 9 } }) });
    await expect(api.getState()).rejects.toMatchObject({ message: 'version_conflict', data: { version: 9 } });
  });
});
