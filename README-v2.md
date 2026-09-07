# sci-log v2（科研工作台 App）

Hana 新版插件形态（`manifestVersion: 2` App）下的科研工作台。原 v1 插件（`~/.hanako/plugins/sci-log`）是冻结兼容层，本工程是其 v2 迁移版，安装于 `~/.hanako/apps/sci-log`。

## 形态差异（v1 → v2）

| 维度 | v1 插件 | v2 App |
|---|---|---|
| 安装位置 | `plugins/` | `apps/` |
| 清单 | `manifestVersion` 缺省/1 | `manifestVersion: 2` |
| 进程 | 宿主进程内（full-access） | 独立子进程（权限模型） |
| 数据目录 | `plugin-data/sci-log/` | `app-data/sci-log/`（`ctx.dataDir`） |
| 文件读写 | 裸 `node:fs` | **必须走 `ctx.resources`**（裸 fs 写入被 Node 权限模型禁止） |
| 工具注册 | 具名导出 + 宿主加载 | `ctx.tools.register`（不 namespace，需自选无冲突名） |
| LLM | app 侧 `sampleText()`（自动巡检） | 无 app 侧 LLM，改为 AI 编排（调用方传结构化产出） |
| 后台任务 | lifecycle 订阅会话事件 + 定时器 | 无（v2 不给读用户会话的门） |
| UI | `contributes.page/widget` WebView | `contributes.cards` + `ui/panel.html` + app 路由 |

## 数据层：resources-backed store

v2 app 子进程运行在 Node 权限模型下（`--allow-fs-*` 未授），裸 `fs.writeFileSync` 会抛
`Access to this API has been restricted`。因此：

- `lib/store.js` 的 `createStore(dataDir, resources)` 全部走 `ctx.resources`（`read/write/mkdir/list/delete`），方法全部 async。
- ref 一律 `{ kind: "local-file", path }`；宿主自动把 `~` 占位路径重定向到真实 home。
- 工具模块经 `__setDataDir` / `__setResources` / `__setNetwork` / `__setConfig` 注入依赖，`execute(args)` 单参数。

## 工具清单（5）

| 工具 | 说明 | v2 裁剪 |
|---|---|---|
| `manage_schedule` | 甘特/日历增删改查 | 去 binding |
| `analyze_metrics` | 指标查询（只读） | 无 |
| `export_report` | 导出实验记录 Markdown | `ctx.resources.stage` 投递 |
| `log_work` | 记录实验/工作 | **AI 编排版**：fields/citations/system 由调用方传入；保留时长正则与跨天甘特建议（纯规则） |
| `collect_literature` | Zotero 手动收纳 | 手动触发；去 PDF 增强/引用补全（依赖 LLM） |

另有 `/state` 只读路由（`/api/apps/sci-log/routes/state`）供 `ui/panel.html` 工作台展示概览。

## 能力裁剪（v2 架构边界所致）

- **自动后台 Zotero 同步 / 会话绑定**：v2 无读取用户主会话事件的通道，改为手动 `collect_literature`。
- **自动 LLM 巡检 / 下一步建议**：v2 无 app 侧 `sampleText`。`log_work` 由 AI 调用时自行判断结构化产出并随参传入（AI 编排）。
- Zotero 文献库镜像保留；PDF 全文增强、AI 关键词/摘要、OpenAlex 引用补全暂缺（可后续做成 Agent 侧步骤）。

## 历史数据迁移

v1 数据在 `plugin-data/sci-log/`，v2 读 `app-data/sci-log/`。迁移方式（本机已执行）：

```powershell
Copy-Item plugin-data\sci-log\*.json  app-data\sci-log\   # 跳过 binding.json
Copy-Item plugin-data\sci-log\snapshots app-data\sci-log\ -Recurse
```

注意：v2 app 内不能做裸 fs 复制（权限模型），故迁移在宿主侧完成。双轨并行期间 v1 与 v2 各自写各自目录，数据会分叉；确认 v2 可用后应停用 v1 插件。

## 开发/调试

- 编辑后同步到 `~/.hanako/apps/sci-log/`，再 reload：
  ```powershell
  $h = @{ Authorization = "Bearer <token>" }
  Invoke-RestMethod -Uri "http://127.0.0.1:<port>/api/extensions/app:sci-log/reload" -Method Post -Headers $h
  ```
  token/port 见 `~/.hanako/server-info.json`。
- 日志：`~/.hanako/logs/<date>.log`，app 内 `ctx.logger` 输出带 `[sci-log]` 前缀。
- 工具对模型可见需在 设置 → 安全 → App 能力 打开「模型调用」（`app/tools.expose-to-model`）；工具集在会话开始时冻结，新会话生效。
