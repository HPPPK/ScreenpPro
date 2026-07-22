# Windows 发布与自动更新

ScreenPro 使用 Tauri Updater 和 GitHub Releases 为 Windows 提供签名验证后的应用内更新。

## 当前发布范围

- **自动发布**：Windows x64，NSIS 安装包；
- **暂不自动发布**：macOS。请在 macOS 设备上完成 Apple 签名、公证和发布配置后再启用；
- **更新源**：`https://github.com/HPPPK/ScreenpPro/releases/latest/download/latest.json`。

## 发布密钥

更新包由 Tauri signing key 签名。对应私钥保存在发布者本机：

```text
%LOCALAPPDATA%\ScreenPro\release-signing\screenpro.key
```

**绝不能**将该文件提交到 Git、上传到 Release 或发送给他人。若私钥丢失，已安装的应用将无法验证后续版本。

仓库已配置以下 GitHub Actions Secret：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 用于生成 Windows 更新包签名及 `.sig` 文件。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 用于解密发布私钥；与私钥一起保存在 GitHub Actions Secret 中。 |

若更换密钥，必须同时更新 `src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey`，否则旧版客户端不能接收新签名版本。

## 发布新版本

1. 将以下三个版本同步更新为相同值：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. 在 Windows 本地验证：

   ```powershell
   bun run build
   Set-Location src-tauri
   cargo test
   Set-Location ..
   bun run tauri build --bundles nsis
   ```

3. 提交、推送并创建 tag：

   ```powershell
   git add --all
   git commit -m "Release v0.1.7"
   git push origin main
   git tag v0.1.7
   git push origin v0.1.7
   ```

4. 在 GitHub Actions 查看 **Release ScreenPro** 工作流；成功后，GitHub Release 会包含：
   - `ScreenPro_<version>_x64-setup.exe`
   - 签名文件（`.sig`）
   - `latest.json` 更新清单。

## 首次发布故障排查

### `Downloading wix314-binaries.zip` 后退出 255

这表示 Tauri 已成功构建应用二进制，但在下载 WiX（MSI 打包工具）时网络失败。ScreenPro 的 Windows 发布工作流和本地发布命令均使用：

```powershell
bun run tauri build --bundles nsis
```

NSIS 不依赖 WiX，因此不会触发该下载。

### “检查更新”提示暂时无法连接

确认以下项目：

1. GitHub Release 是已发布状态，不是 Draft；
2. Release 包含 `latest.json` 和相应签名文件；
3. 应用版本低于 Release 中的版本；
4. `src-tauri/tauri.conf.json` 更新端点仍为 `HPPPK/ScreenpPro`。

## macOS 后续工作

在 macOS 设备准备完成后，再新增 macOS 工作流、Apple Developer 签名证书和 notarization 配置。不要复用 Windows 的 NSIS 参数。