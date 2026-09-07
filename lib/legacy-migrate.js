/**
 * 旧数据兼容层：v1 数据目录 → v2 数据目录
 *
 * v1 时代数据落在 {HANA_HOME}/plugin-data/sci-log/（dataDir 直指该目录）。
 * v2 时代 dataDir 为 {HANA_HOME}/app-data/sci-log/（全新空目录）。
 * 为避免用户历史数据（实验记录/甘特/日历/文献镜像）在切换形态后"消失"，
 * 首次加载时若 v2 目录尚无任何文档、而 v1 目录存在数据，则整体复制过来。
 *
 * 复制策略（保守，不破坏任何一边）：
 * - 仅当 v2 目录里没有任何 *.json 文档时才执行（避免覆盖 v2 已产生的新数据）
 * - 复制 worklog/gantt/calendar/literature/collections/updates/settings + snapshots/
 * - binding.json（会话绑定，v2 已砍）与 exports/ 不复制
 * - 复制完成后置一个 LEGACY_MIGRATED 标记文件
 *
 * 双轨并行说明：v1 与 v2 并存期间，两者各自写各自的 dataDir，
 * 数据会分叉。迁移只在首次发生一次；之后的同步策略由用户在切换形态时定。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIGRATED_MARK = ".v2-legacy-migrated";

/** 宿主把 dataDir 传成 `~\...` 形式（~ = 用户主目录）；fs 需要真实绝对路径 */
function expandHome(p) {
  if (typeof p !== "string" || !p) return p;
  const home = os.homedir();
  if (p === "~") return home;
  if (p.startsWith("~/" ) || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

const DOC_NAMES = [
  "worklog",
  "gantt",
  "calendar",
  "literature",
  "collections",
  "updates",
  "settings",
];

/**
 * @param {string} v2DataDir  当前 app 的 ctx.dataDir（app-data/sci-log）
 * @param {string} v1DataDir  旧 v1 数据目录（plugin-data/sci-log），可空
 * @returns {{ migrated: boolean, copied: string[], skipped: string, source?: string }}
 */
export function migrateLegacyData(v2DataDirRaw, v1DataDirRaw) {
  const v2DataDir = expandHome(v2DataDirRaw);
  const v1DataDir = expandHome(v1DataDirRaw);
  const markPath = path.join(v2DataDir, MIGRATED_MARK);

  // v2 目录已迁移过 → 不再动
  if (fs.existsSync(markPath)) return { migrated: false, copied: [], skipped: "already_migrated" };

  // v1 目录不存在或无数据 → 全新开始
  if (!v1DataDir || !fs.existsSync(v1DataDir)) {
    fs.mkdirSync(v2DataDir, { recursive: true });
    fs.writeFileSync(markPath, new Date().toISOString(), "utf-8");
    return { migrated: false, copied: [], skipped: "no_legacy_source", source: v1DataDir ?? null };
  }

  fs.mkdirSync(v2DataDir, { recursive: true });

  // v2 目录已有任何 .json 文档（用户已在 v2 里产生新数据）→ 不覆盖，只置标记
  let v2HasDocs = false;
  try {
    v2HasDocs = fs.readdirSync(v2DataDir).some((f) => f.endsWith(".json"));
  } catch {}
  if (v2HasDocs) {
    fs.writeFileSync(markPath, new Date().toISOString(), "utf-8");
    return { migrated: false, copied: [], skipped: "v2_has_data", source: v1DataDir };
  }

  const copied = [];
  for (const name of DOC_NAMES) {
    const src = path.join(v1DataDir, `${name}.json`);
    if (!fs.existsSync(src)) continue;
    try {
      const content = fs.readFileSync(src, "utf-8");
      // 跳过空壳文档（默认形状），避免污染 v2 水位线
      const parsed = JSON.parse(content);
      const isEmptyShell =
        name === "worklog" && Array.isArray(parsed.entries) && parsed.entries.length === 0;
      const isEmptyShellLit =
        name === "literature" && Array.isArray(parsed.entries) && parsed.entries.length === 0;
      if (isEmptyShell || isEmptyShellLit) continue;
      fs.writeFileSync(path.join(v2DataDir, `${name}.json`), content, "utf-8");
      copied.push(`${name}.json`);
    } catch {}
  }

  // snapshots 子树整体复制（含 worklog/gantt/calendar/literature/collections 历史快照）
  const srcSnap = path.join(v1DataDir, "snapshots");
  if (fs.existsSync(srcSnap)) {
    try {
      copyTree(srcSnap, path.join(v2DataDir, "snapshots"));
      copied.push("snapshots/");
    } catch {}
  }

  fs.writeFileSync(markPath, new Date().toISOString(), "utf-8");
  return { migrated: copied.length > 0, copied, skipped: "copied", source: v1DataDir };
}

function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}
