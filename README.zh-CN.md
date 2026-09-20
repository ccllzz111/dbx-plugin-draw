# DBX Draw

基于 [draw.io](https://www.drawio.com) 的离线绘图工作台，直接嵌入
[DBX](https://github.com/t8y2/dbx)。在数据库工作区内绘制流程图、架构图、
实体关系图和技术示意图，无需切换应用。

[English](README.md) | [简体中文](README.zh-CN.md)

## 功能

- **绘图编辑器** — 内置 draw.io 31.4.6，提供图形、连接线、图层、多页、
  撤销/重做、缩放和图形库，保留 draw.io 原生界面。
- **文件与导出** — 导入 draw.io XML，保存 `.drawio`，导出 PNG/SVG，
  通过 DBX 宿主复制 XML。图表文件保持与 draw.io 兼容。
- **数学排版** — 内置 MathJax 4.1.3 和 TeX 字体，离线渲染 LaTeX、AsciiMath，
  支持在图表导出中保留公式。
- **最近文件** — 保留最近导入或保存的最多 10 份图表副本，支持重新打开、移除和清空。
- **外观与快捷键** — 深浅色跟随 DBX，插件提供中英文界面；draw.io 根据
  macOS、Windows、Linux 自动适配快捷键及菜单提示，并附带离线快捷键表。
- **保存确认** — 编辑器内的退出按钮提供“保存并继续 / 不保存 / 取消”；
  取消保存或保存失败时保留编辑器。

插件由 Vue 3、draw.io 和本地资源组成，**没有原生后端进程**，运行时无需 CDN，
也不声明额外的宿主权限。

## 安装

需要 **DBX 0.6.15+、Host API 1**。macOS、Windows、Linux 使用同一个
**`universal`** 安装包，使用者无需安装 Node.js。

手动安装时，从 [GitHub Releases](https://github.com/ccllzz111/dbx-plugin-draw/releases)
下载 `.dbxp`，在 DBX 插件中心使用本地安装入口选择文件。
GitHub Release 中的包是**未签名审核候选包**，需要开启 DBX 的未签名开发包安装选项。
升级后关闭旧绘图标签，并重新启动 DBX。

正式商店安装使用审核上架后由 DBX Store 签名的包。发布 GitHub Release 不代表已上架。

CI 在三个系统上执行检查、测试和构建。目前已在 macOS 上进行开发和浏览器沙箱测试；
Windows、Linux 的真实 DBX 界面仍待实机验收。

## 保存与最近文件

编辑时，当前图表保留在内存中。点击 **保存 `.drawio`** 后，由宿主打开保存对话框，
确认后才写入文件；导出 PNG/SVG 不等于保存可继续编辑的图表。
当前 `⌘S` / `Ctrl+S` 绑定的是 **保存并退出**；只想保存时，请使用底部保存按钮。

最近记录保存的是导入或成功保存时的 XML 副本：

| 使用环境 | 最近文件存储方式 |
| --- | --- |
| 当前 DBX 沙箱 | 内存，仅限本次插件会话 |
| 独立浏览器预览 | 浏览器 `localStorage`，刷新后仍可读取 |
| 提供可选存储接口的宿主 | 使用该宿主提供的存储 |

列表最多保留 10 份副本，总 JSON 大小限制为 1.5 MiB。超过历史容量限制的文件仍可正常
导入和保存。重新打开的是记录时的副本，**不会读取原文件在磁盘上的后续修改**。
移除记录或清空列表不会删除原文件；最近文件也不是自动保存或未保存编辑的备份。

## 开发

环境要求：**Node.js 22+** 和 npm，无需 Go 或 Rust 工具链。

```bash
npm ci
npm run dev                    # 独立浏览器预览，使用模拟宿主
```

也可以使用 DBX 插件开发环境：

```bash
npx --yes @dbx-app/plugin-cli@0.1.9 dev --path . --port 5190
```

CLI 使用 `dbx-plugin.toml` 中的构建和监听命令。构建成功后输出
`DBX_UI_BUILD_SUCCESS`，通知开发环境重新加载界面。

```bash
npm run check                  # Vue / TypeScript 类型检查
npm test                       # 协议、保存状态、最近文件、链接与资源加载测试
npm run build                  # 生产构建，输出到 ui/
npm run build:watch             # 监听代码变化并重新构建
```

### 离线资源

选用的 draw.io 资源已提交到 `public/drawio/`，上游提交版本和逐文件 SHA-256
记录在 [`vendor/drawio.json`](vendor/drawio.json)。开发和构建前会校验资源完整性，
并从 `package-lock.json` 锁定的 npm 依赖生成 MathJax 组件。

DBX 在受限的 `srcdoc` iframe 中加载插件。`src/vfs.ts` 通过宿主桥接读取本地文件，
以 blob/data URL 提供资源。大型 JavaScript 包和 SVG 字体被拆成约 1 MiB 的分片，
运行时重新拼接，以适应桥接传输。

浏览器集成验证还应覆盖 DBX 的沙箱和 CSP，包含 `connect-src 'none'`；
独立浏览器预览不能复现全部宿主限制。

## 打包

```bash
npm ci
npm run build
npx --yes @dbx-app/plugin-cli@0.1.9 package .
```

输出为 `dist/ccllzz111.dbx-draw-<版本>-universal.dbxp`，包含构建后的界面、
draw.io 资源、MathJax 组件及字体、插件图标和第三方许可说明，不包含平台专用可执行文件。

## 发布与上架

1. 同步更新 `manifest.json`、`package.json`、`package-lock.json` 的版本号，
   提交并推送代码，然后发布同名 `v<版本>` 标签的 GitHub Release。
2. **Release DBX plugin** 工作流对该标签执行检查、测试、构建、打包，并上传
   未签名 `.dbxp`、`.artifact.json`、`release-candidates.json` 和
   `dbx-store-submission.zip`。
3. Fork [DBX Store](https://github.com/t8y2/dbx-store)，复制生成的候选文件；
   首次提交时还需发布者文件。向 `t8y2/dbx-store:main` 提交 PR，并填写审核说明。
4. DBX Store 维护者审核、签名并在同一个 PR 中生成正式目录。作者不需要官方签名私钥，
   也不需要购买操作系统签名证书。

详细操作见[发布与商店提交步骤](docs/PUBLISHING.zh-CN.md)，
另提供[商店 PR 说明模板](docs/STORE_PR.md)。

本地可执行 `npm run release:metadata` 查看生成的提交材料。正式提交使用 Release
附件中的元数据，哈希和字节大小必须与实际发布包一致。源码和未签名候选包保留在本仓库，
不要把普通插件源码提交到 DBX 宿主或商店仓库。

## 已知限制

- **直接关闭宿主标签页无法拦截**：当前 DBX 下，请先保存，或通过编辑器内退出按钮确认保存。
- **当前 DBX 的最近文件仅限本次会话**：未保存的编辑不会自动持久化，详见上面的存储说明。
- **外部链接无法直接打开浏览器**：帮助链接提供官方地址和复制按钮；快捷键表可本地查看。
- **云端集成和依赖联网的功能不可用**：本插件不声称完全覆盖 draw.io 网页版所有功能。
- **快捷键表是上游静态图片**：表内说明了 macOS 的按键替换规则；实际快捷键和菜单文字会适配系统。

## 致谢与许可证

本插件基于 [draw.io](https://github.com/jgraph/drawio)、
[MathJax](https://github.com/mathjax/MathJax) 和 [Vue](https://github.com/vuejs/core)。

集成代码采用 [Apache-2.0](LICENSE)。内置软件、图形与图标资源保留各自的许可证及限制，
详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安装包的 `ui/` 目录中
同时附带第三方说明和相关许可文本。

这是独立开发的 DBX 插件，不是 draw.io/JGraph 官方产品，也不代表这些项目的官方背书。
