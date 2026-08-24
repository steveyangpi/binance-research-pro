# 可移植 MCP 运行时

两个插件适配层都启动同一个不可变私有包，而不是仓库文件：

```json
{
  "command": "npx",
  "args": [
    "-y",
    "--package=@steveyangpi/binance-research-pro-mcp@0.4.5",
    "--",
    "binance-research-pro-mcp"
  ]
}
```

这使两个插件都不依赖盘符、checkout 位置和构建产物。每台宿主机都需要 Node/npm 与 GitHub Packages 身份验证。

配置值归宿主机所有。Codex 适配层使用 `.mcp.json` 及其 `env_vars` allowlist，转发自身进程环境中已有的可选值。Claude Code 适配层使用 `claude.mcp.json`，并继承宿主进程环境。两份配置都不写入变量值。建议只设置 `BINANCE_RESEARCH_DATA_DIR`，默认缓存与仓库路径都会由它推导。

精确包版本及其已发布的 `npm-shrinkwrap.json` 可防止未经审查的 registry 依赖更新改变插件行为。在 `RELEASING.zh-CN.md` 的阶段二中同时更新两个适配层。
