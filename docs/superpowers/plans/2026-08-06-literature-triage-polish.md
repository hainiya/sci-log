# 文献体验打磨 + 巡检开关 + 文案澄清 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 五项小改进——AI 摘要+关键词默认铺完、待整理可移除、扫描按钮归位文献库、AI 巡检可开关、开始日期文案澄清。

**架构：** 服务端三处改动（增强链路扩展为「摘要+关键词」循环铺完；`DELETE /literature` 端点；`autoTriage` 开关生效于两条巡检触发路径）+ UI 三处（文献面板按钮/关键词行/移除/扫描迁入、设置开关、表单文案）。改动彼此独立，数据模型新增 `keywords`/`keywordsSource` 字段（null 兼容旧数据）。

**技术栈：** Node ESM + esbuild bundle（服务端）、React + Vite（UI）、settings.json 既有读写通道、mock LLM bus 验证。

**执行约束（务必遵守）：**
- 项目**非 git 仓库**：跳过全部 commit 步骤；每任务完成写 `plugin-test/sdd/task-N-report.md` + 更新账本 `plugin-test/sdd/progress.md`
- 本会话 **exec_command 沙箱不稳定**：构建/验证一律用 powershell-tool 通道（vite esbuild spawn 会被沙箱拦 EPERM），用 EXIT 码 + 产物 mtime 复核
- 构建后验证走 **node 直调构建产物**（宿主工具模块缓存，工具层验证不走 MCP 工具）
- 测试数据带 `[loop]` 标记，用完清理；dev 槽数据目录 `C:\Users\nms\.hanako\plugin-data\dev\materials-research-copilot`
- **esbuild 产物中文转义为 `\uXXXX`**，特征验证用转义形式；vite 产物中文不转义
- 每任务 UI 改动后必须 `npx tsc --noEmit`（vite esbuild 不做类型检查）
- 规格权威：`docs/superpowers/specs/2026-08-06-literature-triage-polish-design.md`（任务简报与规格冲突时以规格为准）

---

### 任务 1：服务端增强链路扩展（摘要 + 关键词，循环铺完）

**文件：**
- 修改：`src-server/server/llm.js`（新增 extractKeywords）
- 修改：`src-server/server/sources.js`（targets 扩展 + 关键词分支 + runEnhancementLoop）
- 修改：`src-server/index.js`（同步后调度循环）
- 验证：`plugin-test/tmp/enh-loop-verify.mjs`（新建）

- [ ] **步骤 1：llm.js 新增 extractKeywords（放在 summarizeFromFulltext 附近）**

```js
/**
 * 文献关键词提取：从摘要或全文提取 3-5 个中文关键词（逗号分隔）
 * 返回 string[]；失败返回 null（不阻塞增强链路）
 */
export async function extractKeywords(ctx, entry, text) {
  const out = await sampleText(ctx, {
    callPoint: "extractKeywords",
    messages: [
      { role: "system", content: "你是材料科学文献关键词提取助手。根据论文标题与摘要/全文，提取 3-5 个最能概括主题的中文关键词。只输出 JSON 数组字符串，如 [\"关键词1\",\"关键词2\"]，不要解释。" },
      { role: "user", content: `标题：${entry.title || ""}（${entry.year || ""}）\n\n来源文本：\n${String(text || "").slice(0, 12000)}` },
    ],
    temperature: 0.2,
  });
  if (!out) return null;
  try {
    const m = String(out).match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    const kws = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    return kws.length >= 1 ? kws : null;
  } catch {
    return null;
  }
}
```

（`sampleText` 与既有 llm.js 内调用方式一致；若本文件无 `sampleText` 导出而是 `completeText` 等，按文件内既有 LLM 调用函数对齐签名。）

- [ ] **步骤 2：sources.js targets 扩展 + 关键词提取分支 + 循环函数**

修改 `enhanceZoteroPdfs`：

```js
  const targets = (doc.entries || []).filter(
    (e) =>
      // 既有 Zotero 摘要/PDF 目标（不变）
      (e.source === "zotero" &&
        ((e.pdfPath && (!e.fullTextParsed || (e.fullTextParsed === "failed" && failedRetryable(e)))) ||
          (e.fullTextParsed === "ok" && !e.abstractSource) ||
          (e.abstractSource === "zotero_original" && isEnglishText(e.abstract)) ||
          (!e.pdfPath && !String(e.abstract || "").trim() && !e.abstractSource))) ||
      // 新增：缺关键词目标（任意来源，有摘要或全文可用）
      (e.keywords == null &&
        (String(e.abstract || "").trim() || String(e.abstractEn || "").trim() || e.fullText))
  );
```

处理循环内（`for (const entry of batch)` 开头处，分支零之前）新增关键词分支：

```js
      // 关键词分支：缺关键词且 llmUsed 有预算 → 从摘要/全文提取
      if (entry.keywords == null && llmUsed < llmLimit) {
        const src = String(entry.abstract || "").trim() || String(entry.abstractEn || "").trim() || String(entry.fullText || "").slice(0, 12000);
        if (src) {
          try {
            const kws = await extractKeywords(ctx, entry, src);
            if (kws) {
              const patchBase = { keywords: kws, keywordsSource: "ai" };
              if (entry.source === "zotero") {
                patchEntry(entry.zoteroKey, patchBase);
              } else {
                store.update("literature", undefined, (cur) => ({
                  entries: (cur.entries || []).map((e) => (e.id === entry.id ? { ...e, ...patchBase } : e)),
                }));
              }
              llmUsed += 1;
              continue;
            }
          } catch {}
        }
      }
```

注意：`continue` 会跳过既有分支；关键词提取失败后**不 continue**（走既有分支）。调整：失败时不要 continue。正确写法——仅在成功时 `llmUsed += 1` 且**不 continue**（关键词与摘要互不排斥，一次调用只做一个动作；为保持既有语义，成功也继续走下方分支？不——llmUsed 已 +1，继续走会重复处理同一条。改为：关键词成功后 continue；失败则落入既有分支继续处理）。以「成功 continue / 失败 fallthrough」为准。

新增循环调度函数（文件末尾）：

```js
/**
 * 增强循环：逐批铺完摘要/翻译/关键词
 * 终止条件：无目标（processed === 0）或本轮零产出（防止 LLM 持续失败死循环）
 */
export async function runEnhancementLoop(ctx, store) {
  let rounds = 0;
  for (;;) {
    const r = await enhanceZoteroPdfs(ctx, store, 8, 3);
    rounds += 1;
    if (r.processed === 0 || (r.summaries + r.keywords) === 0 || rounds >= 30) break;
  }
  return { rounds };
}
```

`enhanceZoteroPdfs` 返回对象需加 `keywords` 计数（每批统计 keywords 成功数，与 summaries 并列）。

- [ ] **步骤 3：index.js 调度循环**

`import { runEnhancementLoop }`（与 enhanceZoteroPdfs 同源）。两处：

```js
    // 启动后立即同步一次（失败静默，定时器会重试）；同步后跑增强循环（摘要+关键词铺完）
    this._syncZoteroNow(true).catch(() => {});
```

`_syncZoteroNow` 内部（同步成功后）与 `_zoteroTimer` 回调处，同步完成后追加：

```js
      runEnhancementLoop(ctx, this._store).catch(() => {});
```

（若 `_syncZoteroNow` 已含 enhanceZoteroPdfs 调用，保留既有行为并把该调用替换为 runEnhancementLoop；先读 index.js 相关段落确认，以「同步成功后必跑一次循环」为语义。）

- [ ] **步骤 4：验证脚本 `plugin-test/tmp/enh-loop-verify.mjs`（node 直调构建产物 + mock LLM bus）**

要点：mock bus 的 `sampleText` 返回 `["掺杂","区熔","热电"]`；构造 20 篇缺关键词条目（含在线条目 + Zotero 条目、1 篇无来源跳过）→ 跑 `runEnhancementLoop` → 断言：目标全部写入 keywords/keywordsSource；无来源条目保持 null；轮次 ≥ 3；LLM 调用数 ≤ 30 且停止后无残留目标。另 1 篇 mock LLM 连续失败 → 循环终止（rounds 有限）不无限跑。断言输出 `PASS/FAIL` 逐项 + exit code。

- [ ] **步骤 5：构建 + 运行验证**

构建：`npm run build:server`（powershell-tool 通道），EXIT 码 + 产物 mtime 复核。运行：`node plugin-test/tmp/enh-loop-verify.mjs` 指向 `dist-server/` 构建产物（dataDir 用临时目录，不碰 dev 槽）。预期全部 PASS。清理临时数据。

- [ ] **步骤 6：写 task-1-report.md + 更新 progress.md**

---

### 任务 2：DELETE /literature 端点

**文件：**
- 修改：`src-server/routes/api.js`（新增端点，放 `/scan` 端点附近）
- 验证：`plugin-test/tmp/lit-delete-verify.mjs`（新建）

- [ ] **步骤 1：新增端点**

```js
  // ── 文献移除（用户操作：待整理条目单条/清空；Zotero 镜像只读拒绝） ──
  app.delete("/literature", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch {}
    const doc = store.read("literature");
    const entries = doc.entries || [];
    let targets;
    if (body?.all === true) {
      targets = entries.filter((e) => e.source !== "zotero").map((e) => e.id);
    } else if (Array.isArray(body?.ids)) {
      targets = body.ids.filter((id) => typeof id === "string" && id);
    } else {
      return c.json({ error: "bad_request", hint: "需要 ids 数组或 all=true" }, 400);
    }
    const removable = new Set(
      entries.filter((e) => targets.includes(e.id) && e.source !== "zotero").map((e) => e.id)
    );
    if (removable.size === 0) return c.json({ ok: true, removed: 0 });
    try {
      store.update("literature", doc.version, (cur) => ({
        entries: (cur.entries || []).filter((e) => !removable.has(e.id)),
      }));
      return c.json({ ok: true, removed: removable.size });
    } catch {
      return c.json({ error: "conflict", hint: "文献库已变更，请刷新后重试" }, 409);
    }
  });
```

（路由前缀与既有端点一致：`app.delete("/literature")` 若项目统一前缀在 app 层，按既有 `/scan` 的注册方式对齐。）

- [ ] **步骤 2：验证脚本（HTTP 打 dev 槽端点）**

dev 槽加载后 `POST /scan` 或直接往 dev 槽 literature.json 注入 3 条 `[loop]` 在线条目 + 确认 1 条 Zotero 镜像存在 → `DELETE /literature {ids:[2条]}` → 断言 removed=2、镜像拒绝、剩余 1 条；`DELETE /literature {all:true}` → 断言全部非 Zotero 条目清空、Zotero 镜像不动、计数正确。断言输出 + exit code + 清理注入条目还原基线。

- [ ] **步骤 3：写 task-2-report.md + 更新 progress.md**

---

### 任务 3：autoTriage 巡检开关

**文件：**
- 修改：`src-server/routes/api.js`（写入路径检查）
- 修改：`src-server/tools/log-work.js`（工具路径检查）
- 修改：`src-server/routes/api.js`（新增 `POST /settings/auto-triage`）
- 验证：`plugin-test/tmp/triage-switch-verify.mjs`（新建）

- [ ] **步骤 1：面板写入路径检查（routes/api.js:138-141 现状）**

```js
      // 实验记录写入后触发 AI 巡检（异步，不阻塞响应）：参数结构化/文献关联/甘特进度/日程/方案对比 → 全部走提案
      if (name === "worklog" && result.ok) {
        const settings = readSettings(ctx, store);
        if (settings.autoTriage !== false) {
          triageWorklog(ctx, store).catch((err) => ctx?.log?.warn(`triage after write failed: ${err?.message || err}`));
        }
      }
```

- [ ] **步骤 2：工具路径检查（tools/log-work.js 巡检调用前）**

```js
  // 2. AI 巡检本条记录（与面板写入路径一致…）
  const autoTriage = (toolCtx.store?.read?.("settings")?.autoTriage) !== false;
  if (autoTriage) {
    // 既有 triageWorkEntry 调用 + 提案生成块（3/3.5/4/5/6/P0-1）
  }
```

（若 log-work.js 无 `toolCtx.store`，用其既有 store 实例变量名对齐；关键：默认 true——`!== false` 判定，未设置时仍自动巡检。）

- [ ] **步骤 3：设置保存端点（routes/api.js，settings 相关端点附近）**

```js
  app.post("/settings/auto-triage", async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch {}
    const enabled = body?.enabled === true;
    writeSettings(ctx, store, { autoTriage: enabled });
    return c.json({ ok: true, autoTriage: enabled });
  });
```

- [ ] **步骤 4：验证脚本（node 直调构建产物 + mock LLM bus + 临时 dataDir）**

用例：① 默认（无设置）→ log_work 提交 → LLM 被调用（计数 > 0）；② 设置 autoTriage=false → 提交 → LLM 计数 0（零调用）；③ 手动 force 巡检（`POST /worklog/triage {force:true}` 端点或 triageWorklog 直调）→ 仍产出提案；④ 开关回 true → 恢复自动。断言输出 + exit code + 清理临时数据。

- [ ] **步骤 5：写 task-3-report.md + 更新 progress.md**

---

### 任务 4：UI 文献面板（按钮/关键词行/移除/扫描迁入）

**文件：**
- 修改：`ui/panels/LiteraturePanel.tsx`
- 修改：`ui/Panel.tsx`（顶层扫描按钮移除）
- 修改：`ui/api.ts`（deleteLiterature 调用）

- [ ] **步骤 1：api.ts 新增调用**

```ts
  deleteLiterature: (payload: { ids?: string[]; all?: boolean }) =>
    request<{ ok: boolean; removed: number }>('literature', { method: 'DELETE', body: payload }),
```

（与 `purgeGone` 同文件同风格；确认 request 支持 body 传对象——参照 `saveSearchWindow` 等既有调用。）

- [ ] **步骤 2：LiteraturePanel 头部按钮区改造**

- 「🔄 扫描」按钮（scanning busy 态，调 `api.scan()`，成功 toast 显示 entries 数量——scan 返回结构按现有端点确认，失败 toast 错误）
- 「✨ AI 摘要」按钮（原 enhancePdfs，改文案/title，**常驻显示**——删除 `entries.some(...)` 条件包裹；busy 文案「补全中…」保留）
- 「清除失效」保持现状

```tsx
        <div className="mrc-section-head">
          <span className="mrc-section-title">📚 文献库</span>
          <span className="mrc-count">{entries.length}</span>
          <span className="mrc-zotero-status" title={...}>{...}</span>
          <button className="mrc-btn small" onClick={scanNow} disabled={scanning} title="全量同步：Zotero 镜像 + 工作区扫描 + 去重">
            {scanning ? '⏳ 扫描中…' : '🔄 扫描'}
          </button>
          <button className="mrc-btn small" onClick={enhancePdfs} disabled={enhanceBusy} title="生成/翻译摘要 + 提取关键词（解析 PDF）">
            {enhanceBusy ? '补全中…' : '✨ AI 摘要'}
          </button>
          ...清除失效按钮原样...
        </div>
```

`scanNow`：

```tsx
  const [scanning, setScanning] = useState(false);
  const scanNow = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      await onStateChange();
      showToast(`扫描完成：新增/更新 ${r?.entries?.length ?? r?.replaced ?? 0} 条`);
    } catch (err: any) {
      showToast(`扫描失败：${err.message}`, { error: true });
    } finally {
      setScanning(false);
    }
  };
```

（toast 文案以实际端点返回结构调整；`api.scan()` 已存在。）

- [ ] **步骤 3：关键词行渲染（AbstractBlock 下方 / 卡片 meta 区）**

在 `.mrc-paper-meta` 之后、authors 之前插入：

```tsx
                {Array.isArray(entry.keywords) && entry.keywords.length > 0 && (
                  <div className="mrc-paper-keywords" title={entry.keywordsSource === 'ai' ? 'AI 提取的关键词' : undefined}>
                    {entry.keywordsSource === 'ai' && <span className="mrc-ai-badge">✨</span>}
                    <span>关键词：{entry.keywords.join(' · ')}</span>
                  </div>
                )}
```

（样式类 `mrc-paper-keywords` 在 panel.css 补 2-3 行：字体小、颜色次级。）

- [ ] **步骤 4：待整理移除（单条 + 清空）**

单条（卡片 actions 区，仅非 zotero 显示）：

```tsx
                  {entry.source !== 'zotero' && (
                    <RemoveToggle
                      onConfirm={() => removeEntries([entry.id])}
                    />
                  )}
```

行内两段式组件（与 purgeGone 同款 state 模式）：

```tsx
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const removeEntries = async (ids: string[]) => {
    setPurgeBusy(true);
    try {
      const r = await api.deleteLiterature({ ids });
      setRemoveId(null);
      await onStateChange();
      showToast(`已移除 ${r.removed} 条`);
    } catch (err: any) {
      showToast(`移除失败：${err.message}`, { error: true });
    } finally {
      setPurgeBusy(false);
    }
  };
```

单条按钮渲染：`removeId === entry.id ? (确认移除/取消) : (✕ 移除)`。

清空（to-organize 工具行，与导出 RIS 并列）：

```tsx
          {filter === 'to-organize' && collCounts.toOrganize > 0 && (
            <button className="mrc-btn small danger" onClick={() => setRemoveId('__all__')} title="删除全部待整理条目（Zotero 镜像不受影响）">
              🗑 清空待整理（{collCounts.toOrganize}）
            </button>
          )}
```

`removeId === '__all__'` 时显示确认条（确认调 `deleteLiterature({ all: true })`）。两段式确认 UI 与 purgeGone 风格一致。

- [ ] **步骤 5：Panel.tsx 顶层扫描按钮移除**

删除顶层「🔄 扫描文献」按钮及其 `scanning` state 与 `api.scan()` 调用（该组件内的）。确认顶层按钮删除后无残留引用（tsc 兜底）。

- [ ] **步骤 6：tsc + 浏览器验证**

`npx tsc --noEmit` 0 错误。dev 槽浏览器（凭证 patch 流程既有）：文献库面板——顶层无扫描按钮、面板有「🔄 扫描」「✨ AI 摘要」常驻；待整理分组（若有注入 [loop] 条目）卡片显示「✕ 移除」、清空按钮；移除单条后计数变化；关键词行渲染（注入一条带 keywords 的 [loop] 条目验证样式）；清理 [loop] 痕迹。

- [ ] **步骤 7：写 task-4-report.md + 更新 progress.md**

---

### 任务 5：设置开关 + 表单文案

**文件：**
- 修改：`ui/settings/SettingsDrawer.tsx`
- 修改：`ui/api.ts`（saveAutoTriage）
- 修改：`ui/panels/WorklogPanel.tsx`（label + hint）

- [ ] **步骤 1：api.ts + SettingsDrawer 开关**

```ts
  saveAutoTriage: (enabled: boolean) =>
    request<{ ok: boolean; autoTriage: boolean }>('settings/auto-triage', { method: 'POST', body: { enabled } }),
```

SettingsDrawer 新增 section（放「检索设置」后）：

```tsx
        <section className="mrc-drawer-section">
          <h4>🤖 AI 巡检</h4>
          <p className="mrc-drawer-hint">每次实验记录写入后自动 AI 巡检（参数结构化/文献关联/甘特进度/日程/时长提取），生成提案待你确认。关闭后仍可手动巡检。</p>
          <label className="mrc-switch-row">
            <input
              type="checkbox"
              checked={autoTriage}
              onChange={async (e) => {
                const v = e.target.checked;
                await api.saveAutoTriage(v);
                setAutoTriage(v);
                showToast(v ? '自动巡检已开启' : '自动巡检已关闭');
                await onStateChange();
              }}
            />
            <span>实验记录自动巡检</span>
          </label>
        </section>
```

state 初始化：`useState<boolean>((state as any)?.settings?.autoTriage !== false)`（默认 true，与后端一致）。`mrc-switch-row` 样式 panel.css 补 2-3 行。

- [ ] **步骤 2：WorklogPanel 文案**

- 新建表单 label：「开始日期（可选）」→「实验开始日期（可选）」
- label 下方加一行小字：`<span className="mrc-field-hint">决定甘特图实际条起点；留空则从记录日期开始</span>`
- 编辑弹窗同 label 改（hint 也加，保持一致）；`mrc-field-hint` 样式 panel.css 补（小字、次级色）

- [ ] **步骤 3：tsc + 浏览器验证**

`npx tsc --noEmit` 0 错误。浏览器：设置面板出现「实验记录自动巡检」开关、默认勾选、切换后 toast + 刷新保持；实验记录表单 label/hint 文本存在（新建与编辑两处）。

- [ ] **步骤 4：写 task-5-report.md + 更新 progress.md**

---

### 任务 6：双构建 + 全量验证 + 回归 + 正式目录同步 + 交付

**文件：**
- 修改：`plugin-test/test-log.md`（追加报告）
- 验证：全部既有验证脚本复跑（dur-tool-verify / dur-triage-verify / dur-project-verify / enh-loop-verify / lit-delete-verify / triage-switch-verify）

- [ ] **步骤 1：双构建 + tsc**

powershell-tool 通道：`npm run build:server` + `npm run build:ui`，EXIT 码 + mtime 复核；`npx tsc --noEmit` 0 错误。

- [ ] **步骤 2：特征验证（构建产物字符串）**

- panel.js（vite，明文）：「实验开始日期（可选）」「决定甘特图实际条起点」「✨ AI 摘要」「实验记录自动巡检」「🗑 清空待整理」「关键词：」「✕ 移除」
- tools/log-work.js（esbuild，转义）：`autoTriage` 判定串
- routes/api.js（esbuild，转义）：`settings.autoTriage` / `DELETE` 端点特征

- [ ] **步骤 3：回归**

dev 槽基线核对（literature 153 无 [loop]、worklog 1、proposals 214/0 pending、gantt/calendar 0）；浏览器快照：5 面板正常、提案角标正常；时长甘特链路不受影响（SchedulePanel 投影模拟脚本复跑 6/6）。

- [ ] **步骤 4：正式目录同步 + 交付**

robocopy（排除 node_modules/docs/tmp）→ 特征复核正式目录（panel.js 含新文案、tools/log-work.js 含开关、routes/api.js 含端点）→ test-log.md 追加功能报告 → 交付说明（重启生效）。

---

## 自检记录

- **规格覆盖**：节 1→任务 1+4；节 2→任务 2+4；节 3→任务 4；节 4→任务 3+5；节 5→任务 5；影响文件表→任务 1-5 全覆盖；测试验收→任务 1/2/3 脚本 + 任务 4/5 浏览器 + 任务 6 回归。无遗漏。
- **占位符**：无 TODO/待定；所有关键代码块已给出，仅两处「按既有模式对齐」的显式适配点（llm.js 调用函数名、路由前缀）标注了确认动作。
- **类型一致性**：`keywords: string[] | null`、`keywordsSource: 'ai' | null` 全程一致；`autoTriage` 布尔默认 true 三处（api.js 检查 / log-work.js 检查 / SettingsDrawer 初始化）同语义；`deleteLiterature` 载荷 `{ids} | {all}` 前后一致；`runEnhancementLoop(ctx, store)` 返回 `{rounds}` 单处定义。
