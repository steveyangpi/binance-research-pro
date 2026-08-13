# 架构

## 两个交付物

仓库生成两个独立版本的产物：

```text
Codex 插件（仓库根目录）
  ├─ 清单与 Skills
  └─ .mcp.json ──npx/stdin/stdout──> 私有 MCP npm 包
                                      ├─ Spot 与 USD-M HTTP Client
                                      ├─ 内存 + SQLite 响应缓存
                                      └─ DuckDB/Parquet 历史仓库
```

插件版本是 Codex cachebuster；MCP 包使用语义化版本。两者不要求相同。

## 运行流程

1. Codex 加载 `.codex-plugin/plugin.json` 并发现四个 Skills。
2. `.mcp.json` 通过 `npx` 启动一个固定版本的私有包。
3. Codex 只转发 `env_vars` 中列出的可选环境变量。
4. MCP Server 通过 stdio JSON-RPC 暴露公共市场与本地仓库工具。
5. Skills 选择工具、解释结果，并执行研究与风险边界。

运行时不需要源码路径。npm/GitHub Packages 身份验证由宿主机管理，不写入插件。

## 数据层

- 实时市场层：Binance 公共 Spot 与 USD-M REST 端点。
- 短期缓存：合并并发请求并应用短 TTL。
- 持久缓存：便携数据目录下的可选 SQLite 缓存。
- 历史仓库：DuckDB 元数据与分区 Parquet；导入源必须位于允许的本地根目录或通过 HTTPS 校验。

## 信任边界

- Binance 响应属于不可信网络输入，必须经过 Schema 校验。
- Binance 端点覆盖值必须使用 HTTPS。
- 远程仓库下载拒绝 URL 凭据、非公网目标与超限响应，并重新检查重定向。
- 本地导入需在真实路径和文件系统链接解析后仍位于允许根目录。
- ZIP 条目与大小在提交元数据前校验。

当前 DNS 校验和 HTTP 连接是两个操作，理论上仍有 DNS rebinding 窗口。高安全部署应只使用可信 HTTPS 导入主机，并配合网络出口限制。
