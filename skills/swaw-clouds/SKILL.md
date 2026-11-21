---
name: swaw-clouds
description: 准备、授权和调用 Cloudflare CLI、Wrangler、腾讯云 tccli 与 EdgeOne CLI，供 Agent 管理云资源、发布已有产物及配置 Git 托管构建。
metadata:
  version: "0.1.0"
---

# Swaw Clouds

执行云端变更前，结合用户指令、已有项目关联和只读查询，确定平台、账号或工作空间、目标资源和环境。更新已有资源时核对名称与 ID；查不到目标时，先澄清再使用可能自动创建资源的命令。区分新建与更新、预览与生产，以及是否要切换正式流量。只有剩余歧义会改变操作对象或影响范围时才询问用户。

目前支持 Windows x64。使用本技能目录中的 `swcl.cmd`；在下列示例中简称 `swcl`。

```text
swcl help 2                      #列出命令
swcl auth/setup                  #打开共用授权页
swcl cloudflare/wrangler <参数>  #运行 Wrangler
swcl cloudflare/cli <参数>       #运行 Cloudflare CLI
swcl edgeone/cli <参数>          #运行 EdgeOne CLI
swcl tencent/cli <参数>          #运行腾讯云 CLI
```

命令按需准备固定版本工具。帮助元数据与安装检查不下载工具；原生命令保留原生参数、输出与退出码。
Cloudflare 和 tccli 使用系统临时目录中的固定 `swaw/clouds/<tool>/` 工作目录；文件和目录参数使用绝对路径，Wrangler 项目操作使用原生 `--cwd`。保留固定目录和缓存。
EdgeOne 保留调用目录、原生登录态及项目关联，使用 `swcl edgeone/cli login` 登录。共用授权页管理 Cloudflare、tccli 和 EdgeOne；也可用 `swcl edgeone/auth/setup` 直接打开 EdgeOne。
调用项目负责构建与检查，并提供产物或平台构建参数；本技能指导云端配置与发布。
部分常见部署方案整理在 `tasks/<平台>/deploy/<方案>/help.json` 中，供组合原生 CLI 时参考。用 `swcl help/zh <平台>/deploy` 查看已有方案；其他场景可按需求结合原生帮助和官方文档组织流程。

| 操作 | 参考 |
| --- | --- |
| Cloudflare 授权与命令 | [Cloudflare](references/cloudflare.md) |
| 腾讯云授权与命令 | [腾讯云](references/tencent.md) |
| EdgeOne 授权与项目查询 | [EdgeOne](references/edgeone.md) |
| 网站域名首次接入、换绑、修改 DNS 或验证 HTTPS、HTTP/2 和 IPv6 | [网站域名与访问验证](references/website-domains.md) |
| Python 工具 | [Python](references/python.md) |
| 开发和测试 | [维护约定](references/tasks.md) |
