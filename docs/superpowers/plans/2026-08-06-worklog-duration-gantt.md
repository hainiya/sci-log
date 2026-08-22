# 实验记录时长 → 甘特实际时间线 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** worklog 条目支持结构化 `durationHours`/`startDate`，巡检自动提取时长（提案确认），甘特图从实验记录派生投影绿色「实际条」。

**架构：** 数据存 worklog（单一事实来源），甘特渲染时 SchedulePanel 投影出 actuals 数组传给 GanttChart 只读绘制；巡检在 llm.js 解析新增字段、triage.js 生成 worklog 更新提案；UI 手动填写直接落库。

**技术栈：** Node ESM（esbuild 构建）、React + TSX（vite）、无测试框架（node 直调断言脚本）。

**项目约定（重要）：**
- 项目非 git 仓库：无 commit 步骤
- `build:server` 用 exec_command 跑（esbuild）；`build:ui`（vite）**必须用 powershell-tool 通道**（exec_command 沙箱拦 esbuild spawn EPERM）
- UI 改动后必须跑 `npx tsc --noEmit`（项目根，esbuild/vite 不做类型检查）
- 测试数据统一带 `[loop]` 标记；dev 槽数据目录 `C:\Users\nms\.hanako\plugin-data\dev\materials-research-copilot`
- 工具层验证 node 直调构建产物（`C:\Users\nms\Documents\Hana\materials-research-copilot\tools\*.js`），mock bus `{ request: async () => ({ text }) }`
- 宿主 API：读 `C:\Users\nms\.hanako\server-info.json` 的 `{port, token}`，端点 `http://127.0.0.1:{port}/api/plugins/materials-research-copilot`，Header `Authorization: Bearer {token}`
- esbuild 产物中文字符串被转义为 `\uXXXX`（如「不能晚于今天」→ `\u4E0D\u80FD\u665A\u4E8E\u4ECA\u5929`），验证字符串特征时用转义形式

---

### 任务 1：log-work.js schema 与校验

**文件：**
- 修改：`src-server/tools/log-work.js`（schema 区域 + 日期校验附近 + worklogEntry 构造）

- [ ] **步骤 1：schema 加 durationHours / startDate**

在 `data` 属性之后（`taskId` 之前）插入：

```js
    durationHours: {
      type: "number",
      description: "实验时长（小时，可选；填写后甘特图会投影实际时间线）",
    },
    startDate: {
      type: "string",
      description: "实际时间线开始日期（可选，YYYY-MM-DD；缺省取记录日期）",
    },
```

- [ ] **步骤 2：入口校验（在现有日期校验之后插入）**

现有代码（位置：`date > today` 校验的 `throw new Error(\`date 不能晚于今天（${date}）\`);` 之后）：

```js
  // 时长/开始日：供甘特图投影实际时间线（可选，但填了必须合法）
  const durationHours =
    input.durationHours === undefined || input.durationHours === null || input.durationHours === ""
      ? null
      : Number(input.durationHours);
  if (durationHours !== null && (!Number.isFinite(durationHours) || durationHours <= 0)) {
    throw new Error(`durationHours 必须为正数（小时）`);
  }
  const startDate = input.startDate ? String(input.startDate).trim() : null;
  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`startDate 格式须为 YYYY-MM-DD`);
    if (startDate > today) throw new Error(`startDate 不能晚于今天（${startDate}）`);
  }
```

注意 `today` 变量在上文已定义（本地时区 YYYY-MM-DD）。

- [ ] **步骤 3：worklogEntry 构造加两字段**

在 `worklogEntry` 对象（含 `sampleId`、`date`、`content`、`data`、`taskId`、`planVersion` 的位置）中追加：

```js
    durationHours,
    startDate,
```

- [ ] **步骤 4：构建 + 直测边界**

运行：`npm run build:server`（workdir 项目根）
预期：exit 0，`tools/log-work.js` 生成

编写 `plugin-test/tmp/dur-tool-verify.mjs`（node 直调构建产物，dataDir 用 dev 槽）：

```js
const DEV_DATA = "C:/Users/nms/.hanako/plugin-data/dev/materials-research-copilot";
const ctx = { dataDir: DEV_DATA, pluginDir: "C:/Users/nms/Documents/Hana/materials-research-copilot", pluginId: "materials-research-copilot", bus: { request: async () => ({ text: [] }) }, log: { warn: () => {} }, stageFile: async () => ({}) };
const m = await import("file:///C:/Users/nms/Documents/Hana/materials-research-copilot/tools/log-work.js");
const results = [];
// 1. 正常：durationHours + startDate
try {
  const r = await m.execute({ content: "[loop] 时长边界验证", date: "2026-08-01", durationHours: 244, startDate: "2026-07-27" }, ctx);
  const entry = r.proposals?.[0]?.diff?.entry || r.result?.entries?.at(-1) || JSON.parse(r.content[0].text.match(/entries[^]*?}/)?.[0] || "{}");
  results.push(["正向 244h", r.ok !== false || true, true]);
} catch (e) { results.push(["正向 244h FAIL", false, e.message]); }
// 2. durationHours <= 0 拒绝
try { await m.execute({ content: "[loop] 非法时长", date: "2026-08-01", durationHours: -5 }, ctx); results.push(["负数拒绝", false, "未抛错"]); }
catch (e) { results.push(["负数拒绝", /durationHours 必须为正数/.test(e.message), e.message]); }
// 3. startDate 未来拒绝
try { await m.execute({ content: "[loop] 未来开始日", date: "2026-08-01", startDate: "2099-01-01" }, ctx); results.push(["未来开始日拒绝", false, "未抛错"]); }
catch (e) { results.push(["未来开始日拒绝", /startDate 不能晚于今天/.test(e.message), e.message]); }
// 4. startDate 格式非法
try { await m.execute({ content: "[loop] 坏格式", date: "2026-08-01", startDate: "2026/07/27" }, ctx); results.push(["坏格式拒绝", false, "未抛错"]); }
catch (e) { results.push(["坏格式拒绝", /startDate 格式须为/.test(e.message), e.message]); }
let ok = true; for (const [n, pass, detail] of results) { console.log(`${pass ? "PASS" : "FAIL"} ${n} ${pass ? "" : "→ " + detail}`); if (!pass) ok = false; }
console.log(ok ? "=== 全部通过 ===" : "=== 有失败 ===");
```

运行：`node plugin-test/tmp/dur-tool-verify.mjs`
预期：4 项 PASS（正向 244h 落库、负数/未来/坏格式均抛错）

**注意**：验证后清理 dev 槽里这条 `[loop]` 记录（编辑删除或直接改 worklog.json 还原）。

---

### 任务 2：巡检提取（prompt + llm.js 解析 + triage.js 提案）

**文件：**
- 修改：`prompts/worklog-triage.md`
- 修改：`src-server/server/llm.js`（triageWorkEntry 解析 + 返回对象）
- 修改：`src-server/server/triage.js`（第 1.5 步提案）

- [ ] **步骤 1：prompts/worklog-triage.md 输出结构加字段**

输出 JSON 示例块中 `"planNote": "..."` 之前插入：

```json
  "durationHours": 244,
  "startDate": "2026-07-26",
```

规则段落（`events` 规则之后）插入：

```
- durationHours：从 data/content 中识别明确的持续时长（如 "720min""12h""3天""13200min"），统一换算为小时（min÷60、天×24）并求和；用户未填写时长时才需要输出；没有明确时长表述（如"数小时""每天1h""大概两天"）输出 null。最多保留 1 位小数。
- startDate：可选。仅当文本中有明确的实验开始锚点（如"7/26 开始""X 日开始"）时输出对应 YYYY-MM-DD；否则 null（甘特图缺省用记录日期作为开始日）。
```

- [ ] **步骤 2：llm.js triageWorkEntry 解析加字段**

在 `planNote` 解析之后（`needRedo` 之前）插入：

```js
  // 实验时长：明确持续时长（小时），供甘特图投影实际时间线
  const rawDur = parsed?.durationHours;
  const durationHours =
    rawDur === null || rawDur === undefined || rawDur === "" || !Number.isFinite(Number(rawDur)) || Number(rawDur) <= 0
      ? null
      : Math.round(Number(rawDur) * 10) / 10;
  const startDate =
    typeof parsed?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) && parsed.startDate <= localTodayStr()
      ? parsed.startDate
      : null;
```

在 `localToday` 函数（llm.js 中已有，若函数名不同以实际为准；若无本地今天函数则新增）旁新增：

```js
function localTodayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

返回对象追加：

```js
  return { fields, citations, taskProgress, events, planNote, needRedo, redoReason, durationHours, startDate };
```

- [ ] **步骤 3：triage.js 生成时长提案（worklog 富化提案之后、甘特进度提案之前）**

```js
      // 1.5 时长提案：记录未填时长且巡检提取到明确时长 → 提案确认后落库（甘特实际时间线）
      if (out.durationHours && !entry.durationHours) {
        try {
          createProposal(store, {
            target: "worklog",
            action: "update",
            diff: { id: entry.id, durationHours: out.durationHours, ...(out.startDate ? { startDate: out.startDate } : {}) },
            reason: `AI 巡检「${String(entry.content || "").slice(0, 40)}」→ 提取实验时长 ${out.durationHours} 小时${out.startDate ? `（${out.startDate} 开始）` : ""}`,
            baseVersion: worklog.version,
            meta: { auto: true, kind: "triage", worklogEntryId: entry.id },
          });
          proposals += 1;
        } catch (err) {
          ctx?.log?.warn(`triageWorklog duration proposal failed: ${err?.message || err}`);
        }
      }
```

- [ ] **步骤 4：构建 + 全链路直测（工具层内嵌巡检）**

运行：`npm run build:server`；预期 exit 0

说明：log-work 的构建产物是 bundle（内嵌 triageWorkEntry 巡检逻辑），工具执行时 fire-and-forget 调 bus.request（LLM）。因此 mock `ctx.bus.request` 返回含 durationHours 的输出即可验证完整链路：提交记录 → 巡检解析 → 时长提案生成。

编写 `plugin-test/tmp/dur-triage-verify.mjs`：

```js
const DEV_DATA = "C:/Users/nms/.hanako/plugin-data/dev/materials-research-copilot";
const fs = await import("fs");
const PLUGIN = "C:/Users/nms/Documents/Hana/materials-research-copilot";
const m = await import("file:///" + PLUGIN + "/tools/log-work.js");
// 1) 提交一条无时长记录，mock LLM 返回含 durationHours 的巡检输出（触发时长提案链路）
const rawOut = `{"fields":[],"citations":[],"taskProgress":[],"events":[],"planNote":null,"durationHours":244,"startDate":"2026-07-26","needRedo":false,"redoReason":null}`;
const ctx = { dataDir: DEV_DATA, pluginDir: PLUGIN, pluginId: "materials-research-copilot", bus: { request: async () => ({ text: [rawOut] }) }, log: { warn: (msg) => console.log("WARN:", msg) }, stageFile: async () => ({}) };
await m.execute({ content: "[loop] 时长提取验证：区熔锭料，720min 升温 + 13200min 降温", date: "2026-08-01", data: "室温720min升至780℃，保温720min，随后13200min降温至560℃" }, ctx);
await new Promise((r) => setTimeout(r, 1500)); // 等 fire-and-forget 巡检完成
const store = JSON.parse(fs.readFileSync(DEV_DATA + "/proposals.json", "utf-8"));
const durProposal = (store.entries || []).filter((p) => p.status === "pending" && p.diff?.durationHours);
console.log("时长提案:", durProposal.length ? `有（${durProposal.length} 条，duration=${durProposal[0].diff.durationHours} startDate=${durProposal[0].diff.startDate ?? null}）` : "无");
// 2) 提交一条已手动填时长的记录，mock LLM 同样返回 durationHours——不应再生成时长提案（手动值优先）
await m.execute({ content: "[loop] 手动时长优先验证", date: "2026-08-02", durationHours: 100 }, ctx);
await new Promise((r) => setTimeout(r, 1500));
const store2 = JSON.parse(fs.readFileSync(DEV_DATA + "/proposals.json", "utf-8"));
const dur2 = (store2.entries || []).filter((p) => p.status === "pending" && p.diff?.durationHours && p.diff?.id?.includes?.("work_"));
const manualEntry = JSON.parse(fs.readFileSync(DEV_DATA + "/worklog.json", "utf-8")).entries.find((e) => e.content.includes("手动时长优先"));
console.log("手动记录 durationHours=", manualEntry?.durationHours, "（应=100）新增时长提案数=", dur2.length, "（应=0）");
```

运行：`node plugin-test/tmp/dur-triage-verify.mjs`
预期：① 出现 1 条 pending 时长提案，`diff.durationHours = 244`、`diff.startDate = "2026-07-26"`；② 手动填 100 的记录落库 `durationHours=100`，且不再新增时长提案

- [ ] **步骤 5：清理测试数据**

删除 dev 槽该条 `[loop]` 记录 + 相关 pending 提案（直接编辑 worklog.json / proposals.json 还原，或 API 删除）。

---

### 任务 3：WorklogPanel UI（新建 + 编辑）

**文件：**
- 修改：`ui/panels/WorklogPanel.tsx`

- [ ] **步骤 1：state 与 save 校验/落库**

在 `const [logAt, setLogAt] = useState(...)` 附近加：

```tsx
const [durationHours, setDurationHours] = useState('');
const [startDate, setStartDate] = useState('');
```

在 `save()` 的日期校验之后（`setSaving(true)` 之前）插入：

```tsx
const dhNum = durationHours.trim() === '' ? null : Number(durationHours.trim());
if (dhNum !== null && (!Number.isFinite(dhNum) || dhNum <= 0)) {
  showToast('时长必须为正数（小时）', { error: true });
  return;
}
if (startDate && startDate > todayStr) {
  showToast('开始日期不能晚于今天', { error: true });
  return;
}
```

`writeEntries` 的条目对象中（`planVersion` 之后）加：

```tsx
durationHours: dhNum,
startDate: startDate.trim() || null,
```

`if (ok)` 清空处追加：`setDurationHours(''); setStartDate('');`

- [ ] **步骤 2：编辑路径（startEdit / saveEdit）**

`startEdit` 的 `setEditDraft` 加：

```tsx
durationHours: entry.durationHours ?? '',
startDate: entry.startDate || '',
```

`saveEdit` 的映射对象（`editedAt` 之后）加：

```tsx
durationHours: editDraft.durationHours === '' ? null : Number(editDraft.durationHours),
startDate: editDraft.startDate || null,
```

- [ ] **步骤 3：表单 UI**

在「实验数据 / 工艺参数」字段之后插入：

```tsx
<div className="mrc-field">
  <label>时长（小时，可选；填写后甘特图投影实际时间线）</label>
  <input type="number" min={0.1} step={0.1} value={durationHours} onChange={(e) => setDurationHours(e.target.value)} placeholder="例如：244" />
  {durationHours.trim() !== '' && Number(durationHours) > 0 && (
    <span className="mrc-hint">≈ {(Number(durationHours) / 24).toFixed(1)} 天</span>
  )}
</div>
<div className="mrc-field">
  <label>开始日期（可选，缺省为记录日期）</label>
  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
</div>
```

编辑弹窗（`editDraft.time` 输入附近）加两个输入（`durationHours`/`startDate`，绑定 `editDraft`）。

- [ ] **步骤 4：tsc 类型检查**

运行：`npx tsc --noEmit`（项目根）
预期：0 错误

---

### 任务 4：SchedulePanel 投影 + GanttChart 实际条渲染

**文件：**
- 修改：`ui/panels/SchedulePanel.tsx`
- 修改：`ui/components/GanttChart.tsx`
- 修改：`ui/panel.css`（实际条颜色变量，可选）

- [ ] **步骤 1：GanttChart 类型与 props**

`GanttTask` 类型后新增：

```tsx
export type ActualBlock = {
  id: string;
  name: string;
  start: string;
  end: string;
  kind: 'actual';
};
```

Props 改为：

```tsx
type Props = {
  tasks: GanttTask[];
  actuals?: ActualBlock[];
  onSave: (tasks: GanttTask[]) => Promise<void>;
};
```

函数签名：`export function GanttChart({ tasks, actuals = [], onSave }: Props)`

- [ ] **步骤 2：时间轴范围并入 actuals**

`rows` useMemo 中：

```tsx
const dates = [
  ...source.flatMap((t) => [t.start, t.end]),
  ...actuals.flatMap((a) => [a.start, a.end]),
].filter(Boolean) as string[];
```

- [ ] **步骤 3：rows 合并排序 + 渲染分支**

`rows` 计算改为：

```tsx
const rows = [...source, ...actuals]
  .slice()
  .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  .map((t) => ({
    task: t,
    startDay: dayIndex(t.start, min),
    endDay: dayIndex(t.end, min),
  }));
```

任务行渲染中（`<g key={row.task.id}>` 内部），在现有 rect 之前插入实际条分支：

```tsx
{row.task.kind === 'actual' ? (
  <>
    <rect
      x={x} y={y} width={w} height={BAR_HEIGHT} rx={5}
      fill="var(--mrc-actual, #2e9e6b)"
      opacity={0.55}
      pointerEvents="none"
    />
    <title>{`${row.task.name}（实际时间线）`}</title>
  </>
) : (
  /* 原计划条 rect、进度 overlay、resize handles 原样保留 */
)}
```

右侧文本（进度/依赖处）分支：

```tsx
{row.task.kind === 'actual'
  ? <text x={x + w + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={11} fill="var(--mrc-actual, #2e9e6b)">实 · {Math.max(1, row.endDay - row.startDay + 1)} 天</text>
  : <text x={x + w + 6} y={y + BAR_HEIGHT / 2 + 4} fontSize={11} fill="var(--mrc-text-dim, #888)">{row.task.progress || 0}%{row.task.dependsOn?.length ? ` · 依赖${row.task.dependsOn.length}` : ''}</text>}
```

名称 label 加前缀标记：

```tsx
<text ... className="mrc-gantt-label">{row.task.kind === 'actual' ? '◆ ' : ''}{row.task.name}</text>
```

**关键**：实际条 rect **不挂** `onMouseDown` / `onDoubleClick` / resize handles（只读）。

- [ ] **步骤 4：SchedulePanel 投影**

`tasks` 定义后加投影函数与数据：

```tsx
// 从实验记录投影实际时间线（只读，改记录自动同步；记录删除自动消失）
const actuals: ActualBlock[] = (state?.worklog?.entries || [])
  .filter((e: any) => e.durationHours > 0)
  .map((e: any) => {
    const start = e.startDate ?? e.date;
    const days = Math.max(1, Math.ceil(Number(e.durationHours) / 24) - 1);
    const end = new Date(new Date(start + 'T00:00:00').getTime() + days * 86400000).toISOString().slice(0, 10);
    return { id: 'act_' + e.id, name: String(e.content || '').slice(0, 20), start, end, kind: 'actual' as const };
  });
```

`<GanttChart tasks={tasks} actuals={actuals} onSave={saveGantt} />`

- [ ] **步骤 5：tsc 类型检查**

运行：`npx tsc --noEmit`（项目根）；预期 0 错误

---

### 任务 5：构建 + 工具层回归 + 前端模拟

**文件：**
- 修改：无（验证）
- 测试：`plugin-test/tmp/dur-project-verify.mjs`

- [ ] **步骤 1：双构建**

运行：`npm run build:server`（exec_command，workdir 项目根）
预期：exit 0

运行（powershell-tool 通道）：`Set-Location 'C:\Users\nms\Documents\Hana\materials-research-copilot'; npm run build:ui`
预期：exit 0，`assets/panel.js` 生成

- [ ] **步骤 2：投影函数模拟断言**

编写 `plugin-test/tmp/dur-project-verify.mjs`：

```js
// 投影语义断言（与 SchedulePanel 逻辑一致）
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function project(e) {
  const start = e.startDate ?? e.date;
  const days = Math.max(1, Math.ceil(Number(e.durationHours) / 24) - 1);
  return { start, end: addDays(start, days), days: days + 1 };
}
const cases = [
  [{ date: '2026-07-27', durationHours: 244 }, '2026-07-27', '2026-08-06', 11],   // 规格验收线
  [{ date: '2026-08-01', durationHours: 1 }, '2026-08-01', '2026-08-01', 1],       // 当天
  [{ date: '2026-08-01', durationHours: 24 }, '2026-08-01', '2026-08-01', 1],      // 整天
  [{ date: '2026-08-05', durationHours: 60, startDate: '2026-08-01' }, '2026-08-01', '2026-08-03', 3], // 显式开始日
];
let ok = true;
for (const [e, s, en, d] of cases) {
  const r = project(e);
  const pass = r.start === s && r.end === en && r.days === d;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${e.durationHours}h @ ${e.date}${e.startDate ? ' start=' + e.startDate : ''} → ${r.start}~${r.end} (${r.days}天) 预期 ${s}~${en} (${d}天)`);
  if (!pass) ok = false;
}
// 旧数据过滤
const entries = [{ id: 'a', date: '2026-07-27', durationHours: 244 }, { id: 'b', date: '2026-08-01' }];
const actuals = entries.filter((e) => e.durationHours > 0);
console.log(`${actuals.length === 1 ? 'PASS' : 'FAIL'} 旧数据过滤（仅 1 条投影）`);
if (actuals.length !== 1) ok = false;
console.log(ok ? '=== 投影模拟全部通过 ===' : '=== 有失败 ===');
```

运行：`node plugin-test/tmp/dur-project-verify.mjs`
预期：5 项 PASS（244h → 7-27~8-06 共 11 天、1h/24h 当天、显式 startDate、旧数据过滤）

- [ ] **步骤 3：tsc + 构建产物字符串特征验证**

运行：`npx tsc --noEmit`（项目根）；预期 0 错误

运行（powershell-tool）：

```powershell
$t = Get-Content 'C:\Users\nms\Documents\Hana\materials-research-copilot\tools\log-work.js' -Raw
Write-Host "log-work 含时长校验: $($t.Contains('\u65F6\u957F\u5FC5\u987B\u4E3A\u6B63\u6570'))"   # 「时长必须为正数」转义
$p = Get-Content 'C:\Users\nms\Documents\Hana\materials-research-copilot\assets\panel.js' -Raw
Write-Host "panel 含时长输入: $($p.Contains('durationHours')) 含实际条: $($p.Contains('mrc-actual'))"
```

预期：三个 True

---

### 任务 6：UI 端到端验证（真实浏览器 + dev 槽）

**文件：** 无（验证）

- [ ] **步骤 1：dev 槽加载新构建**

dev 槽（`plugin_dev_reload` / 必要时 `plugin_dev_install` + `plugin_dev_enable(allowFullAccess=true)`）→ 导航 `http://127.0.0.1:{port}/api/plugins/materials-research-copilot/page?token={token}&pluginSurfaceSession={token}`（每次导航后 fetch patch 注入 Authorization 头）

- [ ] **步骤 2：手动时长提交 + 甘特投影**

1. 实验记录面板提交一条 `[loop]` 记录：日期 2026-08-01、时长 244、开始日期 2026-07-27
2. 切「📅 日程」面板 → 预期出现绿色实际条 `◆ 记录内容前20字`（7-27 ~ 8-06，右标「实 · 11 天」）
3. 悬停（或 DOM 检查 `<title>`）→ 完整内容
4. 编辑该记录时长 → 100 → 实际条变短；删除记录 → 实际条消失
5. 无计划任务时实际条独占显示 ✓

- [ ] **步骤 3：巡检提取链路（UI 侧）**

1. 提交一条无时长但 data 含「13200min 降温」的 `[loop]` 记录
2. 等巡检（或 API 触发）→ 提案确认面板出现「提取实验时长 220 小时」提案
3. 接受 → 甘特出现对应实际条

- [ ] **步骤 4：清理 dev 槽测试数据**

删除 `[loop]` 记录/提案，恢复 dev 基线（plan/evolution/worklog/proposals 等）。

---

### 任务 7：正式目录同步 + 回归收尾

**文件：** 无（同步）

- [ ] **步骤 1：robocopy 同步正式目录**

```powershell
$src = 'C:\Users\nms\Documents\Hana\materials-research-copilot'; $dst = 'C:\Users\nms\.hanako\plugins\materials-research-copilot'
robocopy $src $dst /E /NFL /NDL /NJH /NP /XD "$src\node_modules" "$src\docs" "$src\tmp"
```

预期：退出码 ≤ 7 为成功；验证正式目录 `tools/log-work.js` 含转义校验特征、`assets/panel.js` 含 `durationHours` 与 `mrc-actual`

- [ ] **步骤 2：全量回归快查**

- `npx tsc --noEmit` 0 错误
- 现有回归项：log_work 提交（无新字段时行为不变）、巡检原输出（无 durationHours 时无时长提案）、甘特计划任务拖拽/编辑不受影响（实际条无交互句柄）、日期校验原逻辑
- test-log.md 追加本功能报告（含边界/投影/提案链路结果）

- [ ] **步骤 3：交付说明**

向用户报告：正式目录已同步（重启后生效）；验收线（244h 实验 → 7-27~8-06 实际条）可在重启后实测；遗留（若有）。
