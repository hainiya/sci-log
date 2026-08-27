/**
 * SDK 依赖可移植化：把 hana-plugin-creator skill 的 SDK tarball 解包进
 * 仓库内 vendor/sdk/packages/，package.json 通过 bun workspaces
 * （"vendor/sdk/packages/*" + "workspace:*"）引用，使项目不依赖本机绝对路径
 * 即可安装构建。bun 会把 tarball 内声明的 @hana/* 相互依赖解析为本地 workspace 包。
 * 用法：bun scripts/install-sdk.mjs   （或 npm run install:sdk）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const vendorSdkDir = path.join(root, "vendor", "sdk");
const packagesDir = path.join(vendorSdkDir, "packages");
const workDir = path.join(vendorSdkDir, ".work");
const sdkNames = ["runtime", "sdk", "components", "protocol"];
const SDK_VERSION = "0.0.0";

// 候选源：环境变量 > 已知 skill 位置（reasonix + 旧 .hanako 两处）
const candidates = [];
if (process.env.HANA_PLUGIN_CREATOR_SDK) {
  candidates.push(path.join(process.env.HANA_PLUGIN_CREATOR_SDK, "assets", "sdk"));
}
candidates.push(
  "C:/Users/liao2/AppData/Roaming/reasonix/skills/hana-plugin-creator/assets/sdk",
  "C:/Users/liao2/.hanako/skills/hana-plugin-creator/assets/sdk",
);

const src = candidates.find((d) =>
  fs.existsSync(path.join(d, `hana-plugin-runtime-${SDK_VERSION}.tgz`))
);
if (!src) {
  console.error("[install-sdk] 未找到 SDK tarball（检查 hana-plugin-creator skill 位置，或设 HANA_PLUGIN_CREATOR_SDK）");
  process.exit(1);
}

// 解包：Windows git-bash 的 tar 无法解析 "C:" 路径，统一用 7z（双层：tgz→tar→package/）
function extractTgz(tgzPath, destDir) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  // 第一层：tgz → .tar
  execFileSync("7z", ["x", "-y", tgzPath, `-o${workDir}`], { stdio: "ignore" });
  const tarFile = fs.readdirSync(workDir).find((f) => f.endsWith(".tar"));
  if (!tarFile) throw new Error(`未找到内层 tar: ${tgzPath}`);
  // 第二层：.tar → package/
  const s2 = path.join(workDir, "s2");
  fs.mkdirSync(s2, { recursive: true });
  execFileSync("7z", ["x", "-y", path.join(workDir, tarFile), `-o${s2}`], { stdio: "ignore" });
  const pkg = path.join(s2, "package");
  if (!fs.existsSync(pkg)) throw new Error(`未找到 package/ 目录: ${tgzPath}`);
  // 落位
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.renameSync(pkg, destDir);
  fs.rmSync(workDir, { recursive: true, force: true });
}

fs.mkdirSync(packagesDir, { recursive: true });
for (const name of sdkNames) {
  const tgzPath = path.join(src, `hana-plugin-${name}-${SDK_VERSION}.tgz`);
  if (!fs.existsSync(tgzPath)) {
    console.error(`[install-sdk] 缺少源文件: ${tgzPath}`);
    process.exit(1);
  }
  const dest = path.join(packagesDir, `plugin-${name}`);
  console.log(`[install-sdk] 解包 ${name} → vendor/sdk/packages/plugin-${name}`);
  extractTgz(tgzPath, dest);
}
console.log("[install-sdk] done");
