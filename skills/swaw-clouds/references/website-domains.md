# 网站域名与访问验证

日常发布使用对应平台的部署帮助，核对部署版本和访问地址。首次接入正式域名、迁移域名或排查访问异常时，按涉及的项目选用下列检查。

## 接入与换绑

- 查明权威 DNS 服务商、托管平台、目标项目和环境。分别核对根域与 `www` 的记录、绑定和跳转。别名已有独立跳转且目的地保持有效时，保留该入口。
- 换绑前，从目标部署地址验证新版本，记录旧绑定、DNS 记录与 TTL、证书、协议开关和适用的安全策略。若平台要求先解绑，执行前说明释放期及恢复旧绑定的条件。
- 按平台为该域名分配的目标值核对 DNS。值相同时沿用原记录；需要修改时只处理相关记录，保留同名的邮件和验证记录。
- **EdgeOne Makers**：从项目的「域名管理」进入。「域名配置」管理生产或预览环境、HTTP/2 和 IPv6；「HTTPS 配置」管理证书、强制 HTTPS、HSTS 和 OCSP 装订。换绑后复核原开关。等平台分配 CNAME 后再申请或绑定证书。[自定义域名](https://cloud.tencent.com/document/product/1552/127404) · [域名 API 顺序与释放期](https://cloud.tencent.com/document/product/1552/140897)
- **Cloudflare Pages**：接入根域时，需将该域的权威名称服务器指向 Cloudflare，并在 Pages 项目中绑定根域。保留外部权威 DNS 时，可在 Pages 项目中绑定子域名，再为该子域名添加指向项目域名的 CNAME。若 `www` 仅用于跳转，可在 Cloudflare 域名层维护重定向，并为来源主机启用 DNS 代理。[自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/) · [www 跳转](https://developers.cloudflare.com/pages/how-to/www-redirect/)

## 访问验证

| 涉及的配置 | 从访客入口验证 |
| --- | --- |
| 正式项目与证书 | 通过正式域名访问 HTTPS，验证证书，并用本次发布独有的内容或资源指纹识别部署版本。 |
| 强制 HTTPS 或别名跳转 | 用带路径和查询参数的地址检查首个响应的状态码和 Location，再验证最终页面。 |
| HTTP/2 | 用支持 HTTP/2 的客户端检查实际协商的协议。 |
| IPv6 | 查询正式域名的公开 AAAA 记录，包括 CNAME 指向的目标。再从有 IPv6 出口的网络运行 `curl.exe --noproxy "*" -6 -I https://example.com/`（替换为正式域名），确认通过 IPv6 直连并收到 HTTPS 响应。 |
| HSTS 与 OCSP 装订 | 调整 HSTS 前检查 HTTPS 响应头及其配置来源，避免与站点交付规则重复。需要验证 OCSP 装订时，用支持该功能的客户端检查 TLS 握手中的装订响应。 |

向用户报告实际变化、与原配置的差异及未验事项。例如，控制台已开启 IPv6，但公共 DNS 尚未返回 AAAA 时，写明“开关已开启，端到端连接待验证”。
