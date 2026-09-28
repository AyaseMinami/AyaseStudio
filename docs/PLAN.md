# Ayase Studio v0.1 Plan

## User avatar #32 / #34 (2026-09-28)

本地实现独立头像设置页、全局用户消息头像、正方形缩放/位置裁切、保留原图重裁、更换及移除。原图/裁切参数/缩略图原子保存于独立本地 IndexedDB，不进入模型请求；无法读取时回退原有无头像样式。仅用户消息行容纳 32px 头像，助手宽度不变。

这是 Epic #68 的首个限定范围实现；助手头像及共享头像/背景库留待后续。定向自动验证和内置浏览器验收完成，主观视觉及原生选图/桌面重启验收待用户确认。远端 Issue 未更新或关闭。

## Goal

Build a fast, local-first desktop chat client with a deliberately small feature set. Ayase Studio is a new implementation, not a Cherry Studio fork.

### Issue #19 chat content width

聊天标题栏的展开/收窄按钮同步调整消息列与输入框。默认窄屏居中（最大 48rem），宽屏占满聊天工作区并保留左右留白；空间不足时均随可用宽度收缩。布局作为本机全局偏好保存，切换助手、对话或设置页及重启均保留；不改变侧栏状态、窗口尺寸或生成状态。

## v0.1 scope

### Issue #63 lightweight attachments

2026-09-27 用户确认首批范围：CSV/TSV/JSON/XML/YAML/日志及常见代码、配置文本按 UTF-8 正文发送；DOCX/XLSX/PPTX 仅经 Responses 原文件内联发送，Office 本地仅展示信息。无本地 OCR、内容提取、格式转换、Office 正文预览或新增依赖；音视频留待后续。Office 只检查 ZIP 文件头，完整可解析性由上游判断，这取代远端 Issue 对全部损坏/伪造文件预先拒绝的宽泛要求。未知模型和中转站能力不臆断，失败不自动重试。远端 Issue 未修改。

### Issue #31 automatic conversation titles

按 2026-09-27 用户修订采用两步命名：首条消息提交后立即以原文命名（合并空白，最多 40 个 Unicode 码点；仅附件用文件名），后台使用同一模型概括后替换。失败保留原文标题，替代远端 Issue 的默认标题回退要求。每个对话只尝试一次；手动改名优先，后续消息及重试不反复命名。后台命名不阻塞主聊天与导航，不读取附件正文，不引入专用模型设置页。远端 Issue 未修改。

### Desktop UI #44–#47

按 2026-09-26 至 27 用户反馈实施：#44 统筹三页风格；#45 保留级联悬浮导航，外框圆角 8px、间隙 4px，用户消息继续跟随浅蓝默认或自定义强调色，消息操作常显图标；#46 小圆角分组卡片、独立标题及宽屏固定双消息预览；#47 供应商、连接渠道两级导航及右侧模型管理。设置框架采用小圆角卡片，两页统一外层边距与页面标题。字体层级和中文字体观感尚待用户共同精调，本次提交是阶段性基线，不代表最终视觉验收。用户后续要求停止截图验收，由其亲自反馈；远端 Issue 不在本轮修改或关闭。

### Issue #38 about and feedback

后续样式确认：将问题与建议合并为一个“反馈与建议”入口，使用紧凑列表替代双卡片，移除宣传文案和装饰图标；此要求替代 Issue 原先区分两个入口的验收。邮箱保留展示与复制。

按用户确认，设置中的“关于”页面承载应用信息及反馈，替代 Issue #38 原先的独立反馈页面。复用应用图标，版本读取 Tauri 配置，作者为 AyaseMinami；提供预填问题/建议的 GitHub 链接、可复制邮箱 ayasechikage@gmail.com、版本复制及项目主页。仅用户主动点击时打开链接或复制公开信息，不自动附带本地数据。许可证待确定后补充；当前邮箱入口仅支持复制，不启动邮件客户端。远端 Issue 未修改。

- Ordinary Tauri 2 desktop window using React, TypeScript, Vite, and Tailwind CSS.
- Plain-text multi-turn chat with streamed Markdown rendering.
- Assistant presets used as templates for new conversations, independent full conversation settings, multiple saved conversations, and safe deletion.
- User-configured base URL, API key, and model.
- Protocol-aware base URL normalization with the resolved request endpoint shown to the user.
- Four explicit protocol adapters:
  - OpenAI Chat Completions
  - OpenAI Responses
  - Gemini native GenerateContent
  - Anthropic native Messages
- Stop generation with `AbortController`.
- Local conversation persistence through a small repository interface backed by Dexie/IndexedDB.
- Message copying, editing while preserving history, user-message edit-and-send with confirmed history truncation, single-message deletion, explicit regeneration, and independent conversation branches.
- Clear terminal states for success, cancellation, HTTP failure, network failure, and malformed streams.
- Persistent semantic appearance customization with safe accent/canvas colors and validated local PNG, JPEG, or WebP backgrounds copied into app-private storage.
- Issue #5 local attachments: draft picker/drop/image paste, explicit send, private copies and references for sent messages without a post-send image cache, read-only previews, and protocol-specific official input limits instead of shared 10/20 MB caps.

## Explicitly out of scope

- Agents, MCP, RAG, knowledge bases, and client-executed tools/search.
- Provider Files API uploads, audio/video attachments, local Office parsing/conversion, and unsent attachment persistence.
- Saved edit/regeneration versions and arrow navigation (separate Issue #17).
- Accounts, cloud sync, telemetry, auto-update, plugins, and marketplace features.
- Global shortcuts, tray behavior, frameless-window tricks, and multi-window behavior.
- Provider-managed conversation state. OpenAI Responses uses local history with `store: false`.
- Rendering raw HTML from model output. `rehype-raw` is prohibited.
- Conversation search, folders, and pinning.
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
   - settings (independent modelId + config snapshot)
   - messages
```

- A supplier is only a UI grouping. It has no inherited Base URL, key, model, or runtime behavior.
- One supplier may hold any number of connections. Protocol is a dropdown property of a connection, and repeated connections using the same protocol are valid.
- Built-in OpenAI, Google Gemini, and Anthropic entries are read-only creation templates. Their created providers and connections use the same editable runtime model as custom providers.
- Selecting a connection in settings only changes the model list being browsed. Selecting a configured model makes its model ID, parent connection, protocol, Base URL, and key the atomic chat target.
- Each assistant's defaults and each conversation's independent model ID and generation settings are persisted and restored on startup. The settings page marks the selected assistant's default model; the chat selector uses the current conversation's model.
- Missing, deleted, or corrupt active-model references become an explicit unselected state. Deletion never silently switches to another connection or model.
- Each connection can fetch a protocol-aware remote model catalog on demand. Catalog entries are candidates only; users add them explicitly or add an arbitrary model ID manually.
- A user may explicitly test one configured model. The test is cancellable, reports latency/failure, may consume tokens, and is never retried automatically.
- Keys remain local and are never copied into conversations or tracked by Git. Keychain storage remains a later security upgrade.
- Migration deterministically preserves valid non-empty values from the legacy `ProviderProfiles` storage shape.

## Conversation roadmap

Issue #4 extends the original `current` state into assistant-owned conversations. Under the revised Issue #28 contract, assistants provide defaults for new conversations; each conversation owns a full configuration snapshot without copying credentials. Requests freeze the current conversation's settings. Issue #14 branches copy that configuration and can then be edited independently. Editing an assistant does not change existing conversations; restoring assistant defaults is an explicit draft action that takes effect on save. Search, folders, and pinning remain separate later decisions. Automatic titles follow the revised Issue #31 contract above.

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

## Alpha release preparation

- Render ordinary Markdown single newlines as visible line breaks in messages and thinking summaries, preserving source text, code, mathematics and search citation offsets. Cover this behavior with regression tests; raw HTML remains inert.
- Freeze the corrected application identifier `io.github.ayaseminami.ayasestudio` before the first installer. Existing development profiles under the previous spelling require both Windows data directories to be migrated while the app is closed; see [the development guide](DEVELOPMENT.md#application-identity-and-existing-development-data).
- A production frontend build is not an installer acceptance result. Verify the packaged application, clean installation, upgrade and retained local data before publishing Alpha.

## Issue #3 generation configuration slice

按用户 2026-09-20 最新确认，助手是新对话模板，对话独立保存完整配置；编辑底部可恢复助手当前默认值，保存后生效。此前助手统一管理及稀疏覆盖方案被此规则取代。四协议请求映射、非流式、上下文预算与安全校验保持原合同。自动数值省略可选请求字段；Anthropic 必填 `max_tokens` 自动模式使用标明为 Ayase 回退的 4096。流式默认开启是 Ayase 产品推荐。未知模型的能力不从模型 ID 或目录身份信息猜测。自定义 JSON 按协议隔离，并在最终请求构造处安全校验。旧会话配置本地备份后退出运行配置，桌面交互与确定性测试共同组成验收证据。远端 Issue 尚未同步此调整。

## Acceptance gates

### Issue #15 Markdown and math (2026-09-19)

按用户本轮实施指令实现用户消息、助手正文与思考摘要的安全 Markdown/LaTeX 混排，支持美元及反斜线括号分隔符。用户消息同时开放安全 Markdown；代码中的公式保持原样。覆盖中文、列表、表格、矩阵、分式、上下标、多行公式、流式前缀、非法语法降级、货币/转义、搜索引用、安全边界及恢复后的原文复制和请求。浅深主题及窄窗口长公式滚动用浏览器检查。本轮允许全量确定性测试，不使用 computer use，不调用真实模型。

这取代远端 #15 创建时“仅记录待办，本次不修复”的时间性说明。2026-09-19 修正短公式因 KaTeX 上下标右侧 2px 溢出而出现多余滚动条的问题后，用户确认“目前效果完美”，验收通过，并授权提交、推送及将 #15 标记通过。仅完成本功能不代表其他 Alpha 验收项或真实线路均已通过。

### Issue #14 message operations (2026-09-19)

按用户确认，两类消息均提供复制 Markdown 原文、编辑、单条删除、重新请求和分支。Issue #37 将保存编辑改为保留后续历史且不请求、不清理附件；仅用户消息可“编辑并发送”。2026-09-27 用户进一步确认：编辑发送、重新请求均直接执行、不弹确认；最新一轮保留问答候选，旧轮操作仍移除后续记录。删除前仍明确确认。分支保留切点并复制可见历史为同助手下独立对话，使用 `(N)` 后缀，不显示来源、不请求网络；创建快照仅作记录。按 Issue #28 的本轮修订，分支复制完整对话配置，后续独立修改。附件清理按所有对话及保留候选的引用执行。

本轮将 [Issue #17](https://github.com/AyaseMinami/AyaseStudio/issues/17) 收窄为最新一轮问答版本：最新提问编辑发送或重新生成新增候选，箭头同时切换问答；下一轮消息提交并核验附件成功后丢弃其他候选，失败或停止的网络生成不恢复它们。仅保存编辑修改当前候选，不另存编辑历史；不做多轮版本树，无法恢复此前已丢弃内容。与 #50 一起实现输入和编辑快捷键。该范围替代远端 #17 的广义消息编辑历史要求，远端 Issue 未修改。

### Issue #16 protocol thinking extension (2026-09-19)

在 #10 Gemini 首版上扩展 OpenAI Chat 的强度、Responses 的强度与摘要，以及 Anthropic 的协议模式、预算、effort 与可读摘要。复用灯泡弹层、冻结请求和本地摘要存储；按 #28 的后续修订，配置由对话独立保存，新建时复制助手默认值。按用户 2026-09-19 修订，移除型号白名单；任意模型 ID 均可设置所选协议的思考选项，服务端负责参数兼容性判断。切换型号保留设置，不再拦截预算/输出或思考/采样组合。默认不请求摘要，显式已保存的摘要偏好继续保留；错误展示完整响应正文及 HTTP 状态并脱敏。Chat 官方接口不承诺可读摘要，未确认的中转扩展不启用。参数与多轮历史合同见 [PROTOCOLS.md](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

Issue 原文的未知模型默认限制、切换型号重置与供应商预算/采样兼容性前置拦截，以及“仅记录后续需求，本次不开始实现”，均被用户 2026-09-19 的实施与修订指令取代；未修改远端 Issue。真实线路验收需要单独授权，确定性测试与桌面启动不代表中转站兼容性通过。

### Issue #10 Gemini first slice (2026-09-16)

以下为 2026-09-16 首版历史记录，型号限制已由上述 #16 修订取代。本轮按用户要求将思考摘要展示纳入首版，仅实现 Gemini Native。输入区提供按明确型号能力变化的强度/预算菜单及独立的摘要开关，沿用当前助手共享配置（不同于原 Issue 的按对话保存）。Gemini 3 使用型号声明的档位，2.5 使用预算；未知型号省略思考参数。摘要独立于正文保存和折叠展示，不作为聊天历史回传。没有收到摘要时不显示空框，不推断模型思考用时。其他协议和中转站专属兼容规则留待后续；远端 Issue 未修改。

Issue #4 adds create/switch/rename/delete, assistant ordering/default configuration, restart selection recovery, idempotent legacy migration, and transactional safe deletion. Issue #28 makes each conversation's configuration independent. Issue #53 allows concurrent generation across conversations, with at most one task per conversation from preparation through terminal persistence. Request settings remain frozen and all deltas, errors, cancellation and saves remain bound to their original conversation. Other conversations remain editable and sendable; finishing or stopping one task does not unlock another. Browser interaction checks supplement deterministic tests; desktop acceptance is performed by the user.

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
