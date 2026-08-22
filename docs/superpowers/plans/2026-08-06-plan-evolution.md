# 方案演进史 + 变更语义 + 实验反馈闭环 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为研究方案增加演进史（版本时间线 + 变更类型/原因/关联实验标注），实验记录自动带方案版本号，形成「实验反馈 → 方案调整」闭环。

**架构：** 新增 plan-evolution.json 作为演进元数据索引（方案内容仍在既有快照机制）；四条 plan 写路径（面板保存 / 提案接受 / 回退 / 引导草案）统一经 `appendPlanEvolution(store, entry)` 追加记录；前端 PlanPanel 增加「变更说明」折叠区与「方案演进史」区块。

**技术栈：** Node.js ESM（src-server）、React + Vite（ui）、无新依赖。

**规格：** `docs/superpowers/specs/2026-08-06-plan-evolution-design.md`

---

### 任务 1：evolution.js 模块 + store.js FILES 注册

**文件：**
- 创建：`src-server/server/evolution.js`
- 修改：`src-server/server/store.js:17-62`（FILES 列表）

- [ ] **步骤 1：创建 evolution.js**

```js
/**
 * 方案演进史（plan-evolution.json）写入
 * 元数据索引：方案每次成功变更追加一条 {version, at, by, types, reason, experimentKeys}
 * 写入失败不阻塞主流程（与快照同策略，调用方 try/catch 不强制）
 */
export function appendPlanEvolution(store, { version, by, types = [], reason = "", experimentKeys = [] }) {
  try {
    const doc = store.read("plan-evolution");
    const entries = [
      ...(doc.entries || []),
      { version, at: store.now(), by, types, reason, experimentKeys },
    ];
    store.write("plan-evolution", { ...doc, entries });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
```

- [ ] **步骤 2：store.js FILES 注册 plan-evolution**

在 `src-server/server/store.js` 的 FILES 数组中 `"plan",` 之后加一行 `"plan-evolution",`。

- [ ] **步骤 3：验证模块可加载**

运行（工作目录 `C:\Users\nms\Documents\Hana\materials-research-copilot`）：
```bash
node -e "import('./src-server/server/evolution.js').then(m=>console.log('OK', typeof m.appendPlanEvolution)).catch(e=>console.log('FAIL', e.message))"
```
预期：`OK function`

- [ ] **步骤 4：提交**（项目非 git 仓库，跳过 commit；以步骤 3 验证通过为完成标志）

---

### 任务 2：proposals.js — 提案接受路径接入演进记录

**文件：**
- 修改：`src-server/server/proposals.js`（头部 import + applyProposal 成功返回前）

- [ ] **步骤 1：加 import**

在 `proposals.js` 顶部 import 区加：
```js
import { appendPlanEvolution } from "./evolution.js";
```

- [ ] **步骤 2：applyProposal 成功返回前接入**

找到 applyProposal 中：
```js
  if (!result.ok) {
    return { ok: false, error: result.error, data: result.data };
  }
  return { ok: true, data: result.data, applied: true };
```
替换为：
```js
  if (!result.ok) {
    return { ok: false, error: result.error, data: result.data };
  }
  if (target === "plan") {
    const ev = proposal.meta?.evolution;
    appendPlanEvolution(store, {
      version: result.data.version,
      by: "ai",
      types: Array.isArray(ev?.types) ? ev.types.filter((t) => ["material", "process", "scope", "direction", "other"].includes(t)) : [],
      reason: ev?.reason || proposal.reason || "",
    });
  }
  return { ok: true, data: result.data, applied: true };
```

- [ ] **步骤 3：验证**（临时数据目录冒烟：构造 plan + plan-evolution 空文档，createProposal 带 meta.evolution 后 accept）

运行（用临时目录 `C:\Users\nms\Documents\Hana\plugin-test\tmp\evo-test`，先在其中放空 plan.json `{"version":0,"title":"","hypothesis":"","route":"","milestones":[]}`）：
```bash
node -e "
import('./src-server/server/store.js').then(async ({createStore}) => {
  const store = createStore('C:/Users/nms/Documents/Hana/plugin-test/tmp/evo-test');
  const { createProposal } = await import('./src-server/server/proposals.js');
  const p = createProposal(store, { target:'plan', action:'update', diff:{title:'T'}, reason:'测试提案', baseVersion:0, meta:{ evolution:{ types:['material'], reason:'换材料' } } });
  const acc = await import('./src-server/server/proposals.js');
  const r = acc.acceptProposal ? acc.acceptProposal(store, p.entry.id) : null;
  const evo = store.read('plan-evolution');
  console.log('entries:', JSON.stringify(evo.entries));
}).catch(e => console.log('FAIL', e.message))
"
```
预期：`entries: [{"version":1,...,"by":"ai","types":["material"],"reason":"换材料",...}]`

> 注：若 acceptProposal 导出名不同，改用等价验证——直接调 applyProposal(store, p.entry)（需先确认其导出，见步骤 4）。

- [ ] **步骤 4：确认 accept 导出名并完成验证**

```bash
node -e "import('./src-server/server/proposals.js').then(m=>console.log(Object.keys(m).join(',')))"
```
按实际导出名调整步骤 3 脚本后重跑，预期同上。

---

### 任务 3：api.js — 端点与写路径接入

**文件：**
- 修改：`src-server/routes/api.js`（头部 import、/state 枚举、PUT 通用端点、新增 /plan/evolution、rollback 端点）

- [ ] **步骤 1：加 import**

api.js 顶部 import 区（`import { createProposal } ...` 附近）加：
```js
import fs from "node:fs";
import path from "node:path";
import { appendPlanEvolution } from "../server/evolution.js";
```

- [ ] **步骤 2：/state 枚举加 plan-evolution**

找到 `/state` 中：
```js
    for (const name of ["binding", "plan", "gantt", "calendar", "literature", "worklog", "reviews", "rejected", "settings", "report", "collections", "proposals", "assessment"]) {
```
替换为：
```js
    for (const name of ["binding", "plan", "plan-evolution", "gantt", "calendar", "literature", "worklog", "reviews", "rejected", "settings", "report", "collections", "proposals", "assessment"]) {
```

- [ ] **步骤 3：PUT 通用端点支持 evolution**

找到：
```js
      const { version, data } = body || {};
```
替换为：
```js
      const { version, data, evolution } = body || {};
```

找到：
```js
      const result = store.update(name, version, () => data);
      if (!result.ok) {
        return c.json({ error: "version_conflict", data: result.data }, 409);
      }
```
在 `if (!result.ok)` 块后、`if (name === "worklog" ...)` 前插入：
```js
      if (name === "plan" && result.ok) {
        const ev = evolution;
        appendPlanEvolution(store, {
          version: result.data.version,
          by: "user",
          types: Array.isArray(ev?.types) ? ev.types.filter((t) => ["material", "process", "scope", "direction", "other"].includes(t)) : [],
          reason: typeof ev?.reason === "string" ? ev.reason.slice(0, 300) : "",
          experimentKeys: Array.isArray(ev?.experimentKeys) ? ev.experimentKeys.map(String).slice(0, 20) : [],
        });
      }
```

- [ ] **步骤 4：新增 /plan/evolution 两个端点**

在 `/plan/assess` 端点（`app.post("/plan/assess" ...`）之前插入：
```js
  // ── 方案演进史 ─────────────────────────────────────────────
  app.get("/plan/evolution", (c) => {
    const doc = store.read("plan-evolution");
    return c.json({ entries: doc.entries || [], snapshots: store.listSnapshots("plan") });
  });

  app.get("/plan/evolution/:version", (c) => {
    const v = Number(c.req.param("version"));
    if (!Number.isInteger(v) || v <= 0) return c.json({ error: "invalid_version" }, 400);
    const file = path.join(ctx.dataDir, "snapshots", "plan", `${v}.json`);
    if (!fs.existsSync(file)) return c.json({ error: "no_snapshot" }, 404);
    return c.json({ version: v, content: JSON.parse(fs.readFileSync(file, "utf-8")) });
  });
```

- [ ] **步骤 5：rollback 端点支持 toVersion + 演进记录**

找到：
```js
  app.post("/snapshots/:name/rollback", (c) => {
    const name = c.req.param("name");
    if (!WRITABLE.has(name)) return c.json({ error: "invalid_target" }, 400);
    const result = store.rollback(name);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, data: result.data });
  });
```
替换为：
```js
  app.post("/snapshots/:name/rollback", async (c) => {
    const name = c.req.param("name");
    if (!WRITABLE.has(name)) return c.json({ error: "invalid_target" }, 400);
    let toVersion;
    try {
      const body = await c.req.json();
      toVersion = body?.toVersion;
    } catch {}
    if (toVersion === undefined) {
      const q = c.req.query("toVersion");
      if (q !== undefined && q !== null && q !== "") toVersion = Number(q);
    }
    const result = store.rollback(name, toVersion);
    if (!result.ok) return c.json({ error: result.error }, 400);
    if (name === "plan") {
      appendPlanEvolution(store, {
        version: result.data.version,
        by: "rollback",
        types: [],
        reason: toVersion !== undefined ? `回退到 v${toVersion}` : "回退到上一版本",
      });
    }
    return c.json({ ok: true, data: result.data });
  });
```

- [ ] **步骤 6：构建服务端**

运行：`npm run build:server`（工作目录项目根）
预期：构建成功无报错

- [ ] **步骤 7：提交**

---

### 任务 4：manage-plan.js — evolution 参数透传

**文件：**
- 修改：`src-server/tools/manage-plan.js`（parameters + update plan 分支 createProposal）

- [ ] **步骤 1：parameters 加 evolution**

在 `parameters.properties` 的 `id` 属性之后加：
```js
    evolution: {
      type: "object",
      description:
        "可选，仅 plan 的 update 时使用：本次方案变更的类型与原因，写入方案演进史。types 从 ['material','process','scope','direction','other'] 多选（material=改材料/process=改工艺/scope=范围调整/direction=大改方向/other=其他）；reason 为变更原因一句话",
      properties: {
        types: { type: "array", items: { type: "string", enum: ["material", "process", "scope", "direction", "other"] } },
        reason: { type: "string" },
      },
    },
```

- [ ] **步骤 2：update plan 分支透传 meta**

找到 manage-plan.js update 分支：
```js
    const result = createProposal(store, {
      target,
      action: "update",
      diff,
      reason: target === "plan" ? "更新研究方案" : `更新实验记录条目 ${input.id}`,
      baseVersion,
    });
```
替换为：
```js
    const result = createProposal(store, {
      target,
      action: "update",
      diff,
      reason: target === "plan" ? "更新研究方案" : `更新实验记录条目 ${input.id}`,
      baseVersion,
      meta: target === "plan" && input.evolution ? { evolution: input.evolution } : undefined,
    });
```

- [ ] **步骤 3：构建服务端**

运行：`npm run build:server`
预期：成功

---

### 任务 5：log-work.js — 实验记录自动带方案版本

**文件：**
- 修改：`src-server/tools/log-work.js:79-83`（worklogEntry 构造）

- [ ] **步骤 1：加 planVersion**

找到：
```js
  const worklogEntry = {
    id: newId("work"),
    date,
    content,
    data: input.data || null,
```
替换为：
```js
  const worklogEntry = {
    id: newId("work"),
    date,
    content,
    data: input.data || null,
    planVersion: plan.version,
```

- [ ] **步骤 2：构建服务端**

运行：`npm run build:server`
预期：成功

---

### 任务 6：ui/api.ts — 前端 API

**文件：**
- 修改：`ui/api.ts`（savePlan / getPlanEvolution / getPlanSnapshot / rollbackTo）

- [ ] **步骤 1：加四个方法**

在 `write` 方法后加：
```ts
  savePlan: (version: number, data: unknown, evolution?: { types: string[]; reason?: string; experimentKeys?: string[] }) =>
    request<any>(`plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, data, evolution }),
    }),
  getPlanEvolution: () => request<any>(`plan/evolution`),
  getPlanSnapshot: (version: number) => request<any>(`plan/evolution/${version}`),
  rollbackTo: (version: number) =>
    request<any>(`snapshots/plan/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toVersion: version }),
    }),
```

- [ ] **步骤 2：验证构建**

运行：`npm run build:ui`（必须用 powershell-tool 通道，exec_command 沙箱会拦 vite esbuild spawn）
预期：构建成功

---

### 任务 7：PlanPanel.tsx — 变更说明 + 演进史区块

**文件：**
- 修改：`ui/panels/PlanPanel.tsx`

- [ ] **步骤 1：加常量与 state**

文件顶部（`draftFromPlan` 函数后）加：
```tsx
const CHANGE_TYPES = [
  { key: 'material', label: '改材料' },
  { key: 'process', label: '改工艺' },
  { key: 'scope', label: '范围调整' },
  { key: 'direction', label: '大改方向' },
  { key: 'other', label: '其他' },
];
```

组件内 state 区（`const [confirmNew, setConfirmNew] = useState(false);` 后）加：
```tsx
  // 变更说明（演进史标注，可折叠可不填）
  const [showChange, setShowChange] = useState(false);
  const [changeTypes, setChangeTypes] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [changeExperimentKeys, setChangeExperimentKeys] = useState<string[]>([]);
  // 演进史
  const [evoOpen, setEvoOpen] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [viewContent, setViewContent] = useState<any>(null);
  const [rollbackTarget, setRollbackTarget] = useState<any>(null);
  const [evoBusy, setEvoBusy] = useState(false);
```

- [ ] **步骤 2：关联实验与演进条目 useMemo**

在 `assessStale` 定义后加：
```tsx
  const recentWork = useMemo(() => {
    const now = Date.now();
    return (state?.worklog?.entries || [])
      .filter((e: any) => {
        const d = new Date(e.date).getTime();
        return Number.isFinite(d) && now - d <= 14 * 864e5 && now - d >= 0;
      })
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  }, [state?.worklog]);

  const worklogMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of state?.worklog?.entries || []) if (e.id) m.set(e.id, e);
    return m;
  }, [state?.worklog]);

  const evoItems = useMemo(() => {
    const entries = state?.planEvolution?.entries || [];
    const snapshots: number[] = state?.planEvolution?.snapshots || [];
    const byVersion = new Map(entries.map((e: any) => [e.version, e]));
    const versions = new Set<number>([...snapshots, ...byVersion.keys()]);
    return [...versions]
      .sort((a, b) => b - a)
      .map((v) => byVersion.get(v) || { version: v, at: null, by: 'history', types: [], reason: '', experimentKeys: [] });
  }, [state?.planEvolution]);
```

- [ ] **步骤 3：save 改用 savePlan 带 evolution**

找到：
```tsx
      await api.write('plan', plan.version, data);
```
替换为：
```tsx
      const evolution = showChange
        ? { types: changeTypes, reason: changeReason, experimentKeys: changeExperimentKeys }
        : undefined;
      await api.savePlan(plan.version, data, evolution);
      setShowChange(false);
```

- [ ] **步骤 4：viewVersion 与回退处理函数**

在 `save` 函数后加：
```tsx
  const openVersion = async (v: number) => {
    setEvoBusy(true);
    try {
      const r = await api.getPlanSnapshot(v);
      setViewContent(r.content || null);
      setViewVersion(v);
    } catch (err: any) {
      showToast(err.message?.includes('no_snapshot') ? '该版本历史内容已归档清理' : `读取失败：${err.message}`, { error: true });
    } finally {
      setEvoBusy(false);
    }
  };

  const doRollbackTo = async (v: number) => {
    setRollbackTarget(null);
    setEvoBusy(true);
    try {
      await api.rollbackTo(v);
      dirtyRef.current = false;
      await onStateChange();
      showToast(`已回退到 v${v}`);
    } catch (err: any) {
      showToast(`回退失败：${err.message}`, { error: true });
    } finally {
      setEvoBusy(false);
    }
  };
```

- [ ] **步骤 5：变更说明 UI（mrc-actions 之前插入）**

找到：
```tsx
      <div className="mrc-actions">
        <button className="mrc-btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存方案'}</button>
```
在 `<div className="mrc-actions">` 之前插入：
```tsx
      <div className="mrc-evo-block">
        <button className="mrc-btn small" onClick={() => setShowChange(!showChange)}>
          📝 {showChange ? '收起变更说明' : '填写变更说明（可选）'}
        </button>
        {showChange && (
          <div className="mrc-evo-panel">
            <div className="mrc-evo-types">
              {CHANGE_TYPES.map((t) => (
                <button
                  key={t.key}
                  className={`mrc-chip ${changeTypes.includes(t.key) ? 'active' : ''}`}
                  onClick={() =>
                    setChangeTypes((prev) => (prev.includes(t.key) ? prev.filter((k) => k !== t.key) : [...prev, t.key]))
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              className="mrc-evo-reason"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="变更原因（一句话，例如：8/3 实验发现薄膜开裂，调整退火温度）"
            />
            {recentWork.length > 0 && (
              <div className="mrc-evo-experiments">
                <div className="mrc-evo-label">关联实验（变更前 14 天内，可多选）：</div>
                {recentWork.map((w: any) => (
                  <label key={w.id} className="mrc-evo-exp">
                    <input
                      type="checkbox"
                      checked={changeExperimentKeys.includes(w.id)}
                      onChange={(e) =>
                        setChangeExperimentKeys((prev) =>
                          e.target.checked ? [...prev, w.id] : prev.filter((k) => k !== w.id)
                        )
                      }
                    />
                    <span>{w.date} · {String(w.content || '').slice(0, 40)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
```

- [ ] **步骤 6：演进史区块（对照评估区块之前插入）**

找到：
```tsx
      <div className="mrc-panel-section mrc-assess-block">
```
之前插入：
```tsx
      <div className="mrc-panel-section mrc-evo-history">
        <div className="mrc-section-head">
          <span className="mrc-section-title">📜 方案演进史</span>
          <span className="mrc-head-actions">
            <button className="mrc-btn small" onClick={() => setEvoOpen(!evoOpen)}>
              {evoOpen ? '收起' : '展开'}
            </button>
          </span>
        </div>
        {evoOpen && (
          <div className="mrc-evo-list">
            {evoItems.length === 0 && (
              <div className="mrc-empty">暂无变更记录。保存方案时可填写「变更说明」；AI 修改方案会自动记录。</div>
            )}
            {evoItems.map((item) => (
              <div key={item.version} className={`mrc-evo-item ${item.version === plan.version ? 'latest' : ''}`}>
                <div className="mrc-evo-item-head">
                  <span className="mrc-evo-ver">v{item.version}</span>
                  <span className="mrc-evo-at">{item.at ? new Date(item.at).toLocaleString('zh-CN') : '（历史未标注）'}</span>
                  <span className="mrc-evo-by">
                    {item.by === 'ai' ? '🤖 AI' : item.by === 'rollback' ? '↩ 回退' : item.by === 'user' ? '✍️ 手动' : ''}
                  </span>
                  {item.types && item.types.length > 0 ? (
                    item.types.map((t: string) => (
                      <span key={t} className="mrc-chip">{CHANGE_TYPES.find((c) => c.key === t)?.label || t}</span>
                    ))
                  ) : (
                    <span className="mrc-evo-unlabeled">未标注变更</span>
                  )}
                  <span className="mrc-head-actions">
                    <button className="mrc-btn small" onClick={() => openVersion(item.version)}>查看此版本</button>
                    {item.version !== plan.version && (
                      <button className="mrc-btn small" onClick={() => setRollbackTarget(item)}>回退到此版</button>
                    )}
                  </span>
                </div>
                {item.reason && <div className="mrc-evo-reason-text">{item.reason}</div>}
                {item.experimentKeys && item.experimentKeys.length > 0 && (
                  <div className="mrc-evo-exps">
                    关联实验：
                    {item.experimentKeys.map((k: string) => {
                      const w = worklogMap.get(k);
                      return w ? (
                        <span key={k} className="mrc-chip">{w.date} {String(w.content || '').slice(0, 24)}</span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rollbackTarget && (
        <div className="mrc-inline-confirm mrc-evo-rollback-confirm">
          <span className="mrc-confirm-tip">确认回退到 v{rollbackTarget.version}？当前方案内容将被该版本覆盖（可再次回退恢复）。</span>
          <button className="mrc-btn small danger" onClick={() => doRollbackTo(rollbackTarget.version)} disabled={evoBusy}>确认回退</button>
          <button className="mrc-btn small" onClick={() => setRollbackTarget(null)}>取消</button>
        </div>
      )}

      {viewVersion !== null && (
        <div className="mrc-drawer-mask" onClick={() => { setViewVersion(null); setViewContent(null); }}>
          <div className="mrc-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mrc-drawer-head">
              <span>方案 v{viewVersion}（只读）</span>
              <span className="mrc-head-actions">
                <button className="mrc-btn small" onClick={() => { setViewVersion(null); setViewContent(null); }}>关闭</button>
              </span>
            </div>
            <div className="mrc-report-modal-body">
              {viewContent ? (
                <div className="mrc-plan-readonly">
                  <div className="mrc-field"><label>研究题目</label><div>{viewContent.title || '（空）'}</div></div>
                  <div className="mrc-field"><label>研究假设</label><div style={{ whiteSpace: 'pre-wrap' }}>{viewContent.hypothesis || '（空）'}</div></div>
                  <div className="mrc-field"><label>技术路线</label><div style={{ whiteSpace: 'pre-wrap' }}>{viewContent.route || '（空）'}</div></div>
                  <div className="mrc-field"><label>里程碑</label><div style={{ whiteSpace: 'pre-wrap' }}>{Array.isArray(viewContent.milestones) ? viewContent.milestones.join('\n') : viewContent.milestones || '（空）'}</div></div>
                </div>
              ) : (
                <div className="mrc-empty">读取中…</div>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **步骤 7：构建 UI**

运行：`npm run build:ui`（powershell-tool 通道）
预期：构建成功

---

### 任务 8：panel.css — 演进史样式

**文件：**
- 修改：`ui/panel.css`

- [ ] **步骤 1：追加样式**

在文件末尾追加：
```css
/* 方案演进史 + 变更说明 */
.mrc-evo-block { margin: 8px 0 4px; }
.mrc-evo-panel {
  margin-top: 6px; padding: 8px 10px;
  border: 1px solid var(--mrc-border); border-radius: 6px;
  background: var(--mrc-bg);
}
.mrc-evo-types { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.mrc-evo-reason { width: 100%; box-sizing: border-box; font-size: 12px; padding: 4px 6px; margin-bottom: 6px; }
.mrc-evo-label { font-size: 11px; color: var(--mrc-text-dim); margin: 4px 0 2px; }
.mrc-evo-exp { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; padding: 2px 0; cursor: pointer; }
.mrc-evo-exp input { margin-top: 2px; }
.mrc-evo-history { margin-top: 4px; }
.mrc-evo-list { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.mrc-evo-item {
  border: 1px solid var(--mrc-border); border-radius: 6px;
  padding: 6px 8px; font-size: 12px;
}
.mrc-evo-item.latest { border-color: var(--mrc-accent); }
.mrc-evo-item-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.mrc-evo-ver { font-weight: 700; color: var(--mrc-accent); }
.mrc-evo-at { color: var(--mrc-text-dim); font-size: 11px; }
.mrc-evo-by { font-size: 11px; }
.mrc-evo-unlabeled { color: var(--mrc-text-dim); font-style: italic; font-size: 11px; }
.mrc-evo-reason-text { margin-top: 4px; color: var(--mrc-text); }
.mrc-evo-exps { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; color: var(--mrc-text-dim); font-size: 11px; }
.mrc-evo-rollback-confirm { margin: 6px 0; }
.mrc-plan-readonly .mrc-field > div { border: 1px solid var(--mrc-border); border-radius: 4px; padding: 6px 8px; font-size: 12.5px; background: var(--mrc-bg); }
```

- [ ] **步骤 2：构建 UI**

运行：`npm run build:ui`（powershell-tool 通道）
预期：构建成功

---

### 任务 9：dev 槽重载 + 全量功能验证

**文件：** 无（验证）

- [ ] **步骤 1：重载 dev 槽**

先 `plugin_dev_reload`；若报 "No dev source slot registered"，则 `plugin_dev_install` + `plugin_dev_enable(allowFullAccess=true)`。

- [ ] **步骤 2：API 验证（按测试清单）**

从 `C:\Users\nms\.hanako\server-info.json` 读 `{port, token}`，Base = `http://127.0.0.1:{port}/api/plugins/materials-research-copilot`，Header `Authorization: Bearer {token}`：

1. GET `/plan/evolution` → `{entries: [...], snapshots: [...]}`（旧数据兼容：不炸）
2. PUT `/plan` body `{version, data: {...}, evolution: {types:['material','process'], reason:'测试变更', experimentKeys:[]}}` → 200；GET /state 的 plan-evolution.entries 尾部出现 `by:"user"` 记录
3. PUT `/plan` 不带 evolution → 记录 `types:[]`（未标注）
4. POST `/snapshots/plan/rollback` body `{toVersion: <当前-2>}` → 200；plan-evolution 尾部 `by:"rollback"`，reason 含「回退到 v」
5. GET `/plan/evolution/<刚才回退的版本>` → 快照内容
6. GET `/plan/evolution/99999` → 404 no_snapshot
7. 恢复：POST rollback（默认）回上一版，并把 plan 内容还原（或接受测试前快照）

- [ ] **步骤 3：工具验证**

1. `log_work`（[回归] 标记，内容「测试方案版本关联」）→ 生成的 worklog 提案 diff 含 `planVersion`；拒绝该提案
2. `manage_plan` update plan 带 `evolution: {types:['scope'], reason:'测试AI标注'}` → 提案 meta.evolution 存在；拒绝提案

- [ ] **步骤 4：面板产物验证**

`assets/panel.js` Contains：`savePlan`、`getPlanEvolution`、`回退到此版`、`mrc-evo-history`、`填写变更说明`、`方案演进史`、`未标注变更`、`查看此版本`

- [ ] **步骤 5：恢复现场**

- 还原 plan 内容与 version（回退到验证前快照）
- 清理测试产生的 plan-evolution 条目（保留真实演进记录；测试条目若写入则删除）
- 还原 worklog（提案已拒绝即无变化）

---

### 任务 10：回归 + 同步正式目录 + test-log

**文件：** `C:\Users\nms\Documents\Hana\plugin-test\test-log.md`

- [ ] **步骤 1：回归 7 工具冒烟**

manage_plan / manage_schedule / collect_literature（read 或轻量调用）/ log_work / review_research / assess_plan / export_report——各调用一次确认无回归（写操作走提案后拒绝）。

- [ ] **步骤 2：同步正式安装目录**

```powershell
robocopy <src> <dst> /E /NFL /NDL /NJH /NP /XD <src>\node_modules <src>\docs <src>\tmp
```
退出码 1 = 成功。正式目录 `C:\Users\nms\.hanako\plugins\materials-research-copilot`。

- [ ] **步骤 3：同步正式数据目录**

dev 数据目录 → 正式数据目录：plan-evolution.json（含真实演进记录）、plan.json、worklog.json、proposals.json、rejected.json（如本轮产生）、其余不变文件跳过。正式数据目录 `C:\Users\nms\.hanako\plugin-data\materials-research-copilot`。

- [ ] **步骤 4：正式目录模块加载验证**

```bash
node -e "import('./index.js').then(()=>console.log('index OK')).catch(e=>console.log('FAIL:',e.message))"
```
工作目录为正式安装目录，预期 OK（index.js 依赖 evolution.js 链路）。

- [ ] **步骤 5：写 test-log**

记录：变更内容（演进史/变更标注/实验版本关联）、验证表（清单 1-9）、遗留（B 并行路线下一迭代）、正式目录同步状态。
