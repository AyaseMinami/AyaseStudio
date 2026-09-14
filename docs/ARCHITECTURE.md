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
│  │  ├─ settings.ts          current local provider-profile storage
│  │  ├─ useChatSession.ts    chat runtime and persistence orchestration
│  │  ├─ SafeMarkdown.tsx     safe Markdown rendering
│  │  └─ *.test.ts[x]         deterministic tests
│  └─ ui/
│     ├─ AppShell.tsx         top-level settings/workspace layout
│     ├─ SettingsPanel.tsx    appearance and provider-profile controls
│     └─ chat/                header, message list, composer and workspace
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

`App.tsx` 只组合外观、聊天会话与界面模块。聊天请求、流式终态、取消和持久化队列集中在 `useChatSession`；设置面板、标题栏、消息列表与输入区不重复实现这些规则。

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

### AppShell and Theme

`AppShell` 组合设置面板与聊天工作区；聊天工作区再组合标题栏、消息列表与输入区。它们是固定职责的 React 与 CSS 模块，不是可插拔 Panel 或 IDE 停靠系统。未来助手栏和对话栏应继续在这个组合根上增加，而不是重新混入聊天运行逻辑。

主题模块以 `themeMode`、`resolvedTheme`、`settingsOpen` 和两个更新操作作为 React 接口。普通界面模块只使用语义化 CSS 变量，不知道具体的 `stone` 或 `violet` 色阶，也不各自监听系统主题。浅色、深色和跟随系统的解析、系统变化订阅、损坏配置回退与本地持久化集中在 `AppearanceController` 内。

外观偏好使用一个版本化的 localStorage 记录。`bootstrap.ts` 在主 React 入口前应用已保存或系统解析后的实际主题，React 随后通过同一个解析规则建立实时订阅。只有真实出现第二种布局实现时，才增加新的布局 adapter。

## Domain direction

已确认但尚未全部实现的数据关系如下：

```text
Provider
└─ ConnectionProfile
   ├─ protocol
   ├─ configured base URL
   ├─ API key
   └─ default model

Assistant
├─ default connection/model
├─ default system instruction
├─ default generation settings
└─ Conversation
   ├─ settings snapshot and overrides
   ├─ Message
   │  ├─ text
   │  ├─ attachment references (planned)
   │  └─ citations/search metadata (planned)
   └─ last-used connection reference
```

对话引用连接配置，不复制凭据。助手是预设与对话容器，不是 Agent；附件和供应商托管搜索不会自动引入 MCP 或通用工具执行循环。

## State ownership

- 瞬时视图状态：由拥有该交互的 React 界面模块管理。
- 聊天运行状态：集中管理流式消息、取消、唯一终态和持久化队列。
- 外观状态：由主题控制器管理主题模式、实际配色、系统变化订阅与设置面板展开偏好。
- 用户设置：通过明确的加载、校验、迁移与保存入口管理。
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
- 界面模块化或主题变化必须保留发送、流式增量、停止生成、错误展示和重启恢复行为。
- 主题解析、系统变化、持久化与损坏配置回退使用注入式依赖完成确定性测试。
- 涉及 Tauri 权限、窗口或本地文件的改动必须完成桌面烟雾测试。

## Change rules

新增能力时优先加深现有模块：让适配器隐藏协议复杂性，让 repository 隐藏存储复杂性，让主题模块隐藏配色解析。只有行为确实存在两个实现时才建立新的 seam；不要创建只转发参数的浅模块。

架构变化满足以下任一条件时，应在同一 PR 更新本文档：

- 新增或改变稳定模块接口。
- 改变依赖方向、数据所有权或持久化位置。
- 新增协议、宿主权限或安全边界。
- 当前结构与本文的目录说明不再一致。
