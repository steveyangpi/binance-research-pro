# 可移植 MCP 运行方式

已安装插件启动不可变的私有包，而不是仓库文件：

```json
{
  "command": "npx",
  "args": [
    "-y",
    "--package=@steveyangpi/binance-research-pro-mcp@0.4.3",
    "--",
    "binance-research-pro-mcp"
  ]
}
```

因此插件不依赖盘符、源码位置和本地构建输出。每台机器只需 Node/npm 与 GitHub Packages 身份验证。

配置值归宿主机所有。`.mcp.json` 通过 `env_vars` 列出 Codex 可以从自身进程环境转发的可选变量，但不写入变量值。建议只设置 `BINANCE_RESEARCH_DATA_DIR`，默认缓存与仓库路径都会由它推导。

固定包版本可避免未经审查的注册表更新改变插件行为。更新该版本属于 `RELEASING.zh-CN.md` 中发布流程的第二阶段。
