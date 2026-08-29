# 安装与维护

## 1. 配置 npm 身份验证

两个插件都会下载私有 GitHub Packages 制品。请在每台宿主机配置身份验证，不要提交 Token：

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
```

用户名填写 GitHub 用户名，密码使用带 `read:packages` 权限的 classic PAT；因为包是私有的，账号还需具备仓库读取权限。验证两个插件适配层固定的包：

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.4.5 -- binance-research-pro-mcp
```

该命令是 stdio Server，通常会静默等待 JSON-RPC 输入；使用 Ctrl+C 停止。

## 2. 安装 Codex 插件

对于 Personal marketplace，使插件源解析到：

```text
C:\Users\<you>\plugins\binance-research-pro
```

该目录可以是指向本仓库根目录的 junction。通过 Codex 插件开发流程把它注册到 Personal marketplace，安装 `binance-research-pro`，然后完全重启 Codex 并新建 task。

## 3. 本地加载 Claude Code 插件

以仓库根目录作为插件目录，使 Claude Code 能读取 `.claude-plugin/plugin.json`、共享的 `skills/` 目录和 `claude.mcp.json`：

```powershell
claude --plugin-dir .\
```

使用前验证同一目录：

```powershell
npm run check:claude-plugin
```

### 通过 Claude Code Marketplace 安装

仓库提供 `.claude-plugin/marketplace.json`，使插件可以从 GitHub Marketplace 发现并安装，而不必使用本地路径：

```powershell
claude plugin marketplace add steveyangpi/binance-research-pro
claude plugin install binance-research-pro@binance-research-pro-marketplace
```

Marketplace 指向本仓库根目录，因此安装的插件使用相同的 `.claude-plugin/plugin.json`、`skills/` 和 `claude.mcp.json`。由于 MCP Server 是私有 GitHub Packages 制品，每台宿主机仍需完成第 1 节的 npm 注册表身份验证。

不要把 `packages/mcp` 注册为插件源。清单和客户端专用 MCP 适配层均位于仓库根目录。

## 4. 配置可选宿主状态

配置值始终由宿主机持有。Codex 转发 `.mcp.json` 中声明的可选变量名；Claude Code 通过 `claude.mcp.json` 继承宿主进程环境。两份文件都不保存变量值。例如：

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  'D:\marketData',
  'User'
)
```

修改变量后重启正在使用的客户端。全部配置见 `packages/mcp/docs/ENVIRONMENT.zh-CN.md`。

可选账户研究使用 `BINANCE_ACCOUNT_PROFILES_PATH` 和仓库外受保护的 Ed25519 Profile 文件。绝不能把其值写入本仓库。请遵循 `ACCOUNT-ACCESS.zh-CN.md`，配置后重启正在使用的客户端。

## 5. 验收检查

- 请求当前 Spot 对比；
- 请求 USD-M funding/basis 摘要；
- 查看本地 warehouse 状态；
- 调用 `account_profiles_status`；除非已特意配置受保护的 Profile，否则应报告未配置；
- 确认不存在下单、撤单、调整杠杆、转账或提现工具。

只有在这些检查通过后，才移除旧的独立 `binance-analysis` user MCP 条目，否则工具可能重复出现。

## 更新

不要修改已安装插件缓存内的文件。更新此源码仓库并运行校验，发布并验证引用的 MCP 包，然后在阶段二同时更新两个插件适配层。完整顺序见 `RELEASING.zh-CN.md`。
