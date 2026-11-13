---
name: swaw-clouds
description: 准备、授权和调用 Cloudflare CLI、Wrangler、腾讯云 tccli 与 EdgeOne CLI，供 Agent 管理云资源和发布已有构建产物。
metadata:
  version: "0.1.0"
---

# Swaw Clouds

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
本技能发布已有产物；项目构建与检查由调用项目负责。

| 操作 | 参考 |
| --- | --- |
| Cloudflare 授权与命令 | [Cloudflare](references/cloudflare.md) |
| 腾讯云授权与命令 | [腾讯云](references/tencent.md) |
| EdgeOne 登录与部署 | [EdgeOne](references/edgeone.md) |
| Python 工具 | [Python](references/python.md) |
| 开发和测试 | [维护约定](references/tasks.md) |
