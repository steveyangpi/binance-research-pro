# 开发指南

## 初始化

```powershell
git clone https://github.com/steveyangpi/binance-research-pro.git
cd binance-research-pro
npm install
npm run check
```

需要 Node.js 22.13+、npm 和 Python 3。仓库根目录的 workspace lockfile 是唯一依赖锁定文件。

## 常用命令

```powershell
npm run dev:mcp
npm run test
npm run test:mcp
npm run test:mcp:live
npm run test:package
```

`test:mcp` 不访问 Binance，可重复运行；`test:mcp:live` 会调用配置的公共接口，不应作为离线 CI 的必需项。

## 修改规则

- MCP 实现在 `packages/mcp` 中维护。
- 工具名称、Schema 或语义变化时，同步更新 Skills 与 smoke tests。
- Codex 清单变更后，重装前需要提升 cachebuster；Claude Code 清单变更后，重新加载前需要运行插件校验。
- 不要提交机器路径、访问令牌或含凭据的 `.npmrc`。
- `dist`、缓存、历史仓库数据和本地环境文件不得进入 Git。

## 本地插件开发

Codex Personal Marketplace 源和 Claude Code 本地插件目录都可指向本仓库根目录。两个适配层分别通过 `.mcp.json` 和 `claude.mcp.json` 启动同一个已发布私有包；调试未发布 MCP 源码时使用 `npm run dev:mcp`。插件修改后遵循 `docs/INSTALLATION.zh-CN.md` 中的客户端专用重载步骤，并在加载 Claude Code 适配层前运行 `npm run check:claude-plugin`。
