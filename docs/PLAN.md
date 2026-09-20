# Ayase Studio v0.1 Plan

## Goal

Build a fast, local-first desktop chat client with a deliberately small feature set. Ayase Studio is a new implementation, not a Cherry Studio fork.

### Issue #19 chat content width

聊天标题栏的展开/收窄按钮同步调整消息列与输入框。默认窄屏居中（最大 48rem），宽屏占满聊天工作区并保留左右留白；空间不足时均随可用宽度收缩。布局作为本机全局偏好保存，切换助手、对话或设置页及重启均保留；不改变侧栏状态、窗口尺寸或生成状态。

## v0.1 scope

- Ordinary Tauri 2 desktop window using React, TypeScript, Vite, and Tailwind CSS.
- Plain-text multi-turn chat with streamed Markdown rendering.
- Assistant presets with shared model and generation settings, multiple saved conversations, and safe deletion.
- User-configured base URL, API key, and model.
- Protocol-aware base URL normalization with the resolved request endpoint shown to the user.
- Four explicit protocol adapters:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Gemini native GenerateContent
  - Anthropic native Messages
- Stop generation with `AbortController`.
- Local conversation persistence through a small repository interface backed by Dexie/IndexedDB.
- Message copying, editing with history truncation, single-message deletion, explicit regeneration, and independent conversation branches.
- Clear terminal states for success, cancellation, HTTP failure, network failure, and malformed streams.
- Persistent semantic appearance customization with safe accent/canvas colors and validated local PNG, JPEG, or WebP backgrounds copied into app-private storage.
- Issue #5 local attachments: draft picker/drop/image paste, explicit send, private copies and references for sent messages without a post-send image cache, read-only previews, and protocol-specific official input limits instead of shared 10/20 MB caps.

## Explicitly out of scope

- Agents, MCP, RAG, knowledge bases, and client-executed tools/search.
- Provider Files API uploads, audio/video/Office attachments, and unsent attachment persistence.
- Saved edit/regeneration versions and arrow navigation (separate Issue #17).
- Accounts, cloud sync, telemetry, auto-update, plugins, and marketplace features.
- Global shortcuts, tray behavior, frameless-window tricks, and multi-window behavior.
- Provider-managed conversation state. OpenAI Responses uses local history with `store: false`.
- Rendering raw HTML from model output. `rehype-raw` is prohibited.
- Conversation search, folders, pinning, and automatic title generation.
- Unverified relay-specific reasoning extensions (including Chat `reasoning_content`).

## Module seams

Chat generation knows only the `ChatTransport` interface and neutral `ChatEvent` values. Each generation adapter owns endpoint construction, headers, request mapping, SSE decoding, unknown-event handling, and provider-specific errors. The separate, user-triggered model-directory action uses the neutral `ModelCatalogClient`; its protocol-specific GET routes, pagination, headers, and response mapping remain hidden from React.

Conversation storage sits behind `ChatRepository`; UI code does not call Dexie directly.

URL resolution sits in `src/chat/urlResolution.ts`, shared by settings preview, generation transports, and model discovery. The UI supplies the configured base URL; the resolver returns the normalized base URL and final endpoint. Adapters do not independently duplicate normalization rules.

## Configuration model

The connection configuration slice uses a three-level supplier, connection, and configured-model hierarchy:

```text
ProviderGroup
- id
- name
└─ ConnectionProfile[]

ConnectionProfile
- id
- name
- protocol
- baseUrl
- apiKey
└─ ConfiguredModel[]
   - id
   - modelId
   - displayName (optional)

Assistant
- defaultModelId
- defaultConfig
└─ Conversation[]
   - title
   - messages
```

- A supplier is only a UI grouping. It has no inherited Base URL, key, model, or runtime behavior.
- One supplier may hold any number of connections. Protocol is a dropdown property of a connection, and repeated connections using the same protocol are valid.
- Built-in OpenAI, Google Gemini, and Anthropic entries are read-only creation templates. Their created providers and connections use the same editable runtime model as custom providers.
- Selecting a connection in settings only changes the model list being browsed. Selecting a configured model makes its model ID, parent connection, protocol, Base URL, and key the atomic chat target.
- Each assistant's model ID and generation settings are persisted and restored on startup; settings derives the current-model marker from the selected assistant.
- Missing, deleted, or corrupt active-model references become an explicit unselected state. Deletion never silently switches to another connection or model.
- Each connection can fetch a protocol-aware remote model catalog on demand. Catalog entries are candidates only; users add them explicitly or add an arbitrary model ID manually.
- A user may explicitly test one configured model. The test is cancellable, reports latency/failure, may consume tokens, and is never retried automatically.
- Keys remain local and are never copied into conversations or tracked by Git. Keychain storage remains a later security upgrade.
- Migration deterministically preserves valid non-empty values from the legacy `ProviderProfiles` storage shape.

## Conversation roadmap

Issue #4 extends the original `current` state into assistant-owned conversations. Each assistant owns one shared model reference and generation configuration for its conversations; conversations keep their own titles and messages without copying credentials. Issue #14 branches retain a creation-time configuration record, but requests still use the owning assistant's current settings. Search, folders, pinning, and automatic titles remain separate later decisions.

## Delivery stages

1. **Transport tracer bullet**: one public streaming interface, deterministic tests, all four adapters, and Tauri HTTP wiring.
2. **Single-conversation UI**: settings, Markdown transcript, composer, streaming, stop, and visible errors.
3. **Persistence**: conversations/messages in Dexie with throttled writes and unfinished-message recovery.
4. **Acceptance**: packaged Tauri smoke tests against the configured relay, including cancellation and provider switching.

## Protocol-aware URL slice

Issue #13 implements protocol-aware URL resolution before expanding the feature set:

- Trim whitespace and redundant trailing slashes.
- For OpenAI Chat and Responses only, append `/v1` when the configured URL has no path.
- Preserve an existing `/v1` suffix and any non-root custom path.
- Do not change scheme, host, or port, and do not perform fallback network requests.
- Resolve Gemini and Anthropic automatically from a relay root by appending their complete versioned resource paths (`/v1beta/models/...` and `/v1/messages`); do not prepend an extra generic `/v1` to their normalized base.
- Show the exact final request endpoint below the Base URL field before sending.
- For Gemini without an explicitly selected model on that connection, show the normalized base and a clear prompt instead of a fictitious final endpoint.
- Cover root, trailing-slash, existing-version, custom-path, port, and invalid-URL cases with deterministic tests.

## Known issues

- Markdown soft line breaks are currently collapsed by CommonMark rendering. Preserve model-provided single newlines without enabling raw HTML, and cover the rendered line-break behavior with a regression test.

## Issue #3 generation configuration slice

按用户 2026-09-15 确认，原 #3/#4 的独立会话快照规则改为助手统一管理。配置仅在助手编辑中保存，对话无覆盖或重新应用入口。四协议请求映射、非流式、上下文预算与安全校验保持原合同。自动数值省略可选请求字段；Anthropic 必填 `max_tokens` 自动模式使用标明为 Ayase 回退的 4096。流式默认开启是 Ayase 产品推荐。未知模型的能力不从模型 ID 或目录身份信息猜测。自定义 JSON 按协议隔离，并在最终请求构造处安全校验。旧会话配置本地备份后退出运行配置，桌面交互与确定性测试共同组成验收证据。远端 Issue 尚未同步此调整。

## Acceptance gates

### Issue #15 Markdown and math (2026-09-19)

按用户本轮实施指令实现用户消息、助手正文与思考摘要的安全 Markdown/LaTeX 混排，支持美元及反斜线括号分隔符。用户消息同时开放安全 Markdown；代码中的公式保持原样。覆盖中文、列表、表格、矩阵、分式、上下标、多行公式、流式前缀、非法语法降级、货币/转义、搜索引用、安全边界及恢复后的原文复制和请求。浅深主题及窄窗口长公式滚动用浏览器检查。本轮允许全量确定性测试，不使用 computer use，不调用真实模型。

这取代远端 #15 创建时“仅记录待办，本次不修复”的时间性说明。2026-09-19 修正短公式因 KaTeX 上下标右侧 2px 溢出而出现多余滚动条的问题后，用户确认“目前效果完美”，验收通过，并授权提交、推送及将 #15 标记通过。仅完成本功能不代表其他 Alpha 验收项或真实线路均已通过。

### Issue #14 message operations (2026-09-19)

按用户确认，两类消息均提供复制 Markdown 原文、编辑、单条删除、重新请求和分支。编辑保存截断后续消息且不自动请求；重新请求冻结当前配置，以对应用户消息及上文生成一次新回复，丢弃原回复和后续记录。截断和删除前明确确认。分支保留切点并复制为同助手下独立对话，使用 `(N)` 后缀，不显示来源、不请求网络；创建快照仅作记录，后续仍跟随助手共享配置。附件清理按所有对话的剩余引用执行。

这取代远端 #14 中“原结果仍可访问”的首版要求。编辑版本与替代回复的保存、左右箭头导航已移至低优先级 [Issue #17](https://github.com/AyaseMinami/AyaseStudio/issues/17)，无法追溯恢复首版已丢弃内容。未修改远端 #14。验证集中于消息操作、截断、配置冻结、生成冲突、分支恢复与附件引用，不新增模型白名单或供应商参数组合限制。

### Issue #16 protocol thinking extension (2026-09-19)

在 #10 Gemini 首版上扩展 OpenAI Chat 的强度、Responses 的强度与摘要，以及 Anthropic 的协议模式、预算、effort 与可读摘要。复用灯泡弹层、助手共享配置、冻结请求和本地摘要存储。按用户 2026-09-19 修订，移除型号白名单；任意模型 ID 均可设置所选协议的思考选项，服务端负责参数兼容性判断。切换型号保留设置，不再拦截预算/输出或思考/采样组合。默认不请求摘要，显式已保存的摘要偏好继续保留；错误展示完整响应正文及 HTTP 状态并脱敏。Chat 官方接口不承诺可读摘要，未确认的中转扩展不启用。参数与多轮历史合同见 [PROTOCOLS.md](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

Issue 原文的未知模型默认限制、切换型号重置与供应商预算/采样兼容性前置拦截，以及“仅记录后续需求，本次不开始实现”，均被用户 2026-09-19 的实施与修订指令取代；未修改远端 Issue。真实线路验收需要单独授权，确定性测试与桌面启动不代表中转站兼容性通过。

### Issue #10 Gemini first slice (2026-09-16)

以下为 2026-09-16 首版历史记录，型号限制已由上述 #16 修订取代。本轮按用户要求将思考摘要展示纳入首版，仅实现 Gemini Native。输入区提供按明确型号能力变化的强度/预算菜单及独立的摘要开关，沿用当前助手共享配置（不同于原 Issue 的按对话保存）。Gemini 3 使用型号声明的档位，2.5 使用预算；未知型号省略思考参数。摘要独立于正文保存和折叠展示，不作为聊天历史回传。没有收到摘要时不显示空框，不推断模型思考用时。其他协议和中转站专属兼容规则留待后续；远端 Issue 未修改。

Issue #4 adds create/switch/rename/delete, assistant ordering/shared configuration, restart selection recovery, idempotent legacy migration, and transactional safe deletion. One generation may run across navigation or assistant edits; its request settings remain frozen and all deltas, errors and saves remain bound to its original conversation. Browser interaction checks supplement deterministic tests; desktop acceptance is performed by the user.

- Streamed text is incremental and ordered.
- A request produces exactly one terminal outcome: completed, failed, or aborted.
- Deterministic tests cover HTTP 429, HTTP 500, network failure, malformed SSE, and cancellation; real providers are not required to manufacture failures.
- Unknown SSE event types are ignored without losing later standard events.
- URL normalization is deterministic and idempotent, and the endpoint shown in settings exactly matches the requested URL.
- Restart restores the last selected model and resolves its complete parent connection; corrupt stored selection becomes explicitly unselected.
- Model-provided single newlines remain visually distinct without enabling raw HTML.
- Secrets and local probe configuration are ignored by Git.
- Custom appearance survives restart, invalid or missing backgrounds fall back safely, and unreferenced private copies are cleaned without deleting source files.
- `npm test`, TypeScript build, Rust check, and production bundle build pass.

## Reference policy

Official provider documentation is authoritative. Relay behavior is verified by probes. Cherry Studio may be inspected only for a specific UX or compatibility question; its architecture is not imported and code is not copied without an explicit license review and source record.

## Issue #6 用户范围调整（2026-09-19）

本次在同一 Issue 实现四协议原生搜索、输入区开关、正文角标、底部来源/查询、Gemini 建议及历史保存，Anthropic 暂停提供手动继续。客户端工具搜索留后续 Issue。不引入模型白名单、前置能力探针或自动重试。用户确认功能验收通过：Gemini、Anthropic 实际搜索及展示通过；OpenAI 真实线路验证转入低优先级 [#18](https://github.com/AyaseMinami/AyaseStudio/issues/18)，不阻塞 #6。按用户要求仅做必要定向验证。详见 [实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
