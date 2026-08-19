# 只读账户访问

[English](ACCOUNT-ACCESS.md)

Binance Research Pro 可以选择性地通过 Ed25519 API Key 读取 Binance Spot 与 USDⓈ-M Futures 的 `USER_DATA`。公共行情和本地仓库工具仍然无需凭据。MCP 包不包含下单、撤单、调整杠杆、转账或提现 endpoint。

## 凭据边界

不要把 API Key、私钥或口令粘贴到 ChatGPT、Codex、源码、Issue 或 Shell 历史中。凭据一旦泄露，应先撤销再继续。

请创建专用的 Binance 只读 API Key，并保持 `TRADE`、转账和提现权限关闭。Binance 当前推荐 Ed25519，并已将 HMAC Key 标记为 deprecated。

私钥和账户 Profile 文件必须存放在仓库外，并使用操作系统文件权限保护。加密的 PKCS#8 PEM 可以引用独立的单行口令文件；口令文件也必须单独保护。

## 多 Profile 风险隔离

将 `BINANCE_ACCOUNT_PROFILES_PATH` 设置为外部 JSON 文件路径。一个文件最多可以声明 20 个隔离 Profile：

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "spot-read",
      "keyType": "ed25519",
      "apiKey": "SET_LOCALLY_DO_NOT_COMMIT",
      "privateKeyPath": "./spot-read-private.pem",
      "privateKeyPassphrasePath": "./spot-read-passphrase.txt",
      "surfaces": ["spot"],
      "permissions": ["USER_DATA"]
    },
    {
      "id": "futures-read",
      "keyType": "ed25519",
      "apiKey": "SET_LOCALLY_DO_NOT_COMMIT",
      "privateKeyPath": "./futures-read-private.pem",
      "surfaces": ["usd-m-futures"],
      "permissions": ["USER_DATA"]
    }
  ]
}
```

相对密钥路径以 Profile 文件所在目录为基准解析。配置只接受 `ed25519`、`USER_DATA`、`spot` 和 `usd-m-futures`。Profile 不能访问未声明的市场；多个 Profile 覆盖同一市场时，调用者必须明确传入 `profileId`。

Windows 配置示例：

```powershell
[Environment]::SetEnvironmentVariable(
  'BINANCE_ACCOUNT_PROFILES_PATH',
  'C:\Users\<you>\AppData\Local\BinanceResearchPro\credentials\account-profiles.json',
  'User'
)
```

修改转发环境变量后应完全退出并重启 ChatGPT/Codex Desktop，再新建聊天并调用 `account_profiles_status`。返回内容只包含 Profile ID、密钥类型、市场范围和声明的 `USER_DATA` 权限。

`BINANCE_ACCOUNT_RECV_WINDOW_MS` 默认是 `5000`，最大 `60000`。除非明确诊断网络延迟，否则应保持不超过 `5000`。发生 `-1021` 时仅同步一次服务器时间并重试一次；认证和权限错误不会自动切换其他 Profile。

## 可用读取工具

- `account_profiles_status`：本地脱敏配置状态。
- `spot_account_overview`：Spot 余额，默认省略零余额。
- `futures_positions`：USDⓈ-M 仓位风险，默认省略空仓。
- `futures_open_orders`：当前 USDⓈ-M 挂单。
- `futures_income_history`：已实现盈亏、资金费、手续费和其他收益记录。

私有响应经过 Schema 校验后只返回给当前 MCP 客户端，不会写入公共 SQLite 响应缓存或 DuckDB/Parquet 仓库。

参考 Binance 官方 [API Key 类型](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/api_key_types.md)和[签名请求安全说明](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#request-security)。
