/**
 * 共享类型定义（全 TS 化）：跨模块数据形状。
 * 原 types.js 的 JSDoc typedef 已转为 TS interface/type 声明（.ts 中 JSDoc typedef 不生效）。
 * 动态字段（LLM/外部 API 来源）保持宽松 Record。
 */

/** 宿主工具上下文（createTool 的 execute 第二参） */
export interface ToolCtx {
  /** 插件数据目录（store 落盘根） */
  dataDir: string;
  /** 插件安装目录（prompts/ 读取用） */
  pluginDir?: string;
  /** 绑定的宿主会话 id */
  sessionId?: string;
  /** 绑定的宿主会话路径 */
  sessionPath?: string;
  /** 会话引用 */
  sessionRef?: {
    sessionId?: string;
    sessionPath?: string | null;
    path?: string;
    legacySessionPath?: string | null;
  };
  /** 宿主配置读写 */
  config?: { get(key?: string): any; set(key: string, value: any): void };
  /** 日志通道 */
  log?: { info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void };
  /** 宿主事件总线 */
  bus?: {
    request(type?: string, payload?: any, options?: any): Promise<any>;
    subscribe(...args: any[]): any;
    emit(...args: any[]): any;
    on(...args: any[]): any;
  };
  /** 网络代理（绕 CORS） */
  network?: { fetch(url?: string, init?: any): Promise<any> };
  /** 暂存文件投递（SessionFile），返回含 mediaItem 的投递结果 */
  stageFile?: (input: Record<string, any>) => any;
  /** 应用事件 */
  appEvents?: { emit(...args: any[]): any };
}

/** 甘特任务（gantt.json tasks[]） */
export interface GanttTask {
  id: string;
  name: string;
  /** 起始日期 YYYY-MM-DD */
  start: string;
  /** 结束日期 YYYY-MM-DD */
  end: string;
  /** 前置任务 id */
  dependsOn?: string[];
  /** 完成度 0-100 */
  progress?: number;
  tags?: string[];
  note?: string;
}

/** 日历日程（calendar.json events[]） */
export interface CalendarEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime?: string | null;
  endTime?: string | null;
  /** experiment|meeting|deadline|other */
  type?: string;
  /** 关联甘特任务 */
  taskId?: string | null;
}

/** 指标键值对（巡检 fields / 批量导入 fields） */
export interface MetricField {
  /** 键名（可带温度：ZT@823K） */
  k: string;
  /** 值串（可带单位） */
  v: string;
}

/** 实验记录条目（worklog.json entries[]） */
export interface WorklogEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 工作内容描述 */
  content: string;
  /** 原始实验数据（文本） */
  data?: string | null;
  /** 实验时长（小时） */
  durationHours?: number | null;
  /** 实际时间线开始日期 */
  startDate?: string | null;
  /** 关联甘特任务 */
  taskId?: string | null;
  /** ISO 时间戳 */
  createdAt: string;
  /** 条目类型标记（literature-log 等） */
  kind?: string;
  /** 文献同步批次标识（literature-log） */
  scanId?: string;
  /** 关联方案版本 */
  planVersion?: string | null;
  /** 巡检提取的指标参数 */
  fields?: MetricField[];
  /** 巡检关联的文献 id */
  citations?: string[];
  /** 材料体系（SYSTEM_DEFS 标准名） */
  system?: string;
  /** AI 巡检时间 */
  aiReviewedAt?: string | null;
  /** 样品号（批量导入） */
  sampleId?: string | null;
}

/**
 * 文献条目（literature.json entries[]）：字段多且随来源（Zotero/OpenAlex/在线）演化，
 * 已知键显式声明，其余宽松（Record 兜底）。
 */
export type LiteratureEntry = Record<string, any> & {
  id?: string;
  zoteroKey?: string;
  title?: string;
  doi?: string | null;
  url?: string | null;
  year?: number | string | null;
  abstract?: string | null;
  abstractEn?: string | null;
  keywords?: string[];
  citedBy?: number | null;
  fullTextParsed?: string;
  failedAt?: string | null;
  zoteroGone?: boolean;
  createdAt?: string;
};

export interface GanttDoc {
  version: number;
  tasks: GanttTask[];
  updatedAt: string | null;
}

export interface CalendarDoc {
  version: number;
  events: CalendarEvent[];
  updatedAt: string | null;
}

export interface WorklogDoc {
  version: number;
  entries: WorklogEntry[];
  updatedAt: string | null;
  meta?: {
    aiReviewedAt?: string | null;
    aiReviewedIds?: string[];
    aiReviewedCount?: number;
  };
}

export interface LiteratureDoc {
  version: number;
  entries: LiteratureEntry[];
  updatedAt: string | null;
  lastCompactedAt: string | null;
}

export interface CollectionsDoc {
  version: number;
  collections: Array<Record<string, any>>;
  updatedAt: string | null;
}

export interface BindingDoc {
  sessionId: string | null;
  sessionPath: string | null;
  boundAt: string | null;
  source: string | null;
}

export type UpdatesDoc = Record<string, number>;
export type SettingsDoc = Record<string, any>;

/** 各 store 文档的联合（read() 的广义返回） */
export type StoreDoc =
  | GanttDoc
  | CalendarDoc
  | WorklogDoc
  | LiteratureDoc
  | CollectionsDoc
  | BindingDoc
  | UpdatesDoc
  | SettingsDoc;

/**
 * createStore 返回的 store API（乐观锁 + 快照 + 水位线）。
 * read 以交叉签名表达已知文档名的精确返回类型（与 store.ts 实现重载一致），未知名回落 any。
 */
export interface StoreApi {
  read: ((name: "gantt") => GanttDoc) &
    ((name: "calendar") => CalendarDoc) &
    ((name: "worklog") => WorklogDoc) &
    ((name: "literature") => LiteratureDoc) &
    ((name: "collections") => CollectionsDoc) &
    ((name: "binding") => BindingDoc) &
    ((name: "updates") => UpdatesDoc) &
    ((name: "settings") => SettingsDoc) &
    ((name: string) => any);
  /** 全量覆写（不走乐观锁） */
  write: (name: string, data: any) => any;
  /** 乐观锁更新 */
  update: (
    name: string,
    expectedVersion: number | undefined,
    mutator: (cur: any) => Record<string, any>
  ) => { ok: boolean; error?: string; data?: any };
  /** 追加式写入（去重） */
  append: (name: string, items: any[], dedupeKeys?: string[]) => {
    ok: boolean;
    data?: any;
    appended?: number;
  };
  /** 压实去重 */
  compact: (name: string) => void;
  /** 镜像替换 */
  upsertByKey: (
    name: string,
    keyField: string,
    items: any[],
    extraKeep?: any[]
  ) => { ok: boolean; data?: any; replaced?: number };
  /** 回退快照 */
  rollback: (name: string, toVersion?: number) => {
    ok: boolean;
    error?: string;
    data?: any;
  };
  listSnapshots: (name: string) => number[];
  /** 推进水位线 */
  bump: (name: string) => any;
  getUpdates: () => any;
  /** 当前 ISO 时间 */
  now: () => string;
}

/** LLM sampleText 输入 */
export interface SampleTextInput {
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  /** 调用点标识（日志用） */
  callPoint?: string;
  /** 关键路径（200s 超时 + 失败重试一次） */
  critical?: boolean;
  timeoutMs?: number;
}

/** triageWorkEntry 的返回（解析失败为 null） */
export interface TriageResult {
  fields: MetricField[];
  citations: string[];
  system: string;
  taskProgress: Array<{ taskId: string; progress: number; reason: string }>;
  events: Array<{
    title: string;
    date: string;
    startTime: string | null;
    type: string;
    reason: string;
  }>;
  durationHours: number | null;
  startDate: string | null;
}

/** nextStepAdvice 返回 */
export interface AdviceResult {
  text: string;
  schedule: Array<{
    title: string;
    due: string;
    type: string;
    linksTaskId: string | null;
    reason: string;
  }>;
}
