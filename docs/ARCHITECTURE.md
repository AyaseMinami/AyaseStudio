# Ayase Studio Architecture

## Purpose

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
| Rendering | react-markdown + remark-gfm | 安全 Markdown 渲染，不启用原始 HTML |
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
```

Tauri 是宿主，不是界面控件库。Panel、主题和布局属于 React 与 CSS；Rust 层不承载聊天业务状态，除非浏览器环境无法安全或可靠地实现某项能力。

## Current project structure

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
│  │  └─ useAppearance.ts     React subscription seam
│  ├─ chat/
│  │  ├─ types.ts             neutral request, event and transport interface
│  │  ├─ transport.ts         four protocol adapters and error normalization
│  │  ├─ runtime.ts           Tauri HTTP adapter wiring
│  │  ├─ sse.ts               SSE framing parser
│  │  ├─ repository.ts        ChatRepository and Dexie adapter
│  │  ├─ settings.ts          supplier/connection/model domain and v1/v2 migration
│  │  ├─ modelCatalog.ts      protocol-aware remote model discovery client
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

界面只提交中立的聊天请求并消费中立事件。每个协议适配器独占以下知识：

- 端点和请求头。
- 消息与参数映射。
- SSE 或非流式响应解码。
- 供应商错误归一化。
- 未知事件兼容与唯一终态。

调用者不应判断供应商事件名称，也不应在界面层拼接协议路由。

### ChatRepository

界面通过仓库接口加载、保存和清除对话，不直接操作 Dexie。随着多对话、附件和迁移规则增加，复杂性应继续留在存储模块内，而不是分散到各个 Panel。

### URL resolution

配置预览和真实请求必须共享同一个 URL 解析规则。配置值、标准化 Base URL 和最终请求端点是三个不同概念；解析必须确定、幂等，且不能通过自动回退发送第二次生成请求。

### Connection settings

连接配置使用一个版本化 localStorage 记录，并通过 `settings.ts` 的纯函数完成加载、校验、迁移、CRUD 和活动引用校验。React 界面不直接读写 localStorage。供应商只提供命名分组；连接完整持有名称、协议、Base URL 与 API Key；每条连接再拥有零到多个已添加模型。同一供应商可以建立多条相同或不同协议的连接，相同实际模型 ID 也可以分别存在于不同连接中。

运行时只持久化一个 `activeModelId`。选择模型时只更新该 ID，聊天从该模型反向解析唯一的父连接和供应商，再从同一对象链取得模型 ID、协议、Base URL 与 Key，避免字段混配。设置页当前浏览的供应商和连接是瞬时 UI 状态，不等于当前聊天模型。删除当前模型或其父连接/供应商时将活动 ID 清空，禁止静默切换到另一条可能计费或隐私边界不同的线路。

加载顺序优先采用 v3 记录；若不存在有效 v3，则将 v2 的单模型连接迁移为每条连接下的一个稳定模型实体；再无 v2 时才迁移旧 `ayase-studio.provider-profiles.v1`。迁移使用稳定 ID 和固定协议顺序，因此重复加载不会产生重复对象。内置 OpenAI、Google Gemini 与 Anthropic 只是只读创建模板；创建结果与自定义供应商使用相同数据类型和运行时路径。

### Model discovery and availability

`modelCatalog.ts` 以连接为请求边界，按四种协议构造模型目录 GET 请求、凭据头、分页和响应映射；返回值是内存中的候选目录，不直接写入配置。界面可以搜索、分组并显式把单个候选项添加为 `ConfiguredModel`。并非所有中转站都实现目录端点，因此失败或空刷新只作为该连接的可见状态，不删除上次成功结果，也不阻止手动添加。显示错误前必须删除其中出现的当前 API Key。

`modelAvailability.ts` 复用该连接协议对应的 `ChatTransport` 发起一次受限的极短请求，消费统一 `ChatEvent` 并记录首段与总耗时。测试必须由用户对单个模型显式触发；同一时刻最多运行一个，可取消、有超时，且不自动重试或自动选择模型。用户取消优先于随后发生的超时，配置变化会使旧异步结果失去写回资格。

### AppShell, Settings and Theme

`AppShell` 提供固定的顶层功能导航，并在聊天和设置两个工作区之间切换。聊天工作区组合标题栏、消息列表与输入区；设置工作区拥有自己的分类导航，当前将连接配置与外观拆分为两个页面。页面选择由 `App.tsx` 管理，不引入路由框架，也不会因为切换视图而取消或重发聊天请求。这些是固定职责的 React 与 CSS 模块，不是可插拔 Panel 或 IDE 停靠系统。未来助手栏和对话栏应继续在这个组合根上增加，而不是重新混入聊天运行逻辑。

主题模块以 `themeMode`、`resolvedTheme` 和主题更新操作作为 React 接口。普通界面模块只使用语义化 CSS 变量，不知道具体的 `stone` 或 `violet` 色阶，也不各自监听系统主题。浅色、深色和跟随系统的解析、系统变化订阅、损坏配置回退与本地持久化集中在 `AppearanceController` 内。顶层页面与设置分类属于瞬时导航状态，由应用组合根拥有，不混入外观偏好存储。

外观偏好使用一个版本化的 localStorage 记录。`bootstrap.ts` 在主 React 入口前应用已保存或系统解析后的实际主题，React 随后通过同一个解析规则建立实时订阅。只有真实出现第二种布局实现时，才增加新的布局 adapter。

## Domain direction

当前连接配置与后续助手、对话方向的数据关系如下：

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
   ├─ settings snapshot and overrides
   ├─ Message
   │  ├─ text
   │  ├─ attachment references (planned)
   │  └─ citations/search metadata (planned)
   └─ last-used model reference
```

供应商只负责分组，不提供父级配置继承。对话未来引用连接配置时也不复制凭据。助手是预设与对话容器，不是 Agent；附件和供应商托管搜索不会自动引入 MCP 或通用工具执行循环。

## State ownership

- 瞬时视图状态：顶层页面与设置分类由应用组合根管理，局部交互由拥有它的 React 界面模块管理。
- 聊天运行状态：集中管理流式消息、取消、唯一终态和持久化队列。
- 外观状态：由主题控制器管理主题模式、实际配色与系统变化订阅。
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

## Testing strategy

- SSE framing、协议字段映射、错误分类、取消与存储恢复使用确定性测试，不依赖真实网络。
- 每个请求恰好产生一个终态：`completed`、`failed` 或 `aborted`。
- 真实探针只回答中转站是否透传某项能力，不替代确定性回归测试。
- 供应商、重复协议连接和模型的增删改、v1/v2 迁移、当前模型恢复及删除时清空引用使用注入式内存存储完成确定性测试。
- 四种协议的模型目录路径、请求头、响应归一化、去重分组和安全错误，以及模型测试的耗时、失败、取消和超时均使用合成 transport/fetch 测试，不访问真实服务。
- 三栏设置界面覆盖“浏览连接不会改变当前模型”、右栏随中栏切换、目录候选需显式添加，以及删除当前对象不静默回退。
- 顶层页面导航、设置分类或主题变化必须保留发送、流式增量、停止生成、草稿与错误状态，以及重启恢复行为。
- 主题解析、系统变化、持久化与损坏配置回退使用注入式依赖完成确定性测试。
- 涉及 Tauri 权限、窗口或本地文件的改动必须完成桌面烟雾测试。

## Change rules

新增能力时优先加深现有模块：让适配器隐藏协议复杂性，让 repository 隐藏存储复杂性，让主题模块隐藏配色解析。只有行为确实存在两个实现时才建立新的 seam；不要创建只转发参数的浅模块。

架构变化满足以下任一条件时，应在同一 PR 更新本文档：

- 新增或改变稳定模块接口。
- 改变依赖方向、数据所有权或持久化位置。
- 新增协议、宿主权限或安全边界。
- 当前结构与本文的目录说明不再一致。
