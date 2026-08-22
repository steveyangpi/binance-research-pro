# Binance Research Pro

[English](README.md)

Binance Research Pro 是一个私有 monorepo，包含共同演进的交付物：

- 仓库根目录中的 Codex 与 Claude Code 插件适配层；
- `packages/mcp` 中可发布的 `@steveyangpi/binance-research-pro-mcp` stdio Server。

项目研究 Binance Spot 与 USDⓈ-M Futures 公共市场数据，提供可选的本地 DuckDB/Parquet 历史仓库，并可选择启用隔离的 Ed25519 `USER_DATA` Profile 进行只读账户研究。项目不提供下单、调整杠杆、转账或提现能力。

## 为什么合并仓库

插件 Skills、MCP 工具 Schema、测试和文档需要同步变化。放在一个仓库后，一次审查就能发现不兼容修改，CI 也能同时验证两个交付物。运行时仍然解耦：插件启动 GitHub Packages 中的固定私有版本，不依赖源码目录。

## 目录结构

```text
.codex-plugin/plugin.json       Codex 插件清单
.claude-plugin/plugin.json      Claude Code 插件清单
.mcp.json                       Codex MCP 启动配置
claude.mcp.json                 Claude Code MCP 启动配置
skills/                         共享的 Spot、衍生品、历史数据和风险工作流
packages/mcp/                   TypeScript MCP npm workspace
scripts/                        跨交付物校验
docs/                           架构、开发、发布与安全文档
.github/workflows/              CI 与私有包手动发布
```

## 环境要求

- Node.js 22.13 或更高版本，以及 npm。
- Python 3，用于无第三方依赖的插件校验器。
- 运行已安装插件时，需要 `@steveyangpi` GitHub Packages 读取权限。
- 实时研究需要能访问 Binance 公共端点。

公共研究不需要 Binance 凭据。可选账户读取使用仓库外受保护的 Profile 文件，详见[只读账户访问](docs/ACCOUNT-ACCESS.zh-CN.md)。不要把凭据粘贴到 ChatGPT、Codex、Claude Code、源码、日志或 Issue 中。

## 开发快速开始

```powershell
git clone https://github.com/steveyangpi/binance-research-pro.git
cd binance-research-pro
npm install
npm run check
npm run test:package
```

`npm run check` 会检查格式、Lint、TypeScript、单元测试、MCP 握手、插件结构以及分阶段发布状态。`npm run test:package` 会执行 `npm pack`，在隔离消费者项目中安装 tarball，再对安装后的包进行 MCP 握手。

真实 Binance 网络测试必须显式运行：

```powershell
npm run test:mcp:live
```

## 运行模型

Codex 适配层启动 [.mcp.json](.mcp.json) 中声明的固定私有包，并通过 `env_vars` 转发允许的可选变量名。Claude Code 适配层通过 [claude.mcp.json](claude.mcp.json) 启动同一包，并继承宿主机环境变量。两份配置都不保存变量值。

## 环境变量

公共端点和缓存设置均有安全默认值。通过宿主环境变量覆盖；插件配置不会保存变量值。

| 变量                               | 默认值                     | 用途                                  |
| ---------------------------------- | -------------------------- | ------------------------------------- |
| `BINANCE_RESEARCH_DATA_DIR`        | 当前系统用户数据目录       | 所有缓存与仓库状态的根目录。          |
| `BINANCE_REST_BASE_URL`            | `https://api.binance.com`  | Spot 公共 REST 根地址。               |
| `BINANCE_FUTURES_REST_BASE_URL`    | `https://fapi.binance.com` | USDⓈ-M Futures 公共 REST 根地址。     |
| `BINANCE_ACCOUNT_PROFILES_PATH`    | 未设置                     | 外部 Ed25519 USER_DATA Profile 文件。 |
| `BINANCE_CACHE_TTL_MS`             | `15000`                    | ticker、标记价格和盘口缓存时间。      |
| `BINANCE_CANDLE_CACHE_TTL_MS`      | `60000`                    | K 线缓存时间。                        |
| `BINANCE_PERSISTENT_CACHE_ENABLED` | `true`                     | 设为 `false` 时仅使用内存缓存。       |
| `WAREHOUSE_ENABLED`                | `true`                     | 设为 `false` 时隐藏仓库工具。         |

设置一个根目录即可整体迁移缓存和仓库状态，而无需写死机器路径：

```powershell
# Windows PowerShell：持久化到当前用户。
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  "$env:USERPROFILE\BinanceResearchProData",
  'User'
)
```

```sh
# macOS/Linux：仅应用于当前 shell。
export BINANCE_RESEARCH_DATA_DIR="$HOME/binance-research-pro-data"
```

修改宿主变量后必须完全重启正在使用的客户端。完整字段与高级路径覆盖见[环境变量参考](packages/mcp/docs/ENVIRONMENT.zh-CN.md)。

`BINANCE_ACCOUNT_PROFILES_PATH` 可以指向外部凭据文件，并声明多个隔离的 Spot 或 USDⓈ-M 只读 Profile。私有账户响应不会写入市场缓存或历史仓库。

## 修改与发布规则

1. 在 `packages/mcp` 修改 MCP 实现和测试。
2. 同一改动中更新受影响的 Skills 与文档。
3. 运行 `npm run release:check`。
4. 发布新的、不可覆盖的 MCP 包版本。
5. 在干净环境验证注册表版本。
6. 在两份 MCP 配置中固定该版本，更新两份插件清单，然后重装正在使用的插件。

不要让已安装插件重新指向仓库内的 `dist/index.js`。详见[开发指南](docs/DEVELOPMENT.zh-CN.md)、[发布指南](docs/RELEASING.zh-CN.md)、[架构](docs/ARCHITECTURE.md)和[安全边界](docs/SECURITY.md)。

## 研究边界

所有结果均为描述性市场研究，不构成个性化投资建议。使用前应核验数据时间、交易规则、区域可用性、流动性和波动风险。
