# Ayase Studio v0.1 Plan

## Goal

Build a fast, local-first desktop chat client with a deliberately small feature set. Ayase Studio is a new implementation, not a Cherry Studio fork.

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
- Clear terminal states for success, cancellation, HTTP failure, network failure, and malformed streams.
- Persistent semantic appearance customization with safe accent/canvas colors and validated local PNG, JPEG, or WebP backgrounds copied into app-private storage.
- Issue #5 local attachments: draft picker/drop/image paste, explicit send, private copies and references for sent messages without a post-send image cache, read-only previews, and protocol-specific official input limits instead of shared 10/20 MB caps.

## Explicitly out of scope

- Agents, MCP, RAG, knowledge bases, tools, and web search.
- Provider Files API uploads, audio/video/Office attachments, unsent attachment persistence, and per-message edit/delete/branch actions (separate Issue #14).
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

Issue #4 extends the original `current` state into assistant-owned conversations. Each assistant owns one shared model reference and generation configuration for its conversations; conversations keep their own titles and messages but do not copy credentials or configuration snapshots. Search, folders, pinning, and automatic titles remain separate later decisions.

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

### Issue #16 protocol thinking extension (2026-09-19)

在 #10 Gemini 首版上扩展 OpenAI Chat 的强度、Responses 的强度与摘要，以及 Anthropic 的型号相关模式、预算、effort 与可读摘要。复用灯泡弹层、助手共享配置、冻结请求和本地摘要存储。能力表只识别经官方资料确认的精确型号；未知型号保留默认。Chat 官方接口不承诺可读摘要，未确认的中转扩展不启用。参数与多轮历史合同见 [PROTOCOLS.md](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

Issue 原文“仅记录后续需求，本次不开始实现”已被用户 2026-09-19 的本次实施指令取代；未修改远端 Issue。真实线路验收需要单独授权，确定性测试与桌面启动不代表中转站兼容性通过。

### Issue #10 Gemini first slice (2026-09-16)

本轮按用户要求将思考摘要展示纳入首版，仅实现 Gemini Native。输入区提供按明确型号能力变化的强度/预算菜单及独立的摘要开关，沿用当前助手共享配置（不同于原 Issue 的按对话保存）。Gemini 3 使用型号声明的档位，2.5 使用预算；未知型号省略思考参数。摘要独立于正文保存和折叠展示，不作为聊天历史回传。没有收到摘要时不显示空框，不推断模型思考用时。其他协议和中转站专属兼容规则留待后续；远端 Issue 未修改。

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
