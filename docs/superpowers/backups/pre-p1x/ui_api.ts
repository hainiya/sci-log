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
 */
export const api = {
  getState: () => request<any>('state'),
  getChanges: (since: Record<string, number>) =>
    request<{ changed: Record<string, number>; updates: Record<string, number> }>(
      `changes?since=${encodeURIComponent(JSON.stringify(since))}`
    ),
  read: (name: string) => request<any>(`${name}`),
  write: (name: string, version: number, data: unknown) =>
    request<any>(`${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, data }),
    }),
  appendLiterature: (entries: unknown[]) =>
    request<any>('literature/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }),
  refreshReport: (scope?: { type: 'all' | 'recent' | 'collection'; n?: number; key?: string; label?: string }) =>
    request<any>('report/refresh', { method: 'POST', body: JSON.stringify({ scope: scope || { type: 'all' } }) }),
  purgeGone: () => request<any>('literature/purge-gone', { method: 'POST' }),
  fulltext: (id: string) => request<any>(`literature/fulltext?id=${encodeURIComponent(id)}`),
  scan: () => request<any>('scan', { method: 'POST' }),
  zoteroStatus: () => request<any>('sources/zotero'),
  getZoteroStatus: () => request<any>('sources/zotero'),
  reprobeZotero: () => request<any>('sources/zotero/probe', { method: 'POST' }),
  proposalDraft: (input: { background: string; problem: string; data: string }) =>
    request<any>('guide/proposal-draft', { method: 'POST', body: JSON.stringify(input) }),
  exportRisBatch: () =>
    request<{ ok: boolean; count: number; file?: any }>('export/ris-batch', { method: 'POST' }),
  enhancePdfs: () =>
    request<{ ok: boolean; processed: number; summaries: number }>('literature/enhance-pdfs', { method: 'POST' }),
  acceptProposalBatch: (target: string, action: string) =>
    request<any>('proposals/accept-batch', { method: 'POST', body: JSON.stringify({ target, action }) }),
  weekSummary: () => request<any>('summary/week'),
  getFolders: () => request<{ folders: any[] }>('settings/folders'),
  addFolder: (folder: any) =>
    request<{ folders: any[] }>('settings/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    }),
  removeFolder: (key: string) =>
    request<{ folders: any[] }>('settings/folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }),
  getBinding: () => request<any>('binding'),
  bind: (sessionId: string, sessionPath: string | null) =>
    request<any>('binding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, sessionPath, source: 'manual' }),
    }),
  unbind: () => request<any>('binding', { method: 'DELETE' }),
  getProposals: () => request<{ entries: any[] }>('proposals'),
  acceptProposal: (id: string) => request<any>(`proposals/${id}/accept`, { method: 'POST' }),
  rejectProposal: (id: string, reason: string) =>
    request<any>(`proposals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  acceptModifiedProposal: (id: string, diff: any) =>
    request<any>(`proposals/${id}/accept-modified`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diff }),
    }),
  getRejected: () => request<any>('rejected'),
  clearRejected: () => request<any>('rejected/clear', { method: 'POST' }),
  getMetrics: () => request<any>('metrics/series'),
  saveMetricTargets: (targets: Record<string, number | null>) =>
    request<any>('settings/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    }),
  exportFile: (type: string, id?: string) =>
    request<any>(`export/${type}${id ? `?id=${id}` : ''}`),
  rollback: (name: string) => request<any>(`snapshots/${name}/rollback`, { method: 'POST' }),
  getSnapshots: (name: string) => request<any>(`snapshots/${name}`),
};

export { hana };
