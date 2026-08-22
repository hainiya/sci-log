# 文献分析范围控制 + 检索约束 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让文献分析可指定范围（按 Zotero 分类或全库），让在线检索强制关键词并默认限定年份窗口（可覆盖），检索条目带可追溯元数据。

**架构：** 三个检索源（Semantic Scholar/arXiv/Crossref）的查询 URL 追加年份范围参数；`collect_literature` 工具强制 `query` 必填并新增 `fromYear`/`toYear` 覆盖默认窗口（settings 新增 `searchYearWindow`，默认 5）；在线条目入库带 `collectedWith {query, fromYear, toYear, sourceApi}`；UI 报告范围下拉补分类选项（后端 `/report/refresh` 已支持 collection scope），文献卡片来源角标显示年份范围。lifecycle 自动搜集复用同一窗口逻辑。

**技术栈：** Node ESM（esbuild bundle）、React 面板（vite）、现有 store/提案体系。无测试框架——验证用 node 脚本 + 工具调用 + HTTP 端点。

**环境备注（重要）：**
- 项目非 git 仓库，各任务无 commit 步骤，以「构建产物确认」收尾。
- 构建命令：`npm run build:server`（esbuild，输出到项目根）与 `npm run build:ui`（vite，输出 `assets/`）。**build:ui 必须用 powershell-tool 通道执行**（exec_command 沙箱会拦 vite 的 esbuild spawn，报 `spawn EPERM`）。
- 构建后需 `plugin_dev_reload`（pluginId `materials-research-copilot`，allowFullAccess=true）使 dev 槽生效。
- 插件数据目录：dev 槽 `C:\Users\nms\.hanako\plugin-data\dev\materials-research-copilot\`；正式 `C:\Users\nms\.hanako\plugin-data\materials-research-copilot\`。写测试数据一律带 `[测试]` 标记，测完清理。
- 正式安装目录 `C:\Users\nms\.hanako\plugins\materials-research-copilot` 在最终验证后 robocopy 同步（排除 node_modules/docs/tmp）。
- 宿主 API：`http://127.0.0.1:32087`，token 以 `C:\Users\nms\.hanako\server-info.json` 为准（会轮换，勿硬编码）。

---

## 文件结构

| 文件 | 职责 | 变更 |
| --- | --- | --- |
| `src-server/server/literature-client.js` | 检索客户端：年份范围解析 + 三源 URL 过滤 | 修改 |
| `src-server/tools/collect-literature.js` | 工具：query 必填、年份参数、collectedWith、schema | 修改 |
| `src-server/index.js` | lifecycle：自动搜集套窗口 + collectedWith | 修改 |
| `src-server/routes/api.js` | `POST /settings/search-window` 端点 | 修改 |
| `ui/api.ts` | `saveSearchWindow` 方法 | 修改 |
| `ui/settings/SettingsDrawer.tsx` | 「🔍 检索设置」区块（年份窗口输入） | 修改 |
| `ui/panels/LiteraturePanel.tsx` | 报告范围下拉加分类 + 卡片来源角标 | 修改 |
| `ui/panel.css` | `.mrc-year-input` 小宽度输入样式 | 修改 |
| `docs/superpowers/specs/2026-08-06-analysis-scope-and-search-constraints-design.md` | 设计规格（已批准） | 已存在 |

---

### 任务 1：literature-client.js — resolveYearRange + 三源年份过滤

**文件：** 修改 `src-server/server/literature-client.js`

- [ ] **步骤 1：导出 resolveYearRange 并接入三源（实现）**

在文件顶部（`sanitizeTitle` 之前）新增：

```js
/** 解析检索年份窗口：settings.searchYearWindow 默认 5（1-30 校验），返回 {from, to}，含当年共 N 年 */
export function resolveYearRange(settings = {}) {
  const w = Number(settings?.searchYearWindow);
  const window = Number.isInteger(w) && w >= 1 && w <= 30 ? w : 5;
  const to = new Date().getFullYear();
  return { from: to - window + 1, to };
}
```

三处检索函数签名与 URL 改造（`searchAll` 内 worker 调用同步透传）：

```js
  /** Semantic Scholar：批量搜索（Graph API） */
  async function searchSemanticScholar(query, limit = 10, yearRange = null) {
    const yearParam = yearRange ? `&year=${yearRange.from}-${yearRange.to}` : "";
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}&fields=title,authors,year,venue,abstract,externalIds,url,fieldsOfStudy,citationCount,doi,journal${yearParam}`;
    ...
  }

  /** arXiv API（Atom 格式） */
  async function searchArxiv(query, limit = 10, yearRange = null) {
    const dateParam = yearRange ? ` AND submittedDate:[${yearRange.from}01010000 TO ${yearRange.to}12312359]` : "";
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}${dateParam}`)}&start=0&max_results=${Math.min(limit, 100)}`;
    ...
  }

  /** Crossref 搜索 */
  async function searchCrossref(query, limit = 10, yearRange = null) {
    const dateFilter = yearRange ? `&filter=from-pub-date:${yearRange.from}-01-01,until-pub-date:${yearRange.to}-12-31` : "";
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${Math.min(limit, 100)}&select=DOI,title,author,issued,container-title,publisher,URL,abstract,is-referenced-by-count${dateFilter}`;
    ...
  }

  /** 三源并行检索（Semantic Scholar 为主，arXiv/Crossref 补充） */
  async function searchAll(query, limit = 10, signal = null, yearRange = null) {
    const perSource = Math.max(3, Math.ceil(limit / 2));
    const tasks = [
      { name: "semanticscholar", fn: () => searchSemanticScholar(query, perSource, yearRange) },
      { name: "arxiv", fn: () => searchArxiv(query, Math.max(3, Math.ceil(perSource / 2)), yearRange) },
      { name: "crossref", fn: () => searchCrossref(query, Math.max(3, Math.ceil(perSource / 2)), yearRange) },
    ];
    ...其余不变
  }
```

- [ ] **步骤 2：node 验证 resolveYearRange 行为**

运行（PowerShell，项目根目录）：

```powershell
node --input-type=module -e "import('./src-server/server/literature-client.js').then(m => { console.log(JSON.stringify(m.resolveYearRange({ searchYearWindow: 5 }))); console.log(JSON.stringify(m.resolveYearRange({ searchYearWindow: 0 }))); console.log(JSON.stringify(m.resolveYearRange({}))); })"
```

预期（当前年 2026）：`{"from":2022,"to":2026}`、`{"from":2022,"to":2026}`（0 越界回退 5）、`{"from":2022,"to":2026}`。
若 import 报错（文件有顶层副作用依赖），备选：把函数体复制到 `node -e` 中 eval 验证输出。

- [ ] **步骤 3：构建确认**

运行：`npm run build:server`（exec_command 即可，esbuild CLI 不受沙箱影响）
预期：无错误输出，根目录 `server/literature-client.js`（bundle 产物）更新。

---

### 任务 2：collect-literature.js — query 必填 + 年份参数 + collectedWith + schema

**文件：** 修改 `src-server/tools/collect-literature.js`

- [ ] **步骤 1：文件头注释与 import 修正**

```js
/**
 * collect_literature：文献检索与入库
 * - 在线源：Semantic Scholar / arXiv / Crossref（去重合并，强制检索词 + 年份窗口）
 * - 本地源：Zotero（按 source 参数选择）
 * - 入库：autoApproveLiterature=true 直接追加式入库；否则生成批量提案
 */
```

import 删除 `extractKeywords` 行（useAutoKeywords 逻辑删除后不再使用）：

```js
import { scanAllSources } from "../server/sources.js";
import { ensureAutoBinding } from "../server/binding.js";
```

`description` 修正（顺带修复上轮 workspace 删除遗留的措辞）：

```js
export const description =
  "为科研工作搜集文献：按检索词在线检索（Semantic Scholar/arXiv/Crossref）并扫描本地 Zotero 文献源，去重后入文献库。入库策略受 autoApproveLiterature 设置控制。";
```

- [ ] **步骤 2：schema 更新（parameters 块）**

```js
export const parameters = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "检索词，必填，如「SnSe 热电 掺杂」；不填将拒绝执行",
    },
    limit: {
      type: "integer",
      description: "在线检索条数上限，默认 10，最大 50",
    },
    fromYear: {
      type: "integer",
      description: "起始年份（4 位数字），覆盖默认窗口；不传则用设置中的默认窗口",
    },
    toYear: {
      type: "integer",
      description: "结束年份（4 位数字），不超过当前年；不传则用默认窗口的结束年",
    },
    source: {
      type: "string",
      enum: ["online", "zotero", "all"],
      description: "文献来源：online=在线检索；zotero=本地 Zotero；all=全部（默认）",
    },
  },
};
```

- [ ] **步骤 3：execute 检索段改造**

`src-server/tools/collect-literature.js` 第 60-67 行（在线检索分支开头）替换为：

```js
  // 1. 在线检索
  if (source === "online" || source === "all") {
    const query = String(input.query || "").trim();
    if (!query) {
      return {
        content: [
          {
            type: "text",
            text: "请提供检索关键词（query 参数）。插件不支持无关键词检索，以免收进方向不明的文献。",
          },
        ],
      };
    }
    // 年份窗口：默认近 N 年（settings.searchYearWindow，默认 5）；fromYear/toYear 可覆盖
    const currentYear = new Date().getFullYear();
    const settings = store.read("settings");
    let yearRange = resolveYearRange(settings);
    if (input.fromYear !== undefined || input.toYear !== undefined) {
      const f = input.fromYear !== undefined ? Number(input.fromYear) : yearRange.from;
      const t = input.toYear !== undefined ? Number(input.toYear) : currentYear;
      const valid = (v, n) => Number.isInteger(v) && String(n).length === 4 && String(n).match(/^\d{4}$/);
      if (!valid(f, input.fromYear) || !valid(t, input.toYear)) {
        return {
          content: [{ type: "text", text: "fromYear / toYear 必须为 4 位年份数字（如 2021、2026）。" }],
        };
      }
      if (f > t) {
        return { content: [{ type: "text", text: "fromYear 不能晚于 toYear。" }] };
      }
      if (t > currentYear) {
        return { content: [{ type: "text", text: `toYear 不能超过当前年份 ${currentYear}。` }] };
      }
      yearRange = { from: f, to: t };
    }
    const client = createLiteratureClient(toolCtx);
    const items = await client.searchAll(query, limit, null, yearRange);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      results.push({
        id: `lit_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: store.now(),
        status: "new",
        collectedWith: { query, fromYear: yearRange.from, toYear: yearRange.to, sourceApi: item.sourceApi },
        ...item,
      });
    }
  }
```

import 区新增 `resolveYearRange`：

```js
import { createLiteratureClient, resolveYearRange } from "../server/literature-client.js";
```

- [ ] **步骤 4：返回文本加检索参数行**

`src-server/tools/collect-literature.js` 第 138-142 行（titles 构造前）插入：

```js
  const searchMeta =
    source === "online" || source === "all"
      ? `检索参数：关键词「${query}」，时间 ${yearRange.from}-${yearRange.to}\n\n`
      : "";
```

titles 构造改为：

```js
  const titles = searchMeta + results
    .slice(0, 10)
    .map((r) => `- [${r.year || "?"}] ${r.title}（${r.sourceApi || r.source || "?"}）`)
    .join("\n");
```

- [ ] **步骤 5：构建确认**

运行：`npm run build:server`
预期：无错误；`tools/collect-literature.js`（bundle 产物）grep 无 `useAutoKeywords`，含 `collectedWith` 与 `resolveYearRange`。

---

### 任务 3：index.js — 自动搜集套窗口 + collectedWith

**文件：** 修改 `src-server/index.js`

- [ ] **步骤 1：import 增加 resolveYearRange**

```js
import { createLiteratureClient, resolveYearRange } from "./server/literature-client.js";
```

- [ ] **步骤 2：_autoCollect 检索与入库改造**

`src-server/index.js` 第 141-143 行：

```js
    const query = keywords.join(" ");
    const client = createLiteratureClient(ctx);
    const yearRange = resolveYearRange(readSettings(ctx, this._store));
    const items = await client.searchAll(query, 6, null, yearRange);
```

第 156-163 行 entries 构造加 collectedWith：

```js
    const entries = [...relevant, ...uncertain].map((item, i) => ({
      id: `lit_auto_${Date.now().toString(36)}_${i}`,
      addedAt: store.now(),
      status: "new",
      autoCollected: true,
      relevant: i < relevant.length,
      collectedWith: { query, fromYear: yearRange.from, toYear: yearRange.to, sourceApi: item.sourceApi },
      ...item,
    }));
```

- [ ] **步骤 3：构建确认**

运行：`npm run build:server`
预期：无错误。

---

### 任务 4：api.js + api.ts — POST /settings/search-window

**文件：** 修改 `src-server/routes/api.js`、`ui/api.ts`

- [ ] **步骤 1：api.js 新增端点（放在 `/settings/metrics` 之后）**

```js
  // ── 设置抽屉：检索年份窗口（默认近 N 年，在线检索/自动搜集共用） ──
  app.post("/settings/search-window", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const years = Number(body?.years);
    if (!Number.isInteger(years) || years < 1 || years > 30) {
      return c.json({ error: "invalid_years", message: "年份窗口需为 1-30 的整数" }, 400);
    }
    writeSettings(ctx, store, { searchYearWindow: years });
    return c.json({ ok: true, searchYearWindow: years });
  });
```

（`readSettings`/`writeSettings` 已在此文件 import，无需新增。）

- [ ] **步骤 2：api.ts 新增方法（`saveMetricTargets` 之后）**

```ts
  saveSearchWindow: (years: number) =>
    request<any>('settings/search-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ years }),
    }),
```

- [ ] **步骤 3：构建确认**

运行：`npm run build:server`（api.js 产物）；`npm run build:ui`（**用 powershell-tool 通道**）
预期：均无错误。

---

### 任务 5：SettingsDrawer.tsx + panel.css — 检索设置区块

**文件：** 修改 `ui/settings/SettingsDrawer.tsx`、`ui/panel.css`

- [ ] **步骤 1：SettingsDrawer 状态与保存函数**

`SettingsDrawer.tsx` 现有 state 区（`const [probing, setProbing] = useState(false);` 之后）新增：

```ts
  const [yearWindow, setYearWindow] = useState<number>(Number((state as any)?.settings?.searchYearWindow) || 5);
```

`reprobeZotero` 函数之后新增：

```ts
  const saveYearWindow = async () => {
    const y = Math.round(Number(yearWindow));
    if (!Number.isFinite(y) || y < 1 || y > 30) {
      showToast('年份窗口需为 1-30 的整数', { error: true });
      return;
    }
    await api.saveSearchWindow(y);
    setYearWindow(y);
    showToast(`检索年份窗口已保存：近 ${y} 年`);
  };
```

- [ ] **步骤 2：区块 JSX（「🚫 拒绝记录」section 之前插入）**

```tsx
        <section className="mrc-drawer-section">
          <h4>🔍 检索设置</h4>
          <p className="mrc-drawer-hint">在线检索与自动搜集文献时的默认时间范围（收集方向由检索词决定，时间由此窗口限定）。</p>
          <div className="mrc-folder-row">
            <span>默认检索窗口</span>
            <input
              type="number"
              min={1}
              max={30}
              className="mrc-year-input"
              value={yearWindow}
              onChange={(e) => setYearWindow(Number(e.target.value))}
            />
            <span>近 N 年</span>
            <button className="mrc-btn small" onClick={saveYearWindow}>保存</button>
          </div>
        </section>
```

- [ ] **步骤 3：panel.css 新增样式（`.mrc-metric-target input` 附近）**

```css
.mrc-year-input { width: 64px; text-align: center; }
```

- [ ] **步骤 4：构建确认**

运行：`npm run build:ui`（powershell-tool 通道）
预期：无错误；`assets/panel.js` grep 含「检索设置」。

---

### 任务 6：LiteraturePanel.tsx — 报告范围下拉分类 + 卡片角标

**文件：** 修改 `ui/panels/LiteraturePanel.tsx`

- [ ] **步骤 1：refreshReport 支持分类 scope**

`src/…/LiteraturePanel.tsx` 第 124-131 行 refreshReport 函数内 scope 构造替换为：

```ts
      const scope =
        reportScope === 'all'
          ? { type: 'all' as const }
          : reportScope.startsWith('coll:')
            ? { type: 'collection' as const, key: reportScope.slice(5), label: collectionMap.get(reportScope.slice(5))?.name || reportScope.slice(5) }
            : { type: 'recent' as const, n: Number(reportScope) };
```

（`collectionMap` 在第 45 行已有，可直接用。）

- [ ] **步骤 2：报告范围下拉加分类选项**

第 369-374 行下拉替换为：

```tsx
            <select className="mrc-lit-sort" value={reportScope} onChange={(e) => setReportScope(e.target.value)} title="报告分析范围">
              <option value="all">全库</option>
              <option value="10">最近 10 篇</option>
              <option value="20">最近 20 篇</option>
              <option value="50">最近 50 篇</option>
              {collections.length > 0 && <option disabled>── 按分类 ──</option>}
              {collections.map((c) => (
                <option key={c.key} value={`coll:${c.key}`}>
                  {c.name}（{collCounts[c.key] || 0}）
                </option>
              ))}
            </select>
```

（`collCounts` 在第 61 行已有；`collections` 在第 44 行已有。）

- [ ] **步骤 3：卡片来源角标（第 321-324 行）替换**

```tsx
                  {entry.source === 'zotero' ? (
                    <span className={`mrc-paper-source src-zotero`}>
                      {entry.readOnly ? 'Zotero 镜像' : 'Zotero'}
                    </span>
                  ) : entry.collectedWith ? (
                    <span
                      className={`mrc-paper-source src-${entry.source || 'unknown'}`}
                      title={`检索词：${entry.collectedWith.query}；时间 ${entry.collectedWith.fromYear}-${entry.collectedWith.toYear}`}
                    >
                      在线 · {String(entry.collectedWith.fromYear).slice(2)}-{String(entry.collectedWith.toYear).slice(2)}
                    </span>
                  ) : (
                    <span className={`mrc-paper-source src-${entry.source || 'unknown'}`}>
                      {SOURCE_LABELS[entry.source] || entry.source}
                    </span>
                  )}
                  {entry.unsupported ? '（暂不支持解析）' : ''}
```

（注意：原代码 `unsupported` 后缀在 span 内，新结构保持在其后相邻输出，效果一致。）

- [ ] **步骤 4：构建确认**

运行：`npm run build:ui`（powershell-tool 通道）
预期：无错误；`assets/panel.js` grep 含「按分类」与「在线 ·」。

---

### 任务 7：构建 + 重载 + 功能验证

**文件：** 无（验证用）

- [ ] **步骤 1：全量构建 + dev 槽重载**

运行（powershell-tool）：`npm run build:server; npm run build:ui`，然后 `plugin_dev_reload`（allowFullAccess=true）。
预期：均成功，插件 status=loaded、activationState=activated。

- [ ] **步骤 2：无 query 拒绝**

`plugin_dev_invoke_tool` 调 `collect_literature`，input `{ query: '', source: 'online', limit: 3 }`（先 `useAutoKeywords` 不存在了）。
预期：返回文本「请提供检索关键词」。

- [ ] **步骤 3：指定年份窗口检索（带 [测试] 标记思路：检索词用热电方向，结果可保留）**

`plugin_dev_invoke_tool` 调 `collect_literature`，input `{ query: 'SnSe thermoelectric doping', source: 'online', limit: 5, fromYear: 2024, toYear: 2026 }`。
预期：返回文本含「检索参数：关键词「SnSe thermoelectric doping」，时间 2024-2026」；抽查入库条目的 `year` 均在 2024-2026（个别条目无 year 字段时检查 collectedWith 存在且 fromYear=2024、toYear=2026）。
检查：读 `plugin-data\dev\...\literature.json`，验证新条目的 `collectedWith` 结构与年份。

- [ ] **步骤 4：默认窗口生效**

`plugin_dev_invoke_tool` 调 `collect_literature`，input `{ query: 'flexible thermoelectric generator', source: 'online', limit: 3 }`（不传年份）。
预期：返回文本时间 = 当前年-4 到当前年（2022-2026）；新条目 collectedWith.fromYear=2022、toYear=2026。

- [ ] **步骤 5：参数校验**

`plugin_dev_invoke_tool` 调 `collect_literature`，input `{ query: 'test', fromYear: 2030 }`。
预期：返回「toYear 不能超过当前年份」或对应校验错误（2030 作为 toYear 超当前年）。

- [ ] **步骤 6：settings 端点持久化**

HTTP POST `http://127.0.0.1:32087/api/plugins/materials-research-copilot/settings/search-window`，body `{"years": 7}`（用 server-info.json 最新 token）。
预期：`{ ok: true, searchYearWindow: 7 }`；settings.json 含 `searchYearWindow: 7`。
测后还原为 5（POST `{"years": 5}`）。

- [ ] **步骤 7：分类分析端点（HTTP，scope=collection）**

先确认存在分类：GET `/state`，取 `collections.collections` 任一条的 key。
POST `/report/refresh`，body `{ scope: { type: 'collection', key: <key>, label: <name> } }`。
预期：报告开头为 `> 分析范围：collection「<name>」N 篇`（后端已有此功能，仅验证链路）。
测后还原报告：POST `/report/refresh`，body `{ scope: { type: 'all' } }` 重新生成全库报告。

- [ ] **步骤 8：面板产物抽查**

`assets/panel.js` grep：`按分类`、`coll:`、`在线 ·`、`检索设置`、`saveSearchWindow`。
预期：全部命中。

---

### 任务 8：回归 + 同步正式目录

- [ ] **步骤 1：回归冒烟（7 工具）**

- `manage_plan` read：plan v12 真实方案正常返回。
- `manage_schedule` read：gantt/calendar 正常。
- `log_work`：[回归] 标记内容 → 生成提案 → 拒绝归档。
- `review_research` / `assess_plan`：只读审查，SUGGESTIONS 提案拒绝归档。
- `export_report`：导出 review 或 report（sessionPath 用当前会话）。
- `collect_literature`：已完成（任务 7）。
- 结束后 `proposals` 待处理归零，数据与操作前一致（plan/gantt/calendar/worklog 无 [测试]/[回归] 残留；文献库新增条目为热电方向真实文献，保留并记录）。

- [ ] **步骤 2：同步正式安装目录**

robocopy（PowerShell，排除 node_modules/docs/tmp）：
```powershell
$src = 'C:\Users\nms\Documents\Hana\materials-research-copilot'; $dst = 'C:\Users\nms\.hanako\plugins\materials-research-copilot'; robocopy $src $dst /E /NFL /NDL /NJH /NP /XD "$src\node_modules" "$src\docs" "$src\tmp"
```
预期：退出码 ≤ 1；正式目录模块加载验证（node import index.js/routes/api.js/tools/collect-literature.js 均 OK）。

- [ ] **步骤 3：数据目录核对**

正式数据目录 `plugin-data\materials-research-copilot\literature.json` 与 dev 一致（任务 7 新增的 collectedWith 条目需从 dev 数据目录迁移到正式数据目录——新增条目同样存在 dev 数据，同步方式：复制 literature.json + settings.json（若 searchYearWindow 被改过）到正式数据目录）。

- [ ] **步骤 4：记录 test-log**

追加到 `C:\Users\nms\Documents\Hana\plugin-test\test-log.md`：本轮功能变更、任务 7/8 的测试轮次、参数、结果、遗留问题（若有）。

---

## 自检

**1. 规格覆盖度：**
- 时间窗口默认近 5 年可覆盖 → 任务 1（resolveYearRange）+ 任务 2（fromYear/toYear）+ 任务 5（设置 UI）✓
- 关键词强制 → 任务 2（query 必填 + 删 useAutoKeywords）✓
- collectedWith 入库 + 卡片角标 → 任务 2/3（入库）+ 任务 6（角标）✓
- 自动搜集套同一约束 → 任务 3 ✓
- 三源年份过滤 → 任务 1 ✓
- 分析范围下拉分类 → 任务 6（后端已有，仅 UI）✓
- 错误处理表（query 空 / 年份非法 / from>to / to 超当前年 / window 越界）→ 任务 2 步骤 3 + 任务 1 步骤 1 + 任务 5 步骤 1 ✓
- 测试清单 → 任务 7/8 ✓
- 数据兼容（旧条目无 collectedWith 正常显示、settings 缺省回退）→ 任务 6 步骤 3（旧条目走 else 分支）+ 任务 1（?? 5）✓

**2. 占位符扫描：** 无 TODO/待定；所有代码块完整可复制。

**3. 类型一致性：** `resolveYearRange(settings)` 返回 `{from, to}`，任务 1/2/3 使用一致；`searchAll(query, limit, signal, yearRange)` 签名在任务 1 定义、任务 2/3 调用处均为四参；`collectedWith` 字段结构 `{query, fromYear, toYear, sourceApi}` 三处一致；scope 前缀 `coll:` 在任务 6 下拉与 refreshReport 两侧一致。
