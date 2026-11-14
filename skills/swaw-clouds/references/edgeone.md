# EdgeOne CLI

通过 swcl edgeone/cli 调用固定版本的官方 edgeone 包。保留原生参数、输出、退出码和调用目录；登录态由官方 CLI 管理。

在目标项目目录执行：

```text
swcl edgeone/cli login                                #浏览器登录
swcl edgeone/cli whoami                               #查看当前身份
swcl edgeone/cli --help                               #查看原生命令
```

先检查当前版本的原生帮助，再使用工作区、项目和环境变量命令。明确目标项目、站点和部署环境；默认部署环境可能为 production。产物上传和平台构建分别见[上传方案](../tasks/edgeone/deploy/upload/help.json)与 [Git 构建方案](../tasks/edgeone/deploy/git/help.json)。

Makers API Token 与腾讯云 SecretId/SecretKey 不同。使用原生登录、`EDGEONE_PAGES_API_TOKEN` 环境变量或官方 Token 参数；共用授权页中选择 EdgeOne Makers，或运行 `swcl edgeone/auth/setup`。不要把 Token 写入文档、仓库或日志。

[官方 CLI 文档](https://pages.edgeone.ai/zh/document/edgeone-cli)

授权页的“API Token”验证所选 China/Global 站点的身份，再将 Token 和站点存入 Windows 凭据 `swcl/edgeone/default`。运行时注入子进程环境，不写入项目文件或原生登录文件。
显式 Token 参数和环境变量优先；保存的 Token 优先于原生凭据。登录、退出、切换账号及工作区管理不注入保存的 Token。
登录页使用原生 `whoami --json` 检查，排除环境变量 Token 和本工具保存的 Token；仍遵循当前目录的原生凭据选择，并显示可用的工作区名称和 ID。

登录授权页提供工作区下拉框；选中后点击“切换”才调用官方 `workspace use`。切换后重新读取列表和授权状态；未缓存的工作区可能要求重新登录。此选择不覆盖 Token 所属工作区或项目关联。

官方 CLI 默认在用户主目录 `~/.edgeone/` 保存登录信息。Swaw Clouds 不重定向该目录；同一系统用户安装的兼容版本 EdgeOne CLI 会共用这份登录信息。`--local` 写入的项目 `.edgeone/auth.json` 和环境变量可改变凭据选择。本管理页保存的 Token 位于独立 Windows 凭据项，不属于该原生目录。

## 查询云端项目

CLI 帮助只列出命令，不代表平台的全部能力。当前固定版本 1.7.2 没有独立的项目列表命令；列出项目可使用 [Makers SDK](https://pages.edgeone.ai/document/project-operations) 的 `projects.list` 或 `projects.listAll`，不需要先关联本地仓库。

本版本 CLI 内部使用 `DescribePagesProjects` 接口。直接调用前，核对当前版本的请求参数、分页和凭据选择；查询范围受凭据及工作区限制。优先参考公开 SDK 文档，不将 CLI 内部接口视为稳定契约。不要为了列出项目运行可能改变关联或创建项目的 `makers link`。
