# 方案演进史 + 变更语义 + 实验反馈闭环 设计文档

> 日期：2026-08-06
> 状态：已批准（用户确认设计后进入实现）
> 范围：materials-research-copilot 插件

## 背景与问题

研究方案在真实科研中是动态演进的：实验反馈触发微调（材料不变改工艺、工艺不变改材料）、范围调整、大改方向。当前方案板块是「版本号 + 回退」的静态文档模型：

- 已有：plan.json 乐观锁版本、snapshots/plan/{version}.json 快照（保留最近 20 个）、rollback 回退、提案系统（AI 改动走提案）
- 缺失：方案变更的「为什么」——变更类型、原因、触发实验全部无结构；实验记录（worklog）与方案版本无关联；演进过程无展示

## 需求（用户确认）

- **A 方案演进史**：时间线展示方案每次变更（版本、时间、来源、类型、原因、关联实验），可查看历史版本内容，可回退到任意历史版本
- **C 变更语义标注**：保存时可填（类型多选 + 原因 + 关联实验），不填显示「未标注变更」；AI 提案改动自动带标注（AI 判断类型，reason 兜底）
- **D 实验反馈闭环（混合模式）**：log_work 自动记录当时方案版本号（零操作）；改方案时可勾选引用变更前 14 天内的实验记录；演进史条目展示关联实验
- **B 并行路线**：本轮不做（YAGNI，下一迭代）

## 数据模型

### 新增 plan-evolution.json

```json
{
  "version": 0,
  "entries": [
    {
      "version": 13,
      "at": "2026-08-06T12:00:00Z",
      "by": "user" | "ai" | "rollback",
      "types": ["material", "process"],
      "reason": "掺杂比例调整，换用磁控溅射",
      "experimentKeys": ["work_xxx"]
    }
  ]
}
```

- `types` 多选枚举：`material` 改材料 / `process` 改工艺 / `scope` 范围调整 / `direction` 大改方向 / `other` 其他
- `experimentKeys`：worklog 条目 id 列表（用户勾选引用）
- 方案内容本身仍在 snapshots，演进史条目是元数据索引
- 快照保留上限维持 20；演进史元数据永久保留，被清理快照的版本内容显示「历史内容已归档」

## 服务端

### 写路径接入（全部 plan 变更成功时追加演进记录）

| 写路径 | 位置 | 演进记录来源 |
| --- | --- | --- |
| 面板保存 | api.js PUT /plan | body 可选 `evolution {types, reason, experimentKeys}`；不填记「未标注变更」 |
| 提案接受 | proposals.js applyProposal plan 分支 | proposal.meta.evolution（AI 通过 manage_plan 传入）；不传用 proposal.reason 兜底，by=ai |
| 回退 | api.js POST /snapshots/:name/rollback | 自动记 by=rollback，reason「回退到 vN」（toVersion 支持） |
| 引导草案 | api.js proposalDraft | by=ai（meta.evolution 为空时 reason 兜底） |

### 新端点

- `GET /plan/evolution`：`{entries: [...], snapshots: [版本号...]}`（snapshots 用于前端兜底展示未标注的历史版本）
- `GET /plan/evolution/:version`：返回该版本快照内容（不存在返回 `{error: "no_snapshot"}`）
- `POST /snapshots/:name/rollback`：body/query 支持可选 `toVersion`（store.rollback 已支持，API 补透传）

### 其他

- store.js FILES 列表加 `plan-evolution`；/state 枚举加 `plan-evolution`（前端直接取）
- log-work.js：worklogEntry 构造处加 `planVersion: plan.version`（该处已读 plan）
- manage-plan.js：parameters 加可选 `evolution {types: enum[], reason}`；update plan 时透传进 proposal meta.evolution
- 演进记录写入失败不阻塞方案保存（try/catch + log.warn，与快照同策略）

## 前端

### PlanPanel 保存区

可折叠「📝 变更说明」区块（默认收起）：
- 类型多选 chips：改材料 / 改工艺 / 范围调整 / 大改方向 / 其他
- 原因输入（textarea 一行）
- 「关联实验」勾选区：列出变更前 14 天内的 worklog 条目（date + content 摘要），勾选即引用
- 保存时 body 带 `evolution`（未展开/未填写 → 不带，服务端记未标注）

### 新增「方案演进史」区块（方案表单下方、对照评估上方）

时间线列表，每条：`v13 · 2026-08-06 20:00 · 🤖 AI / ✍️ 手动 / ↩ 回退 · [改材料][改工艺] · 原因 · 关联实验 ×2`；未标注灰色「未标注变更」。

操作：
- 点条目展开：显示关联实验列表（date + content 摘要）
- 「查看此版本」：弹层只读展示该版本方案（GET /plan/evolution/:version）
- 「回退到此版本」：POST rollback toVersion（内联两段式确认，沙箱无 confirm）

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 无 plan-evolution.json（旧数据） | 读空数组，snapshots 兜底显示「历史版本（未标注）」 |
| 快照被 prune | 查看返回「历史内容已归档」提示 |
| evolution 写入失败 | 不阻塞方案保存，log.warn |
| rollback toVersion 不存在 | 400 no_snapshot |
| 提案拒绝 | 不产生演进记录 |

## 测试清单

1. PUT /plan 带 evolution → plan-evolution 追加，/state 可见
2. PUT /plan 不带 evolution → 记「未标注变更」
3. manage_plan update 带 evolution → 提案 meta 带 → 接受后 by=ai 记录
4. rollback（默认上一版 + toVersion）→ by=rollback 记录
5. log_work → worklog 条目带 planVersion
6. GET /plan/evolution/:version 快照内容
7. 前端：演进史渲染 / 展开关联实验 / 查看历史版本 / 回退到此版本
8. 旧数据兼容（无 plan-evolution.json 不炸）
9. 回归现有 7 工具

## YAGNI（明确不做）

- 并行路线 B（下一迭代）
- 版本间 diff 对比（查看历史版本已够）
- 实验记录独立 UI 面板（闭环在演进史与对话返回中体现）
