# Swaw Clouds

面向 Agent 的多云 CLI 工具集。当前支持 Windows x64、Cloudflare CLI、Wrangler、腾讯云 tccli 和 EdgeOne CLI。

将整个 `skills/swaw-clouds/` 目录安装到项目的 `.agents/skills/swaw-clouds/`。保留目录内全部文件。

```powershell
.\.agents\skills\swaw-clouds\swcl.cmd help 2      #查看命令
.\.agents\skills\swaw-clouds\swcl.cmd auth/setup  #打开授权页
```

在本仓库中使用 `.\skills\swaw-clouds\swcl.cmd`。Agent 使用说明见 [SKILL.md](skills/swaw-clouds/SKILL.md)。

工具按需准备；凭据由本机系统或官方 CLI 管理。技能不包含站点构建逻辑。EdgeOne 使用官方 CLI 登录。

采用 MIT 许可证。

开发验证（在仓库根目录）：

```powershell
.\skills\swaw-clouds\swcl.cmd dev/browser/ensure  #准备授权页浏览器测试
.\skills\swaw-clouds\swcl.cmd tencent/cli/ensure   #准备 tccli 实测依赖
.\skills\swaw-clouds\swcl.cmd base/node --test "skills/swaw-clouds/tasks/**/*.test.mjs"  #运行测试
```

测试归属、夹具和分组运行见 [维护约定](skills/swaw-clouds/references/tasks.md)。
