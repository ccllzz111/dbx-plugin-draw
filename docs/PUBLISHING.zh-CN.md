# 发布与 DBX 插件中心提交

仓库：https://github.com/ccllzz111/dbx-plugin-draw

## 首次发布

1. 使用 Node.js 22+，执行 `npm ci`、`npm run check`、`npm test`、`npm run build`。
   draw.io 资源已纳入 Git，并在构建前校验 SHA-256；MathJax 由锁定的 npm 依赖生成。
2. 推送准备好的源码分支到 GitHub。CI 在 macOS、Windows、Linux 检查、测试、构建；
   构建通过不等于各系统的 DBX 实机兼容性验收。
3. 确认 `manifest.json`、`package.json`、`package-lock.json` 版本一致。
4. 创建并推送 `v0.3.21` 标签，在 GitHub Releases 发布同名 Release。
5. `Release DBX plugin` 工作流从该标签构建，上传未签名的 universal `.dbxp`、
   `.artifact.json`、`release-candidates.json`、`dbx-store-submission.zip`。
   工作流不会覆盖已存在的同名附件；修改安装包内容应发布新版本。

## 商店 PR

1. Fork https://github.com/t8y2/dbx-store ，从 main 创建提交分支。
2. 下载该 Release 的 `dbx-store-submission.zip`，解压至商店仓库根目录。
   首次提交包含 `publishers/ccllzz111.json` 和
   `candidates/com.cailiangzhou.dbx-draw.json`。以后更新不覆盖已审核的 publisher 记录。
3. 提交 PR 到 `t8y2/dbx-store:main`，允许维护者编辑分支。
   可使用本目录 `STORE_PR.md` 填写说明。
4. 执行 `node scripts/validate.mjs`。若只有
   `open candidate(s) awaiting DBX Store signing`，表示等待官方审核签名。
   其他错误需修复。不要手动编辑 plugins/ 或 catalog/index.json。
5. 维护者审核后签名并更新同一个 PR，CI 通过后合并，上架插件中心。

签名由 DBX Store 管理。不要购买或上传操作系统证书，不需要作者私钥。
不要把 .dbxp 安装包提交到商店 Git 仓库；安装包仅作为 Release 附件。

本地也可用固定 CLI 打包并生成提交材料：

```bash
npm run build
npx --yes @dbx-app/plugin-cli@0.1.9 package .
npm run release:metadata
```

正式提交使用 **CI 发布的安装包及对应元数据**；本地打包字节可能与 CI 不同，
不能混用哈希。保留既有插件 ID `com.cailiangzhou.dbx-draw`；首次上架 publisher
设为当前 GitHub 账号 `ccllzz111`。该身份应在官方审核后保持稳定。

官方规范：https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md
