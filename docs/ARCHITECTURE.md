# Ayase Studio Architecture

Issue #36：SafeMarkdown 通过 remarkCodeBlocks 保留代码节点的语言和复制文本，CodeBlock 负责语言标签、复制反馈与 lowlight 语法树的 React 渲染。常用语言和 PowerShell 本地打包，未知语言不自动检测，按纯文本显示；不注入 HTML、不执行代码。围栏内文本保留换行形式和末尾换行，列表/引用容器的缩进仍由 Markdown 解析器处理。高亮按代码与语言缓存，组件类型保持稳定，流式更新不重建代码块。代码区沿用两种主题下的深色底板，只有代码正文横向滚动；消息存储、整条消息复制和请求内容不变。

聊天内容宽度由 App 持有的 `useChatLayout` 管理，以独立 localStorage 键 `ayase-studio.chat-layout.v1` 保存本机全局偏好。默认窄屏，宽/窄模式只通过聊天容器 CSS 变量同步约束消息列与输入框，不进入助手配置、会话数据库或请求。存储不可用时当前运行仍可切换。

## Purpose

聊天顶部的窄内容模式与窄窗口是两个概念：大于 1100px 的窗口中，窄内容列以原聊天工作区的中心为锚点，优先让侧栏占用左侧留白，只有侧栏侵入该列时才向右让位；宽内容模式仍按侧栏占用宽度让位。不超过 1100px 的窗口维持覆盖布局。

界面排版使用本机字体，Windows 的拉丁字符优先 Segoe UI，中文明确回退到 Microsoft YaHei UI / Microsoft YaHei；其他系统回退到 PingFang SC、Noto Sans CJK SC 等。不随应用分发这些系统字体文件。App.css 统一维护 12px 提示、13px 次要文字、14px 控件、16px 区块标题四档字号；聊天正文为 16px、1.75 倍行高，代码与 KaTeX 保留各自字体。

Ayase Studio 是一个轻量、local-first 的桌面聊天客户端。架构目标不是复制 Cherry Studio 的规模，而是用少量稳定的模块接口承载四种协议、多个连接配置、助手与对话，以及后续附件和供应商原生搜索能力。

本文件描述当前实现与已确认的目标方向。GitHub Issue 决定功能范围，代码与测试决定当前事实；未来能力在实现前不得被当作已经可用。

## Technology stack

| Area | Choice | Responsibility |
| --- | --- | --- |
| Desktop host | Tauri 2 | Windows 窗口、WebView、权限与原生能力入口 |
| Native language | Rust 2024 edition | Tauri 启动、插件注册和少量必须的宿主逻辑 |
| UI | React 19 + TypeScript | 页面模块、交互状态和应用编排 |
| Build | Vite 8 | 前端开发服务器和生产构建 |
| Styling | Tailwind CSS 4 + CSS | 布局、语义化主题变量和 Markdown 样式 |
| HTTP | Tauri HTTP plugin | 从 WebView 发起允许的跨域请求 |
| OpenAI client | OpenAI JavaScript SDK | OpenAI 协议类型与流式请求支持；其他协议仍使用显式适配器 |
| Persistence | Dexie 4 / IndexedDB | 本地设置、会话和消息持久化 |
| Rendering | react-markdown + remark-gfm + remark-math + rehype-katex | 安全 Markdown 与数学公式渲染，不启用原始 HTML |
| Tests | Vitest 5 | 确定性协议、存储和 UI 逻辑测试 |

`package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock` 是实际依赖版本的权威来源，本表用于解释选型，不替代锁文件。

## Runtime topology

```text
React UI
  │ neutral ChatRequest / ChatEvent
  ▼
ChatTransport interface
  ├─ OpenAI Chat adapter
  ├─ OpenAI Responses adapter
  ├─ Gemini Native adapter
  └─ Anthropic Native adapter
  │
  ▼
Tauri HTTP plugin ── HTTPS ── Provider or relay

React UI
  │ ChatSnapshot
  ▼
ChatRepository interface
  ▼
Dexie / IndexedDB

React appearance settings
  │ stable background reference
  ▼
AppearanceController
  │ dedicated Tauri commands
  ▼
App data / backgrounds

React chat runtime
  │ runtime-only attachment drafts / sent stable references
  ▼
AttachmentStore → validated Tauri commands → App data / attachments
  │ reference ownership from ChatRepository across all conversations
  ▼
ref-safe private-copy cleanup
```

Tauri 是宿主，不是界面控件库。Panel、主题和布局属于 React 与 CSS；Rust 层不承载聊天业务状态，除非浏览器环境无法安全或可靠地实现某项能力。

## Current project structure

供应商顺序直接沿用配置记录中 `providers` 数组的顺序保存；供应商标题的拖动手柄和浮动菜单“上移 / 下移”共用 `moveProvider`。拖动以目标分组上下半区决定插入前后，并显示对应边缘的插入线；只调整供应商顺序，不改变连接归属、内部顺序、当前模型或编辑状态，无新增存储字段和迁移。供应商与连接管理菜单沿用助手菜单的浮动样式和键盘导航，供应商额外提供排序；连接菜单仍仅重命名、删除。

Issue #26 的连接配置采用左侧供应商 → 连接分级导航、右侧连接详情两栏。导航分组折叠与当前连接选择独立；导航和详情分别滚动，模型列表不另设纵向滚动层。接口配置可手动折叠，模型管理位于折叠区域之外；只读请求地址详情默认折叠，URL 校验错误仍显示在输入框附近。菜单提供供应商及连接重命名、删除，名称沿用失焦保存，地址与密钥沿用即时保存，模型编辑仍显式提交。布局状态仅在当前页面内存中保存，不增加存储或迁移；设置页模型选择仍作用于助手的新对话默认模型。

```text
AyaseStudio/
├─ src/
│  ├─ App.tsx                 application-shell composition root
│  ├─ App.css                 semantic theme tokens and shared component states
│  ├─ main.tsx                React entry point
│  ├─ appearance/
│  │  ├─ appearance.ts        validated preferences and theme controller
│  │  ├─ bootstrap.ts         pre-render theme application
│  │  ├─ browser.ts           localStorage and matchMedia adapters
│  │  ├─ backgroundResources.ts Tauri command and asset URL adapter
│  │  └─ useAppearance.ts     React subscription seam
│  ├─ chat/
│  │  ├─ types.ts             neutral request, event and transport interface
│  │  ├─ transport.ts         four protocol adapters and error normalization
│  │  ├─ runtime.ts           Tauri HTTP adapter wiring
│  │  ├─ sse.ts               SSE framing parser
│  │  ├─ repository.ts        ChatRepository and Dexie adapter
│  │  ├─ attachments.ts       draft format metadata and transient content
│  │  ├─ attachmentResources.ts Tauri-only file storage/reading interface
│  │  ├─ settings.ts          supplier/connection/model domain and v1/v2 migration
│  │  ├─ modelCatalog.ts      protocol-aware remote model discovery client
│  │  ├─ urlResolution.ts     shared Base URL validation and endpoint resolution
│  │  ├─ modelGrouping.ts     stable configured/discovered model grouping
│  │  ├─ modelAvailability.ts explicit single-model availability test
│  │  ├─ useChatSession.ts    chat runtime and persistence orchestration
│  │  ├─ SafeMarkdown.tsx     safe Markdown rendering
│  │  └─ *.test.ts[x]         deterministic tests
│  └─ ui/
│     ├─ AppShell.tsx         top-level chat/settings navigation and workspace
│     ├─ chat/                header, message list, composer and workspace
│     └─ settings/            categorized settings workspace and pages
├─ src-tauri/
│  ├─ capabilities/           Tauri permission declarations
│  ├─ src/                    Rust application entry points
│  │  ├─ background.rs        validated private background import and cleanup
│  │  └─ attachments.rs       validated sent-copy storage and managed ref cleanup
│  ├─ Cargo.toml              Rust dependencies and release profile
│  └─ tauri.conf.json         desktop application configuration
├─ scripts/
│  └─ provider-probe.live.ts  opt-in real-provider compatibility probe
├─ docs/
│  ├─ PLAN.md                 current product plan and acceptance gates
│  ├─ PROTOCOLS.md            protocol and URL contract
│  ├─ ARCHITECTURE.md         this document
│  └─ DEVELOPMENT.md          environment and workflow guide
├─ .env.probe.example         tracked secret-free probe template
├─ package.json
└─ vite.config.ts
```

`App.tsx` 只组合外观、聊天会话、顶层页面选择与界面模块。`useChatSession` 无条件位于组合根中，因此聊天和设置页面切换不会重建聊天运行状态。聊天请求、流式终态、取消和持久化队列集中在 `useChatSession`；设置页、标题栏、消息列表与输入区不重复实现这些规则。

## Stable module seams

### ChatTransport

Gemini 思考由 `geminiThinking.ts` 集中维护协议选项、数值结构校验和请求字段映射。助手配置中的可选 `geminiThinking` 保持旧记录兼容；输入区快捷修改持久化到当前对话配置。发送时冻结整个有效配置。`thinking-delta` 与 `text-delta` 独立，`StoredChatMessage.thinkingSummary` 仅用于本地展示，不进入 `ChatMessage` 请求历史；复用现有节流保存与中止恢复。`ThinkingSummary` 用 SafeMarkdown 渲染供应商可读摘要，不展示或存储 thoughtSignature。折叠状态属于组件临时状态，用户手动展开后不随正文增量强制收起。

Issue #16 的 `thinking.ts` 为四协议控件提供协议选项、结构校验与配置读写；Gemini 委托原模块，其他协议使用可选 `SessionConfig.thinking[protocol]` 独立保存。2026-09-19 按用户修订移除模型能力白名单、型号档位限制、预算与输出/采样冲突拦截。模型 ID 不参与思考配置准入；供应商验证能力与参数组合。同协议切换模型不重置配置；Issue #21 快捷选模跨协议切换使用目标协议独立值，并清除两端不共通的选项，详见下文。缺字段即供应商默认，摘要默认关闭，无数据库版本迁移。Anthropic 模式/预算与 effort 分开表达。最终请求由 `requestMapping.ts` 验证结构和可映射字段；本地历史、受保护 JSON 与附件安全边界保留。

供应商 HTTP 错误保留状态码和完整响应正文，流式错误保留错误载荷；凭据在 transport 内脱敏后进入中立错误事件，界面以文本展示。错误不会触发自动降级、删除参数或重试。

Responses 的 `responseThinking.ts` 是 adapter 内部的思考文本拼接器，按 item、summary/content 类型、各自索引和事件序号协调增量与完整结果，避免 done、output item、terminal 重复添加内容。除官方 summary_text 外，也读取明确返回的 reasoning_text。Chat 在现有 adapter 中读取兼容服务的 reasoning_content 扩展，不增加供应商协议或模型白名单。Anthropic 只接收 thinking block 的可读字段；签名、密文和 redacted block 不保存。每次生成拥有独立解码状态；adapter 和会话运行时均按冻结配置丢弃被关闭的思考内容。普通无工具多轮仅回传正文，不增加供应商托管状态或结构化思考历史。

界面只提交中立的聊天请求并消费中立事件。每个协议适配器独占以下知识：

- 端点和请求头。
- 消息与参数映射。
- SSE 或非流式响应解码。
- 供应商错误归一化。
- 未知事件兼容与唯一终态。

调用者不应判断供应商事件名称，也不应在界面层拼接协议路由。

### ChatRepository

界面通过仓库接口加载、保存和清除对话，不直接操作 Dexie。随着多对话、附件和迁移规则增加，复杂性应继续留在存储模块内，而不是分散到各个 Panel。

Issue #14 的消息编辑、单条删除与分支通过工作区命令队列执行；修改前等待该对话写入结束，数据库事务成功后刷新消息视图。Issue #37 将保存编辑改为只更新所选消息，保留后续历史和附件，不请求模型、不整理附件引用；编辑助手正文仍清除该消息失效的搜索引用和续接数据。单条删除不连带删除其他消息，并按剩余引用整理附件。助手消息用 `replyToId` 绑定用户消息，旧记录在读取和删除前按原顺序补齐，删除后不重新猜测归属。缺失原提问的回复仍可查看，但不能重新请求，也不会与其他提问拼成请求轮次。

仅用户消息提供“编辑并发送”，确认框说明移除后续历史。此操作将编辑文本直接交给现有重发流程，预检失败或提交前停止不修改历史；预检通过后，一次保存修改后的提问、截断历史和新回复占位。请求失败或提交后停止保留已编辑及截断的记录，不恢复旧历史、不自动重试。附件整理沿用所有会话引用核对。编辑区使用不透明主题底板、明确的文字和边框颜色，避免聊天背景或用户气泡文字色影响可读性。

重新请求复用正常发送的配置冻结、附件读取、预算、流式保存和停止流程；输入截至对应用户消息，预检成功后保存截断记录和新回复占位，再发起一次请求。旧回复及后续记录不保留；失败不自动重试。运行中对话的消息修改与分支被阻止，导航不改变请求归属。分支事务复制截至切点的消息、重建消息 ID 与回复引用，附件共用已有私有副本。新对话保存在原助手下，标题使用 `(N)` 后缀；`creationConfig` 只记录创建时的模型引用与生成配置，不含连接凭据，不参与当前对话的运行配置。无需新增数据库索引，新增可选字段兼容旧记录。

### URL resolution

`urlResolution.ts` 为配置预览、四种生成 adapter 与模型目录提供同一套 Base URL 校验、协议归一化和最终端点解析。配置值、标准化 Base URL 和最终请求端点是三个不同概念；设置页只保存用户输入，直接从当前连接和明确选中的模型计算预览，Gemini 无模型上下文时不显示虚假的最终端点。OpenAI SDK 接收解析后的标准化 Base URL；原生协议 fetch 接收解析后的最终端点。聊天发送、目录读取和模型测速都在建立运行时请求前调用这一校验；解析确定、幂等，且不能通过自动回退发送第二次生成请求。

### Connection settings

连接配置使用一个版本化 localStorage 记录，并通过 `settings.ts` 的纯函数完成加载、校验、迁移、CRUD 和活动引用校验。React 界面不直接读写 localStorage。供应商只提供命名分组；连接完整持有名称、协议、Base URL 与 API Key；每条连接再拥有零到多个已添加模型。同一供应商可以建立多条相同或不同协议的连接，相同实际模型 ID 也可以分别存在于不同连接中。

运行时模型只读取 `Conversation.settings.modelId`，从模型唯一父连接原子取得协议、Base URL 与 Key。设置页的 `activeModelId` 表示助手默认模型，只用于以后新建对话；已有对话通过编辑弹窗修改或恢复助手默认值。删除模型或连接后，会话引用保留为失效状态并阻止发送，不回退到助手或其他线路。会话配置不复制连接凭据。

加载顺序优先采用 v3 记录；若不存在有效 v3，则将 v2 的单模型连接迁移为每条连接下的一个稳定模型实体；再无 v2 时才迁移旧 `ayase-studio.provider-profiles.v1`。迁移使用稳定 ID 和固定协议顺序，因此重复加载不会产生重复对象。内置 OpenAI、Google Gemini 与 Anthropic 只是只读创建模板；创建结果与自定义供应商使用相同数据类型和运行时路径。

### Model discovery and availability

`modelCatalog.ts` 以连接为请求边界，按四种协议构造模型目录 GET 请求、凭据头、分页和响应映射；返回值是内存中的候选目录，不直接写入配置。界面可以搜索、分组并显式把单个候选项添加为 `ConfiguredModel`。并非所有中转站都实现目录端点，因此失败或空刷新只作为该连接的可见状态，不删除上次成功结果，也不阻止手动添加。显示错误前必须删除其中出现的当前 API Key。

`modelAvailability.ts` 复用该连接协议对应的 `ChatTransport` 发起一次受限的极短请求，消费统一 `ChatEvent` 并记录首段与总耗时。测试必须由用户对单个模型显式触发；同一时刻最多运行一个，可取消、有超时，且不自动重试或自动选择模型。用户取消优先于随后发生的超时，配置变化会使旧异步结果失去写回资格。

### AppShell, Settings and Theme

`AppShell` 提供固定的顶层功能导航，并在聊天和设置两个工作区之间切换。聊天工作区组合助手栏、对话栏、标题栏、消息列表与输入区；设置工作区拥有自己的分类导航，当前将连接配置与外观拆分为两个页面。页面选择由 `App.tsx` 管理，不引入路由框架，也不会因为切换视图而取消或重发聊天请求。这些是固定职责的 React 与 CSS 模块，不是可插拔 Panel 或 IDE 停靠系统。助手栏和对话栏在这个组合根内参与布局，不混入聊天运行逻辑。

主题模块以 `themeMode`、`resolvedTheme`、自定义颜色、背景显示参数和更新操作作为 React 接口。普通界面模块只使用语义化 CSS 变量，不知道具体的 `stone` 或 `violet` 色阶，也不各自监听系统主题。浅色、深色和跟随系统的解析、系统变化订阅、安全颜色派生、遮罩下限、损坏配置回退与本地持久化集中在 `AppearanceController` 内。自定义强调色会派生具有安全前景色的强调/焦点/用户消息语义变量；自定义画布色按实际浅色或深色主题调整到可读范围，并重新派生 Panel、输入、悬停和边框表面。原始自定义值保持不变，因此跟随系统切换后可以基于新的实际主题重新计算。顶层页面与设置分类属于瞬时导航状态，由应用组合根拥有，不混入外观偏好存储。

外观偏好使用一个版本化的 localStorage 记录，保存颜色、`backgrounds/<uuid>.<ext>` 稳定引用、填充/适应、35%–90% 遮罩、0–32 px 模糊和可选的相对原图取景中心及缩放。`bootstrap.ts` 在主 React 入口前应用已保存或系统解析后的实际主题与颜色；React 随后通过同一个解析规则建立实时订阅，并异步解析背景私有副本。只有资源重新通过大小、类型、完整解码和引用校验后，asset URL 才进入共享背景渲染组件。

Issue #30 按用户补充支持助手回复气泡独立颜色及 0–100% 背景透明度（0% 不透明、100% 完全透明，默认 6%）。颜色未设置时沿用主题表面色，设置后按用户颜色显示，仅背景色 alpha 改变；正文、思考摘要、按钮与用户消息不改变透明度。用户消息继续跟随强调色。高度透明或自定义低对比颜色不保证任意背景上的对比度，用户可自行搭配遮罩。新字段缺失时使用默认值，重置外观一并清除；不增加数据库迁移。此处独立气泡颜色是当前用户对远端 Issue 范围的补充，未修改远端。

Issue #33 按用户后续修订改为中心取景与图片缩放：保留完整私有原图，保存相对原图的中心 x/y 和可选 zoom（默认 1，支持 0.25–4）。中心允许超出 0–1，不吸附或限制在图片边缘；超框区域显示画布色。固定比例参考框只辅助定位，实际显示窗口按当前宽高比重新计算取景范围，填充/适应决定基础缩放，再应用用户 zoom。早期未发布裁切配置读取时采用原矩形中心，丢弃固定裁切范围。新图片导入先进入临时草稿，确认才更新引用与取景设置，取消保留旧背景；原有私有资源清理和持久化失败引用保护不变。背景、设置预览与取景预览共用 BackgroundImage，无新原生命令、上传或图片重新编码。远端 Issue 未修改。

背景选择、复制、恢复与清理由 `background.rs` 的专用 Tauri 命令完成。选择器不把原文件路径返回 React；导入只复制到应用数据目录的 `backgrounds` 子目录。替换、移除和启动整理按当前稳定引用集合删除未引用的受管副本，永不删除原文件或非 UUID 管理文件。asset protocol 只开放 `$APPDATA/backgrounds/**`；CSP 的图片源允许同源、`asset:`/`http://asset.localhost` 和已发送附件预览的 `data:`，不开放任意远程图片源。待发送附件在输入框上方显示文件图标、文件名和移除按钮组成的紧凑标签，不解码图片或创建 object URL；已发送图片解码失败时显示明确提示，保留附件记录与消息正文。背景内容不会进入聊天或任何供应商 transport。

## Domain direction

当前连接配置、助手和对话的数据关系如下：

```text
ProviderGroup
└─ ConnectionProfile
   ├─ id
   ├─ name
   ├─ protocol
   ├─ configured base URL
   ├─ API key
   └─ ConfiguredModel[]
      ├─ internal id
      ├─ actual model id
      └─ optional display name

Assistant
├─ default model reference
├─ default system instruction
├─ default generation settings
└─ Conversation
   ├─ title and timestamps
   ├─ independent full configuration snapshot (including model reference)
   ├─ Message
   │  ├─ text
   │  ├─ sent attachment references (app-private copies)
   │  └─ citations/search metadata
   └─ text / attachment draft (in memory, per conversation)
```

供应商只负责分组，不提供父级配置继承。助手提供新对话的默认配置；当前对话通过自身快照中的已添加模型引用解析所属连接，不复制连接配置或凭据。修改助手不更新已有对话，分支复制完整配置，恢复助手默认值须显式保存。助手是预设与对话容器，不是 Agent；附件和供应商托管搜索不会自动引入 MCP 或通用工具执行循环。

### Application identity and Windows storage

首次 Alpha 前将应用标识固定为 `io.github.ayaseminami.ayasestudio`。Windows 下 Tauri 的 `app_data_dir()` 位于 `%APPDATA%/<identifier>`，存放附件和背景；默认 WebView 数据目录位于 `%LOCALAPPDATA%/<identifier>`，其中的浏览器配置承载 localStorage 和 IndexedDB。旧开发版的 `ayaseminani` 拼写只作为迁移来源，不增加运行时双目录回退。更名须关闭旧版及其 WebView，并将两个完整目录成对迁移；目标已有数据时禁止覆盖或合并。变更标识不改变浏览器 origin，开发版与生产版的存储仍可能按 origin 隔离，开发版数据迁移不等于安装版升级验收。操作边界见 [开发指南](DEVELOPMENT.md#application-identity-and-existing-development-data)。

## State ownership

- 瞬时视图状态：顶层页面与设置分类由应用组合根管理，局部交互由拥有它的 React 界面模块管理。
- 聊天运行状态：集中管理流式消息、取消、唯一终态和持久化队列。
- 外观状态：由主题控制器管理主题模式、实际配色、安全派生、背景稳定引用、显示参数与系统变化订阅；原生 adapter 管理私有文件生命周期。
- 用户设置：通过明确的加载、校验、确定性迁移与保存入口管理；当前模型由单一 ID 标识，父连接按归属关系解析。
- 供应商差异：只存在于协议 adapter 内。
- 长期数据：通过 repository seam 进入 Dexie 或后续本地文件存储。

不要仅为了减少属性传递引入全局状态库。只有多个相距较远的真实调用方共享同一状态并且现有接口明显失去局部性时，才重新评估。

## Security invariants

- 模型输出和搜索结果不渲染原始 HTML；`rehype-raw` 与等价绕过方式禁止使用。
- API Key 不进入消息、Issue、PR、测试快照、错误日志或 Git。
- Alpha 阶段凭据仍是本机明文配置，界面必须如实提示，不使用伪加密制造安全错觉。
- Tauri 网络权限保持最小化；远程请求使用 HTTPS，本地开发仅允许 `localhost` 和 `127.0.0.1` 的 HTTP。
- OpenAI Responses 继续使用本地历史和 `store: false`，除非单独 Issue 明确改变隐私模型。
- 不对模糊网络失败自动重试生成请求，避免得到重复回复或重复计费。
- 自定义请求参数不能覆盖模型、消息、System Instruction、流式模式、最大输出和其他受保护字段。
- 背景图片不进入消息、模型请求、遥测、日志或 Git；原文件路径不持久化，asset protocol 只暴露应用私有背景目录。

## Testing strategy

- SSE framing、协议字段映射、错误分类、取消与存储恢复使用确定性测试，不依赖真实网络。
- 每个请求恰好产生一个终态：`completed`、`failed` 或 `aborted`。
- 真实探针只回答中转站是否透传某项能力，不替代确定性回归测试。
- 供应商、重复协议连接和模型的增删改、v1/v2 迁移、当前模型恢复及删除时清空引用使用注入式内存存储完成确定性测试。
- 四种协议的模型目录路径、请求头、响应归一化、去重分组和安全错误，以及模型测试的耗时、失败、取消和超时均使用合成 transport/fetch 测试，不访问真实服务。
- 连接设置界面覆盖“浏览连接不会改变助手默认模型”、供应商折叠与连接选择独立、目录候选需显式添加，以及删除当前对象不静默回退。
- 顶层页面导航、设置分类或主题变化必须保留发送、流式增量、停止生成、草稿与错误状态，以及重启恢复行为。
- 主题解析、系统变化、持久化与损坏配置回退使用注入式依赖完成确定性测试。
- 自定义颜色安全派生、背景显示参数、缺失资源回退和引用集合清理通过 `AppearanceController` 接口测试；Rust 测试覆盖 20 MB（20,000,000 字节）、PNG/JPEG/WebP 完整解码、稳定引用、复制不改原文件和受管副本清理。
- 涉及 Tauri 权限、窗口或本地文件的改动必须完成桌面烟雾测试。

## Change rules

新增能力时优先加深现有模块：让适配器隐藏协议复杂性，让 repository 隐藏存储复杂性，让主题模块隐藏配色解析。只有行为确实存在两个实现时才建立新的 seam；不要创建只转发参数的浅模块。

架构变化满足以下任一条件时，应在同一 PR 更新本文档：

- 新增或改变稳定模块接口。
- 改变依赖方向、数据所有权或持久化位置。
- 新增协议、宿主权限或安全边界。
- 当前结构与本文的目录说明不再一致。

## Issue #3 conversation generation configuration

助手默认值保存在 `AssistantPreset.defaultConfig/defaultModelId`，仅作为模板。每个对话在 `Conversation.settings` 保存完整的 `{ modelId, config }` 快照，发送、标题、预检和预算只读取该快照。新建对话复制助手当时设置，修改助手不传播到已有对话。“恢复助手默认值”把助手当前完整设置复制到编辑草稿，保存后生效；不改变标题或消息。`SessionStore` 只写消息，清空消息保留设置；`creationConfig` 仅是历史记录。

## Issue #4 assistants and conversations

`workspace.ts` 定义助手预设、对话元数据、导航记录及完整操作命令。Dexie v3 保留 `chats`、`assistants`、`conversations`、`workspace`，新增 `legacyConversationConfigs`。历史 v1/v2 升级事务将旧对话配置和模型引用按对话 ID 备份，再移除活跃记录中的对应字段；消息与时间戳不变。v1 的 `current` 配置迁入默认助手；v2 的助手配置保留为后续完整快照初始化的模板，原对话差异仅保存在本地备份，不重新参与请求。当前已有对话以自身 `settings` 为唯一配置来源，不随助手更新。备份没有 UI 恢复入口，不会被后续保存覆盖，永久删除对应对话时一同删除。初始化在单个事务内创建不可删除的默认助手，将旧 `current` 和孤立消息记录原地归属，修复失效助手/导航/模型引用。重复初始化不复制数据；加载错误显示重试入口，不按空数据库继续写入。

初始化事务对没有 `settings` 的旧记录一次性合成助手配置与旧 `overrides`，保存完整快照并移除旧覆盖字段；没有覆盖的记录复制所属助手设置。转换在助手模型引用修复前完成，保留原有失效引用，不采用历史 `creationConfig` 或重新启用 v2 备份。已有快照在重启时不从助手刷新，转换失败会回滚整个事务。沿用 Dexie v3 元数据字段，无需新索引。分支深拷贝原对话快照；迁移到默认助手只改归属，保留配置和消息。永久删除对话同时移除快照。

`useConversationWorkspace.ts` 拥有导航操作队列、按 ID 缓存的 Store 和消息/草稿/错误/参数校验/上下文提示视图。`useChatSession` 保持生成编排与连接操作，发送时冻结会话有效配置、模型及连接目标、目标 Store 和对应视图更新函数；切换视图或编辑配置不改变旧请求。全局同时最多一个生成，其他对话可以查看并编辑草稿；停止按钮作用于正在生成的请求。删除生成中对话或其助手前，需先停止并等待终态保存。保存失败后的写入栅栏会尝试重新保存当前状态一次，持续失败则保留错误。

Issue #5 附件草稿是同一按对话 ID 保留的会话内视图状态，只持有 `File` 句柄和元数据，仅读取小段文件头识别 MIME，仅在本次运行保留，不写入 IndexedDB，也不提前缓存整图 Base64。文件选择、拖入聊天区域和图片粘贴只加入草稿；读取途中禁用发送。点击发送后先预算，再逐项读取本次草稿与所需历史附件，每项之后检查中止；新附件只在此时转为请求内联内容并复制到 `$APPDATA/attachments/staging`，得到不包含来源路径的稳定引用。用户消息及占位助手消息通过 `SessionStore` 成功持久化后，原生层按引用一次核对全部副本仍可访问且大小一致（不在 JS 重新加载整图），随后才发起供应商请求；副本缺失则先回滚消息记录且不联网，即使此时用户按了停止也核对所有已入库副本。已入库副本可以留在暂存目录供预览和历史读取，启动或后续引用整理才将其转入活动目录，因此联网前没有批量转正/部分转正的回滚问题。若提交失败或发送前中止，立即清掉未提交暂存副本。即使生成失败或取消，已发送用户消息仍拥有附件，重启可只读预览。清空、删对话或删助手时，仓库汇总所有现存消息引用后原生层只清理不再被引用的托管文件；无法读取数据库时不清理。文件保存和清理串行化，新文件在尚未完成消息提交时作为临时保留引用参与清理计算，避免跨对话误删。桌面主机先持有应用数据目录的进程级文件锁，再手动创建主窗口；Tauri 单实例插件处理重复启动的聚焦，文件锁弥补其 Windows 初始化竞态。消息级操作留给 Issue #14，并必须遵守相同引用规则。

原生清理对活动目录的无主 UUID 文件先同卷移动到私有 `attachments/quarantine`，不信任前端列表立即永久删除可能已发送的副本；已发送预览及历史请求读取同时检查活动、暂存和隔离目录，后来重新扫描为有主时恢复活动副本。隔离满 30 天后仍无主，先记一次扫描，再至少一小时后的独立扫描仍无主才最终回收；此保留期是避免清理错误立即破坏已发送引用的磁盘空间权衡。暂存目录既可容纳尚未完成提交的副本，也可容纳已被数据库引用、待整理转正的副本；明确提交失败或发送前中止只删除未提交副本。启动整理依据数据库权威引用转正已提交副本、清理无主暂存副本。所有操作仅接受受管 UUID 引用，不读取任意用户路径，Windows 拖入使用 HTML5 `File`。

上下文提示按对话只缓存计数摘要，不缓存请求消息或已发送图片 Base64。未发送草稿在当前运行内暂存 `File` 句柄；生成期间仍可编辑文本、添加或移除附件，但当前生成停止前不接受新发送。点击发送才完整读入内容；异步准备完成后，只清除本次已发送且未被继续编辑的文本及本次已发送附件，保留准备期间新增或修改的草稿。历史只保留应用私有文件引用和元数据。历史附件仅在该次请求中按引用读取，预览仅在打开期间读取，结束后不建立跨请求或跨预览的内存图片缓存。最终 Body 只检查对应协议可直接测量的官方输入限制，不再使用统一的应用级附件大小或请求体大小上限；校验失败不复制新附件、不写入用户消息也不请求供应商。发送和预览期间的临时 RAM 占用是允许的，实际 GC 释放时点由运行时决定。

`ConversationNavigation` 使用横向级联的两栏导航：助手栏在左，点击助手在右侧展开其对话栏，两栏使用悬浮卡片外观，200ms 位移与透明度过渡。按当前用户对 #27 的新约定，窗口宽度大于 1100px 时聊天区以同周期边距动画让位；不超过 1100px 时覆盖聊天区，保持正文宽度不变（替代远端 Issue 原先要求所有窗口不让位的设计）。关闭的栏保留 DOM 以完成退场，同时 inert/aria-hidden 禁止交互与聚焦；减少动态效果偏好取消过渡。顶部按钮联动隐藏或恢复两栏；对话栏按钮收起对话栏；Escape 优先关闭菜单/弹窗，再收对话栏、最后关闭导航，并恢复到可用入口。按用户后续反馈取消外部点击关闭及遮挡层：导航展开时可直接点击、选择正文或输入，不自动收起导航（替代 #27 原外部点击关闭约定）。点击当前助手也可切换对话栏。选择或创建对话后保持导航展开。宽度不超过 860 px 时缩窄两栏，初始隐藏导航。助手行显示自选 Emoji 或仅用于显示的默认轮廓图标，长名称省略；`AssistantActions` 将编辑、排序和删除收纳到行右侧菜单，菜单通过 portal 挂到 document.body，避免侧栏动画的 transform 与层叠上下文影响定位，菜单 Escape 不收起对话栏。新建和编辑助手复用 `SessionConfigPanel` 字段和请求校验，以应用窗口居中的弹窗呈现，标题和取消/保存操作固定，表单独立滚动。取消或关闭丢弃草稿，显式保存仍经现有工作区命令执行，不改变配置作用域。对话草稿仅在当前应用会话中按 ID 保留，导航选择和助手排序持久化；不提供搜索、置顶、自动标题或工具执行。

`sessionConfig.ts` 负责模式、范围、字段错误和双采样确认；`requestMapping.ts` 负责协议能力、受保护字段、JSON 安全补充字段与最终 Body 构造。界面发送前校验，四个 adapter 在最终构造处再次校验。生成请求冻结配置，生成时修改的配置仅供下一次发送。运行状态表示“正在生成”，流式和非流式都可停止。

`contextBudget.ts` 只构造请求副本：必须保留系统指令与最新用户消息，从新到旧纳入完整且成功的 user/assistant 轮次；失败、取消、空内容及未完成轮次不进入后续请求。自动预算不裁剪完整轮次，自定义预算不足以容纳必保内容时阻止发送。原始消息不截断、不改写。已识别的 OpenAI 模型用本地对应 BPE 分词器，消息封装开销仍是估算；其他模型用 UTF-8 字节保守估算，界面均标注“估算”。分词数据按需加载，避免增加首屏主包。

助手编辑与对话行的铅笔入口共用紧凑参数弹窗；对话标题与完整配置原子保存，取消丢弃草稿。编辑任意对话绑定其 ID，不切换当前聊天。没有逐字段继承、覆盖或来源提示，仅底部提供“恢复助手默认值”。思考和搜索快捷入口自动保存当前对话配置；运行中修改只影响后续请求。助手编辑阻止保存无效配置，对话可保存未完成设置，但错误修正前不能发送。移除顶部独立设置按钮，对话行保留编辑和删除。

## Provider-native search

### Issue #21 quick model selection

聊天顶部为单层工具栏：左侧是侧栏图标和对话标题，右侧是仅显示模型名的选择按钮、宽窄切换和清空。助手名保留在侧栏与标题悬浮提示中，供应商和连接保留在模型悬浮提示及选择弹窗中。正文不再重复标题和模型栏；长名称省略，操作提供悬浮、按下和键盘焦点反馈，动效遵循系统减少动态效果偏好。

对话标题的模型按钮打开 `ModelPicker`：仅搜索本地已配置模型，按供应商和连接分组，显示协议及当前选择，不拉目录、不测试、不自动生成。选择通过现有 `configure-conversation` 保存当前对话完整快照中的模型引用，助手模板及其他对话不变；模型唯一父连接决定协议、地址和凭据。生成中的请求仍使用冻结目标，切换仅影响下一次请求。

思考选项仅依据 `thinkingOptions` 的协议契约，不按模型名推断。跨协议切换清除两端不共通的已选思考档位、预算和力度，切回不会复活不可用参数；共通选项保留各协议自己的值，包括四协议都支持的本地思考显示偏好。同协议换模型保留参数。四协议均已提供联网映射，保留会话联网开关并由目标 adapter 生成对应字段。Chat Completions 的思考显示复选框可用，并注明内容取决于兼容服务是否返回。此实现遵循 #28 完成说明中的独立会话快照，取代 #21 旧正文的持续跟随助手语义。

搜索通过 ChatTransport 的 `search-update` 与 `provider-replay` 事件进入会话。SearchRecord 是展示快照；Anthropic ProviderReplay 保留完整原始块，按连接 ID/地址隔离，仅在原协议回传。paused 消息携带冻结配置与初始历史；用户显式继续，普通后续消息仍按完整轮次裁剪。记录不含凭据。

SafeMarkdown 继续禁止原始 HTML。Gemini searchEntryPoint 只进入 scriptless sandbox iframe 的独立文档；主 DOM 不注入供应商 HTML，父组件绑定链接和高度。外链统一使用受限 HTTP(S) opener。新可选字段沿用 repository 持久化，无新增表/索引；编辑正文清除引用和 replay，删除使旧续接失效。详见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。

### Issue #15 math rendering

普通文本的 LF/CRLF 单换行在搜索引用定位完成后转换为 Markdown break 节点，用户消息、助手正文和摘要统一生效；代码和数学节点不改写，不再使用用户消息段落的 `white-space: pre-wrap` 作为换行补丁，避免显式换行与空白样式叠加。CRLF 的源码引用偏移先映射到解析后的文本位置，转换仍只影响显示。

用户消息、助手正文和思考摘要共享 SafeMarkdown，用户消息同时支持安全 Markdown，普通段落保留单换行。remark-math 提供数学节点，markdownMath.ts 在 Markdown 解析阶段识别 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`；双美元及 `\[...\]` 使用独立公式排版。单美元内部首尾不能留空白，结束符后不能紧接数字，以避免常见货币误判；有歧义的美元文本使用 `\$`。不做全局替换，原文位置供搜索引用继续使用；公式内的引用角标放在公式后。

行内代码、缩进代码及围栏代码（包括 math 标签）保持字面显示。rehype-katex 使用 `trust: false`，非法公式沿用插件的可读源码降级；不开放原始 HTML 或可信命令。KaTeX 引擎与 CSS/字体版本保持一致并本地打包；公式继承主题文字颜色，超长公式局部横向滚动。所有转换限于渲染树，持久化、复制、编辑及请求仍使用原始消息，无数据库迁移或协议变更。
