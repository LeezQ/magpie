# StallionX 独立发布

## 产物与边界

`.github/workflows/release.yml`（**StallionX Release**）仅手动运行，不再
响应上游 `v*` 标签、不调用或复制 `yetone/magpie-releases`。
产物发布到运行工作流的**当前仓库**，不需要跨仓库 PAT。
如仓库私有，普通用户无法下载其 Release；要公开下载，需使用公开仓库。
本流程不会自动改变仓库可见性、建立仓库或推送代码。

每个版本有六个安装包和一个 `SHA256SUMS`：

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| macOS | arm64（Apple Silicon）、amd64（Intel） | 每种架构各有 DMG、ZIP |
| Windows | amd64（x64）、arm64 | 每种架构各有便携 ZIP |

未签名产物的文件名带 `-unsigned`，不能宣传为签名安装包。
Mac 签名模式同时完成 Developer ID 签名、公证和 stapling；缺少任何
凭据或 Apple 拒绝公证会直接失败，不会降级成未签名包。
Windows 当前是**未签名便携版**，不是 MSI/安装向导，可能触发 SmartScreen。
使用者需要 Windows 10+ 和 Microsoft Edge WebView2 Runtime。
Windows Authenticode/云签名须在选择证书服务后另行接入。

## 一次性设置（仓库管理员）

1. 确认发布仓库，例如现有 `fork` 对应的 `LeezQ/magpie`。
   `origin` 目前是上游，**不要把 StallionX 标签推到 origin**。
2. 将已审核的源码和此工作流提交到自己的 `main`。
   手动工作流只有进入默认分支后才会出现在 Actions。
3. 在 Settings → Environments 新建 `stallionx-release`，建议设置必要
   审批人，并只允许 `main` 部署。环境保护规则是否可用取决于仓库及套餐。
4. 若需要 Mac 正式签名，在该 Environment 配置下列 Secrets：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE_P12_BASE64` | Developer ID Application 证书与私钥导出的 P12，Base64 编码 |
| `APPLE_CERTIFICATE_PASSWORD` | P12 导出密码 |
| `APPLE_SIGNING_IDENTITY` | 完整 Developer ID Application 签名身份 |
| `APPLE_ID` | 用于公证的 Apple ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_APP_PASSWORD` | Apple ID 的 App 专用密码 |

证书和密码只写入 GitHub Secrets，不提交仓库、不粘贴到聊天。
未签名内测不需要这些 Secrets。工作流默认 `sign_macos=false`。
原有 Docker 发布代码保留，但限制在上游仓库运行，避免推送本 fork 时
自动发布 magpie 名称的镜像；桌面发布不依赖 Docker。

## 每次发布

先完成真机测试、服务端验证以及代码提交。工作流拒绝缺少标签、标签不在
main 历史中的版本；所有测试、构建、打包均固定同一个提交 SHA。
只接受 `X.Y.Z` 数字版本，例如 `0.1.0`。不要复用版本或移动已有发布标签。

下面是**需要管理员主动执行的操作**，配置脚本不会替你推送：

```bash
# 在自己的仓库 main 中，确认 HEAD 是要发布的已提交版本。
git status --short
git remote -v
git push fork main
git tag -a stallionx-v0.1.0 -m 'StallionX 0.1.0'
git push fork stallionx-v0.1.0
```

然后进入自己的 GitHub 仓库 → Actions → **StallionX Release** → Run workflow：

- Branch：`main`
- `version`：`0.1.0`（不带前缀）
- `sign_macos`：内测选 false；正式 Mac 分发选 true，先配置 Secrets
- `create_draft`：true 生成草稿 Release；false 只保存 Actions artifacts

工作流先运行完整 Go 测试、vet、账号 race 测试及完整 GUI 测试；失败时
不会构建/发布安装包。浏览器依赖版本固定，不使用 latest。
随后 Mac 双架构原生构建、Windows 双架构交叉构建；Windows runner 执行
账号测试并编译全套测试。Windows ARM64 包仍需要 ARM64 真机验证。
全部六个包齐全、非空、文件名正确后才生成 SHA-256 清单。

Release 始终是**草稿**，`latest=false`，不会自动公开或抢占 Latest。
重复版本会失败，不会覆盖旧包。检查草稿里的版本说明、签名状态和全部附件，
完成干净机器安装/卸载与登录测试后，管理员再点击 Publish release。
将最高的正式版本标记为 Latest；旧版本补发时不要标记 Latest。
签名和公证成功并不代替真机功能测试。

## 发布前检查

- 生产默认服务为 `https://x.stallion-api.run`；发布前确认线上邮箱验证码、
  注册、模型列表、请求、充值及账单接口均已部署并验证。不要发布连接
  localhost 的开发版。配置打包流程不代表这些线上接口已经验收。
- 不包含 `.stallionx-dev-home`、账号配置、JWT、API Key、开发数据库。
- 包内包含 LICENSE 与 THIRD_PARTY_NOTICES，上游 MIT 版权保留。
- Mac 检查签名、公证和首次启动；Windows 检查解压、WebView2、首次启动。
- 在两个架构真机验证，尤其是 Windows ARM64 和 Intel Mac。
- 下载完整安装包，按 `SHA256SUMS` 校验；Actions 绿色不等于 Release 已公开。

## 本地打包

```bash
# Mac 本机架构，未签名内测；脚本不会上传到 GitHub。
bash build/release-macos.sh 0.1.0

# Windows 两个架构；从干净已提交源码构建，不覆盖已有同名 ZIP。
bash build/release-windows.sh 0.1.0

# 六个安装包放在独立目录后校验并生成 SHA256SUMS。
python3 -I build/release-assets.py /path/to/packages 0.1.0 false
```

Windows 脚本需要 Go、GNU make、Git、Python 3.11+，会下载固定版本
`go-winres@v0.3.3`。Mac 脚本需要 Xcode command-line tools 和 Go。
首次运行需联网获取 Go 模块。签名模式必须由管理员主动设置相应环境变量。
不要用 `make dev` 的输出作为公开下载包。

## 更新与验证状态

本配置只管理安装包发布，**没有接入客户端自动更新**，也不会恢复 magpie
更新源。用户先手动下载新版；独立更新源、签名校验及回滚属于后续工作。

配置的本地检查与实际云端运行分开记录：脚本语法/manifest 测试不等于
GitHub 托管 runner 构建成功，未配置证书时也无法验证 Apple 公证。
首次 Release 必须检查完整 Actions 日志和实际安装结果。

2026-11-01 本地配置验证：

- `actionlint v1.7.12`：release/docker 工作流通过。
- 两个平台打包脚本的 `bash -n` 通过；release manifest 离线测试 3/3 通过；
  `git diff --check` 通过。两个脚本都拒绝非法版本；Windows 打包脚本确认
  拒绝当前未提交工作区，没有为了测试而提交或修改已有文件。
- 本机实际生成 `0.1.0` Mac ARM64 未签名 DMG/ZIP；DMG 校验通过，ZIP
  核对了 ARM64 可执行文件、版本、`com.stallionx.client`、许可证和文件列表。
  这是当前未提交工作区的内测包，不是标签发布或线上安装验收。
- 在独立临时源码副本执行 `make release-windows VERSION=0.1.0` 成功，
  `file` 确认产物分别为 x86-64 和 Aarch64 Windows GUI EXE。未改变原仓库
  的资源对象或嵌入式 launcher；交叉编译不等于 Windows 真机运行，完整
  Windows ZIP 脚本尚未在干净的发布提交上执行。
- 尚未运行 GitHub 托管工作流、Intel Mac 打包、Windows 原生安装验证，
  也未使用 Apple 证书执行签名/公证。本次没有推送、打标签或创建 Release。
- 本次发布配置验证未重跑全仓库 Go/GUI 测试；工作流已将这些检查设为
  打包前置门禁，不能用脚本检查或本机编译代替首次完整绿灯。

### 首版发布前验证（2026-11-01，尚未发布）

- 完整 Go 测试使用 `-tags nogui -timeout 45m ./...`，网关通过；GUI 代理
  绕过测试、两个 Bun Git 更新测试、macOS 子进程责任测试失败，不能发布。
- 原生 macOS、Linux nogui、Windows 的全仓库 `go vet` 均通过。
- 代理失败按上游 [#2562](https://github.com/yetone/magpie/issues/2562)
  中 ggbdpq 的修复处理：在 testenv 中隔离读取机器系统代理的 `scutil`，
  不改变生产代理优先级。代理测试族通过，新增隔离回归在旧实现上明确失败、
  新实现通过。仅替换 HOME 不能隔离 macOS 的系统网络设置。
- Bun Git 测试在本机 1.3.14 上失败，在已安装的 1.4.4 上通过。随后通过
  GitHub asset API 下载 CI 固定的 1.4.2，并核对官方 SHA-256；同组测试在
  1.4.2 上通过。未升级或覆盖用户全局 Bun，测试使用独立临时目录。
- 逐文件扫描 383 个改动/新增文件的敏感文件名和凭据模式，未发现实际
  凭据；两处命中均在 Scalar vendor 代码中，分别是 PEM 输入占位符和
  诊断 source 字符串。模式扫描不等于证明所有内容都无敏感信息；最终
  归档仍需按安装包内容白名单检查。
- CI 固定 Bun 1.4.2 环境下，`internal/stallionx`、`internal/testenv`、
  `internal/netproxy` 的完整包 `-race` 检查均通过。
- 完整 GUI 验证与 macOS 子进程责任失败调查仍在进行；最终验收记录需在
  这些任务结束后补齐。以上不是绿灯或已公开发布声明。
