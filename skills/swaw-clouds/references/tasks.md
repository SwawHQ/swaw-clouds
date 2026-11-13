# 维护约定

命令对应 tasks/<command>/entry.mjs；每个命令和上级分类有中英 help.json。测试放在对应任务的 _tests/。
复用 _shared 中的安装、路径、进程和凭据工具。各 CLI 在自己的目录固定依赖和锁文件。
技能必须自包含，不引用仓库根目录或其他技能的实现。临时测试文件放系统临时目录 swaw/clouds/<task>/，只清理本任务创建的文件。
新增平台时保留原生 CLI 的工作目录、身份选择和退出码语义；不要把一种平台的规则套用到另一平台。

测试按被测功能归属：auth 管公共授权页，cloudflare、tencent 和 edgeone 管平台行为，_shared 管公共凭据、路径和进程，help 管命令帮助。
同一技能内复用实际共用的夹具；其他仓库需要时复制，禁止跨仓库导入或符号链接。模拟站点目录只用于验证调用目录隔离，不依赖 Banyan。

普通测试使用 *.test.mjs；浏览器测试使用 *.browser.test.mjs；需要已安装官方 CLI 的测试使用 *.native.test.mjs。测试不部署云资源。原生 tccli 测试使用本地 TLS 服务或模拟 STS 响应；依赖缺失时会跳过，完整验收前先准备依赖。

在仓库根目录运行：

```powershell
$localTests = @(Get-ChildItem skills/swaw-clouds/tasks -Recurse -Filter *.test.mjs | Where-Object Name -NotMatch '\.(browser|native)\.test\.mjs$' | Select-Object -ExpandProperty FullName)
.\skills\swaw-clouds\swcl.cmd base/node --test @localTests  #本地测试
.\skills\swaw-clouds\swcl.cmd base/node --test "skills/swaw-clouds/tasks/**/*.browser.test.mjs"  #浏览器测试
.\skills\swaw-clouds\swcl.cmd base/node --test "skills/swaw-clouds/tasks/**/*.native.test.mjs"   #原生 CLI 测试
.\skills\swaw-clouds\swcl.cmd base/node --test "skills/swaw-clouds/tasks/**/*.test.mjs"          #完整回归
```

`swcl dev/browser/ensure` 只准备授权页测试所需的 Chromium；普通授权操作不依赖 Playwright。

uv/Python 通用测试放在 `base/uv/_tests/`。原生测试使用 `CLOUDS_TEST_UV`（uv.exe）、`CLOUDS_TEST_PYTHON_DIR`（uv 管理的 Python 安装根目录）和 `CLOUDS_TEST_UV_ARCHIVE`（固定版本 ZIP，旁边需有 LICENSE-MIT、LICENSE-APACHE）。缺少输入时对应测试跳过；验收时须提供全部输入。wheel 夹具由测试本地生成，不下载 Python 包。
