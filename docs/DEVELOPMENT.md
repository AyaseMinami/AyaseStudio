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

以下是需要同步机器时的人工操作示例，不是代理每次任务的启动脚本。先检查工作区；仅在任务需要同步且现有修改可安全保留时更新 `dev`，依赖未变化时无需重复安装：

```powershell
git status --short --branch
git switch dev
git pull --ff-only origin dev
npm.cmd ci
```

如果 `git status` 显示未提交修改，不要直接拉取、重置或覆盖。先确认这些修改属于哪台机器和哪个任务，再决定继续完成、提交，或向用户请求处理方式。

办公室与家里之间通过 Git 远端交换已检查的工作。提交、推送和 PR 操作需要用户明确授权；已有授权涵盖本次操作时不重复询问。没有授权时完成本地工作并报告待同步状态。

当前分支约定：

- `main`：稳定基线与阶段版本。
- `dev`：日常集成开发分支。
- GitHub Issues：记录需求范围、验收标准和依赖。
- 达到一个可发布阶段后，通过 Pull Request 将 `dev` 合并到 `main`。
- 除非用户明确要求，不为普通工作额外创建分支或 worktree。

## Local credentials and live probes

Issue #14 的定向回归可运行 `npm.cmd test -- src/chat/messageOperations.test.ts src/chat/useChatSession.messages.test.tsx src/ui/chat/MessageList.test.tsx`。其中使用合成模型、附件存储与 transport，覆盖编辑/删除、截断重发、分支、配置与生成归属；不消费供应商 Token。配合 `npm.cmd run build` 做类型与打包检查。界面验收关注确认框、键盘访问、窄窗口、复制原文及分支后附件预览。

应用内连接的 API Key 保存在本机 WebView 的版本化 localStorage 配置中。供应商只是分组；每条连接独立保存名称、协议、Base URL 与 Key，并拥有自己的已添加模型列表。模型 ID 保存在 Dexie 助手记录中，通过所属连接原子地解析出请求协议和凭据；旧全局模型 ID 仅作为首次助手迁移的输入。旧版单模型连接与 `ProviderProfiles` 会由应用确定性迁移，开发和测试不应手工复制其中的真实值。

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
- 探针会消耗少量真实模型 Token，只在用户明确授权该次真实调用范围后运行；技术上需要验证不等于已获授权。
- 429、500、畸形 SSE 与取消行为由确定性测试覆盖，不需要用真实服务制造故障。
- 远程凭据和消息内容使用 HTTPS；明文 HTTP 仅允许 `localhost` 与 `127.0.0.1` 调试。

## Local appearance assets

自定义背景只支持 PNG、JPEG 和 WebP，单文件上限为 20 MB（20,000,000 字节）。原生文件选择器在 Rust 命令内完成选择、大小检查、内容格式识别和完整解码，再把副本写入应用数据目录的 `backgrounds` 子目录。React 只收到 `backgrounds/<uuid>.<ext>` 稳定引用与应用私有副本路径，不接收或持久化用户所选原文件的绝对路径。

偏好设置保存在现有版本化外观 localStorage 记录中；图片本体不进入 localStorage、聊天、供应商请求、日志、测试快照或 Git。启动恢复会重新校验私有副本；缺失、损坏或无效引用会清空并回退到基础主题。替换、移除与启动整理只删除该专用目录中符合 Ayase Studio UUID 命名规则且不再被偏好引用的副本，不修改原文件，也不处理目录中的非受管文件。

涉及这条能力的变更除前端测试外，还应运行 Rust 单元测试，并在 `npm.cmd run tauri dev` 中实际验证文件选择、重启恢复、替换、移除、浅色/深色切换，以及 720×520 最小窗口下的可操作性。单纯启动进程不算完成交互烟雾测试。

## Assistant/conversation regression checks

Issue #21 快捷选模定向验证：`npm.cmd test -- src/chat/modelSwitch.test.ts src/Workspace.test.tsx src/chat/useChatSession.messages.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。检查顶部弹窗搜索、连接/协议分组、选中标记、Escape/Tab、窄窗口；保存仅影响当前会话，正在生成的目标不变，下一次请求同步切换连接和协议。测试使用合成配置，不调用真实供应商。不可用的思考选项切回后不自动恢复；四种协议的联网开关均可用。

Issue #25 紧凑布局补充：图标在助手名称左侧，采样与预算字段按表单可用宽度自动分列，自定义数值位于对应选项下方。高级 JSON 默认折叠，校验错误时保持展开；恢复默认配置位于固定底栏。内置浏览器检查了 1280×900、720×520 和 480×640，确认自动减列、无横向溢出以及图标/自定义数值操作；JSON 折叠、错误可见与草稿保留由工作区定向测试覆盖。

Issue #25 的定向回归使用 `npm.cmd test -- src/Workspace.test.tsx`，再运行 `npm.cmd run build` 和 `git diff --check`。覆盖助手菜单导航隔离、排序、默认助手删除限制、Escape 焦点返回，以及弹窗取消/关闭丢弃草稿；既有保存、迁移和生成归属测试保留。2026-09-20 本地 18 项工作区测试及构建通过，内置浏览器完成浅色/深色与 720×520 检查：居中弹窗、固定标题和操作栏、表单滚动、Tab 焦点循环、取消不保存、菜单键盘入口，以及两栏标题/新建按钮/首行对齐均通过。未调用真实供应商；原生截图接口失败后按用户要求停止 computer-use，桌面实际效果由用户验收。此项仅调整 React/CSS 界面，不运行全量协议或 Rust 测试。

助手统一配置使用 Dexie v3；不要手工清除真实 WebView 数据来模拟升级。v1 的 current 配置转入默认助手，v2 原助手配置保持为统一来源，旧对话参数和模型引用存入本地 `legacyConversationConfigs` 备份，不再参与请求；没有 UI 恢复入口。升级可能改变原来拥有独立配置的对话的后续请求参数和模型，这是统一管理的既定规则。`src/chat/workspace.test.ts` 用真实 v1/v2 表形状验证升级、备份、重复初始化、回滚及安全删除；`src/Workspace.test.tsx` 用模拟 transport 验证共享配置和切换期间的请求归属，不访问真实 Provider。

交互验收包括助手创建/编辑/排序、对话新建/切换、标题右侧重命名与删除图标、共享配置与请求冻结、删除助手时迁移/永久删除分支，以及重启恢复。宽窗口和 `720×520` 均检查助手左栏与对话右栏的横向级联、独立滚动、整体联动收起与恢复、只收起对话栏、选择对话后保持展开，以及输入区和停止操作。两栏应参与布局，不能单独悬浮。本轮原生截图返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)` 后已停止 computer-use；真实桌面验收由用户完成，启动成功不计作交互验收通过。

内置浏览器已通过真实点击验证助手创建、新建对话及系统指令继承；刷新阶段开发服务连接中断，内置浏览器错误页被 URL 策略拦截，因此没有把刷新恢复或窄窗口视觉检查标为通过。重启恢复和删除分支已由确定性测试覆盖，仍需用户桌面验收。

## Commands reference

Issue #19 的最小定向验证：`npm.cmd test -- src/ui/chat/ChatLayout.test.tsx` 和 `npm.cmd run build`。检查默认窄屏、生成中切换及重新挂载恢复；浏览器在 1440×900 和 720×520 下检查消息列/输入框同步伸缩、侧栏保持、无页面横向溢出和刷新恢复。此项仅改变前端布局偏好，无供应商请求或原生窗口行为改动。

Issue #15 的定向回归：`npm.cmd test -- src/chat/SafeMarkdown.test.tsx src/ui/chat/MessageList.test.tsx src/ui/chat/SearchResults.test.tsx src/chat/useChatSession.messages.test.tsx`。全量门禁使用下表命令。数学排版检查三处消息展示、浅深主题、窄窗口局部横向滚动及刷新恢复；本轮按用户要求用浏览器验证，不使用 computer use。KaTeX CSS/字体须与 rehype-katex 实际使用的引擎版本一致，可用 `npm.cmd ls katex` 检查；不加载 CDN 字体。

2026-09-19 验证：全量前端 365 项、Rust 20 项测试通过，TypeScript/Vite 生产构建与 Rust check 通过。使用 Playwright 驱动本机 Edge 的独立无头浏览器验证实际消息页面及生产预览：用户/助手/摘要公式、720×520 与 1280×900、浅深主题、长公式局部滚动、刷新恢复和本地字体加载通过，无页面异常；未使用 computer use、未访问真实模型，也未将浏览器验证表述为原生桌面交互验收。

短公式滚动条回归：KaTeX `.vlist-t2` 的负右边距会产生 2px 的排版溢出，行内公式滚动容器需为其留出右侧空间。浏览器检查 `a_n`、数列上下标、极限与分式等用户/助手消息：修复前 20 个短公式中 12 个满足 `scrollWidth > clientWidth`，修复后为 0；720/1100 宽度、浅深主题及 100%/125%/150% 缩放均通过。长行内和独立公式仍可局部滚动，消息容器不溢出。此项依赖真实浏览器布局，不能由 happy-dom 渲染测试代替。

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

纯文档修改检查内容、相对链接和 `git diff --check`，并查看 `git status --short --branch`；无需构建、启动桌面或运行真实探针。普通代码修改默认运行：

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

并完成与修改范围相称的桌面烟雾测试。真实 API 探针仅用于确有需要且用户已授权的兼容性验证。检查通过后，只有相关修改、失败或新的疑点才需要扩大或重复检查。

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

## Conversation configuration and deterministic checks

Issue #16 思考扩展可针对运行 `npm.cmd test -- src/chat/thinking.test.ts src/ui/chat/Thinking.test.tsx src/Workspace.test.tsx src/chat/transport.test.ts src/chat/requestMapping.test.ts src/chat/geminiThinking.test.ts`。覆盖任意模型 ID 的协议映射、默认字段省略、显式摘要偏好、协议配置隔离、预算和采样组合原样发送及数值结构校验、流式与非流式摘要分离、关闭摘要、Responses 重复/最终事件、完整错误正文/状态与凭据脱敏、失败和历史不回传摘要。默认代码门禁仍为 `npm.cmd run check` 与 Rust check。

交互验收检查 Chat 的摘要能力提示、Responses 独立摘要开关、Anthropic 模式与 effort 独立选择、预算应用、切换型号后思考选项与预算保持不变及重启恢复；在浅色/深色和 720×520 下确认弹层可滚动且输入区常驻高度不变。真实供应商调用需要授权，不能用自动重试绕过参数错误。只启动桌面程序不能算完成交互或联网验收。

2026-09-19 本地内置浏览器以无密钥配置手动添加 `claude-opus-4-6`，实测灯泡弹层、预算选择、720×520 浅色/深色布局和刷新后配置恢复通过。`tauri dev` 编译并启动桌面进程成功；当前工具的原生窗口控制不可用，未将原生交互或真实线路验收记为通过。

Gemini 思考首版的针对性检查可运行 `npm.cmd test -- src/chat/geminiThinking.test.ts src/ui/chat/Thinking.test.tsx src/chat/transport.test.ts src/chat/requestMapping.test.ts src/chat/sessionStore.test.ts src/Workspace.test.tsx`，再运行前端构建和 Rust check。输入区底部附件与思考图标同排，点击灯泡向上展开强度列表，摘要勾选位于弹层内的独立分区；Escape 关闭并将焦点还给灯泡，点击外部或 Tab 离开时收起。Issue #28 起快捷菜单保存当前对话配置；自定义预算需要点击“应用预算”，助手编辑器内则仍需“保存助手”。验收应检查协议选项、切换型号后选择和预算保持不变、独立摘要开关、流式摘要折叠、停止后保留内容及重启恢复。模拟 transport 的验收不代表真实中转站兼容性已验证。

按用户最新确认，助手仅提供新对话模板，每个对话独立保存模型、系统指令、生成参数、思考、搜索和四协议 JSON。铅笔入口统一编辑标题和配置；底部“恢复助手默认值”将助手当前设置复制到草稿，保存才生效，取消不写入。清空消息保留设置，分支复制配置，迁移助手仅改变归属。发送从对话快照读取，修改助手不影响已有对话。

Issue #28 完整快照调整的定向检查包括 `src/chat/conversationConfig.test.ts`、`src/chat/workspace.test.ts`、`src/chat/useConversationWorkspace.test.tsx`、`src/chat/useChatSession.messages.test.tsx`、`src/Workspace.test.tsx` 与配置相关 App 用例，再运行 `npm.cmd run build` 和 `git diff --check`。重点验证旧记录一次性转换、重启不刷新、清空/分支/迁移保留配置、恢复草稿及取消、模型失效阻止发送、运行中冻结。无需 Rust 或协议全量测试，不调用真实供应商。

2026-09-20 早期稀疏覆盖版的 49 项用例与浏览器验收属于历史记录；同日按用户确认改为完整对话快照，最新验收以完整快照语义为准。

完整快照版验证：存储/迁移、工作区、请求编排、思考控件与 7 项 App 配置用例定向通过，生产构建通过，独立审查无遗留 P1/P2。内置浏览器确认旧配置转换后模型和参数保留、所有逐项来源提示移除、独立设置刷新保留、恢复可取消及保存后生效。没有运行全量测试、调用真实供应商或进行原生截图验收。

本地输入预算是 Token **估算**，不是供应商公布的模型上下文上限。已知 OpenAI 模型按对应本地 BPE 分词，未知或非 OpenAI 模型按 UTF-8 字节保守估算；消息封装开销仍可能与供应商计费值不同。真实中转站若出现传输差异，应先核对官方协议，再把中转站观测单独记录。桌面烟雾测试需要实际操作配置面板、非流式停止、协议切换与恢复，单纯启动 `tauri dev` 不构成交互验收。

## Attachment checks (Issue #5)

Windows 窗口禁用 Tauri 原生路径拖拽截获，使用 HTML5 `DataTransfer.files` 获取实际拖入的 `File`，不向原生命令传送任意来源路径。

已发送但后来因清空或删除而无主的附件不会立即永久删除：先移动到私有隔离目录，仍可凭引用预览；至少 30 天后经过两次间隔一小时以上的无主引用扫描才彻底回收。打开时可读取隔离副本，重新扫描有主引用可恢复活动副本。发送前新副本位于私有暂存目录；聊天记录提交失败或发送前中止时立即删除，成功提交后副本可凭引用读取，启动或后续引用整理时转入活动目录。异常退出后，已发送副本仍可从暂存目录读取并恢复；无主暂存副本会被清理。清理失败不得伪装成消息保存失败。

输入框左下角的附件按钮、拖入聊天区域和粘贴图片仅形成本次运行内的当前对话草稿。草稿只保留 `File` 句柄和元数据，仅读取一小段格式头识别 MIME，不提前读入或缓存整图 Base64。第一阶段只提供 PNG/JPEG/WebP/PDF/TXT/Markdown，文本须能作为 UTF-8 文本映射；不设统一的单文件 10 MB 或单消息 20 MB 应用上限。图片后缀与内容不一致时使用识别出的实际 MIME；本地不完整解码图片，也不因图片/PDF 无法在本地解析而预先拒绝，供应商可能自行拒绝不合规内容。选择/拖入不会联网或留下永久副本；点击“发送”才逐项完整读入文件、复制到应用私有暂存目录并和文本一起进入本次请求；每项读取后检查中止。新用户消息写入数据库成功、原生层核对全部副本可访问且大小一致后才开始网络请求；这一步不在 JS 重新加载图片。发送后的历史消息只持有私有副本引用及元数据，不在对话状态中缓存图片字节；一次请求和打开的预览短暂在内存中持有内容，请求结束或关闭预览后不建立长驻缓存，具体回收时点由运行时决定。已发送消息上的附件按钮只读打开图片、文本/安全 Markdown 或按页本地 PDF.js 预览；原文件删掉后仍应能读出。清空和删除对话会按所有对话仍持有的引用清理副本，不能误删其他对话共用的引用。桌面主窗口仅在取得应用数据锁后创建，重复启动通常聚焦已有窗口，避免跨进程误删暂存文件。

本地确定性测试和 Rust 单元测试覆盖校验、协议映射、存储、草稿不跨重启、引用清理和预览入口。桌面烟雾测试要亲自验证文件选择、Windows 文件拖入、图片粘贴、仅在点击发送后发起一次请求、出错后的预览以及 PDF 页面渲染；不读取实际密钥或花费真实 Token 时，可先检验草稿和本地保存/预览，联网请求仍标记未验证。

## Issue #6 定向验证

本次按用户要求不运行全量测试；只检查搜索解析、引用 UI、会话保存/手动续接，再运行 `npm.cmd run build`、`cargo check --manifest-path src-tauri/Cargo.toml` 和 `git diff --check`。外链新增 Tauri opener 权限；Gemini 建议需要在浏览器与桌面实际检查容器布局及外链。进程启动不代表桌面交互通过，真实供应商探针仍需单独授权。实施范围见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
