# GitHub Releases 更新与发布

ScreenPro 使用 Tauri Updater 从 GitHub Releases 下载更新清单。应用仅安装由发布私钥签名、并由内置公钥验证通过的更新包。

## 首次仓库配置

1. 将 GitHub Releases 更新端点已配置为 `HPPPK/ScreenpPro`。
2. 在仓库的 GitHub Actions secrets 中设置：
   - `TAURI_SIGNING_PRIVATE_KEY`：本机发布密钥文件的完整内容。
3. 发布密钥存放在当前 Windows 用户的本地目录：`%LOCALAPPDATA%\ScreenPro\release-signing\screenpro.key`。不要提交、分享或删除它。
4. 推送形如 `v0.1.1` 的 Git tag，即可触发发布工作流。

## 发布版本

```powershell
bun install --frozen-lockfile
git tag v0.1.1
git push origin v0.1.1
```

工作流会为 Windows（NSIS，避免首次下载 WiX 时的 MSI 问题）和 macOS 构建安装包、生成签名，并将 `latest.json` 与更新资产发布到 GitHub Release。已安装的 ScreenPro 可在“设置 → GitHub Releases”中检查并安装更新。
