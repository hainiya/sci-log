# vendor/openhanako — 宿主 Hana SDK 运行副本

本目录是宿主 **Hana（openhanako）** 四个 SDK 包的**运行所需副本**，仅保留 `dist/` 编译产物（+ `package.json`），不含源码。

## 为什么存在

- `package.json` 的 `@hana/*` 依赖原本指向宿主源码树 `file:../openhanako/packages/*`（兄弟目录）。
- openhanako 源码树不在开发机后，该依赖全部失效（`npm install` 失败、构建/测试全挂）。
- 因此从本机宿主安装副本 `~/.hanako/plugins/materials-research-copilot/node_modules/@hana/*` 拷贝出运行所需文件，改为 `file:./vendor/openhanako/packages/*`，保证仓库自包含（clone 即 `npm install` 可用）。

## 内容与许可

| 包 | 用途 | 许可 |
|---|---|---|
| `plugin-runtime` | 后端 bus 调用封装（`sampleText` / `sendSessionMessage` 等） | Apache-2.0 |
| `plugin-sdk` | 前端 `hana` API（`api.fetch` / `toast` 等） | Apache-2.0 |
| `plugin-protocol` | 宿主契约类型 | Apache-2.0 |
| `plugin-components` | `HanaThemeProvider` + `styles.css` | Apache-2.0 |

## 切换回源码树（openhanako 恢复后）

```bash
git checkout HEAD -- vendor 2>/dev/null; rm -rf vendor
# package.json 依赖改回：
#   "@hana/plugin-components": "file:../openhanako/packages/plugin-components",
#   ...
npm install
```

> 注意：`npm install` 会按 `package.json` 重新解析 `file:` 依赖；若 openhanako 源码树不在预期位置，请勿直接 `npm install`（会再次挂掉），先恢复 vendor 或修复依赖路径。
