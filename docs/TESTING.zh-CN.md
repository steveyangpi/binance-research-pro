# 测试

## 必需质量门

在 monorepo 根目录运行：

```powershell
npm ci
npm run check
npm run test:package
```

检查内容包括仓库格式、ESLint、TypeScript、单元测试、可重复的 MCP 握手与工具 Schema、插件结构、分阶段发布状态、tarball 内容、隔离安装以及从安装包启动后的握手。

## 可选实时测试

```powershell
npm run test:mcp:live
```

该命令会访问 Binance 公共端点。报告失败时应记录端点、时间和区域/网络限制。离线 CI 不运行它。

## 插件验收

- 单标的和多标的 Spot 请求选择正确工具。
- 多周期分析按周期展示证据。
- Futures 输出区分标记/指数价格、基差、资金费率、持仓量与趋势。
- 历史研究在查询或导入前检查仓库覆盖范围。
- 导入被视为状态修改，必须指定明确来源。
- 响应说明数据新鲜度与限制。
- 账户与交易请求明确报告为不支持。

第二阶段发布前还必须运行 `npm run plugin:release-check`，证明 `.mcp.json` 已固定到当前源码包版本。
