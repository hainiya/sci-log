# P0 实现：日程闭环（隐式建议 + 滞后再平衡 + 失败重做）

日期：2026-08-05
范围：补全"AI 依据试验记录与方案完善日程表"的闭环（此前仅方案一次性派生 + 显式日期词抽取）

## 改动文件

| 文件 | 改动 |
|---|---|
| `src-server/server/schedule-rebalance.js` | **新增**。日期工具 + `rebalanceSchedule`（滞后再平衡）+ `proposeRedoTask`（失败重做），两条巡检路径与生命周期共用 |
| `prompts/next-step-advisor.md` | 追加 `<!--SCHEDULE-->` JSON 块输出（绝对日期的排程意图） |
| `prompts/worklog-triage.md` | 追加 `needRedo` / `redoReason` 输出字段（保守判定：仅记录明确负面表述且关联任务时） |
| `src-server/server/llm.js` | `nextStepAdvice` 返回 `{text, schedule}` 并解析结构化块；`triageWorkEntry` 解析 `needRedo`/`redoReason` |
| `src-server/tools/log-work.js` | 消费 schedule 生成日历提案（与 triage/已有日历去重）；失败重做提案；调用再平衡 |
| `src-server/server/triage.js` | 面板后台巡检路径同步：失败重做 + 再平衡 |
| `src-server/index.js` | 周期定时器（60min）在自动审查后调用 `_maybeRebalance()`；新增 `_maybeRebalance` 方法 |
| `tests/schedule-rebalance.test.mjs` | **新增**。14 条断言：再平衡级联顺延/去重、失败重做/去重、无滞后不提案 |

## 三个子功能

### P0-1 下一步建议 → 隐式日程提案
`next-step-advisor.md` 除可读建议外，额外输出带绝对日期的 `schedule` 意图块；`log-work.js` 将其转为**日历提案**，并：
- 与同次 triage 识别的 events 去重（同 title+date）
- 与已有日历事件去重（同 title 且日期 ±2 天内）
- 仅当建议含"接下来要做的具体动作"才产生提案

### P0-2 滞后再平衡
`rebalanceSchedule`（纯函数、无 LLM 调用）：
1. 每张任务 `progress<100 且 end<today` → 滞后，顺延至少 1 天 + 2 天缓冲
2. 沿 `dependsOn` 拓扑顺序，使下游 `start` 不早于上游新 `end + 1` 天
3. 对实际位移的任务生成甘特 update 提案；关联日历事件同步顺延
4. 去重：已存在相同待确认提案则跳过

触发点：① `log_work` 记录后；② 面板巡检 `triageWorklog` 后；③ 生命周期每 60 分钟定时（与自动审查共用定时器）。

### P0-3 失败实验 → 重做日程
`worklog-triage.md` 增加 `needRedo`/`redoReason`；当记录明确负面表述（失败/未达标/开裂/需重做等）且关联任务时：
- 复制原任务生成「重做」甘特任务（`progress:0`、`dependsOn:原任务`、`tags:["重做","AI巡检"]`、带 2 天缓冲）
- 生成对应日历事件（experiment）
- 同一原任务已有待确认重做提案时跳过

## 验证
- `npm run build:server` 无法直接覆盖根目录锁定产物（宿主占用），改为打包至临时目录验证：**BUILD_EXIT=0，无语法/导入错误**，`schedule-rebalance.js` 正确打进 bundle。
- `node tests/schedule-rebalance.test.mjs`：**14/14 通过**。
- 现有宿主侧 dev 验证（HTTP 断言 + `plugin_dev_*`）需在你的 Hana dev 环境中 rebuild（src-server 为源，构建后 install 即生效）。

## 已知边界 / 注意
- 根目录 `index.js` / `tools/*.js` / `routes/*.js` 为打包产物，本次未覆盖（被宿主锁定）。请在 dev 环境重新 `build:server` + `plugin_dev_install` 以使改动生效。
- P0-1 的 schedule 块解析依赖 LLM 遵守绝对日期格式；若模型输出相对日期会被 `parseScheduleBlock` 过滤（due >= today 校验 + 格式校验）。
- redo 判定保守：仅在记录含明确负面词且关联任务时触发，避免误排重做。
