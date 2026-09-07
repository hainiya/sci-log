# sci-log 升级到最新 Hana 插件契约 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 sci-log 插件（当前 1.2.1，`minAppVersion 0.159.0`）升级到最新 Hana（0.680+）的插件契约：manifest 现代化、SDK 依赖可移植化、assets 静态资源协议合规化、会话身份细节修正。不改变业务行为。

**架构：** 逐项对齐 2026-08-27 解包确认的最新 SDK 契约（`@hana/plugin-protocol`、`@hana/plugin-runtime`、`@hana/plugin-sdk`，均 0.0.0 tarball，来自 hana-plugin-creator skill）。核心原则：静态 `tools/*.js` 导出四件套与 class 生命周期形态**已经合规**，不重构；只动 manifest 声明、构建产物投递方式、SDK 引用方式和会话身份细节。

**技术栈：** Node ESM、esbuild（服务端构建）、Vite（UI 构建）、TypeScript、Hono（route shell）、@hana/plugin-* SDK tarball。

**验证基线（升级前实测）：**
- `bun test tests/`：除 `consistency.test.mjs` 的 O-8「prompt 枚举应包含体系 Cu₂Se」外全部通过（该失败源于**用户未提交的** `prompts/worklog-triage.md` 改动，与本次升级无关，不处理）。
- `zotero-sync.test.mjs`：SKIP（无 Zotero 实机）。
- 环境无 `node`/`npm`，用 `C:/Users/liao2/scoop/shims/bun.exe`（bun 1.4.0）执行 npm 脚本与测试。

---

## 文件结构

**修改：**
- `manifest.json`：entry、activationEvents、minAppVersion、多语言 title、capabilities 校准、sensitiveCapabilities、dev.scenarios 路径更新（如需要）
- `package.json`：SDK 依赖从本机绝对路径改为可移植（bun 支持 `workspace:` / 本地相对路径 + postinstall 复制，或打包时注入）
- `scripts/sync-version.mjs`：版本 1.2.1 → 1.3.0（manifest + package.json 双写或校验）
- `src-server/routes/ui.ts`：route shell 从"内联 CSS/JS"改为"引用 `assets/` 官方路径"（`/api/plugins/{id}/assets/...`），保留 hana-css/hana-theme 主题参数
- `src-server/routes/api.ts`：会话身份 query fallback 从 `sessionId` 校准为 `pluginSurfaceSession`（header 名已正确）
- `ui/`（Panel.tsx 及组件）：如 assets 引用方式变更需同步
- `README.md`：版本、最低宿主、安装说明更新
- `vite.config.ts`：如产物需要同时输出到 assets 且不被构建清空（当前 `emptyOutDir:false` 已正确）

**创建：**
- `scripts/install-sdk.mjs`：把 SDK tarball 从 hana-plugin-creator skill 复制进仓库内 `vendor/sdk/`（或安装时注入），使 package.json 依赖可移植
- `docs/superpowers/plans/2026-08-27-hana-latest-contract.md`（本计划）

**测试：**
- 现有 `tests/*.test.mjs` 全部保持通过（业务逻辑不变，测试不应改动）
- `tests/consistency.test.mjs`：不因本次改动而新增失败（保持 1 个既有失败）

---

### 任务 1：manifest.json 契约现代化

**文件：**
- 修改：`manifest.json`

- [ ] **步骤 1：修改 manifest.json**

```json
{
  "manifestVersion": 1,
  "id": "sci-log",
  "name": "科研工作",
  "version": "1.3.0",
  "description": "科研工作：实验记录中心 + 甘特图/日历 + 指标趋势 + 文献库（Zotero 收纳）",
  "minAppVersion": "0.680.0",
  "trust": "full-access",
  "entry": "index.js",
  "activationEvents": ["onStartup"],
  "capabilities": [
    "session",
    "model.sample",
    "network.fetch"
  ],
  "sensitiveCapabilities": [],
  "network": {
    "allowedHosts": ["localhost", "127.0.0.1", "api.openalex.org"],
    "methods": ["GET", "POST"],
    "defaultTimeoutMs": 15000,
    "maxResponseBytes": 10485760,
    "allowLocalhost": true
  },
  "contributes": {
    "page": {
      "title": { "zh": "科研工作", "en": "Research Log" },
      "route": "/page",
      "icon": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M5 5h14v14H5z\"/><path d=\"M9 9h6M9 13h6\"/></svg>"
    },
    "widget": {
      "title": { "zh": "科研工作", "en": "Research Log" },
      "route": "/widget",
      "icon": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M8 7l-4 5 4 5\"/><path d=\"M16 7l4 5-4 5\"/></svg>"
    },
    "configuration": {
      "type": "object",
      "properties": {
        "zoteroPort": { "type": "integer", "default": 23119, "title": "Zotero 本地 API 端口", "description": "Zotero 桌面客户端本地 API 监听端口（Zotero 7+，需保持客户端运行）" },
        "autoCollectEnabled": { "type": "boolean", "default": true, "title": "绑定会话后自动同步 Zotero", "description": "绑定会话后，用户消息触发时自动同步 Zotero 本地文献库并日志化到实验记录" },
        "autoTriage": { "type": "boolean", "default": true, "title": "实验记录自动巡检", "description": "每次实验记录写入后自动 AI 巡检（参数结构化/文献关联/甘特进度/日程/时长提取），直接写库；关闭后仍可手动巡检" }
      }
    }
  },
  "ui": {
    "hostCapabilities": ["external.open"]
  },
  "dev": {
    "scenarios": [
      {
        "id": "smoke-manage-schedule",
        "steps": [
          { "invokeTool": { "name": "manage_schedule", "input": { "action": "read", "target": "gantt" } } },
          { "expectToolText": "甘特图任务" }
        ]
      },
      {
        "id": "smoke-export-worklog",
        "steps": [
          { "invokeTool": { "name": "export_report", "input": { "type": "worklog" } } },
          { "expectToolText": "实验记录" }
        ]
      }
    ]
  }
}
```

要点：
- `entry: "index.js"` 与 `activationEvents: ["onStartup"]` 对齐 dsh-hanako 最新形态（常驻生命周期插件）。
- `minAppVersion: 0.680.0` 对齐目标宿主。
- title 改为 `{zh, en}` 多语言对象（token-tracker/dsh-hanako 已用此形态）。
- `sensitiveCapabilities` 显式空数组（新契约字段，声明未来高风险权限意图；当前无）。
- `ui.hostCapabilities: ["external.open"]` **保持不变**（protocol 包确认 `external.open` 是合法能力名，页面确实用 `hana.external.open`）。

- [ ] **步骤 2：验证 manifest JSON 合法**

运行：`bun -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
预期：输出 `manifest ok`

- [ ] **步骤 3：Commit**

```bash
git add manifest.json
git commit -m "feat(manifest): 升级到最新 Hana 契约（entry/activationEvents/minAppVersion 0.680/多语言 title/sensitiveCapabilities）"
```

---

### 任务 2：SDK 依赖可移植化

**文件：**
- 创建：`scripts/install-sdk.mjs`
- 修改：`package.json`
- 修改：`scripts/sync-version.mjs`（版本号同步）

- [ ] **步骤 1：创建 scripts/install-sdk.mjs**

```js
/**
 * SDK 依赖可移植化：把 hana-plugin-creator skill 的 SDK tarball 复制进
 * 仓库内 vendor/sdk/，package.json 依赖改为本地相对路径 file:vendor/sdk/*.tgz，
 * 使项目不依赖本机绝对路径（C:/Users/...）即可安装构建。
 * 用法：bun scripts/install-sdk.mjs   （或 npm run install:sdk）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const vendorDir = path.join(root, "vendor", "sdk");
const skillSdkDir = path.join(
  process.env.HANA_PLUGIN_CREATOR_SDK || "",
  "assets", "sdk"
);

// 候选源：环境变量 > 已知 skill 位置（reasonix + 旧 .hanako 两处）
const candidates = [];
if (skillSdkDir) candidates.push(skillSdkDir);
candidates.push(
  "C:/Users/liao2/AppData/Roaming/reasonix/skills/hana-plugin-creator/assets/sdk",
  "C:/Users/liao2/.hanako/skills/hana-plugin-creator/assets/sdk",
);
const sdkNames = ["hana-plugin-runtime", "hana-plugin-sdk", "hana-plugin-components", "hana-plugin-protocol"];

const src = candidates.find((d) => fs.existsSync(path.join(d, `${sdkNames[0]}-0.0.0.tgz`)));
if (!src) {
  console.error("[install-sdk] 未找到 SDK tarball（检查 hana-plugin-creator skill 位置）");
  process.exit(1);
}

fs.mkdirSync(vendorDir, { recursive: true });
for (const name of sdkNames) {
  const from = path.join(src, `${name}-0.0.0.tgz`);
  const to = path.join(vendorDir, `${name}-0.0.0.tgz`);
  fs.copyFileSync(from, to);
  console.log(`[install-sdk] ${name} → vendor/sdk/`);
}
console.log("[install-sdk] done");
```

- [ ] **步骤 2：修改 package.json**

```json
{
  "name": "materials-research-copilot",
  "version": "1.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "prebuild": "node scripts/sync-version.mjs && node scripts/install-sdk.mjs",
    "install:sdk": "node scripts/install-sdk.mjs",
    "build:ui": "vite build",
    "build:server": "esbuild src-server/index.ts src-server/tools/*.ts src-server/routes/*.ts --bundle --format=esm --platform=node --outbase=src-server --outdir=. --log-level=warning --external:fs --external:http --external:https --external:url",
    "build": "npm run build:server && npm run build:ui",
    "check:version": "node scripts/sync-version.mjs",
    "test": "node tests/run-all.mjs",
    "test:ui": "vitest run",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.server.json"
  },
  "dependencies": {
    "@hana/plugin-components": "file:vendor/sdk/hana-plugin-components-0.0.0.tgz",
    "@hana/plugin-protocol": "file:vendor/sdk/hana-plugin-protocol-0.0.0.tgz",
    "@hana/plugin-runtime": "file:vendor/sdk/hana-plugin-runtime-0.0.0.tgz",
    "@hana/plugin-sdk": "file:vendor/sdk/hana-plugin-sdk-0.0.0.tgz",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.6",
    "@types/node": "^26.2.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.4",
    "esbuild": "^0.28.1",
    "jsdom": "^30.0.1",
    "typescript": "^5.9.3",
    "vite": "^7.3.1",
    "vitest": "^4.1.11"
  }
}
```

要点：
- 依赖从 `file:C:/Users/liao2/.hanako/skills/...` 改为 `file:vendor/sdk/...`（仓库内相对路径）。
- `prebuild` 先跑 `install:sdk` 保证 vendor 存在（若已存在则幂等覆盖）。
- 版本号同步到 1.3.0。
- 需把 `vendor/sdk/` 加入 git（不再 ignore）。

- [ ] **步骤 3：更新 .gitignore**

把 `vendor/sdk/` 从忽略中移除（确认当前是否被忽略；如未忽略则跳过此步）。追加说明注释：

```
# SDK tarball（可移植依赖，随仓库分发）
vendor/sdk/
```

如果 `vendor/` 被整体忽略则需先解除。

- [ ] **步骤 4：运行 install-sdk 并验证依赖可解析**

运行：
```bash
bun scripts/install-sdk.mjs
bun install
```
预期：vendor/sdk/ 出现 4 个 tarball；`bun install` 成功解析 `file:vendor/sdk/*.tgz`。

- [ ] **步骤 5：运行测试确认无回归**

运行：`bun test tests/store.test.mjs`
预期：9 pass / 0 fail

- [ ] **步骤 6：Commit**

```bash
git add package.json scripts/install-sdk.mjs vendor/sdk .gitignore
git commit -m "chore(sdk): 依赖改指仓库内 vendor/sdk（可移植，去掉本机绝对路径）"
```

---

### 任务 3：assets 静态资源协议合规化

**文件：**
- 修改：`src-server/routes/ui.ts`
- 修改：`ui/Panel.tsx`（如需要同步 assets 引用）

- [ ] **步骤 1：修改 src-server/routes/ui.ts**

把 `inlineAsset()` 内联逻辑改为引用官方 assets 路径：

```ts
// src-server/routes/ui.ts
import type { HanaPluginContext } from "@hana/plugin-runtime";

function registerPluginUiRoutes(app: any, ctx: any) {
  app.get("/page", (c: any) => c.html(renderShell(c, ctx, "page")));
  app.get("/widget", (c: any) => c.html(renderShell(c, ctx, "widget")));
}

function renderShell(c: any, ctx: any, surface: string) {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const title = "科研工作";
  const assetsBase = `/api/plugins/${ctx.pluginId}/assets/`;
  const cssHref = `${assetsBase}panel.css`;
  const jsSrc = `${assetsBase}panel.js`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <link rel="stylesheet" href="${cssHref}">
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-surface="${surface}">
  <div id="root" data-surface="${surface}"></div>
  <script src="${jsSrc}"></script>
</body>
</html>`;
}
```

要点：
- 静态资源从"服务端读文件内联进 HTML"改为"浏览器按官方 `/api/plugins/{pluginId}/assets/panel.js|css` 路径加载"。
- 删除 `inlineAsset`/`inlineCache`（不再需要）。
- 保留 `hana-css`/`hana-theme` query param 支持（route shell 主题协议）。
- 保留 `escapeHtml`/`escapeAttr` 防注入。

注意：**保留诊断脚本**（`window.__mrcDiag`）——这是调试资产，可作为独立 `<script>` 保留在 shell 内联（小体积），不违反"禁止内联大资源"（诊断脚本约 10 行）。或者移入 assets/ 单独文件。选择：保留内联（体积极小，属调试壳）。

- [ ] **步骤 2：验证前端仍能加载**

由于无浏览器环境，用静态检查确认：
运行：`bun -e "const s=require('fs').readFileSync('src-server/routes/ui.ts','utf8'); if(/panel\.js/.test(s)&&!/inlineAsset/.test(s))console.log('ui shell ok'); else console.log('CHECK')"`
预期：输出 `ui shell ok`

- [ ] **步骤 3：构建验证**

运行：`bun run build`
预期：`assets/panel.js`、`assets/panel.css` 生成；esbuild 服务端产物 `routes/ui.js` 编译通过。

- [ ] **步骤 4：Commit**

```bash
git add src-server/routes/ui.ts
git commit -m "refactor(routes/ui): 静态资源改走官方 /api/plugins/{id}/assets/ 路径，去掉内联"
```

---

### 任务 4：会话身份 query fallback 校准

**文件：**
- 修改：`src-server/routes/api.ts`

- [ ] **步骤 1：修改 api.ts 的 sessionIdOf**

```ts
const sessionIdOf = (c: any) => {
  const header = c.req.header("x-hana-plugin-surface-session");
  if (header && header.trim()) return header.trim();
  // #1629：iframe src 上的会话凭证 query 名是 pluginSurfaceSession（protocol 包常量）
  const q = c.req.query("pluginSurfaceSession");
  if (q && q.trim()) return q.trim();
  return c.req.query("sessionId") || null; // 保留旧 fallback 兼容
};
```

要点：
- header 名 `x-hana-plugin-surface-session` 已正确（protocol 常量 `PLUGIN_SURFACE_SESSION_HEADER`）。
- query fallback 补充官方名 `pluginSurfaceSession`（`PLUGIN_SURFACE_SESSION_QUERY`），旧 `sessionId` 保留兼容。

- [ ] **步骤 2：验证**

运行：`bun -e "const s=require('fs').readFileSync('src-server/routes/api.ts','utf8'); if(/pluginSurfaceSession/.test(s))console.log('api session ok'); else console.log('CHECK')"`
预期：输出 `api session ok`

- [ ] **步骤 3：运行测试确认无回归**

运行：`bun test tests/store.test.mjs tests/log-work.test.mjs`
预期：全部 pass

- [ ] **步骤 4：Commit**

```bash
git add src-server/routes/api.ts
git commit -m "fix(routes/api): 会话凭证 query 兼容 pluginSurfaceSession 官方名"
```

---

### 任务 5：版本号同步与文档

**文件：**
- 修改：`README.md`
- 修改：`scripts/sync-version.mjs`（确认版本 1.3.0 双写逻辑）

- [ ] **步骤 1：同步版本号**

先确认 `manifest.json` 与 `package.json` 的 version 均已为 1.3.0。
运行：`bun run check:version`
预期：`[sync-version] ok：version=1.3.0`

- [ ] **步骤 2：更新 README.md 头部**

把：
```
- 版本：`1.2.1` · 最低宿主：`0.159.0`
```
改为：
```
- 版本：`1.3.0` · 最低宿主：`0.680.0`
```

并更新"架构分层"中 assets 说明（如提到内联则改为官方 assets 路径）。

- [ ] **步骤 3：Commit**

```bash
git add README.md
git commit -m "docs: 版本 1.3.0 / 最低宿主 0.680.0"
```

---

### 任务 6：回归验证与打包

**文件：**
- 测试：现有全部测试

- [ ] **步骤 1：完整构建**

运行：`bun run build`
预期：esbuild 与 vite 均成功，产物在插件根（index.js、tools/、routes/、assets/panel.js|css）。

- [ ] **步骤 2：全部测试**

运行：`bun test tests/`
预期：除 `consistency.test.mjs` 的 O-8（既有失败，源于未提交的 prompts 改动）与 zotero SKIP 外全部通过。

- [ ] **步骤 3：类型检查**

运行：`bunx tsc --noEmit && bunx tsc -p tsconfig.server.json`
预期：无新错误（若 bunx 不可用则跳过，说明原因）。

- [ ] **步骤 4：安装到 Hana 开发目录（人工/插件开发循环）**

按 hana-plugin-creator 的 Plugin Dev Loop：
1. 确认 Settings → Plugins → "Allow Agent plugin dev tools" 已开（用户已确认）。
2. `plugin.dev.install`（源指向本目录）。
3. `plugin.dev.reload` 后 `plugin.dev.diagnostics`。
4. `plugin.dev.runScenario` 跑 `smoke-manage-schedule`、`smoke-export-worklog`。
5. 面板打开验证 page/widget 渲染（assets 路径正确加载）。

- [ ] **步骤 5：最终 review**

运行 `git diff` 确认改动仅涉及计划内文件，无业务逻辑变更。

---

## 自检

**1. 规格覆盖度：**
- manifest 现代化（entry/activationEvents/minAppVersion/多语言 title/sensitiveCapabilities）→ 任务 1 ✓
- SDK 依赖可移植化 → 任务 2 ✓
- assets 协议合规化 → 任务 3 ✓
- 会话身份 query 校准 → 任务 4 ✓
- 版本号 + 文档 → 任务 5 ✓
- 回归验证 + 打包 → 任务 6 ✓

**2. 占位符扫描：** 所有步骤均有具体代码或命令，无 TODO/占位。

**3. 类型一致性：** `sessionRef` 形状（`{sessionId, sessionPath}`）沿用 export-report 现有用法；`HanaPluginContext` 类型引用自 runtime 包，与 d.ts 一致。`/api/plugins/{pluginId}/assets/` 路径与 protocol 包 `PLUGIN_SURFACE_SESSION_*` 常量命名一致。

**已知保留项（不在本计划范围）：**
- `consistency.test.mjs` O-8 既有失败（用户未提交的 prompts 改动引起，不处理）。
- UI 的 `hana.api.fetch` 路径约定（`不带 api/ 前缀`）已实测正确，不改。
- `sessionPermission` 归类已全部符合新 SDK 枚举（read/plugin_output/session_file_output/external_side_effect），不改。
- `createSession/sendSessionMessage(context)/chat.surface` 等新能力集成不在本轮（业务行为不变原则）。
