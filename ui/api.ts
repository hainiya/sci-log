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
  write: (name: string, version: number, data: unknown) =>
    request<any>(`${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, data }),
    }),
  savePlan: (version: number, data: unknown, evolution?: { types: string[]; reason?: string; experimentKeys?: string[] }) =>
    request<any>(`plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, data, evolution }),
    }),
  getPlanSnapshot: (version: number) => request<any>(`plan/evolution/${version}`),
  rollbackTo: (version: number) =>
    request<any>(`snapshots/plan/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toVersion: version }),
    }),
  refreshReport: (scope?: { type: 'all' | 'recent' | 'collection'; n?: number; key?: string; label?: string }) =>
    request<any>('report/refresh', { method: 'POST', body: JSON.stringify({ scope: scope || { type: 'all' } }) }),
  purgeGone: () => request<any>('literature/purge-gone', { method: 'POST' }),
  deleteLiterature: (payload: { ids?: string[]; all?: boolean }) =>
    request<{ ok: boolean; removed: number }>('literature', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  scan: () => request<any>('scan', { method: 'POST' }),
  zoteroStatus: () => request<any>('sources/zotero'),
  reprobeZotero: () => request<any>('sources/zotero/probe', { method: 'POST' }),
  proposalDraft: (input: { background: string; problem: string; data: string }) =>
    request<any>('guide/proposal-draft', { method: 'POST', body: JSON.stringify(input) }),
  exportRisBatch: () =>
    request<{ ok: boolean; count: number; file?: any }>('export/ris-batch', { method: 'POST' }),
  enhancePdfs: () => request<{ ok: boolean }>('literature/enhance-pdfs', { method: 'POST' }),
  acceptProposalBatch: (target: string, action: string) =>
    request<any>('proposals/accept-batch', { method: 'POST', body: JSON.stringify({ target, action }) }),
  weekSummary: () => request<any>('summary/week'),
  getBinding: () => request<any>('binding'),
  bind: (sessionId: string, sessionPath: string | null) =>
    request<any>('binding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, sessionPath, source: 'manual' }),
    }),
  unbind: () => request<any>('binding', { method: 'DELETE' }),
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
  assessPlan: (force?: boolean) =>
    request<any>('plan/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(force) }),
    }),
  saveMetricTargets: (targets: Record<string, number | null>) =>
    request<any>('settings/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    }),
  saveSearchWindow: (years: number) =>
    request<any>('settings/search-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ years }),
    }),
  saveAutoTriage: (enabled: boolean) =>
    request<{ ok: boolean; autoTriage: boolean }>('settings/auto-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
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
