# MCP 接入与排障

[English](CONNECTING.md)

## 前置条件

- Node.js 22.13 或更高版本。
- npm/npx 可用，且首次安装时可以访问 npm 注册表。
- 能访问 Binance 公共 Spot 与 USDⓈ-M Futures API。
- Codex Desktop/CLI/IDE，或其他支持本地 stdio MCP 的客户端。

## 推荐：固定 npm 版本启动

插件与跨机器部署使用固定版本，避免依赖源码仓库的绝对路径：

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.3.2 -- binance-research-pro-mcp
```

首次启动由 npx 下载并缓存私有包；请先配置 `@steveyangpi` GitHub Packages 注册表和身份验证。后续启动复用 npm 缓存，升级必须显式修改版本号并重新验证。

Codex CLI 可注册为独立 MCP：

```powershell
codex mcp add binance-research-pro -- npx -y --package=@steveyangpi/binance-research-pro-mcp@0.3.2 -- binance-research-pro-mcp
codex mcp list
```

安装 `Binance Research Pro` 插件时不需要再注册独立 MCP，因为插件自己的 `.mcp.json` 会启动同一服务。

用户级 `~/.codex/config.toml` 示例：

```toml
[mcp_servers.binance-research-pro]
command = "npx"
args = ["-y", "--package=@steveyangpi/binance-research-pro-mcp@0.3.2", "--", "binance-research-pro-mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 30
enabled = true
```

若要把全部运行数据放到自选磁盘，只加一个环境变量：

```toml
[mcp_servers.binance-research-pro.env]
BINANCE_RESEARCH_DATA_DIR = "D:\\BinanceResearchPro"
```

可选只读账户研究通过 `BINANCE_ACCOUNT_PROFILES_PATH` 引用仓库外受保护的 Ed25519 Profile 文件。请按照[账户访问指南](https://github.com/steveyangpi/binance-research-pro/blob/main/docs/ACCOUNT-ACCESS.zh-CN.md)配置；不要把凭据值直接写入 MCP 配置。

Codex Desktop、CLI 和 IDE 扩展共享 Codex MCP 配置。修改后新建任务或重启客户端，让它启动新进程。官方参考：[OpenAI Codex MCP 文档](https://developers.openai.com/codex/mcp/)。

## 其他 stdio MCP 客户端

```json
{
  "mcpServers": {
    "binance-research-pro": {
      "command": "npx",
      "args": [
        "-y",
        "--package=@steveyangpi/binance-research-pro-mcp@0.3.2",
        "--",
        "binance-research-pro-mcp"
      ],
      "env": {
        "BINANCE_RESEARCH_DATA_DIR": "D:\\BinanceResearchPro"
      }
    }
  }
}
```

`env` 整段可省略，此时服务自动使用当前系统的用户应用数据目录。具体配置文件位置由客户端决定。

## 从源码开发和验证

```powershell
cd <binance-research-pro 仓库目录>
npm install
npm run check
npm run test:package
```

- `test:mcp` 从当前 `dist` 启动真实 MCP 客户端，验证 initialize、工具清单和仓库状态。
- `test:package` 执行 `npm pack`，在临时消费者项目中安装 tarball，再从安装包启动并握手；这是发布前必须通过的检查。
- 发布工作流会独立安装精确的 GitHub Packages 制品，清除 registry 凭据，再通过已安装 CLI 的绝对路径完成握手。
- `test:mcp:live` 额外访问 Binance 公共接口。

## 验证请求

1. `调用 market_overview，symbol=BTCUSDT。`
2. `调用 analyze_futures，symbol=BTCUSDT，interval=1h，limit=200。`
3. `调用 warehouse_status，返回 dataDirectory、Parquet 根目录和已导入文件数。`
4. `调用 account_profiles_status，只报告已配置的 Profile ID 和允许的市场范围。`

`warehouse_status.dataDirectory` 应等于显式配置的目录，或系统默认目录。

## 常见问题

| 现象                 | 检查方式                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| 首次启动超时         | 确认 npm 注册表可访问，将 `startup_timeout_sec` 提高到 60 秒后重试。          |
| 客户端没有列出工具   | 直接运行固定版本命令检查安装错误，然后重启客户端。                            |
| Windows 找不到 `npx` | 确认 Node.js 安装目录在 PATH；必要时在客户端中配置 `npx.cmd`。                |
| Binance 请求超时/429 | 检查网络和区域可用性，降低调用频率或提高缓存 TTL。                            |
| 本地导入被拒绝       | 调用 `warehouse_status` 查看 `importRoots`，只从这些目录导入。                |
| 需要离线启动         | 先在线执行一次固定版本命令填充 npm 缓存；完全离线环境应使用私有镜像或预装包。 |

## 安全边界

公共市场工具不需要凭据。可选账户工具只接受外部配置的 Ed25519 USER_DATA Profile，并保持只读。服务不提供下单、撤单、杠杆调整、转账或提现工具。不要把凭据值或私有账户响应放进 MCP 配置、日志、截图、源码或 CI。
