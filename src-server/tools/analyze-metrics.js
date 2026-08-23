/**
 * analyze_metrics：指标数据查询（只读）
 * 从实验记录提炼的性能指标序列，按体系/测试温度/日期过滤后返回结构化数据；
 * 不做趋势结论（点数 < 3 时由调用方明示样本不足）。
 * 注：宿主工具加载器仅注册具名导出 execute（plugin-manager.ts _loadTools），
 * 故与 tools/ 下其他工具同构采用 execute(input, toolCtx)，而非 default 导出。
 */
import { createStore } from "../server/store.js";
import { buildMetricsSeries, filterSeries } from "../server/metrics.js";

export const name = "analyze_metrics";
export const description =
  "查询实验记录中提炼的材料性能指标数据（ZT/功率因子/电导率/Seebeck/热导率/载流子浓度/迁移率），可按材料体系、测试温度、日期范围过滤，返回结构化时间序列、文献基准与统计；只读，不写库。";
export const parameters = {
  type: "object",
  properties: {
    metric: { type: "string", enum: ["zt", "pf", "sigma", "seebeck", "kappa", "n", "mu"], description: "指标 key，缺省全部" },
    system: { type: "string", description: "材料体系名（如 SnSe、Bi₂Te₃），缺省全部" },
    temp: { type: "number", description: "测试温度筛选（如 823），缺省不筛" },
    from: { type: "string", description: "起始日期 YYYY-MM-DD" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD" },
  },
};

export const sessionPermission = {
  kind: "read",
  describeSideEffect: () => ({
    kind: "read",
    summary: "读取实验记录与文献库，构建指标序列并过滤返回，只读不写库",
    ruleId: "materials-research-copilot-read",
  }),
};

/**
 * @param {Record<string, any>} input
 * @param {import("../server/types.js").ToolCtx} toolCtx
 * @returns {Promise<any>}
 */
export async function execute(input = {}, toolCtx) {
  const store = createStore(toolCtx.dataDir);
  const worklog = store.read("worklog");
  const literature = store.read("literature");
  const data = buildMetricsSeries(worklog.entries || [], literature.entries || []);
  const filtered = filterSeries(data, {
    metric: input?.metric, system: input?.system,
    temp: input?.temp, from: input?.from, to: input?.to,
  });
  // 宿主 normalizePluginToolResult 对裸对象 String 化为 "[object Object]"（plugin-manager.ts），
  // 必须用 content 文本包装（tools/ 下 7 个工具同构）；JSON 序列化保留结构化数据供对话 AI 组织回答
  return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
}
