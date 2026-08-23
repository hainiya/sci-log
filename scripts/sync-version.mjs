/**
 * 版本一致性校验（O-2）：package.json 与 manifest.json 的 version 必须一致。
 * 以 package.json 为单一版本源；构建前(prebuild)或手动 `npm run check:version` 校验，
 * 不一致即非零退出，阻止发布/调试时版本语境漂移。
 * 用法：node scripts/sync-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

if (pkg.version !== manifest.version) {
  console.error(`[sync-version] 版本不一致：package.json=${pkg.version}，manifest.json=${manifest.version}`);
  process.exit(1);
}
console.log(`[sync-version] ok：version=${pkg.version}`);
