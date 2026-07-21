# 贡献指南

## 开始前

1. Fork 或克隆仓库；
2. 使用 Bun 安装依赖：`bun install`；
3. 使用 `bun run tauri dev` 启动桌面开发环境。

## 提交前检查

```powershell
bun run build
Set-Location src-tauri
cargo fmt --check
cargo test
```

## 提交原则

- 功能变更请保持范围小，并在 PR 中说明用户可见行为；
- 不要提交 `node_modules`、`dist`、`src-tauri/target` 或发布私钥；
- 涉及密码、更新签名、文件导入或全屏窗口时，请说明测试方式；
- 文案优先使用简体中文，代码符号和命令保持英文。