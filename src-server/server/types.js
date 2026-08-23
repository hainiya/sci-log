/**
 * 共享 JSDoc 类型定义（O-5 checkJs 渐进类型化）
 * 集中定义跨模块数据形状，供各模块通过 `import` 类型的 JSDoc 引用
 * （例如在消费模块写 `@typedef {import("./types.js").WorklogEntry} WorklogEntry`）。
 * 注意：本文件只放类型（无运行时代码）；动态字段（LLM/外部 API 来源）保持宽松Record。
 */

/**
 * 宿主工具上下文（createTool 的 execute 第二参）。
 * @typedef {object} ToolCtx
 * @property {string} dataDir 插件数据目录（store 落盘根）
 * @property {string} [pluginDir] 插件安装目录（prompts/ 读取用）
 * @property {string} [sessionId] 绑定的宿主会话 id
 * @property {string} [sessionPath] 绑定的宿主会话路径
 * @property {{ sessionId?: string, sessionPath?: string|null, path?: string, legacySessionPath?: string|null }} [sessionRef] 会话引用
 * @property {{ get(key?: string): any, set(key: string, value: any): void }} [config] 宿主配置读写
 * @property {{ info(...args: any[]): void, warn(...args: any[]): void, error(...args: any[]): void }} [log] 日志通道
 * @property {{ request(type?: string, payload?: any, options?: any): Promise<any>, subscribe(...args: any[]): any, emit(...args: any[]): any, on(...args: any[]): any }} [bus] 宿主事件总线
 * @property {{ fetch(url?: string, init?: any): Promise<any> }} [network] 网络代理（绕 CORS）
 * @property {(input: Record<string, any>) => any} [stageFile] 暂存文件投递（SessionFile），返回含 mediaItem 的投递结果
 * @property {{ emit(...args: any[]): any }} [appEvents] 应用事件
 */

/**
 * 甘特任务（gantt.json tasks[]）
 * @typedef {object} GanttTask
 * @property {string} id
 * @property {string} name
 * @property {string} start 起始日期 YYYY-MM-DD
 * @property {string} end 结束日期 YYYY-MM-DD
 * @property {string[]} [dependsOn] 前置任务 id
 * @property {number} [progress] 完成度 0-100
 * @property {string[]} [tags]
 * @property {string} [note]
 */

/**
 * 日历日程（calendar.json events[]）
 * @typedef {object} CalendarEvent
 * @property {string} id
 * @property {string} title
 * @property {string} date YYYY-MM-DD
 * @property {string|null} [startTime] HH:mm
 * @property {string|null} [endTime] HH:mm
 * @property {string} [type] experiment|meeting|deadline|other
 * @property {string|null} [taskId] 关联甘特任务
 */

/**
 * 实验记录条目（worklog.json entries[]）
 * @typedef {object} WorklogEntry
 * @property {string} id
 * @property {string} date YYYY-MM-DD
 * @property {string} content 工作内容描述
 * @property {string|null} [data] 原始实验数据（文本）
 * @property {number|null} [durationHours] 实验时长（小时）
 * @property {string|null} [startDate] 实际时间线开始日期
 * @property {string|null} [taskId] 关联甘特任务
 * @property {string} createdAt ISO 时间戳
 * @property {string} [kind] 条目类型标记（literature-log 等）
 * @property {string} [scanId] 文献同步批次标识（literature-log）
 * @property {string|null} [planVersion] 关联方案版本
 * @property {Array<{k: string, v: string}>} [fields] 巡检提取的指标参数
 * @property {string[]} [citations] 巡检关联的文献 id
 * @property {string} [system] 材料体系（SYSTEM_DEFS 标准名）
 * @property {string|null} [aiReviewedAt] AI 巡检时间
 * @property {string|null} [sampleId] 样品号（批量导入）
 */

/**
 * 文献条目（literature.json entries[]）：字段多且随来源（Zotero/OpenAlex/在线）演化，
 * 已知键显式声明，其余宽松（Record 兜底）。
 * @typedef {Record<string, any> & {
 *   id?: string,
 *   zoteroKey?: string,
 *   title?: string,
 *   doi?: string|null,
 *   url?: string|null,
 *   year?: number|string|null,
 *   abstract?: string|null,
 *   abstractEn?: string|null,
 *   keywords?: string[],
 *   citedBy?: number|null,
 *   fullTextParsed?: string,
 *   failedAt?: string|null,
 *   zoteroGone?: boolean,
 *   createdAt?: string
 * }} LiteratureEntry
 */

/**
 * 指标键值对（巡检 fields / 批量导入 fields）
 * @typedef {object} MetricField
 * @property {string} k 键名（可带温度：ZT@823K）
 * @property {string} v 值串（可带单位）
 */

/** @typedef {{ version: number, tasks: GanttTask[], updatedAt: string|null }} GanttDoc */
/** @typedef {{ version: number, events: CalendarEvent[], updatedAt: string|null }} CalendarDoc */
/** @typedef {{ version: number, entries: WorklogEntry[], updatedAt: string|null, meta?: { aiReviewedAt?: string|null, aiReviewedIds?: string[], aiReviewedCount?: number } }} WorklogDoc */
/** @typedef {{ version: number, entries: LiteratureEntry[], updatedAt: string|null, lastCompactedAt: string|null }} LiteratureDoc */
/** @typedef {{ version: number, collections: Array<Record<string, any>>, updatedAt: string|null }} CollectionsDoc */
/** @typedef {{ sessionId: string|null, sessionPath: string|null, boundAt: string|null, source: string|null }} BindingDoc */
/** @typedef {Record<string, number>} UpdatesDoc */
/** @typedef {Record<string, any>} SettingsDoc */

/** 各 store 文档的联合（read() 的广义返回） */
/** @typedef {GanttDoc|CalendarDoc|WorklogDoc|LiteratureDoc|CollectionsDoc|BindingDoc|UpdatesDoc|SettingsDoc} StoreDoc */

/**
 * createStore 返回的 store API（乐观锁 + 快照 + 水位线）。
 * read 以交叉签名表达已知文档名的精确返回类型（与 store.js 实现重载一致），
 * 未知名回落 any。
 * @typedef {object} StoreApi
 * @property {((name: "gantt") => import("./types.js").GanttDoc)
 *   & ((name: "calendar") => import("./types.js").CalendarDoc)
 *   & ((name: "worklog") => import("./types.js").WorklogDoc)
 *   & ((name: "literature") => import("./types.js").LiteratureDoc)
 *   & ((name: "collections") => import("./types.js").CollectionsDoc)
 *   & ((name: "binding") => import("./types.js").BindingDoc)
 *   & ((name: "updates") => import("./types.js").UpdatesDoc)
 *   & ((name: "settings") => import("./types.js").SettingsDoc)
 *   & ((name: string) => any)} read 读取（含结构兜底与 version 归一化）
 * @property {(name: string, data: any) => any} write 全量覆写（不走乐观锁）
 * @property {(name: string, expectedVersion: number|undefined, mutator: (cur: any) => Record<string, any>) => { ok: boolean, error?: string, data?: any }} update 乐观锁更新
 * @property {(name: string, items: any[], dedupeKeys?: string[]) => { ok: boolean, data?: any, appended?: number }} append 追加式写入（去重）
 * @property {(name: string) => void} compact 压实去重
 * @property {(name: string, keyField: string, items: any[], extraKeep?: any[]) => { ok: boolean, data?: any, replaced?: number }} upsertByKey 镜像替换
 * @property {(name: string, toVersion?: number) => { ok: boolean, error?: string, data?: any }} rollback 回退快照
 * @property {(name: string) => number[]} listSnapshots
 * @property {(name: string) => any} bump 推进水位线
 * @property {(key: string, value: number) => any} setUpdate
 * @property {() => any} getUpdates
 * @property {() => string} now 当前 ISO 时间
 */

/**
 * LLM sampleText 输入
 * @typedef {object} SampleTextInput
 * @property {Array<{role: string, content: string}>} messages
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 * @property {string} [callPoint] 调用点标识（日志用）
 * @property {boolean} [critical] 关键路径（200s 超时 + 失败重试一次）
 * @property {number} [timeoutMs]
 */

/** triageWorkEntry 的返回（解析失败为 null） */
/**
 * @typedef {object} TriageResult
 * @property {MetricField[]} fields
 * @property {string[]} citations
 * @property {string} system
 * @property {Array<{taskId: string, progress: number, reason: string}>} taskProgress
 * @property {Array<{title: string, date: string, startTime: string|null, type: string, reason: string}>} events
 * @property {number|null} durationHours
 * @property {string|null} startDate
 */

/** nextStepAdvice 返回 */
/**
 * @typedef {object} AdviceResult
 * @property {string} text
 * @property {Array<{title: string, due: string, type: string, linksTaskId: string|null, reason: string}>} schedule
 */

export {}; // 使本文件成为模块（仅类型引用，无运行时代码）
