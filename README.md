# ScreenPro

ScreenPro is a Tauri 2 desktop MVP for Windows and macOS. It keeps background processes running while showing password-protected, full-screen overlay windows on all monitors.

## Included MVP

- Built-in offline templates and a local private library
- Blank project creation, clone-from-template, delete, active-project selection
- A canvas editor with drag-to-position **text**, **image**, and **clock** components
- Image import into the app-private data directory
- A local Argon2id-protected exit password and security-question reset flow
- Global shortcut for the active project plus up to nine library shortcuts
- Full-screen, always-on-top saver windows for all displays; unlock requires password

> This is an overlay screen saver, not a replacement for the operating system lock screen. System security shortcuts and force-quit controls remain under Windows/macOS control.

## Run

```powershell
bun install
bun run tauri dev
```

## Build

```powershell
bun run tauri build
```

## 更新

在应用的 **设置 → GitHub Releases** 中可检查、下载并安装签名验证通过的更新。发布流程请见 RELEASE.md。
