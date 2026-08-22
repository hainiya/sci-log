# 实验记录时长 → 甘特实际时间线（worklog duration 结构化 + 巡检提取 + 投影渲染）

日期：2026-08-06
状态：设计已批准，待实现

## 1. 背景与动机

用户记录了一条「配置 Bi2Te3 单晶生长」实验（2026-07-27），工艺时长约 244 小时（data 文本：室温 720min 升至 780℃、保温 720min、13200min 降温至 560℃，合计 14640 min）。甘特图中没有任何对应的时间段。

根因：
- worklog 条目无结构化的时长字段，时长只存在于 data 自由文本中；
- 甘特图任务（tasks，start/end）是独立的排期实体，来源为计划里程碑派生、手动创建、巡检「未来安排」提取；
- 巡检提示词（worklog-triage.md）的 taskProgress 只更新已有任务，events 只提取未来安排，均不产生「过去时间段」；
- 该记录 taskId=null，未关联任何甘特任务。

产品语义问题：甘特图应当具备「计划 vs 实际」双轨语义。计划部分由任务排期表达；实际部分应当由实验记录自然投影——日志就是时间线。用户明确要求：worklog 加结构化 duration 字段 + 巡检提取规则；甘特图实际轨迹可独立于计划绘制（当前计划为空，实际条照常显示）。

## 2. 决策

### 2.1 时间锚点：startDate 可选，缺省取记录日期
- 实际块 start = startDate ?? date；
- 理由：长程实验（如 244h 降温）的升温/保温阶段可能发生在记录日期之前，需要显式开始日；日常短实验当天记当天开始，缺省即可；
- 用户选定：C 变体（可选 startDate）。

### 2.2 录入双通道：手动 + 巡检兜底
- 手动：WorklogPanel 新增「时长（小时，可选）」与「开始日期（可选）」输入；
- 巡检：triage 从 data/content 提取明确时长表述（\d+ + min/h/小时/天），换算求和为小时；仅当用户未手动填时提取；结果走提案确认（target=worklog 更新）；
- 单位统一小时（h），UI 显示换算（244 h ≈ 10.2 天）；
- 用户选定：B 方案。

### 2.3 存储模型：记录即时间线（派生投影）
- durationHours / startDate 存于 worklog 条目，不写入 gantt.json；
- 甘特图渲染时从 worklog 投影实际条，单一事实来源：编辑/删除记录自动同步；
- 用户选定：方案 A（否决了「实际条落 gantt.json」与「tasks 加 type」两种双份存储/混合结构方案）。

## 3. 数据模型

worklog 条目新增两个可选字段（旧条目缺省 null，兼容）：

```json
{
  "id": "work_msg2n1fi",
  "date": "2026-07-27",
  "durationHours": 244,
  "startDate": "2026-07-26",
  "content": "...",
  "data": "..."
}
```

- `durationHours`：number | null，统一小时；null = 未填（不投影）；0 与负数非法；
- `startDate`：string | null（YYYY-MM-DD），null 时实际条从 date 开始画；不得晚于今天（与 date 校验一致）。

## 4. 巡检提取规则（worklog-triage.md 扩展）

- 输出 JSON 顶层新增 `durationHours`（number|null）与 `startDate`（string|null，可选）；
- 提取：识别 data/content 中 `\d+\s*(min|h|小时|天)` 形式的明确持续时长，换算为小时（min/60、h×1、天×24）求和；可多个并行（如 720min + 13200min → 244h）；
- 拒绝提取：模糊表述（「数小时」「每天 1h」「大概两天」）输出 null；
- 覆盖规则（明确）：提交时若 durationHours 已手动填写非空值，则不发起提取提案（巡检输出中的 durationHours 被忽略）；仅当提交时 durationHours 为空时，巡检提取并生成提案（提取到非 null 值才提案）。
- startDate 提取：仅当文本有明确锚点（如「7/26 开始」「X 日开始」）时输出，否则 null（缺省取 date）。

## 5. 甘特投影与渲染

### 5.1 投影（SchedulePanel 内派生，不落盘）

```ts
const actuals = (state.worklog?.entries || [])
  .filter(e => e.durationHours > 0)
  .map(e => ({
    id: 'act_' + e.id,
    name: e.content.slice(0, 20),
    start: e.startDate ?? e.date,
    end: addDays(start, Math.ceil(e.durationHours / 24) - 1),
    kind: 'actual',
    sourceId: e.id,
  }));
```

- end 语义：最后一个占用日（含）；244h → 11 个日历日 → start + 10 天；1h / 24h → end = start（当天块）；
- 名称取 content 前 20 字，悬停 title 显示完整 content。

### 5.2 GanttChart 渲染

- rows = 计划任务 + 实际条合并，按 start 排序平铺，每块一行；计划为空时仅显示实际条；
- 实际条样式：绿色系实心条（区别于计划条橙色系），名称前加「实」标记；
- 时间轴 min/max 范围计算并入实际条 start/end；
- 实际条只读：不参与拖拽、编辑表单、删除；修改只能通过改实验记录。

### 5.3 联动语义

- 手动填时长保存 → 甘特立即出现实际条；
- 巡检提取确认 → 落库后自动出现；
- 编辑记录时长/日期/内容 → 实际条跟着变；
- 删除记录 → 实际条消失。

## 6. 边界与错误处理

- durationHours 非数字 / ≤0 → API 拒绝（400）；
- startDate 晚于今天 → 拒绝（400）；
- startDate 非法格式 → 拒绝（400）；
- 模糊时长表述 → 巡检输出 null，不生成提案；
- 旧数据（无字段）→ 不投影，无异常；
- 实际条不进入任何写路径（拖拽/编辑/删除均不可达）。

## 7. 测试与验收

- 投影纯函数：244h→start+10 天；1h/24h→end=start；startDate 缺省取 date；旧数据过滤；
- 提取正则：720+720+13200min→244h；12h→12；3天→72；混用求和；拒绝「每天1h」「数小时」；
- API 边界：durationHours 非法、startDate 未来/非法格式均 400；
- 巡检提案链路：mock LLM 输出 durationHours → target=worklog 提案 → 接受 → 落库 → 投影出现；
- UI：WorklogPanel 两个输入正常提交/编辑；甘特实际条绿色渲染 + 标记 + 悬停 + 时间轴包含 10 天块；0 计划任务时仅实际条；
- 回归：tsc 全量；记录增删改；甘特计划任务拖拽不受影响；巡检原有输出结构不变（新增字段向后兼容）。

验收标准：用户那条 244h 实验补上时长后，甘特图出现 7-27 → 8-06 的绿色实际条，且改记录/删记录它跟着变。

## 8. 范围外（YAGNI）

- 实际条独立手动创建/编辑（影子不应有独立意志）；
- 「每天 X」周期模式提取；
- 多条记录重叠的时间块冲突处理（平铺即可，不做碰撞折叠）；
- 导出（worklog/审查报告）中的时长字段格式化。

## 9. 影响文件

- `src-server/tools/log-work.js`：schema 加 durationHours/startDate；校验；
- `src-server/server/triage.js`（或调用处）：提取时长 → 提案（target=worklog update）；
- `prompts/worklog-triage.md`：输出结构加 durationHours/startDate + 规则；
- `ui/panels/WorklogPanel.tsx`：两个输入框（新建 + 编辑已有）；
- `ui/panels/SchedulePanel.tsx`：投影 actuals；
- `ui/components/GanttChart.tsx`：渲染实际条 + 时间轴范围并入 + 只读；
- 构建产物同步：项目根 tools/*.js、assets/panel.js（vite build）；正式目录 robocopy。
