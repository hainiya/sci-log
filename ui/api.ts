import { hana } from '@hana/plugin-sdk';

export type ApiResult<T = unknown> = T & { ok?: boolean; error?: string; hint?: string };

async function request<T = unknown>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await hana.api.fetch(path, init);
  if (!res.ok) {
    let body: ApiResult = {};
    try {
      body = await res.json();
    } catch {}
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), body);
  }
  return (await res.json()) as ApiResult<T>;
}

/**
 * 路径约定（实测宿主代理层）：hana.api.fetch(path) 会把 path 原样拼到
 * /api/plugins/<pluginId>/ 之后，不剥离任何前缀。因此这里统一用
 * 不带 "api/" 前缀的插件路由相对路径（与 routes/*.js 注册的路径一一对应）。
 * 实验记录中心化后：移除 plan/report/proposals/assessment 相关方法。
 */
export const api = {
  getState: () => request<any>('state'),
  getChanges: (since: Record<string, number>) =>
    request<{ changed: Record<string, number>; updates: Record<string, number> }>(
      `changes?since=${encodeURIComponent(JSON.stringify(since))}`
    ),
  write: (name: string, version: number, data: unknown) =>
    request<any>(`${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, data }),
    }),
  purgeGone: () => request<any>('literature/purge-gone', { method: 'POST' }),
  deleteLiterature: (payload: { ids?: string[]; all?: boolean }) =>
    request<{ ok: boolean; removed: number }>('literature', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  scan: () => request<any>('scan', { method: 'POST' }),
  zoteroStatus: () => request<any>('sources/zotero'),
  enhancePdfs: () => request<{ ok: boolean }>('literature/enhance-pdfs', { method: 'POST' }),
  getMetrics: () => request<any>('metrics/series'),
  saveMetricTargets: (targets: Record<string, number | null>) =>
    request<any>('settings/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    }),
  importWorklog: (text: string, dryRun?: boolean) =>
    request<any>('worklog/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dryRun: Boolean(dryRun) }),
    }),
  exportFile: (type: string, id?: string) =>
    request<any>(`export/${type}${id ? `?id=${id}` : ''}`),
  rollback: (name: string) => request<any>(`snapshots/${name}/rollback`, { method: 'POST' }),
};

export { hana };
