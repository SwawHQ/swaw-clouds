# 开发约定

- 文档与回复使用简洁中文；help 每行一个命令及说明。
- skills/swaw-clouds 必须自包含。保留官方 CLI 参数、退出码及身份选择规则。
- 临时过程文件放系统临时目录 swaw/clouds/<task>/；只清理本任务文件，保留固定 CLI 目录和缓存。
- 测试就近放在任务的 _tests/；授权和进程边界的改动必须验证。
- 项目未发布，不保留旧命令兼容或自动迁移；不写 .git。
- Git 操作使用 PATH 中的 gitbw.cmd；先查看 gitbw.cmd .help。
