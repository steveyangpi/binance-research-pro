# 发布指南

Binance Research Pro 先发布私有 MCP 包，再发布固定该包版本的 Codex 插件。push 和 pull request CI 仅执行验证；发布只能通过手动 **Publish private MCP package** 工作流（`workflow_dispatch`）进行。不得发布到 public npm 或公开 marketplace。

## 版本与 Git 合同

正式发布使用一个产品版本 `X.Y.Z`：

| 位置                             | 必须使用的值                                  |
| -------------------------------- | --------------------------------------------- |
| 根 workspace 与 lockfile         | `X.Y.Z`                                       |
| MCP 包与 workspace lockfile 条目 | `X.Y.Z`                                       |
| `.mcp.json` 精确包固定版本       | `@steveyangpi/binance-research-pro-mcp@X.Y.Z` |
| 当前安装和连接示例               | 同一个精确固定版本                            |
| 最终 annotated Git tag           | `vX.Y.Z`                                      |
| Codex Plugin manifest            | `X.Y.Z+codex.YYYYMMDDHHmmss`                  |

14 位 Codex 后缀是 UTC 部署修订，不是另一套产品版本。开发期间只使用标准预发布版本，例如 `X.Y.Z-alpha.N`、`X.Y.Z-beta.N`、`X.Y.Z-rc.N`。在阶段二之前，源码版本可以领先已安装的 Plugin pin；绝不能让 `.mcp.json` 指向未发布源码。

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
5. 在有 GitHub Packages 发布权限的环境中，运行手动 **Publish private MCP package** 工作流。GitHub Packages 版本不可变；预检必须拒绝已存在的版本。
6. 在干净、已认证的消费者环境中，使用与 `.mcp.json` 相同的命令形式安装并启动刚发布的精确版本：

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@X.Y.Z -- binance-research-pro-mcp
```

记录成功的 CLI/MCP stdio handshake 后才能继续。未通过该检查时，阶段二被阻断。

此时 `.mcp.json` 仍可固定旧包。这是预期行为，可保证已安装 Plugin 在发布期间继续工作。

## 阶段二：发布 Codex Plugin

1. 将 `.mcp.json` 更新为已验证的精确包版本。
2. 同步更新所有展示当前版本的英文与简体中文安装/连接示例。`npm run plugin:release-check` 会验证指定的当前固定版本。
3. 将 `.codex-plugin/plugin.json` 设置为 `X.Y.Z+codex.YYYYMMDDHHmmss`，使用新的 UTC 部署修订。
4. 运行：

```powershell
npm run plugin:release-check
```

5. 从 Personal Marketplace 重装 Plugin，完全重启 Codex，并确认：
   - 公共 Spot 与 USD-M Futures 读取正常；
   - `account_profiles_status` 在未配置凭据时正常工作，并且只暴露脱敏后的 profile 元数据；
   - 账户读取仅使用本地 Ed25519 profile 手工验证，CI 中绝不保存凭据；
   - warehouse 状态/读取工具正常，而导入仍是需要显式来源的状态变更操作；
   - 不存在下单、撤单、杠杆调整、转账或提现能力；
   - 市场结论有时间戳，并区分实时数据与本地 warehouse；
   - MCP stdout 保持为干净的 JSON-RPC。
6. 提交完整的最终 release 状态。仅在此前检查和 Codex 验收全部通过后，才在该 commit 创建并验证不可变 annotated release tag：

```powershell
git tag -a vX.Y.Z -m "Binance Research Pro vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

不得在包发布/验证前创建最终 tag，也不得用 Git tag 触发发布。

## 回滚

将 `.mcp.json` 固定到上一个已知正常的不可变包，发布新的产品 patch 版本和 Codex 部署修订，完成验证并重装。不要覆盖、撤销或复用已发布的 GitHub Packages 版本。
