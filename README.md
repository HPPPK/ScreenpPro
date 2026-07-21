# ScreenPro

[![Release](https://img.shields.io/github/v/release/HPPPK/ScreenpPro?display_name=tag)](https://github.com/HPPPK/ScreenpPro/releases)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4)](https://github.com/HPPPK/ScreenpPro/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**ScreenPro** 是一款以 Windows 为当前发布平台的可自定义桌面屏幕保护应用；macOS 构建将在 macOS 电脑上单独完成。它以覆盖式全屏窗口保护屏幕，同时不终止下载、渲染、同步或其他后台程序。

> ScreenPro 的“覆盖式屏保”是应用级展示与隐私工具，不是 Windows/macOS 系统锁屏。它不能可靠阻止 `Alt + Tab`、任务管理器、系统安全快捷键、强制退出或具有本机权限的用户。需要真正锁定且不终止后台程序时，请使用应用内的“安全锁定 Windows”，由 Windows 账户密码解锁。

## 功能

- **私人屏保库**：从空白画布开始，或将内置模板下载到本地库后继续编辑。
- **离线资源库**：极简文字、照片展示、数字时钟、深色专注四个首发模板。
- **画布编辑器**：添加、选中、拖动、调整文字、图片、时钟组件。
- **图片托管**：导入图片后复制到应用私有目录，原始文件移动不会使项目失效。
- **全部显示器覆盖**：启动后为已连接显示器创建全屏、无边框、置顶窗口。
- **密码退出（覆盖式屏保）**：使用本机应用独立密码结束 ScreenPro 覆盖窗口；凭据采用 Argon2id 哈希保存，支持安全问题重设。
- **安全锁定 Windows**：调用 Windows 原生锁屏，后台程序不会被 ScreenPro 终止；使用 Windows 账户密码恢复。
- **全局快捷键**：启动当前屏保，或为最多 9 个私有作品分配专属快捷键。
- **GitHub Releases 更新**：设置页可检查、下载并验证由 ScreenPro 发布密钥签名的 Windows 更新包。

## 安装（Windows）

从 [Releases](https://github.com/HPPPK/ScreenpPro/releases) 下载最新的 `ScreenPro_*_x64-setup.exe`，运行安装程序后打开 ScreenPro。

首次启动需要设置：

1. 屏保退出密码；
2. 安全问题及答案。

之后可在 **资源库** 下载模板，或在 **我的库** 创建空白屏保。

## 使用

1. 在 **资源库** 选择模板并“下载到我的库”，或创建空白项目；
2. 在编辑器添加文字、图片、时钟，并拖动组件完成布局；
3. 在 **我的库** 将作品设为“当前屏保”；
4. 在工作台点击“立即启动”，或使用设置中的全局快捷键；
5. 在屏保窗口移动鼠标或按任意键，输入应用密码后退出。

### 常用快捷键

默认快捷键为 `Ctrl / Cmd + Alt / Option + Shift + S`。可在 **设置 → 启动快捷键** 修改；也可在 **设置 → 快捷键库** 为指定屏保设置专属快捷键。

## 开发

### 前置条件

- [Bun](https://bun.sh/)
- Rust stable toolchain
- Windows：WebView2 Runtime、NSIS（Tauri 会在需要时使用本机/缓存工具）
- macOS：Xcode Command Line Tools

### 本地启动

```powershell
bun install
bun run tauri dev
```

### 验证

```powershell
bun run build
Set-Location src-tauri
cargo fmt --check
cargo test
```

### 构建 Windows 安装包

```powershell
bun run tauri build --bundles nsis
```

产物位于：

```text
src-tauri/target/release/bundle/nsis/
```

我们使用 **NSIS** 打包 Windows 安装包，避免首次构建时下载 WiX/MSI 工具可能造成的网络等待问题。

## 自动更新与发布

Windows 发布由 GitHub Actions 自动完成。推送形如 `v0.1.1` 的 tag 后，会构建、签名并发布 Windows NSIS 安装包以及更新清单。

```powershell
# 更新 package.json、src-tauri/Cargo.toml、src-tauri/tauri.conf.json 中的版本号后：
git tag v0.1.2
git push origin v0.1.2
```

详细的签名密钥、安全边界和发布步骤请见 [RELEASE.md](RELEASE.md)。

### macOS

当前 GitHub Actions **仅发布 Windows**。macOS 构建与签名将在 macOS 设备上单独配置；相关开发步骤仍可在本项目执行。

## 项目结构

```text
src/                         React 桌面界面、画布编辑器与更新面板
src-tauri/src/lib.rs         本地数据、密码验证、图片导入、全屏窗口与命令
src-tauri/tauri.conf.json    桌面应用、签名公钥和更新端点配置
.github/workflows/release.yml Windows Release 自动发布工作流
```

## 安全说明

- 密码与安全问题答案仅保存为 **Argon2id 哈希**，不保存明文；
- 用户图片与项目数据保存在操作系统的应用数据目录，不写入安装目录；
- 更新客户端只接受匹配内置公钥的签名更新包；
- 覆盖式屏保不能替代系统锁屏，不能保证阻止 `Alt + Tab`、任务管理器或拥有本机管理员权限的用户；需要安全边界时使用“安全锁定 Windows”。

## 贡献与反馈

欢迎提交 Bug、功能建议与改进。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 的方式报告。