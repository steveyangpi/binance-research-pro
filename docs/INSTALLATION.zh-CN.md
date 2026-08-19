# 安装与维护

## 1. 配置 npm 身份验证

插件会下载 GitHub Packages 中的私有包。每台机器分别配置，不要把 Token 提交到仓库：

```powershell
npm config set @steveyangpi:registry https://npm.pkg.github.com
npm login --scope=@steveyangpi --auth-type=legacy --registry=https://npm.pkg.github.com
```

用户名填写 GitHub 用户名，密码使用带 `read:packages` 权限的 classic PAT；因为包是私有的，账号还需具备仓库读取权限。验证 `.mcp.json` 当前固定的包：

```powershell
npx -y --package=@steveyangpi/binance-research-pro-mcp@0.3.2 -- binance-research-pro-mcp
```

这是 stdio Server，正常情况下会静默等待 JSON-RPC 输入，可按 Ctrl+C 停止。

## 2. 注册并安装插件

Personal marketplace 的插件源码应解析到：

```text
C:\Users\<用户名>\plugins\binance-research-pro
```

该目录可以是指向本仓库根目录的 junction。通过 Codex 插件开发流程把它注册到 Personal marketplace，安装 `binance-research-pro`，然后完全重启 Codex 并新建 task。

不要把 `packages/mcp` 注册为插件源，插件清单位于仓库根目录。

## 3. 配置可选的本机状态

`.mcp.json` 只声明允许转发的变量名，不保存变量值。例如：

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_RESEARCH_DATA_DIR',
  'D:\marketData',
  'User'
)
```

修改变量后完全重启 Codex。全部配置见 `packages/mcp/docs/ENVIRONMENT.zh-CN.md`。

可选账户研究通过 `BINANCE_ACCOUNT_PROFILES_PATH` 指向仓库外受保护的 Ed25519 Profile 文件。不要把其中内容写入本仓库。按照 `ACCOUNT-ACCESS.zh-CN.md` 配置后完全重启应用。

## 4. 验收

- 查询实时 Spot 市场比较；
- 查询 USD-M 资金费率与基差；
- 检查本地历史仓库状态；
- 调用 `account_profiles_status`；除非已主动添加受保护 Profile，否则应报告未配置；
- 确认不存在下单、撤单、调整杠杆、转账或提现工具。

以上通过后再删除旧的独立 `binance-analysis` 用户 MCP 配置，否则工具可能重复出现。

## 更新

不要直接修改安装缓存。应修改本源码仓库、完成校验、提升插件 cachebuster，并在新 MCP 私有包发布后从 Personal marketplace 重装。准确顺序见 `RELEASING.zh-CN.md`。
