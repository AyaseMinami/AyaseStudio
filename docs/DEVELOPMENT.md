# Ayase Studio Development Guide

本指南用于在办公室、家里或新的 Windows 开发环境中稳定地继续 Ayase Studio 的开发。仓库中的锁文件是依赖版本的权威来源；真实 API Key 与本地运行产物不进入 Git。

## Supported development environment

Ayase Studio 当前以 Windows 桌面端为首要目标。按照 [Tauri 2 官方先决条件](https://v2.tauri.app/start/prerequisites/)，Windows 开发环境需要：

- Microsoft C++ Build Tools，并安装 `Desktop development with C++` 工作负载。
- Microsoft Edge WebView2 Runtime。
- 通过 `rustup` 安装的 Rust 工具链。
- Node.js LTS 与 npm。

2026-09-14 的已验证本地环境如下。这是已知可工作的参考组合，不是当前由仓库强制锁定的最低版本：

| Tool | Verified version |
| --- | --- |
| Node.js | `v22.22.3` |
| npm | `10.9.8` |
| rustc | `1.96.0` |
| cargo | `1.96.0` |

前端依赖由 `package-lock.json` 锁定，Rust 依赖由 `src-tauri/Cargo.lock` 锁定。不同机器首次安装时应使用锁文件，不要手工复制 `node_modules`、`target` 或构建目录。

## First checkout

```powershell
git clone https://github.com/AyaseMinami/AyaseStudio.git
Set-Location AyaseStudio
git switch dev
npm.cmd ci
```

PowerShell 如果禁止执行 `npm.ps1`，请继续使用本项目文档中的 `npm.cmd` 命令。

启动完整桌面应用：

```powershell
npm.cmd run tauri dev
```

首次 Rust 构建可能需要几分钟；后续增量构建通常更快。`npm.cmd run dev` 只启动 Vite 页面，聊天网络层依赖 Tauri HTTP 插件，因此日常功能调试应优先使用 `tauri dev`。

## Daily cross-machine workflow

开始工作前先确认本机没有遗留修改，再同步 `dev`：

```powershell
git status --short --branch
git switch dev
git pull --ff-only origin dev
npm.cmd ci
```

如果 `git status` 显示未提交修改，不要直接拉取、重置或覆盖。先确认这些修改属于哪台机器和哪个任务，再决定继续完成、提交，或向用户请求处理方式。

办公室与家里之间的事实来源是 Git 远端，不是手工复制整个项目目录。切换机器前应确保需要保留的工作已经经过检查、提交并推送；不要让两台机器同时积累彼此不可见的修改。

当前分支约定：

- `main`：稳定基线与阶段版本。
- `dev`：日常集成开发分支。
- GitHub Issues：记录需求范围、验收标准和依赖。
- 达到一个可发布阶段后，通过 Pull Request 将 `dev` 合并到 `main`。
- 除非用户明确要求，不为普通工作额外创建分支或 worktree。

## Local credentials and live probes

应用内连接的 API Key 保存在本机 WebView 的版本化 localStorage 配置中。供应商只是分组；每条连接独立保存名称、协议、Base URL 与 Key，并拥有自己的已添加模型列表。当前模型 ID 会随配置一起保存，并通过所属连接原子地解析出请求协议和凭据。旧版单模型连接与 `ProviderProfiles` 会由应用确定性迁移，开发和测试不应手工复制其中的真实值。

“获取模型列表”和“测试模型”都是用户显式触发的真实网络请求。前者只更新所选连接的临时候选目录，用户仍需逐个添加；后者发送一条极短请求并显示首段与总耗时，可能产生少量 Token 或中转站费用。应用不自动探测、批量测速或在失败后改路重试。

连接编辑器保留用户输入的 Base URL，同时显示协议归一化后的地址和最终生成端点。OpenAI Chat/Responses 的根地址自动补 `/v1`，非根自定义路径保持原样；Gemini 和 Anthropic 在其地址下追加各自版本路径。Gemini 只有在该连接的模型被明确选为当前模型后才显示完整端点。非法网址、非 HTTP(S) scheme、查询参数、片段和 URL 内的用户名/密码会在目录、测速或聊天网络请求之前报错；不要为了兼容性手工试探备用路径。端点预览不显示 API Key 或请求头。

真实中转站配置只存放在 `.env.probe.local`。每台机器分别从示例文件创建：

```powershell
Copy-Item -LiteralPath .env.probe.example -Destination .env.probe.local
```

填写本机文件后运行真实兼容性探针：

```powershell
npm.cmd run probe:live -- --disableConsoleIntercept
```

规则：

- `.env.probe.local` 已被 Git 忽略，不应强制添加或粘贴到 Issue、PR、日志和聊天记录中。
- 探针会消耗少量真实模型 Token，只在明确需要验证中转站或协议兼容性时运行。
- 429、500、畸形 SSE 与取消行为由确定性测试覆盖，不需要用真实服务制造故障。
- 远程凭据和消息内容使用 HTTPS；明文 HTTP 仅允许 `localhost` 与 `127.0.0.1` 调试。

## Local appearance assets

自定义背景只支持 PNG、JPEG 和 WebP，单文件上限为 20 MB（20,000,000 字节）。原生文件选择器在 Rust 命令内完成选择、大小检查、内容格式识别和完整解码，再把副本写入应用数据目录的 `backgrounds` 子目录。React 只收到 `backgrounds/<uuid>.<ext>` 稳定引用与应用私有副本路径，不接收或持久化用户所选原文件的绝对路径。

偏好设置保存在现有版本化外观 localStorage 记录中；图片本体不进入 localStorage、聊天、供应商请求、日志、测试快照或 Git。启动恢复会重新校验私有副本；缺失、损坏或无效引用会清空并回退到基础主题。替换、移除与启动整理只删除该专用目录中符合 Ayase Studio UUID 命名规则且不再被偏好引用的副本，不修改原文件，也不处理目录中的非受管文件。

涉及这条能力的变更除前端测试外，还应运行 Rust 单元测试，并在 `npm.cmd run tauri dev` 中实际验证文件选择、重启恢复、替换、移除、浅色/深色切换，以及 720×520 最小窗口下的可操作性。单纯启动进程不算完成交互烟雾测试。

## Commands

| Purpose | Command |
| --- | --- |
| Tauri desktop development | `npm.cmd run tauri dev` |
| Unit and integration tests | `npm.cmd test` |
| Test watch mode | `npm.cmd run test:watch` |
| TypeScript and Vite build | `npm.cmd run build` |
| Frontend check bundle | `npm.cmd run check` |
| Rust compile check | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Production desktop bundle | `npm.cmd run tauri build` |
| Live provider probe | `npm.cmd run probe:live -- --disableConsoleIntercept` |

## Required verification before handoff

普通代码修改至少运行：

```powershell
npm.cmd run check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short --branch
```

涉及 Tauri 权限、运行时网络、窗口、主题首屏或本地文件能力时，还要运行：

```powershell
npm.cmd run tauri dev
```

并完成与修改范围相称的桌面烟雾测试。只有中转站兼容性发生变化时才需要真实 API 探针。

## Troubleshooting

- `npm` 被 PowerShell 执行策略拦截：改用 `npm.cmd`。
- 首次构建长时间编译 `build-script-build.exe`：通常是 Cargo 正在编译依赖；核对其路径位于本仓库的 `src-tauri/target` 后再判断安全软件告警。
- `failed to run light.exe`：按照 Tauri 官方文档检查 Windows 的 VBSCRIPT 可选功能；它只影响 MSI 打包。
- 页面能打开但发送失败：确认使用的是 `npm.cmd run tauri dev`，而不是单独的 Vite 浏览器页面。
- 新机器行为不一致：先比较 Node、npm、rustc 和 cargo 版本，再确认使用了当前锁文件执行 `npm.cmd ci`。

## Related documents

- [Architecture and project structure](ARCHITECTURE.md)
- [v0.1 plan](PLAN.md)
- [Protocol compatibility contract](PROTOCOLS.md)
