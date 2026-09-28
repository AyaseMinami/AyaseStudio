# Ayase Studio Development Guide

## User avatar #32 / #34 verification (2026-09-28)

头像原图、裁切参数及缩略图保存于 WebView 的 `ayase-studio-avatars` IndexedDB；备份应用数据时需包含 WebView 本地目录，没有单独的头像文件目录。浏览器验收数据与桌面应用分离。

头像仓库/几何、Hook 保存失败、MessageList 和 SettingsWorkspace 共四个文件 28 项定向测试通过；TypeScript/Vite 构建、Cargo check 和 diff 检查通过。独立只读审查无待修复问题。未运行全量协议测试或真实供应商探针。

内置浏览器使用隔离来源 `127.0.0.1:1462`、合成聊天和仓库图标验收：本地选图、正方形预览、缩放、指针拖动、重裁、取消保留旧取景、损坏图片、移除及页面刷新恢复通过。检查浅/深主题、1280×900 与 720×520，消息头像为 32px，无横向溢出；低高度裁切按钮可见。按钮使用键盘操作，因浏览器点击自动化未触发；拖动可用。未读取凭据或发送供应商请求。

使用临时隔离 identifier 配置运行 `npm.cmd run tauri dev -- --no-watch --config ui-review.local/avatars-tauri.json`，编译并启动成功。原生文件选择、生产 WebView 图片显示及真实桌面重启恢复仍待人工验收；启动成功和浏览器验收不代表这些原生交互已通过。

2026-09-28 后续外观微调：色盘、透明度和背景数值旁补充单项恢复按钮；统一色和统一透明度分别原子恢复其覆盖范围内的方案默认值。沿用用户暂不测试的要求，仅做源码复核与 diff 检查，dev 视觉和交互由用户确认。

## 统一主题色与独立子项（2026-09-28）

配色新增统一主题色、独立组件色与用户气泡色，默认方案保留不同色；助手和画布不受统一操作影响。同步更新接口样例和旧对比度预期，补充统一覆盖、独立修改、同色同步、重启与预设恢复的确定性测试源码。遵循本次用户要求，未运行测试、构建、浏览器或原生启动；只做源码复核和 diff 空白检查，视觉效果由用户正在运行的 dev 验收。

## 浅色配色预设（2026-09-27）

默认配色改为中性灰助手气泡与较明显的浅蓝用户气泡，原暖灰配色保留为外观设置的“阅读”预设，具体色值及交互见 [UI 约定](UI-DESIGN.md#确认状态)。按用户要求不运行测试、构建或启动新的 dev 实例；仅做源码检查及 diff 空白检查，现有测试中的默认值与接口样例同步更新但未执行。用户使用已运行的 dev 直接确认视觉效果，运行时和视觉验收尚未完成。

## 最新一轮问答版本与快捷键（#17 / #50，2026-09-27）

按用户要求执行最小相关验证：`npm.cmd test -- src/chat/roundVersions.test.ts src/chat/repository.test.ts src/chat/useChatSession.messages.test.tsx src/chat/useChatSession.concurrency.test.tsx src/ui/chat/MessageList.test.tsx src/ui/chat/Composer.test.tsx`，6 文件 47 项通过；修复箭头切换后的焦点恢复后，仅重跑 MessageList 的 19 项通过。`npx.cmd tsc --noEmit`、`git diff --check` 通过。独立只读审查覆盖存储、请求上下文、附件引用、并发保护、恢复和 UI，未发现剩余确认缺陷。

内置浏览器通过隔离 origin `127.0.0.1:1458/ui-review.local/round50.html` 运行真实 App、Dexie、会话逻辑与组件，仅替换 transport 为本地合成回复，不读取真实凭据或发送供应商请求。验收 Enter / Ctrl+Enter 发送、Shift+Enter 换行、编辑 Ctrl+Enter 直接发送、Enter 仅保存、Escape 取消；重新生成及修改提问产生 3 个候选，箭头同步恢复对应问答，刷新保持 2/3 选择。箭头切换到边界后焦点转到可用箭头，可连续键盘切换。继续下一轮后旧候选入口消失，保留选中问答；新一轮可独立新增候选。720×520 深色与默认尺寸浅色布局无页面横向溢出，浏览器无 error 日志。

验收截图：`ui-review.local/round50-versions.png`、`ui-review.local/round50-dark.png`；样例、模拟 transport 和独立 Vite 配置均位于忽略目录，不随仓库交付。不运行全量测试、Rust 检查或原生启动；本轮无原生合同变更。真实 Windows 输入法选词仍需用户实机确认，合成事件测试只验证组合输入保护分支。未提交、推送或修改远端 Issue。

## Issue #62 消息内图片预览（2026-09-27）

粘贴默认名规则补充：附件 UI 16 项与 TypeScript 通过，确定性测试覆盖同批/同秒连续粘贴编号、跨秒重置、明确名称保留、扩展名及原字节/MIME/修改时间保留。内置浏览器通过合成 clipboard paste 事件验证两张默认名分别变为时间名和 `-2`，`风景.png` 保留，改名后可点击预览且发送计数为 0；截图 `ui-review.local/paste-names62.png`。这验证应用粘贴处理，不代表 Windows 系统剪贴板格式兼容性的全面验收。

后续补充待发送图片标签点击预览，保持紧凑标签和独立移除按钮。附件 UI 15 项测试、TypeScript 与 diff 检查通过；新增测试覆盖显式打开才读取、关闭再打开重新读取、草稿保持、附件移除后关闭、读取失败且不发送。内置浏览器 `ui-review.local/draft62.html` 合成图片验证鼠标打开、Escape 关闭后标签焦点恢复、草稿文字及附件保留，点击 × 只移除，发送计数始终为 0。截图 `ui-review.local/draft62-preview.png`。未运行全量或原生检查，未改变附件保存/传输协议。

按用户确认实施适当尺寸的消息内图片预览：单图最大 560×420px，多图最多两列、每格最大 280×280px，窄内容区域单列，等比完整显示且不放大小图。见 [UI 规则](UI-DESIGN.md#消息内图片预览issue-62) 与 [临时读取生命周期](ARCHITECTURE.md#message-image-previews-62)。

最低限度验证：`npm.cmd test -- src/ui/chat/AttachmentUi.test.tsx src/ui/chat/MessageList.test.tsx` 首轮 29 项通过；末张导航焦点修复后只重跑附件 UI，13 项通过（消息组件既有 17 项此前通过）。`npx.cmd tsc --noEmit` 与 `git diff --check` 通过。新增测试覆盖可视范围读取/释放、迟到结果丢弃、图片失败、弹窗切换和焦点返回。独立只读审查发现的中等宽度单格超限、末张导航焦点逃逸已修复并复核，无剩余确认缺陷。

内置浏览器使用隔离 origin `127.0.0.1:1456` 和 `ui-review.local/images62.html`，真实消息组件配合合成图片与读取回调。1200×850 下单图外框 560×420px、多图两列各 280×280px；横图、竖图和长截图完整显示，80×60 小图不放大。720×520 窗口中的 320px 内容区改为单列，无页面或消息区横向溢出；浅深主题均检查。鼠标打开/关闭、左右键切图、Escape 返回、末张导航后 Tab 回到关闭按钮通过；读取失败、解码失败、延迟加载均保留稳定占位。20 条长对话在底部仅挂载附近两张图片，滚到顶部后换为前两张且总高度不变。刷新合成样例后图片重新读取并正常显示。

浏览器验收修复了首版长图裁切和多图意外单列问题。截图保存在 `ui-review.local/images62-single.png`、`images62-multi-light.png` 与 `images62-narrow-dark.png`。这是隔离样例的组件/布局验收，不代表原生私有附件持久化或真实供应商验收；不调用真实供应商，不读取凭据，未运行全量测试、生产构建、Rust 或原生启动。未提交、推送或修改远端 Issue；最终主观视觉效果由用户确认。

## Issue #63 轻量附件扩展（2026-09-27）

后续按用户反馈取消选择器的协议过滤：所有连接（包括尚未选择模型）都列出 DOCX/XLSX/PPTX，加入草稿后再提示 Responses 发送要求。切换连接保留草稿，非 Responses 的发送限制不变。

该修复通过 9 项附件 UI 测试、TypeScript 与 diff 检查；内置浏览器确认 Anthropic 下文件输入 accept 包含三个 Office 后缀，添加后显示限制原因并禁用发送。此轮未操作 Windows 原生选择对话框。

新增 UTF-8 结构化文本/代码，以及仅 Responses 可发送的 DOCX/XLSX/PPTX 原文件。Office 仅验证 ZIP 文件头，不做完整 OOXML 解析；预览只读元数据，无新增依赖。验收范围及远端需求差异见 [计划](PLAN.md#issue-63-lightweight-attachments)。

定向前端 5 个文件、54 项测试通过（格式识别、请求映射、私有存储接口、会话附件生命周期及 UI），生产构建通过，保留既有大 chunk 提示。Rust 附件 14 项测试和 cargo check 通过。独立只读审查未发现确认缺陷。未运行无关全量测试，也未读取凭据或请求真实供应商。

内置浏览器使用独立 `127.0.0.1:1453` 与 `ui-review.local/attachments63.html`，真实组件和请求映射配合合成附件、本地模拟存储。通过键盘验证添加草稿、切换协议保留附件且阻止发送、切回 Responses 后产生原 Office Base64 与 CSV 正文、Office 信息预览及 CSV 中文预览、Escape 关闭；浏览器刷新恢复仅验证模拟存储，正式持久化由既有会话测试及本轮 Rust 副本测试覆盖。720×520 浅深主题均无横向溢出；截图为 `ui-review.local/attachments63-light.png` 与 `attachments63-preview.png`。鼠标点击工具未改变页面，未将其计为通过。

`tauri dev --no-watch` 启动检查因用户正在运行的 `target/debug/ayase-studio.exe` 被占用，链接替换报 Windows 拒绝访问而未完成；保留该实例，不强制关闭。原生文件对话框与真实供应商兼容性未验收，浏览器检查不替代它们。

## Issue #59 区域透明度（2026-09-27）

后续按用户要求将预览改为固定 1920×1080 的完整模拟画布并整体缩放，背景取景明确为 16:9。10 项相关测试、TypeScript、生产构建和 diff 检查通过；测试覆盖容器宽度变化、observer 清理、固定预览取景及真实窗口默认取景。内置浏览器实测内部尺寸始终 1920×1080，在 1280px 宽窗口显示为 948×533.25，在 1440px 双列设置页显示为 597×335.8125；720×520 下无横向溢出，浅深主题和透明度实时更新正常。截图为 `ui-review.local/preview-1080p.png`，独立只读复审无确认缺陷。本轮仅改预览与可选背景比例参数，未重复全量测试、Rust 或原生启动。

统一滑块覆盖侧栏、输入栏、双方消息气泡；独立调整只覆盖对应区域，差异以橙色叹号提示，手动恢复一致后同步统一值。预览包括两级侧栏、双方气泡与输入区，方案见 [UI 约定](UI-DESIGN.md#透明度设置issue-59)。

最终 `npm.cmd run check` 通过 49 个测试文件、489 项测试和 TypeScript/Vite 构建；`cargo check --manifest-path src-tauri/Cargo.toml` 通过。新增确定性测试覆盖统一一次存储、独立覆盖与收敛、恢复偏好、旧配置/非法值回退、重置、差异提示、提示层视口边界，以及浅深主题和自定义配色下每个整数透明度的用户文字对比度。构建保留既有大 chunk 提示。

内置浏览器使用隔离 `127.0.0.1:1445` origin 和 `ui-review.local/opacity.html`，供应商请求被阻断，背景适配器提供合成图形。实测统一 100%、单项变 0%、手动恢复 100% 的提示出现/消失，以及统一 30% 后侧栏 40% 刷新恢复；预览与实际聊天对应底板 alpha 相同，内容 opacity 保持 1（侧栏原有开关动画除外）。浅深主题、1440×900 与 720×520 均无页面横向溢出，键盘聚焦显示差异说明；最终截图为 `ui-review.local/opacity-dark.png`。导航和精确数值测试通过键盘 Enter/方向键完成，另实测鼠标拖动统一滑块将三个区域同步为 60%，差异标识消失。

独立审查发现并修复高透明度下深色画布上的用户文字对比不足，以及说明提示在滚动区或窗口边缘裁切；复审无剩余确认缺陷。浏览器确认深色无背景图、100% 气泡透明度时用户文字为白色，实际聊天与预览一致；说明提示使用 body portal，Escape 关闭。

未访问真实密钥或供应商、未提交或修改远端 Issue。本轮不涉及原生权限、网络、文件实现或主题首屏机制；未重启用户正在运行的桌面实例，浏览器验收不代表原生安装/启动与用户主观视觉验收。

## Issue #9 标题栏样板（2026-09-27）

按用户确认，Windows 原生标题栏与聊天顶部栏合并，对话标题居中，模型选择迁移至输入框底部，宽窄与清空在窗口三键左侧独立成组。设置页同样保留窗口三键。用户随后要求将聊天顶部栏收紧至 40px；内置浏览器实测高度 40px，三键贴顶对齐，无页面横向溢出。

用户在上述调整后明确授权提交代码，并将 #9 标记为已完成。关闭依据是用户本轮指示，不将其扩大为全部原生交互测试或安装发布验收通过；以下已验证范围及 Snap Layout 限制继续保留。

默认自主 UI 验收使用 Codex 内置浏览器，详见 [AGENTS.md](../AGENTS.md#editing-and-verification)。只有用户明确要求时才使用 Computer Use 或其他原生 UI 自动化。原生能力仍需相关编译、启动检查；浏览器无法验证的行为明确交由用户手动验收，不用浏览器模拟替代。

本轮 `npm.cmd run check` 的 48 个文件、482 项测试与生产构建通过，`cargo check --manifest-path src-tauri/Cargo.toml` 通过；构建保留既有大 chunk 提示。窗口测试覆盖浏览器/原生装饰分支、三键分发、最大化状态同步、迟到状态忽略、重复命令防护、错误呈现和卸载监听清理。后续仅 CSS 微调重跑相关 32 项测试和 TypeScript 检查。

独立只读审查确认并复核修复了最小窗口下长标题与操作区重叠的问题，未发现其余确认的 P1/P2 缺陷；该审查不替代下面列出的原生体验验收。

内置浏览器使用独立 `127.0.0.1:1441` origin 与 `ui-review.local/titlebar.html` 样板，拦截原生命令且不请求供应商。720×520 下浅深主题、模型弹窗与 Escape 焦点回退可用；长标题居中（聊天区域与标题中心均为 x=392），标题右缘 472px、操作区左缘约 487px，无重叠及页面横向溢出。截图 `ui-review.local/titlebar-720-dark.png` 为浏览器模拟的原生按钮外观，不是原生窗口截图。

`npm.cmd run tauri dev` 已编译启动，原生可访问性树确认窗口三键出现，并读取到真实最大化状态。用户新增默认浏览器验收要求前尝试的 Computer Use 截图报 `FrameArrived timed out`，点击报 `coordinate input geometry is unavailable`；因此未声称拖动、双击、三键原生动作、阴影或系统菜单通过。启动日志仍出现 IPC 自定义协议回退到 postMessage 的警告。

Windows 11 最大化按钮悬停 Snap Layout 尚未接入：普通 HTML 按钮与 `toggleMaximize` 不提供原生 `HTMAXBUTTON` 命中行为。其余 Snap、系统菜单、阴影和缩放也待用户实机确认；若原生体验明显退化，应按 #9 保留原生标题栏，不将当前样板视为发布通过。可在启动前设置 `$env:AYASE_NATIVE_TITLEBAR = '1'` 恢复原生装饰，自定义三键会随之隐藏；移除此环境变量并重启可恢复样板。官方依据：[Tauri 窗口定制](https://v2.tauri.app/learn/window-customization/)、[Microsoft 自定义标题栏 Snap Layout](https://learn.microsoft.com/windows/apps/desktop/modernize/apply-snap-layout-menu)。

## Alpha 2 候选包验证（2026-09-27）

版本统一为 `0.1.0-alpha.2`，继续仅构建 Windows x64 NSIS 安装程序。`npm.cmd run check` 通过：46 个文件、473 项确定性测试及 TypeScript/Vite 生产构建；`cargo test --manifest-path src-tauri/Cargo.toml` 的 20 项单元测试和 `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

默认测试由 `vitest.config.ts` 限定为 `src/**/*.test.{ts,tsx}`，覆盖全部正式前端测试，避免误收集被忽略的本地供应商探针。真实供应商探测仍由独立的 `probe:live` 显式运行，本轮未调用。App 请求断言已区分主聊天和后台自动命名请求；命名行为本身仍由专门测试覆盖。生产构建保留大于 500 kB 的 chunk 提示。

此记录不代表安装或升级验收。发布前仍需检查全新安装、覆盖升级、聊天/连接凭据/附件/背景保留，以及窗口尺寸与最大化状态的关闭重启恢复。候选包提交到 `dev → main` PR 供用户检查，PR 创建不等于合并或正式发布。

本轮 `npm.cmd run tauri dev` 编译并启动成功，系统确认主窗口存在且响应正常，检查后已关闭。该检查未操作窗口恢复或安装器；日志包含 libpng 颜色配置警告。独立只读审查覆盖并发任务归属、标题写入保护及窗口状态插件生命周期，未发现确认的 P1/P2 缺陷。

`npm.cmd run build:windows` 构建应用成功；后续仅修改安装模板，使用 `npm.cmd run tauri -- bundle --bundles nsis` 重新封装。当前候选包为 `src-tauri/target/release/bundle/nsis/Ayase Studio_0.1.0-alpha.2_x64-setup.exe`（6,063,106 字节）；应用 ProductVersion 为 `0.1.0-alpha.2`。安装包签名状态为 `NotSigned`，SHA-256：`7E9F0F2134B3815864248E4ABD2A1D5D53143616308EB74C63D2CD14F7A11BAC`。本地 `check-alpha.local.log`、`build-alpha.local.log`、`desktop-alpha.local.log`、`bundle-overwrite.local.log` 保存对应日志且不提交。

覆盖升级调整：同版本 NSIS 重装和向上升级直接跳过“先卸载/不卸载”选择页，继续原有文件覆盖安装；首次安装、降级和 WiX 迁移保留上游流程。模板来源与维护说明见 [Windows installer template](../src-tauri/windows/README.md)。`pwsh -NoProfile -File scripts/test-installer-policy.ps1` 使用 NSIS 编译并执行真实版本比较和策略代码，六项用例通过；独立只读审查未发现安装流程缺陷。测试不写安装注册表或应用数据，不能替代实际界面和数据保留验收。本轮未改应用代码，未重复前述全量测试。

## Issue #54 窗口尺寸记忆

用户本轮将需求明确为“记住上次关闭时的窗口大小”；远端 Issue 未修改。首次启动使用 1040×760，正常关闭后保存普通窗口尺寸及最大化状态，后续启动恢复；仍允许手动调整，保留 720×520 最小尺寸。状态文件为应用配置目录下的 `.window-state.json`，与聊天数据独立。

桌面验收步骤：首次启动检查默认尺寸；调整为其他尺寸后关闭并重启，确认恢复；最大化后关闭重启，确认最大化并可还原至原普通尺寸；最小化后通过任务栏关闭再启动，确认窗口正常可见。不能以浏览器窗口或 Rust 编译结果替代这些原生交互验证。

2026-09-27：`cargo check --manifest-path src-tauri/Cargo.toml`、现有 20 项 Rust 单元测试及 `git diff --check` 通过。`npm.cmd run tauri dev` 已编译启动，操作系统报告主窗口存在且响应；未完成上述尺寸往返和视觉验收，现有单元测试也不覆盖原生窗口恢复。启动日志有 IPC 自定义协议转 postMessage 及异步回调丢失警告，不将进程启动记作完整桌面验收。本次未修改前端，未运行前端全量测试或真实供应商探测。

## Issue #31 定向验证（2026-09-27）

按用户要求不运行全量测试，使用 Codex 内置浏览器验收，不操作原生桌面。确定性检查覆盖 `conversationTitle.test.ts`、`conversationTitle.repository.test.ts`、`useChatSession.title.test.tsx`，以及受影响的 workspace、消息发送、附件与跨对话并发测试。新增 UI 回归确认仅编辑标题才设 manual 标记；仅修改参数不锁定标题。旧测试的请求观察器现在区分主聊天和额外命名请求，相关失败已定向修复并重跑通过。`npx.cmd tsc --noEmit` 和 `git diff --check` 通过；未运行全量 check、Rust 编译或真实供应商探测。

独立审查发现并修复了 Responses/Gemini 输出截断被误收为标题，以及首条附件消息提交后停止漏掉命名的分支；后者用延迟附件 verify 的确定性用例覆盖。复审未发现剩余运行时问题。

内置浏览器使用独立 `127.0.0.1:1438` origin 和忽略目录 `ui-review.local` 的模拟 transport，实际渲染 App 并操作发送/编辑/导航。确认长原文立即截断为标题、成功后顶部与侧栏同步显示摘要、失败保留原文、后续消息不重命名、手动标题不被迟到结果覆盖，以及刷新后持久化。截图：`ui-review.local/title-success.png`、`ui-review.local/title-verified.png`。模拟请求只验证界面与应用编排，不代表真实模型标题质量或供应商兼容性验收。

## Issue #55 pre-push verification

供应商连接列表与返回入口的提交前检查：`npm.cmd test -- src` 的 43 个文件、458 项测试通过，包含新增的列表字段与多连接跳转、返回时未保存模型编辑确认、删除取消/确认、生成期间禁用、焦点恢复及空状态用例。`npm.cmd run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml` 通过；构建仍提示部分 chunk 超过 500 kB。

默认 `npm.cmd run check` 首次执行误收集了被忽略的 `.gemini-search-diagnosis.local/probe.test.ts`，其已有结果防重复保护在调用前阻止执行。因此改用上述 `src` 测试范围与独立构建，不将默认 check 记为通过，不删除或重跑本地探针。新增测试的确认框模拟在修正后通过。用户已确认连接列表与返回功能；详情页最后一轮对齐及全局下拉框样式仍未完成全面视觉验收，本次未启动桌面或调用真实供应商。

## Issue #51 切换对话定位定向验证

2026-09-27：用户确认 #42 与 #51 手动验收均已完成并通过，授权关闭两项 Issue 并提交代码。此记录为用户提供的界面验收结果。

复用 #42 已有的绘制前定位实现，新增两组组件回归覆盖缓存历史直接挂载、异步历史加载、从上滚暂停的对话切走并切回，以及新建空对话。通过父组件 layout effect 读取子组件位置，验证在 passive effect 前已经到底，避免只检查最终位置而漏掉首屏跳动。happy-dom 的容器尺寸由测试模拟，不能替代实际绘制验收。

验证命令：`npm.cmd test -- src/ui/chat/MessageList.test.tsx`（16 项）、`npx.cmd tsc --noEmit` 和 `git diff --check`。按用户要求不运行全量测试或 Computer Use，切换时无可见滚动过程及空对话显示由用户手动验收。

## Issue #42 流式滚动定向验证

`npm.cmd test -- src/ui/chat/MessageList.test.tsx` 的 14 项测试通过；新增用例模拟滚动容器尺寸，覆盖流式跟随、上滚滚轮先于 scroll 事件时暂停、底部附近继续上滚仍暂停、滚动条回到底部 48px 内恢复、附件预览滚轮不误暂停聊天，以及清空消息和切换会话重置。`npx.cmd tsc --noEmit` 通过。按用户要求不运行全量测试和 Computer Use；实际滚轮与滚动条交互由用户验收，组件模拟不代表实机验证。

## UI #44–#47 定向验证（2026-09-26）

按用户要求使用内置浏览器，避免全量测试和原生桌面自动化。定向回归范围为 `src/App.test.tsx`、`src/Workspace.test.tsx`、`src/ui/chat/MessageList.test.tsx`、`src/ui/settings/SettingsWorkspace.test.tsx`、`src/ui/settings/AppearanceSettings.test.tsx`、`src/ui/settings/ConnectionSettings.test.tsx`。覆盖页面/会话切换、生成状态保护、消息入口、主题/滑块回调、树展开与节点选择分离、模型浏览不改默认、放弃编辑后不残留草稿。前端构建和 Git diff 检查补充验证；未修改 Rust、权限、协议或持久化。

浏览器使用独立 `127.0.0.1:1437` origin 与忽略目录 `ui-review.local` 中的合成供应商、模型和聊天样例，不读取真实密钥、不调用模型。首轮宽屏 1440×900 曾检查贴边级联面板，但该外观被用户指出偏离保留悬浮面板的要求，不能作为视觉接受证据，720×520 验证覆盖导航前后输入框 x/width 不变、分级 Escape、草稿保留和连接详情可访问；浅深主题与透明度回调均实际检查。该证据不等于原生文件选择、背景持久化、安装包升级或真实供应商验收，用户主观视觉反馈仍可继续调整。

首轮上述定向文件的 62 项回归均通过（分别执行，失败修复后仅重跑受影响文件），另对前景色 token 调整执行外观控制器与搜索结果的 28 项相关回归，通过；TypeScript/Vite build 与 diff 检查通过，构建仍有既有大 chunk 提示。独立审查指出并修复了同连接模型切换的编辑残留、最后一个模型删除后的焦点回退和浅蓝前景/焦点对比度。首轮页面截图保存在忽略目录 `ui-review.local/{chat,appearance,connections}.png`，不包含真实聊天或凭据，不代表后续调整版本。

2026-09-27 阶段性提交：依据用户反馈恢复悬浮聊天侧栏、连接两级树，设置页面和分组采用小圆角卡片，外观预览增加用户消息并支持宽屏固定。两级树修正后 App 的 20 项及连接设置的 3 项定向测试通过；后续菜单排版调整重跑连接设置 3 项通过。外观设置 2 项测试在结构调整后通过。用户已要求不再进行截图验收，后续视觉效果由其亲自检查；字体大小、字重、中文字体回退仍待下一轮共同调整。

## Issue #49 图片预览回归

按用户最终确认的样式，待发送附件在输入框上方显示紧凑标签：文件图标、文件名、移除按钮。长文件名省略、多附件换行，完整名称、MIME 与大小放入悬浮提示；草稿不再解码图片或创建 object URL，也不需要扩展 CSP。已发送图片仍可打开预览，解码失败显示明确错误，不改变附件或消息正文。定向回归命令：`npm.cmd test -- src/ui/chat/AttachmentUi.test.tsx`。

2026-09-26：初版曾验证缺少 `blob:` CSP 来源导致缩略图被拦截；用户随后要求改为紧凑标签，最终实现移除草稿缩略图及对应 CSP 改动。桌面自动化截图超时后，按用户要求使用内置浏览器做视觉验收。安装版需重新构建更新后才能获得修复；全程不需真实供应商调用。

已发送附件弹窗的失败提示、关闭再打开及消息保留由组件测试覆盖；浏览器验收聚焦草稿标签布局和交互，不代表原生附件持久化验收。

最终紧凑标签版：426 项测试及前端构建通过；内置浏览器确认标签高 24px、长名称省略、720×520 窗口下多附件换行和单独移除正常。完整文件信息仍可从悬浮提示查看，未发起供应商请求。

用户随后明确确认测试通过，已按授权将 #49 关闭为已完成。此为用户提供的验收结果，不扩大为安装包发布或升级验证。

## Issue #39 现有 OpenAI 兼容协议修复

2026-09-21：按用户本轮要求复用现有 Chat/Responses adapter，补齐 Chat `reasoning_content` 与 Responses `reasoning_text` 的本地显示；保留 OpenAI 官方摘要、显示开关、正文隔离和本地历史规则。用户将 #39 范围修订为修复现有协议，不新增协议或供应商模板，并确认按此范围验收关闭。DeepSeek Chat 关闭思考参数差异另由低优先级 [#40](https://github.com/AyaseMinami/AyaseStudio/issues/40) 跟踪，暂缓处理。OpenAI/DeepSeek 官方合同及参数差异见 [协议说明](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

全量 420 项测试、TypeScript/Vite build、Rust check 通过；定向回归覆盖两个协议的流式/非流式思考字段、关闭显示、错误类型、摘要与内容索引隔离、重复终态快照、合法重复增量、思考期间停止、null/空正文输出截断及拒绝文本。最终快照先补齐正在显示的片段，再追加未出现过的摘要或内容，避免将摘要插入半截思考文本。构建仍提示现有大 chunk，不影响构建完成。

使用用户授权的本地 DeepSeek 配置，通过实际 `ChatTransport` 与 Node fetch 请求模型目录及四个短生成请求。`deepseek-flash` 的 Chat/Responses × 流式/非流式均 HTTP 200，正文均为 `42`，思考字段在传输前后字符数分别一致（55/61/62/59），每次一个正常终态。未重试或自动改协议。该证据仅证明 DeepSeek 线路兼容，不代表 OpenAI 官方端点或 Tauri WebView 联网/桌面交互验收。

尝试 `npm.cmd run tauri dev` 时原生目标编译完成，但 Vite 报 1420 端口已被占用；本轮未完成新增桌面烟雾验收，未停止已有应用或服务。

随后用户确认桌面手动测试已通过，并授权提交、推送及关闭 #39。这是用户提供的桌面验收结果，不扩大为 OpenAI 官方端点的真实调用验收。

本机凭据在 Git 忽略的 `.env.deepseek.local`，脱敏统计在 `.deepseek-probe.local/results.json`；这些本地文件不随仓库分发。现有 `probe:live` 仍读取 `.env.probe.local`，不会自动读取 DeepSeek 专用文件。不要将真实 Key 或完整思考文本加入报告。

Issue #36 / #61 定向验证：`npm.cmd test -- src/chat/CodeBlock.test.tsx src/chat/SafeMarkdown.test.tsx src/ui/chat/SearchResults.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。覆盖代码高亮、未知语言、逐段流式更新、原文复制（缩进、空行、CRLF、末尾换行）、复制失败与既有公式/引用安全边界，以及每块独立换行、流式更新保留选择和两种模式下复制原文。浏览器检查浅深主题、窄窗口自动折行与关闭后的局部滚动；桌面剪贴板实际交互仍需桌面验收。本项不改变原生权限、存储或供应商协议。

2026-09-27 #61 本地验证：`npm.cmd run check` 通过（50 个测试文件、497 项测试及生产构建），Rust check 通过；构建仍有大 chunk 提示。内置浏览器合成样例验证浅深主题、320px/900px 内容容器：窄容器代码正文 clientWidth/scrollWidth 为 286/286，关闭换行后为 286/1877，页面仍为 680/680；900px 容器中换行正文为 866/866，页面为 1100/1100。真实 MessageList 合成消息在 320px 容器中正文为 231/231，页面无横向溢出。键盘 Enter 可切换模式，模拟流式追加至闭合围栏后保持选择。鼠标自动化点击无状态变化，未记作通过。复制按钮显示成功，但浏览器剪贴板读取接口返回空值，原文一致性以组件测试为证，真实剪贴板仍待手动确认。未调用供应商或原生桌面自动化。

本指南用于在办公室、家里或新的 Windows 开发环境中稳定地继续 Ayase Studio 的开发。仓库中的锁文件是依赖版本的权威来源；真实 API Key 与本地运行产物不进入 Git。

## Issue #27 本地验证记录

2026-09-20：按用户本轮确认改为“宽屏正文平滑让位、窄屏覆盖”，替代远端 Issue 中所有窗口正文不移动的约束；未修改远端 Issue。导航使用 200ms CSS 过渡、关闭时 inert/aria-hidden，助手菜单独立 portal，避免动画定位与层叠问题。

`src/Workspace.test.tsx` 与 `src/ui/chat/MessageList.test.tsx` 共 31 项定向测试通过，前端构建通过；独立审查发现的菜单层级与焦点回退问题已修复并复审。内置浏览器检查了宽屏让位、720×520 覆盖（输入框 x/width 开关前后相同）、浅深主题、菜单和三级 Escape、外部点击、隐藏状态及 reduced-motion。未进行本机 Tauri 桌面交互验收或真实供应商请求，这些不由浏览器检查替代。

后续交互修正：按用户反馈移除导航的外部点击遮挡层，正文点击与输入不再强制关闭导航；23 项工作区回归（含展开双栏后直接聚焦、输入且保持展开）及构建通过。该规则替代上方初版验收中的外部点击关闭行为。

## Application identity and existing development data

2026-09-20 本地收尾验证：全量前端 386 项、Rust 20 项测试通过，TypeScript/Vite build、Rust check 通过。Chat 摘要的回归断言改为验证禁用且未选中；Markdown 覆盖 LF/CRLF、硬换行、代码、公式及跨行引用。独立 Edge 浏览器在 720/1280 宽度检查用户/助手/摘要，修正用户消息换行叠加后两行正文均占两行，无页面异常。

本机迁移在应用关闭后完成，自动重载曾生成的新目录先保留为带时间戳的备份；旧 Roaming/Local 目录迁移前后分别 3/2172 个条目的路径、大小、修改时间一致。`tauri dev` 启动后通过实际 WebView 检查设置/聊天导航、输入与清空、刷新恢复：3 个助手、11 个对话及 11 份聊天记录的计数保持一致，无页面异常。仅统计记录数量，不读取凭据或聊天内容，不发供应商请求。上述结果不覆盖附件/背景逐项预览、安装包、升级或开发到生产 origin 的数据迁移。

首次 Alpha 的应用标识为 `io.github.ayaseminami.ayasestudio`，替代未发布开发版的 `io.github.ayaseminani.ayasestudio`。后续发布不得将标识当作可随意修改的显示名称。

Windows 旧开发数据需要同时处理以下两个目录：

| 内容 | 旧目录 | 新目录 |
| --- | --- | --- |
| 附件、背景及数据锁 | `%APPDATA%/io.github.ayaseminani.ayasestudio` | `%APPDATA%/io.github.ayaseminami.ayasestudio` |
| WebView 配置、localStorage、IndexedDB | `%LOCALAPPDATA%/io.github.ayaseminani.ayasestudio` | `%LOCALAPPDATA%/io.github.ayaseminami.ayasestudio` |

这是首次发布前的本机维护步骤，不是应用自动迁移。修改标识前先停止开发监听器，避免配置热重载自动创建新配置目录。迁移前关闭 Ayase Studio、开发启动器及使用任一配置目录的 WebView2 进程；检查两个来源、两个目标和目录占用。目标已有数据时停止，不覆盖、不合并；若确认采用旧数据，可先将两个目标目录分别改名为带时间戳的备份，完整保留新目录内容。将同一父目录内的旧目录重命名为新目录，保留全部内容，不解析聊天或凭据；若第二个目录改名失败，回退第一个及已移动的备份。迁移前后按相对路径、文件大小和修改时间核对文件清单，成功后才启动新标识版本。不要把目录内容或包含用户文件名的详细清单写入 Git 或报告。

应用保存的是附件/背景稳定引用，原生层通过新的 `app_data_dir()` 重新解析路径；WebView 配置随整目录迁移。目录清单一致只证明文件未遗漏，启动成功也不能替代聊天恢复、配置、附件和背景的实际交互验收。开发 origin 与生产 origin 可能隔离存储，不能承诺开发聊天自动成为安装版聊天；安装版升级保留须使用同一发布标识与生产 origin 单独验证。未发布的旧开发版不能在迁移后继续使用，以免重新创建旧目录并形成两份数据。

## Application icon

图标母版为 `assets/branding/ayase-icon.svg`。应用导航与网页 favicon 直接引用该 SVG；
Tauri 打包使用 `src-tauri/icons` 中的 PNG、Windows `icon.ico` 和 macOS `icon.icns`，
路径已由 `src-tauri/tauri.conf.json` 的 `bundle.icon` 配置。
修改母版后运行 `python assets/branding/export.py`（需要 Pillow 及已安装的项目 npm 依赖），
统一重建预览、ICO 和现有桌面打包资源。不要只修改生成的某一张 PNG。
已有 EXE 不会随资源文件自动更新，需重新构建；Windows 图标缓存可能延迟显示变化。
正式安装包和任务栏外观需另行实机验收。

当前 Alpha 阶段只发布 NSIS 安装程序（setup EXE），暂不发布 MSI。统一运行
`npm.cmd run build:windows` 构建 NSIS 包，输出位于
`src-tauri/target/release/bundle/nsis`。应用及安装包版本使用 `0.1.0-alpha.N`；
若内部临时测试 MSI，Tauri 要求 MSI 预发布标识为数字，因此 alpha 字符串版本不能用于 MSI。
仓库默认 bundle target 与打包脚本均限制为 NSIS。
`bundle.windows.nsis.installerIcon` 和 `uninstallerIcon` 显式指向 `icons/icon.ico`；
它们控制 NSIS 安装/卸载程序自身图标，区别于 `bundle.icon` 控制的应用图标。
MSI 文件在资源管理器中通常显示 Windows Installer 的文件类型图标。
仅修改安装器配置且已有当前源码对应的 release 程序时，可运行
`npm.cmd run tauri -- bundle --bundles nsis` 重新封装；此命令不编译源码，
不能代替代码或应用资源变更后的完整打包。

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

Issue #14 / #37 的定向回归可运行 `npm.cmd test -- src/chat/messageOperations.test.ts src/chat/useChatSession.messages.test.tsx src/chat/useConversationWorkspace.test.tsx src/ui/chat/MessageList.test.tsx`。其中使用合成模型、附件存储与 transport，覆盖保存保留历史且不清理附件、编辑并发送、取消确认、截断重发、停止/失败、分支附件引用、配置与生成归属；不消费供应商 Token。配合 `npm.cmd run build` 做类型与打包检查。界面验收关注确认框、键盘访问、窄窗口、复制原文及分支后附件预览；消息编辑区还需检查黑色/深色、自定义背景和浅色主题下的文字、边框与按钮可读性。

应用内连接的 API Key 保存在本机 WebView 的版本化 localStorage 配置中。供应商只是分组；每条连接独立保存名称、协议、Base URL 与 Key，并拥有自己的已添加模型列表。助手默认模型与当前对话模型引用分别保存在 Dexie 助手记录和对话完整快照中；发送通过对话模型所属连接原子地解析请求协议和凭据。旧全局模型 ID 仅作为首次助手迁移的输入。旧版单模型连接与 `ProviderProfiles` 会由应用确定性迁移，开发和测试不应手工复制其中的真实值。

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

Issue #30/#33：助手气泡支持独立颜色和 0–100% 透明度（默认 6%），用户气泡仍跟随强调色。背景选择打开中心取景弹窗，参考框可拖动、允许超出图片边缘，图片可缩放 25%–400%；“恢复居中”恢复中心与默认缩放，确认后保存，取消不改当前背景。窗口比例变化时围绕保存的中心重新取景，不固定裁掉原图。填充/适应决定基础大小，遮罩与模糊继续独立。

2026-09-21 早期裁切版曾通过 32 项定向测试、构建、Rust check 和浏览器检查；这些结果不作为后续中心取景版的验证证据。中心取景版按用户明确要求不运行测试、构建或浏览器验收，只做 TypeScript 与 diff 静态检查。后续如需验收，重点检查不同窗口比例、自由超框和留白、缩放、确认/取消与持久化恢复。原生选图、asset URL 与桌面重启的实际交互仍未验证。

自定义背景只支持 PNG、JPEG 和 WebP，单文件上限为 20 MB（20,000,000 字节）。原生文件选择器在 Rust 命令内完成选择、大小检查、内容格式识别和完整解码，再把副本写入应用数据目录的 `backgrounds` 子目录。React 只收到 `backgrounds/<uuid>.<ext>` 稳定引用与应用私有副本路径，不接收或持久化用户所选原文件的绝对路径。

偏好设置保存在现有版本化外观 localStorage 记录中；图片本体不进入 localStorage、聊天、供应商请求、日志、测试快照或 Git。启动恢复会重新校验私有副本；缺失、损坏或无效引用会清空并回退到基础主题。替换、移除与启动整理只删除该专用目录中符合 Ayase Studio UUID 命名规则且不再被偏好引用的副本，不修改原文件，也不处理目录中的非受管文件。

涉及这条能力的变更除前端测试外，还应运行 Rust 单元测试，并在 `npm.cmd run tauri dev` 中实际验证文件选择、重启恢复、替换、移除、浅色/深色切换，以及 720×520 最小窗口下的可操作性。单纯启动进程不算完成交互烟雾测试。

## Assistant/conversation regression checks

Issue #21 快捷选模定向验证：`npm.cmd test -- src/chat/modelSwitch.test.ts src/Workspace.test.tsx src/chat/useChatSession.messages.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。检查顶部弹窗搜索、连接/协议分组、选中标记、Escape/Tab、窄窗口；保存仅影响当前会话，正在生成的目标不变，下一次请求同步切换连接和协议。测试使用合成配置，不调用真实供应商。不可用的思考选项切回后不自动恢复；四种协议的联网开关均可用。

Issue #25 紧凑布局补充：图标在助手名称左侧，采样与预算字段按表单可用宽度自动分列，自定义数值位于对应选项下方。高级 JSON 默认折叠，校验错误时保持展开；恢复默认配置位于固定底栏。内置浏览器检查了 1280×900、720×520 和 480×640，确认自动减列、无横向溢出以及图标/自定义数值操作；JSON 折叠、错误可见与草稿保留由工作区定向测试覆盖。

Issue #25 的定向回归使用 `npm.cmd test -- src/Workspace.test.tsx`，再运行 `npm.cmd run build` 和 `git diff --check`。覆盖助手菜单导航隔离、排序、默认助手删除限制、Escape 焦点返回，以及弹窗取消/关闭丢弃草稿；既有保存、迁移和生成归属测试保留。2026-09-20 本地 18 项工作区测试及构建通过，内置浏览器完成浅色/深色与 720×520 检查：居中弹窗、固定标题和操作栏、表单滚动、Tab 焦点循环、取消不保存、菜单键盘入口，以及两栏标题/新建按钮/首行对齐均通过。未调用真实供应商；原生截图接口失败后按用户要求停止 computer-use，桌面实际效果由用户验收。此项仅调整 React/CSS 界面，不运行全量协议或 Rust 测试。

助手与对话存储沿用 Dexie v3；不要手工清除真实 WebView 数据来模拟升级。历史 v1/v2 升级将 current 配置转入默认助手，将旧对话参数和模型引用存入本地 `legacyConversationConfigs` 备份，不重新启用该备份作为请求配置，也没有 UI 恢复入口。当前初始化对没有 `settings` 的对话一次性合成所属助手设置与旧覆盖，保存完整快照；已有快照不随助手修改或重启刷新。`src/chat/workspace.test.ts` 用真实旧表形状验证升级、备份、重复初始化、回滚及安全删除；工作区用模拟 transport 验证对话配置隔离和切换期间的请求归属，不访问真实 Provider。

交互验收包括助手创建/编辑/排序、对话新建/切换、标题与配置编辑、独立对话配置与请求冻结、删除助手时迁移/永久删除分支，以及重启恢复。宽窗口和 `720×520` 均检查助手左栏与对话右栏的横向级联、独立滚动、整体联动收起与恢复、只收起对话栏、选择对话后保持展开，以及输入区和停止操作。侧栏采用本文 #27 的宽屏让位、窄屏覆盖规则。早期原生截图返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)` 后停止了 computer-use；该历史记录不代表当前交互验收已完成，启动成功不计作交互验收通过。

内置浏览器已通过真实点击验证助手创建、新建对话及系统指令继承；刷新阶段开发服务连接中断，内置浏览器错误页被 URL 策略拦截，因此没有把刷新恢复或窄窗口视觉检查标为通过。重启恢复和删除分支已由确定性测试覆盖，仍需用户桌面验收。

## Commands reference

供应商排序与浮动菜单补充：用户确认只对供应商排序，增加拖动手柄及菜单上移/下移。定向命令为 `npm.cmd test -- src/chat/settings.test.ts src/App.test.tsx src/ui/settings/SettingsWorkspace.test.tsx`；覆盖顺序持久化、模型/连接选择保持、拖动落下及菜单边界。2026-09-20 的 33 项用例及构建通过；内置浏览器通过实际鼠标拖动观察到插入提示、落下后顺序改变，菜单上下移可用且不撑高分组。此为当前用户对 #26 范围的补充，未更新远端 Issue。

Issue #26 连接页的定向验证：`npm.cmd test -- src/App.test.tsx src/ui/settings/SettingsWorkspace.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。检查分组折叠不改变连接/模型选择、同供应商多连接、菜单重命名与删除焦点、模型编辑未保存切换确认、接口折叠后模型管理可用、请求地址默认折叠且校验错误可见。视觉验收检查浅/深主题、1280×900 与 720×520、长名称及左右独立滚动。此项沿用连接存储与协议接口，不需重复全量协议或 Rust 测试；无真实供应商请求。

2026-09-20：23 项 App/设置定向测试和生产构建通过，独立审查无遗留问题。内置浏览器使用独立本地来源的无密钥样例配置，验证非当前连接重命名不切换详情、同供应商同协议连接创建、接口折叠后添加模型、刷新恢复，以及 720×520 浅/深主题和 1280×900 浅色布局。窄窗口页面、导航、详情及模型编辑表单均无横向溢出；未调用真实供应商，未将浏览器检查表述为原生桌面交互验收。

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

## Concurrent conversation checks (Issue #53)

Run `npm.cmd test -- src/chat/generationTasks.test.ts src/chat/useChatSession.concurrency.test.tsx src/chat/useChatSession.messages.test.tsx src/chat/useChatSession.attachments.test.tsx src/chat/useConversationWorkspace.test.tsx src/Workspace.test.tsx`, then the default code gate. Deterministic transports control A/B event ordering without real credentials or provider tokens. Verify simultaneous sends, isolated text and terminal persistence, current-conversation Stop, same-conversation duplicate rejection, preparation failure, final-save ownership, deletion protection and unmount cancellation. App tests also exercise sending from B while A is still generating. These checks do not establish live-provider throughput or native desktop interaction acceptance.

2026-09-26 内置浏览器行为验收通过：在独立本地 origin 上使用合成配置和可控 SSE，保留真实 App、任务管理、IndexedDB 和 OpenAI Chat 协议解析，仅替换 Tauri 网络入口。通过页面结构读取及键盘操作确认 A 生成时 B 可编辑历史并发送、双任务同时生成、停止 B 不影响 A、A 失败或完成不解除 B 的生成保护，以及刷新后独立恢复消息与终态。未使用截图；浏览器点击接口报错，因此本轮不声称验证了鼠标点击路径或视觉布局。未读取真实密钥、调用供应商或验证原生窗口；临时验收文件和服务已清理。

## Attachment checks (Issue #5)

Windows 窗口禁用 Tauri 原生路径拖拽截获，使用 HTML5 `DataTransfer.files` 获取实际拖入的 `File`，不向原生命令传送任意来源路径。

已发送但后来因清空或删除而无主的附件不会立即永久删除：先移动到私有隔离目录，仍可凭引用预览；至少 30 天后经过两次间隔一小时以上的无主引用扫描才彻底回收。打开时可读取隔离副本，重新扫描有主引用可恢复活动副本。发送前新副本位于私有暂存目录；聊天记录提交失败或发送前中止时立即删除，成功提交后副本可凭引用读取，启动或后续引用整理时转入活动目录。异常退出后，已发送副本仍可从暂存目录读取并恢复；无主暂存副本会被清理。清理失败不得伪装成消息保存失败。

输入框左下角的附件按钮、拖入聊天区域和粘贴图片仅形成本次运行内的当前对话草稿。草稿只保留 `File` 句柄和元数据，仅读取一小段格式头识别 MIME，不提前读入或缓存整图 Base64。第一阶段只提供 PNG/JPEG/WebP/PDF/TXT/Markdown，文本须能作为 UTF-8 文本映射；不设统一的单文件 10 MB 或单消息 20 MB 应用上限。图片后缀与内容不一致时使用识别出的实际 MIME；本地不完整解码图片，也不因图片/PDF 无法在本地解析而预先拒绝，供应商可能自行拒绝不合规内容。选择/拖入不会联网或留下永久副本；点击“发送”才逐项完整读入文件、复制到应用私有暂存目录并和文本一起进入本次请求；每项读取后检查中止。新用户消息写入数据库成功、原生层核对全部副本可访问且大小一致后才开始网络请求；这一步不在 JS 重新加载图片。发送后的历史消息只持有私有副本引用及元数据，不在对话状态中缓存图片字节；一次请求和打开的预览短暂在内存中持有内容，请求结束或关闭预览后不建立长驻缓存，具体回收时点由运行时决定。已发送消息上的附件按钮只读打开图片、文本/安全 Markdown 或按页本地 PDF.js 预览；原文件删掉后仍应能读出。清空和删除对话会按所有对话仍持有的引用清理副本，不能误删其他对话共用的引用。桌面主窗口仅在取得应用数据锁后创建，重复启动通常聚焦已有窗口，避免跨进程误删暂存文件。

本地确定性测试和 Rust 单元测试覆盖校验、协议映射、存储、草稿不跨重启、引用清理和预览入口。桌面烟雾测试要亲自验证文件选择、Windows 文件拖入、图片粘贴、仅在点击发送后发起一次请求、出错后的预览以及 PDF 页面渲染；不读取实际密钥或花费真实 Token 时，可先检验草稿和本地保存/预览，联网请求仍标记未验证。

## Issue #6 定向验证

本次按用户要求不运行全量测试；只检查搜索解析、引用 UI、会话保存/手动续接，再运行 `npm.cmd run build`、`cargo check --manifest-path src-tauri/Cargo.toml` 和 `git diff --check`。外链新增 Tauri opener 权限；Gemini 建议需要在浏览器与桌面实际检查容器布局及外链。进程启动不代表桌面交互通过，真实供应商探针仍需单独授权。实施范围见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
