# 发布指南

Binance Research Pro 先发布私有 MCP 包，再发布固定该包版本的 Codex 与 Claude Code 插件适配层。push 和 pull request CI 仅执行验证；发布只能通过手动 **Publish private MCP package** 工作流（`workflow_dispatch`）进行。不得发布到 public npm 或公开 marketplace。

## 版本与 Git 合同

正式发布使用一个产品版本 `X.Y.Z`：

| 位置                               | 必须使用的值                                  |
| ---------------------------------- | --------------------------------------------- |
| 根 workspace 与 lockfile           | `X.Y.Z`                                       |
| MCP 包与 workspace lockfile 条目   | `X.Y.Z`                                       |
| Codex 与 Claude MCP 精确包固定版本 | `@steveyangpi/binance-research-pro-mcp@X.Y.Z` |
| Claude Code Plugin manifest        | `X.Y.Z`                                       |
| 当前安装和连接示例                 | 同一个精确固定版本                            |
| 最终 annotated Git tag             | `vX.Y.Z`                                      |
| Codex Plugin manifest              | `X.Y.Z+codex.YYYYMMDDHHmmss`                  |

14 位 Codex 后缀是 UTC 部署修订，不是另一套产品版本。开发期间只使用标准预发布版本，例如 `X.Y.Z-alpha.N`、`X.Y.Z-beta.N`、`X.Y.Z-rc.N`。在阶段二之前，源码版本可以领先两端已安装的 Plugin pin；绝不能让任一 MCP 配置指向未发布源码。

## 阶段一：发布并验证私有 MCP 包

1. 选择下一个 `X.Y.Z`，更新根 workspace 与 `packages/mcp` 包版本，并使用 npm 重新生成根 lockfile。同步更新实现、测试、canonical Skills、包 README，以及英文与简体中文文档。
2. 确认 `publishConfig` 仍指向 `https://npm.pkg.github.com` 且 `access: restricted`。不得加入凭据值、私有账户响应、运行数据、公开 registry 发布、交易、杠杆调整、转账或提现能力。
3. 运行：

```powershell
npm ci
npm run release:check
npm run test:package
npm pack --workspace packages/mcp --dry-run
```

4. 检查打包结果：不得包含 secrets、本地 warehouse/运行数据或仅属于 monorepo 的文件。
5. 在有 GitHub Packages 发布权限的环境中，运行手动 **Publish private MCP package** 工作流。GitHub Packages 版本不可变；预检必须拒绝已存在的版本。工作流先在 `packages: write` Job 中发布，再在独立的 `packages: read` Job 中验证精确 registry 制品。
6. 确认 `verify-published` Job 在禁用 lifecycle scripts 的隔离临时消费者目录中安装包、清除 registry 凭据，并成功启动已安装 CLI 的绝对路径。还可以在另一台干净、已认证的主机上验证与 `.mcp.json` 相同的命令形式：

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@X.Y.Z -- binance-research-pro-mcp
```

记录工作流中成功的 CLI/MCP stdio handshake 后才能继续。未通过该检查时，阶段二被阻断。

此时两份 MCP 配置仍可固定旧包。这是预期行为，可保证已安装 Plugin 在发布期间继续工作。

## 阶段二：发布两个插件适配层

1. 将 `.mcp.json` 和 `claude.mcp.json` 更新为已验证的精确包版本。
2. 将 `.claude-plugin/plugin.json` 设置为 `X.Y.Z`，将 `.codex-plugin/plugin.json` 设置为 `X.Y.Z+codex.YYYYMMDDHHmmss`，并使用新的 UTC Codex 部署修订。
3. 同步更新所有展示当前版本的英文与简体中文安装/连接示例。`npm run plugin:release-check` 会验证指定的当前固定版本。
4. 运行：

```powershell
npm run plugin:release-check
```

5. 从 Personal Marketplace 重装 Plugin，并从仓库根目录加载 Claude Code 插件。重启正在使用的客户端，并确认：
   - 公共 Spot 与 USD-M Futures 读取正常；
   - `account_profiles_status` 在未配置凭据时正常工作，并且只暴露脱敏后的 profile 元数据；
   - 账户读取仅使用本地 Ed25519 profile 手工验证，CI 中绝不保存凭据；
   - warehouse 状态/读取工具正常，而导入仍是需要显式来源的状态变更操作；
   - 不存在下单、撤单、杠杆调整、转账或提现能力；
   - 市场结论有时间戳，并区分实时数据与本地 warehouse；
   - MCP stdout 保持为干净的 JSON-RPC。
6. 提交完整的最终 release 状态。仅在此前检查和两个客户端验收全部通过后，才在该 commit 创建并验证不可变 annotated release tag：

```powershell
git tag -a vX.Y.Z -m "Binance Research Pro vX.Y.Z"
npm run check:final-release
git push origin main
git push origin vX.Y.Z
```

不得在包发布/验证前创建最终 tag，也不得用 Git tag 触发发布。

## 回滚

将两份 MCP 配置固定到上一个已知正常的不可变包，发布新的产品 patch 版本和 Codex 部署修订，完成验证并重装正在使用的插件。不要覆盖、撤销或复用已发布的 GitHub Packages 版本。
