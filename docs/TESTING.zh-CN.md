# 测试

## 必需质量门

在 monorepo 根目录运行：

```powershell
npm ci
npm run check
npm run test:package
```

检查内容包括仓库格式、ESLint、TypeScript、单元测试、可重复的 MCP 握手、所有已暴露工具的 Schema 与安全 annotations、canonical Skill 到 tool 的引用、插件结构、普通发布状态校验、tarball 内容、隔离安装，以及通过已安装 CLI 启动后的握手。

## 可选实时测试

```powershell
npm run test:mcp:live
```

该命令会访问 Binance 公共端点。报告失败时应记录端点、时间和区域/网络限制。离线 CI 不运行它。

认证实时测试必须单独手动执行，并使用仓库外新建的只读 Ed25519 Profile。不得把凭据文件或值放入 CI。先调用 `account_profiles_status`，再只调用 Profile 声明市场对应的读取工具。

## 插件验收

- 单标的和多标的 Spot 请求选择正确工具。
- 多周期分析按周期展示证据。
- Futures 输出区分标记/指数价格、基差、资金费率、持仓量与趋势。
- 历史研究在查询或导入前检查仓库覆盖范围。
- 导入被视为状态修改，必须指定明确来源。
- 响应说明数据新鲜度与限制。
- 未配置凭据时账户工具仍可发现，并安全报告未配置状态。
- 已配置账户读取选择正确 Profile，私有响应不会进入缓存。
- 交易、撤单、调整杠杆、转账和提现请求明确报告为不支持。

第二阶段发布前还必须运行 `npm run plugin:release-check`，证明 `.mcp.json` 已固定到当前源码包版本。
