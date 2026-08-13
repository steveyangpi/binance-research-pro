# 发布指南

MCP 私有包与 Codex 插件分两个阶段发布，因为插件必须始终引用一个可安装的包。

## 阶段一：发布 MCP 包

1. 在 `packages/mcp/package.json` 选择新的语义化版本。GitHub Packages 版本不可复用。
2. 同步修改实现、测试、Skills、面向变更的文档和包 README。
3. 运行：

```powershell
npm ci
npm run release:check
```

4. 检查 `npm pack --workspace packages/mcp --dry-run`，确保不含凭据、运行数据或仅属于 monorepo 的文件。
5. 运行 GitHub Actions 中手动的 **Publish private MCP package** 工作流，或在已授权环境运行：

```powershell
npm publish --workspace packages/mcp
```

6. 在干净环境配置 GitHub Packages 身份验证，启动刚发布的准确版本。

此时 `.mcp.json` 仍可固定旧包，这是预期行为，可保证发布期间已安装插件继续工作。

## 阶段二：发布插件

1. 把 `.mcp.json` 的 `--package` 更新为已验证的新版本。
2. 同步更新展示当前固定版本的安装示例。
3. 提升 `.codex-plugin/plugin.json` 的 `version`，作为 cachebuster。
4. 运行：

```powershell
npm run plugin:release-check
```

5. 使用 Codex 开发 cachebuster/reinstall 流程从 Personal marketplace 重装。
6. 完全重启 Codex，测试 Spot、Futures、仓库状态以及“不支持交易”边界。

## 回滚

将 `.mcp.json` 改回上一个已知正常的不可变包版本，再次提升插件 cachebuster，完成校验并重装。正常回滚不应覆盖或撤销已发布版本。
