/**
 * analyze_metrics（v2 版）：指标数据查询（只读）
 * - 自 v1 analyze-metrics.ts 迁移
 * - v2 改动：store/metrics 引用 v2 lib；无宿主能力依赖，只读 dataDir
 */
import { createStore } from "../lib/store.js";
import { buildMetricsSeries, filterSeries } from "../lib/metrics.js";

let _dataDir = null;
let _resources = null;
export function __setDataDir(dir) {
  _dataDir = dir;
}
export function __setResources(r) {
  _resources = r;
}

export const name = "analyze_metrics";

export const description =
  "查询实验记录中提炼的材料性能指标数据（ZT/功率因子/电导率/Seebeck/热导率/载流子浓度/迁移率），可按材料体系、测试温度、日期范围过滤，返回结构化时间序列、文献基准与统计；只读，不写库。";

export const parameters = {
  type: "object",
  properties: {
    metric: {
      type: "string",
      enum: ["zt", "pf", "sigma", "seebeck", "kappa", "n", "mu"],
      description: "指标 key，缺省全部",
    },
    system: { type: "string", description: "材料体系名（如 SnSe、Bi₂Te₃），缺省全部" },
    temp: { type: "number", description: "测试温度筛选（如 823），缺省不筛" },
    from: { type: "string", description: "起始日期 YYYY-MM-DD" },
    to: { type: "string", description: "结束日期 YYYY-MM-DD" },
  },
};

export async function execute(input = {}) {
  if (!_dataDir || !_resources) throw new Error("dataDir/resources 未注入");
  const store = createStore(_dataDir, _resources);
  const worklog = await store.read("worklog");
  const literature = await store.read("literature");
  const data = buildMetricsSeries(worklog.entries || [], literature.entries || []);
  const filtered = filterSeries(data, {
    metric: input?.metric,
    system: input?.system,
    temp: input?.temp,
    from: input?.from,
    to: input?.to,
  });
  return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
}

export default { name, description, parameters, execute };
