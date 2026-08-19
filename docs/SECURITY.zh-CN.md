# 安全边界

## 产品范围

- 公共行情和本地历史研究不需要 Binance 凭据。
- 可选账户工具只接受仓库外的 Ed25519 Profile，且只能声明 `USER_DATA` 和 `spot`、`usd-m-futures` 只读市场。
- 本包不包含下单、撤单、调整杠杆、转账或提现请求路径。
- 不实现 HMAC。交易或其他状态修改能力必须作为独立产品重新进行安全审查。

## 供应链

- 插件固定到一个明确的私有 MCP 版本。
- GitHub Actions 仅通过手动工作流发布包；已发布包验证在独立的 `packages: read` Job 中运行。
- GitHub Packages 凭据只保存在本机 npm 配置或 CI Secret 中，不能进入仓库。
- Binance API Key、私钥、口令、Profile 文件、签名和私有响应不得进入仓库、CI、日志、fixture、snapshot、缓存或历史仓库。
- MCP 包与插件分阶段发布；未发布的源码版本不能写入 `.mcp.json`。

## 网络与存储

- 公共 Binance 端点覆盖值必须使用 HTTPS；签名账户请求还必须命中明确的 Binance origin allowlist，并在发送 API Key 前拒绝重定向。
- 私有 JSON 响应以无损方式保留长整型 ID 与十进制账户数据，不进行有损 JavaScript Number 转换。
- 网络响应经过 Schema 校验；只有公共市场数据可以进入响应缓存，私有账户响应只存在于当前请求内存中。
- Profile 选择会强制检查声明的市场范围；认证、权限和 IP 错误不会回退到其他 Profile。
- 远程历史导入只允许 HTTPS，拒绝 URL 凭据与非公网目标，重新检查重定向，并限制时间和字节数。
- 本地导入经路径与文件系统链接解析后，必须仍位于显式允许的根目录内。
- ZIP 条目、解压大小、行数和 SQL 标识符在提交元数据前均会校验。

当前 URL 防护在 `fetch` 前解析 DNS，理论上仍存在解析与连接之间的 DNS rebinding 窗口。高安全环境应在网络层只允许可信 Binance/导入域名，并在来源提供校验值时使用 SHA-256。

不要在公开 Issue 中提交 Token、本机敏感路径或可直接利用的证明。请私下向仓库所有者报告受影响版本、影响、复现步骤与建议缓解方式。
