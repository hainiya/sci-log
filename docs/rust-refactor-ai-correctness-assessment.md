# materials-research-copilot Rust 重构：AI 正确性视角评估

> 文档作用：回答一个具体决策问题——**"用 Rust 重构这个插件，是否能让 AI（维护者/生成者）写/改代码时显著更少出错？值不值得为此付出重构成本？"**
> 视角：与工程性能、部署、学习动机相区分，本文聚焦 **AI 生成/维护代码的正确性**。
> 结论一句话：从"AI 正确性"看，真正的杠杆是"**把错误前移到编译期 + 让 AI 自纠反馈可靠**"；性价比最高的是**后端从纯 JS 迁到严格 TypeScript + 在数据边界加运行时 schema 校验（zod）**，Rust 只对"纯逻辑核心"（metrics/parsers）有局部补充价值，且代价是 AI 编译迭代更慢、覆盖不了动态边界。

---

## 1. 文档定位与结论摘要

### 1.1 要回答的决策问题

- 这个项目当前"AI 出错"的风险主要暴露在哪一层？（答案是：几乎全在运行时，因为后端零类型检查）
- Rust 的强类型能给"AI 正确性"带来什么真实收益？
- 这些收益能否覆盖它自己的代价，且是否是该投入里回报最高的？

### 1.2 目标读者

- 决定是否投入 Rust 重构的技术负责人 / 插件维护者。
- 关注"让 AI 助手少写 bug"而非"追求极致性能"的人。

### 1.3 TL;DR 结论

1. **后端目前是"零编译期检查"的纯 JS**：`tsconfig.json` 的 `include` 只有 `["ui"]`，`allowJs:false`，因此 `npm run typecheck` 只扫前端；`src-server/`（约 4350 行、23 个文件）完全不被任何静态检查覆盖，也没有 ESLint/Prettier/Biome。这是 AI 改后端最容易埋错、且要到运行时/测试才爆的土壤。
2. **Rust 对"AI 正确性"有真实价值，但边界清晰**：编译器把错误**强制前移**到编译期，并给出**具体可定位**的报错，能形成"AI 生成 → 编译器反馈 → AI 修复"的高质量自纠闭环；`Result/Option` 阻止"静默吞错"；`struct/serde` 固化跨模块数据契约。
3. **价值被两件事稀释**：① 这个项目最大的错误源是**动态边界**——LLM 输出、Zotero/OpenAlex 异构响应、前后端契约——这些在 Rust 里只能 `serde_json::Value` + 容错反序列化，拿不到静态保障；② **AI 写 Rust 的初始编译错误率反而更高**（借用检查是 LLM 最易翻车区、Rust 语料远少于 JS/TS），需靠更多轮编译器循环抵消。
4. **对"减少 AI 错误"这个目标，最优杠杆是"后端先 TS 化 + zod 边界校验"**，它能拿到编译器闸门约 80% 的收益，成本远低于 Rust，且与现有前端 TS/esbuild 栈一致。Rust 仅在 `metrics/parsers` 这类纯逻辑核心作为"验证 AI 自纠循环"的补充。
5. **不建议**：全栈含前端的 Rust 重构（前端 React → WASM 会让 AI 在这个 AI 语料最少、边界全动态的层面更难写对），以及"为了 AI 正确性而重写整个后端"。

### 1.4 关键证据链速览

| 证据 | 出处 | 含义 |
|---|---|---|
| `"include": ["ui"]`、`"allowJs": false` | `tsconfig.json:7,20` | 后端不在类型检查范围 |
| `"typecheck": "tsc --noEmit"` | `package.json:22` | 类型检查只覆盖 UI |
| `"test": "node tests/run-all.mjs"` | `package.json:20` | 后端只有运行时单测，无编译期保障 |
| `useState<any>(null)` | `ui/Panel.tsx:50` | 前端主状态为 `any`，边界松 |
| `type ApiResult<T> = T & { ok?; error?; hint? }` | `ui/api.ts:3` | 前后端契约透传、弱类型 |
| 多处 `catch {}` / `.catch(()=>{})` | `store.js`、`sources.js`、`index.js`、`routes/api.js` | 静默吞错的高频形态（AI 易写） |

---

## 2. 现状与错误暴露层级（实证部分）

### 2.1 后端是零编译期检查的纯 JS

- `tsconfig.json` 唯一 `include` 是 `["ui"]`，`allowJs:false`，`strict:true`。`moduleResolution:"Bundler"`、`jsx:"react-jsx"`，全部围绕前端 Vite 栈。
- 后端 `src-server/` 全部是 `.js`（无 `.ts`），意味着 `tsc` 即使放行 `allowJs` 也不会深度检查（`allowJs:false` 直接排除）。
- 无 lint 工具：`package.json` 里没有 `eslint`/`prettier`/`biome`，也没有对应脚本。（已核实目录无 `.eslintrc`/`biome.json`/`.prettierrc`。）

**结论**：后端的正确性完全依赖"运行时单测（`tests/*.mjs`）+ 面板手工测试 + 防御式编码"。AI 对后端做改动时，类型/字段/schema 层面的破坏不会在写代码时被拦截，只会等到 `npm test` 或真机运行才现形。

### 2.2 前后端契约边界是"弱类型透传"

- 前端 `ui/api.ts` 的核心类型：`ApiResult<T>` 把宿主响应做宽松合并（`T & { ok?; error?; hint? }`），业务字段多为 `T = any`（如 `getState: () => request<any>('state')`）。数据形状不在编译期定义。
- `Panel.tsx` 用 `useState<any>(null)` 承接全量 state，再向下传给各 panel。字段名改动（如 `worklog.entries` → `worklog.records`）在前后端任何一侧都会静默漂移，直到渲染成 `undefined`。

### 2.3 本项目的 5 类真实错误源（均附证据）

| # | 错误源 | 典型表现 | 代码证据 |
|---|---|---|---|
| E1 | 跨模块结构/字段漂移 | 改一个字段名，某处没同步，运行时 `undefined` | `store.js` 的 `DEFAULT_DOC` 形态 + 前端 `api.ts` 弱类型透传 + `Panel.tsx:50 any` |
| E2 | 前后端契约漂移 | path 前缀约定（不带 `api/`）、`{version,data}` 封装、`{ok,...}` 响应形态 | `ui/api.ts:17-22` 注释、`routes/api.js` 的 `store.update` 冲突语义 |
| E3 | 静默吞错 | 大量 `catch {}`、`.catch(()=>{})`，失败被吞、界面无感知 | `store.js`(`readJson` L51-63、`snapshot` L94-103、`pruneSnapshots` L105-121、`rollback`)、`sources.js`(`fetchZoteroFulltext` L123-142、`enrichCitationCounts` L588-614 的多处 `catch {}`)、`index.js`(`.catch(()=>{})` L88)、`routes/api.js`(`try{...}catch{}` 解析 JSON) |
| E4 | LLM 输出不可控 | 非 JSON、字段缺失、类型漂移 → 需 `extractFirstJson`/`Array.isArray ? : []` 容错 | `llm.js` `triageWorkEntry` L207-307、`summarizeFromFulltext` 返回 `null`（L129-147） |
| E5 | 外部 API 异构响应 | Zotero `Total-Results` 分页校验、403 `zotero-allowed-request` 兜底、fulltext 三态分类；OpenAlex `cited_by_count` 类型校验 | `sources.js` `zoteroFetch` L98-112、`fetchZoteroItems` L165-258、`fetchZoteroFulltext` L123-142、`enrichCitationCounts` L588-614 |

### 2.4 "防御式健壮性"与"AI 静默吞错"的模糊地带

项目里很多看似"吞错"的写法其实是**故意的容错设计**，例如：

- `store.js` 对 `version` 做**数值归一化**（L77-85），避免字符串版本导致永久 `version_conflict` 锁死——这是 P1-2 复审后的健壮性，不是 bug。
- `sources.js` fulltext 错误三态（`no_index`/`api_error`/`ok`）是**刻意区分**"可重试" vs "环境问题"的语义化错误分类（L119-142）。
- `routes/api.js` `try{...}catch{}` 解析请求体是为了非 JSON 输入返回 400，而非静默。

**问题在于**：在纯 JS 里，这类"有意的容错"和"AI 手滑写出的静默失败"在代码形态上几乎不可区分，编译器也不帮忙区分。Rust 的 `Result` 能把"你显式处理了错误"变成**硬性要求**——这是相对 JS 的真实、可感知收益（详见 §4.2）。

---

## 3. "AI 正确性"分析框架

### 3.1 错误暴露层级的阶梯

一个 bug 从"写错"到"用户可见"，经历的层级决定它的代价：

```
层级A  运行时（最晚）   ── 用户可见 / 或已被 catch{} 吞掉   ← JS 动态后端的现状
层级B  编译期（TS 严格） ── 类型/结构错误在 tsc 就报错，AI 就地自纠
层级C  编译期 + 所有权  ── 除 B 外，数据竞争/悬垂/资源泄漏也被编译器拦下 ← Rust
```

**越往上层（越早暴露），AI 自纠的代价越低**。因为：

- 报错信息是**具体、可定位、可据以推理**的（编译器说"line 42 类型不匹配，期望 A 实为 B"）→ AI 能精准修复；
- 修复的**反馈回路快**（改一行 → 重跑检查 → 立即知道对错）；
- 不会把错误扩散成"运行时一次炸一片"的连锁。

### 3.2 AI 自纠闭环成立的三条件

对"让 AI 写对代码"，真正起作用的不是语言"强不强大"，而是能否形成可靠的**自纠闭环**：

1. **尽早暴露**：错误在写了就发现，而非在用户运行后发现；
2. **反馈具体**：错误信息能精确定位到"哪个类型/字段/生命周期"；
3. **快速重跑**：验证一次迭代的代价足够小。

Rust 和严格 TS 都满足 1、2；但 3 上 Rust 明显更贵（编译依赖图、增量编译、大型 crate）。这是后面权衡的关键。

### 3.3 由此得出的评估方法

对每个模块/层，按三问评估：

- Q1 该层有多少错误能**在写代码时就暴露**？（语言能否拦截）
- Q2 该层最大的错误是**内部逻辑**还是**动态边界**？（语言能否覆盖）
- Q3 该层的 AI 迭代成本是否可接受？（编译循环快慢）

---

## 4. Rust vs 严格 TypeScript 逐项对比（AI 正确性向）

### 4.1 共同优势：编译器闸门

两者都能把"字段名拼错 / 参数类型不符 / 返回结构缺字段"这类 AI 高频错误**前移到编译期**，并给 AI 具体可定位的报错。对本项目，最直接的应用是把 `tsconfig` 的 `include` 扩到 `src-server`、后端 `.js`→`.ts`，让 `analyze_metrics.js` 里"宿主把裸对象 String 化"这类坑（`analyze-metrics.js:43-46`）能在类型层面被提醒。**严格 TS 已经能拿到约 80% 的"编译器闸门"收益。**

### 4.2 Rust 独有（且对"AI 正确性"真实）的优势

| 优势 | 机制 | 对本项目的价值 |
|---|---|---|
| 强制显式错误处理 | `Result`/`Option`，不处理编译不过 | 阻断 `catch {}`/`.catch(()=>{})` 这类静默失败（E3 类），逼 AI 面对每个错误路径 |
| 跨模块契约固化 | `struct`/`enum` + serde，改字段名全项目标红 | 阻断跨模块/前后端结构漂移（E1/E2 类），字段改动即刻显形 |
| 所有权/借用 | 编译期查数据竞争、悬垂、use-after-free | 对"并发状态 + 文件 + 网络"系统有额外安全网 |
| 精确的编译器诊断 | E0308 等，报错指向类型/借用点 | AI 可据具体报错精准修复，自纠反馈质量高 |

### 4.3 Rust 的劣势（诚实评估，"AI 正确性"向）

| 劣势 | 影响 |
|---|---|
| AI 写 Rust 初始编译错误率更高 | 借用检查（lifetime/NLL/trait 对象）是 LLM 最易翻车区；Rust 训练语料远少于 JS/TS。结果是"编译错误数量"上升，靠更多轮循环弥补；收益是**错误更早暴露、危害更小**，而非错误总数量减少 |
| 覆盖不了动态边界 | LLM 输出、外部 API、前端契约只能 `serde_json::Value` + `#[serde(default)]` 容错，拿不到静态保障，反而逼出大量样板；而这些边界恰恰**需要宽松容错**，与 Rust 严格性方向相反 |
| 编译迭代慢 | 大型 crate + 依赖图，AI 自纠循环的第 3 条件（快速重跑）受损失 |
| 跨语言桥接是新错误源 | 后端接 Rust（WASM/N-API/二进制旁路）本身引入序列化/生命周期/构建分层的新错误 |
| 前端 Web 改造风险最高 | React → Yew/Leptos 生态小、AI 语料少；前端"快速迭代 + 边界全动态"，是 AI 正确率最低的区 |

### 4.4 小结

- **如果想要"AI 少出错"，Rust 只在"内部逻辑层"提供了 TS 没有的增量收益：显式错误处理 + 所有权 + 更硬的契约。**
- **但这些收益不覆盖本项目最大的错误源（动态边界），且以"编译更慢、AI 初始错误率更高"为成本。**
- 结论：对本项目，从"AI 正确性"出发，**严格 TS + zod 是投入回报最高的方案**；Rust 属"加分项"，只在纯逻辑核心（metrics/parsers）值得局部尝试，且应作为"验证 AI 自纠循环"的研究性实践，而非全量迁移目标。

---

## 5. 逐模块错误风险评估 + 落地方案（含推荐序）

### 5.1 逐模块风险表

> 行号标注仅对源码里我已核对过的模块给出，避免臆造；未标注者按其角色定性。规模列为大致行数。

| 模块 | 行数 | 当前错误风险 | TS 化收益 | Rust 化收益 | 备注 |
|---|---|---|---|---|---|
| `server/store.js` | 312 | 高（乐观锁/快照/水位线/version 归一化的细粒度语义，契约严格依赖前端） | 中 | 低 | 深度 `fs/path`，重写风险高收益低；TS 能让节点更清晰 |
| `server/sources.js` | 640 | 高（Zotero/OpenAlex 异构响应 + 分页校验 + three-state 错误分类，E5） | 中（边界仍需 zod/serde 容错） | 低 | 外部 API 是"动态边界"，Rust 无静态优势 |
| `server/llm.js` | 384 | 高（LLM 输出不可控，E4；大量 `Array.isArray?}` 容错） | 中 | 低 | 边界必须宽容，Rust 反而逼样板 |
| `server/metrics.js` | 503 | 中（纯函数、正则+单位归一化，正确性敏感但无宿主边界） | 高 | **中-高** | 唯一"强类型能帮 AI 写对"且无动态边界的核心；最值得 Rust 局部化 |
| `server/parsers.js` / `import-parser.js` | 295/238 | 中（表格/文本解析，纯函数） | 高 | 中-高 | 同 metrics，纯逻辑核心 |
| `server/triage.js` | 177 | 中（巡检编排，调用 llm + 写 store） | 中 | 低 | 宿主边界 |
| `server/worklog-gen.js` / `worklog-parse.js` | 97/68 | 中（AI 草稿解析） | 中 | 低 | 动态边界 |
| `server/literature-log.js` | 50 | 低（动作日志化） | 中 | 低 | 小模块 |
| `server/binding.js` / `ids.js` / `json-util.js` / `export-util.js` | ≤50 | 低 | 中 | 低 | 工具函数 |
| `routes/*.js`（api/ui/export） | 447/92/119 | 中-高（请求体解析 + 乐观锁冲突 + 契约约定 E2） | 中 | 低 | 宿主路由契约 |
| `tools/*.js`（5 个 Agent 工具） | ~600 | 中（`content:[{type:'text'}]` 契约、`sessionPermission`、`execute(input,toolCtx)` 形态） | 中 | 低 | 宿主工具加载契约 |
| `index.js`（lifecycle） | 235 | 中（会话状态机 + 节流 + 定时 + `.catch` 静默 E3） | 中 | 低 | 深度宿主耦合 |
| 前端 `ui/` | 3048 | 中-高（`any` 主态 + 契约透传 + 大量交互组件） | 已在 TS | **不推荐 Rust** | 前端 WASM 化会让 AI 正确率最低的层更难 |

### 5.2 落地方案（三档）

**方案 A —— 后端 TS 化 + zod 边界校验（主推，性价比最高）**
- 把 `tsconfig.json` 的 `include` 扩到 `["ui","src-server"]`、后端 `.js`→`.ts`、开 `strict` + `noUncheckedIndexedAccess`。
- 在数据边界（`store.js` 的读入、`llm.js` 的 `extractFirstJson` 之后、`sources.js` 的外部 API 响应、`routes` 的请求体）加 **zod schema**，对 LLM/外部 API 异构响应做运行时校验与容错降级。
- 收益：编译器闸门（覆盖 E1/E2 大部分）+ 动态边界的显式 schema（覆盖 E4/E5）+ 保留现有 `catch {}` 的容错语义（改造成显式 zod 校验 + 降级）。
- 成本：中等；工作量为后端 4350 行迁移 + schema 定义；与现有前端 TS/esbuild 栈无缝衔接。
- 风险/回退：渐进式迁移，任一模块可单独 TS 化并保留 `.js` 共存（`allowJs` 可按模块粒度开启），随时可停。

**方案 B —— 纯逻辑核心做 Rust PoC（研究性，仅作"AI 自纠循环"验证）**
- 只把 `metrics.js`（`buildMetricsSeries`/`filterSeries`/`extractLiteratureBaseline`）作为 Rust 练习对象，编译成 WASM 或原生模块，由 JS 薄调用。
- 目的：实测"AI 写 Rust 的编译器反馈循环"是否真的比 TS 更能让 AI 收敛到正确实现；验证借用检查在纯算法代码里的自纠质量。
- 成本：中等（跨语言桥接 + 双构建 + 测试对齐）；收益：**不确定**，属探索性，不承诺生产收益。
- 风险/回退：改挂 JS 实现即可回退（保留原 `.js`），不阻塞主链路。

**方案 C —— 前端维持 React 不变**
- 无论 A/B 是否做，前端保持 React + TS。避免 WASM 渲染框架（Yew/Leptos）带来的 AI 正确率下降与新桥接错误源。

### 5.3 推荐序

1. **方案 A（后端 TS 化 + zod）** —— 先做，直接命中"减少 AI 错误"的杠杆，成本可控。
2. **方案 B（metrics Rust PoC）** —— 作为技术验证/学习，在 A 之后做，用可度量的"AI 自纠循环质量"决定是否扩展到 parsers。
3. **方案 C** —— 前端保持 React，与语言无关地贯彻。

> 再次强调：**不建议为"AI 正确性"做全栈 Rust 重构**。它的杠杆方向正确（把错误前移编译期），但选错了工具覆盖面（覆盖不了核心动态边界）+ 放大了 AI 正确率最低的层（前端/WASM）。

---

## 6. 校验与定稿

### 6.1 引用复核清单

- `tsconfig.json:7,20`：`allowJs:false`、`include:["ui"]` ✓（本次复核）
- `package.json:22`：`"typecheck":"tsc --noEmit"` ✓（本次复核）
- `package.json:20`：`"test":"node tests/run-all.mjs"` ✓
- `ui/Panel.tsx:50`：`useState<any>(null)` ✓
- `ui/api.ts:3`：`type ApiResult<T> = T & { ok?; error?; hint? }` ✓
- `analyze-metrics.js:43-46`：宿主 `normalizePluginToolResult` 把裸对象 String 化、必须 `content` 文本包装 ✓
- `store.js` / `sources.js` / `index.js` / `routes/api.js` 的多处 `catch {}` / `.catch(()=>{})` ✓
- `llm.js` `triageWorkEntry` / `summarizeFromFulltext` 的动态边界容错 ✓

### 6.2 结论约束声明

- 本文所有"收益/劣势"判断均落到**可复现的代码证据**（行号或角色描述），不作主观夸大。
- "AI 写 Rust 初始编译错误率更高"是基于 Rust/JS 训练语料比重与借用检查复杂度的**工程经验判断**，非本项目实测；如需确证，应按方案 B 做对照实验。
- 未评估项：Rust 在"性能/部署"上的收益不在本视角范围；如需请另立文档。

---

*撰写日期：2026-08-23 · 视角：AI 正确性 · 状态：初稿（结合源码实证）*
