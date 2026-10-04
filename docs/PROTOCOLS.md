# Protocol Compatibility Contract

## Application update transport (#76)

The default-on device preference permits one startup check after workspace initialization plus a 10-second delay. An empty selection is valid readiness. Manual check cancels the pending startup timer; disabling the switch suppresses a late background offer, and failure stays quiet without retries. No automatic download/install or provider request is added. Tray restoration and settings navigation do not create another startup check.

The native signature verifier also requires the authenticated minisign `file:` comment to match the original versioned installer filename. The public download filename uses a dot in the product name; it does not alter the signed original name. About provides the user-maintained Baidu mirror with `pwd=ayas` and a separate extraction-code copy control; this is an explicit external link, not an updater source or automatic fallback.

Update traffic is separate from provider transport and never uses provider credentials. Explicit checks fetch `https://raw.githubusercontent.com/AyaseMinami/AyaseStudio/updates/beta.json` or `stable.json` through the native Tauri updater. Stable builds only accept stable versions; Beta builds accept later Beta or stable versions. Static manifests use `windows-x86_64` with exact versioned GitHub Release installer URLs and embedded updater signatures. HTTPS and normal TLS verification remain enabled; signed packages are verified before they can enter the install state. Requests have a 20-second check timeout and 300-second download timeout, with a 512 MiB download ceiling. Explicit cancellation settles the native future; failures do not automatically retry or switch to the optional manual download mirror. Browser/UI mocks do not test GitHub connectivity, redirect/download behavior, or Windows installer restart. See [release and upgrade acceptance](RELEASING.md).

## Official supplier presets (#100)

Defaults cover documented contracts expressible by existing adapters, including #103 images. OpenRouter's Bearer Native API is excluded from x-api-key presets. Directory absence is distinct from generation support. Shared URL resolution preserves explicit catalog version prefixes and the exact HTTPS DeepSeek origin's Chat/Responses root; explicit paths and relays retain existing rules. Preset identities and avatars never choose actual protocols or authentication. See [matrix and limitations](ISSUE-100-IMPLEMENTATION.md).

## Tavily and Zhipu REST search (#82)

Tavily POST `/search` and Zhipu POST `/api/paas/v4/web_search` use separate Bearer Keys. Tavily sends explicitly selected basic/advanced depth with automatic parameters, answers and raw HTML disabled. Zhipu sends the selected four-engine enum, `search_intent:false` and medium content; queries over 70 Unicode characters fail before chat writes, and Sogou requests 10 results upstream before local configured capping. No provider retry/fallback or model tool loop. Both reuse bounded sources/citations and suppress native search in four chat protocols. Shared JSON reception bounds the whole request to 30 seconds/2 MiB and rejects redirects, invalid UTF-8/JSON and provider errors without leaking response bodies or credentials. See [official contracts and evidence](ISSUE-82-IMPLEMENTATION.md).

## Grok and Seedream images (#103)

Grok JSON generation/edit requests use `/v1/images/generations` and `/v1/images/edits`; custom relay prefixes are preserved. Single references map to `image`, multiple references to ordered `images` objects containing original data URIs. Seedream generation/reference edits both use `/api/v3/images/generations`, with `image` as a string or ordered array. Root URLs receive the protocol prefix; explicit prefixes are retained. Both use Bearer authentication, HTTPS and `response_format: b64_json`; automatic options are omitted. Explicit unknown/foreign fields reject before dispatch without switching protocol or model.

User-selected version contracts govern Grok ratios/resolution/quality and Seedream size/output format. Grok requests `n:1`; Seedream explicitly disables optional sequential groups for supporting versions and omits that unsupported field on Pro/Flash. Original references are packaged without conversion. Actual PNG/JPEG/WebP signatures must agree with top/item/data-URI MIME before native full decoding. Existing response/count/aggregate budgets, timeout, redirect rejection and no-download/no-retry rules apply. Result-as-reference editing carries pixels rather than preserved provider conversation state. [Official sources, exact profiles and boundaries](ISSUE-103-IMPLEMENTATION.md).

## Chat generation statistics (#107)

Adapters normalize provider usage into cumulative `TokenUsage` snapshots and emit `usage-update`, including metadata arriving after text. OpenAI Chat requests streaming usage explicitly; Responses uses terminal response usage, Gemini includes thinking in output where the response permits that derivation, and Anthropic counts ordinary input plus cache read/write as total input. Missing fields remain unknown, explicit zero remains zero. Terminal output must be confirmed before average speed is available; cancellation/failure retains partial observations without automatic retries. See [field mappings, sources and acceptance boundaries](ISSUE-107-IMPLEMENTATION.md).

## Drawing PNG parameter export (#89)

Export leaves adapter requests unchanged. Explicit PNG `parameters` JSON contains prompt, actual model ID, protocol, GNBP-compatible `api_type` (gemini/gpt) and explicitly submitted protocol option fields; automatic values are omitted. Frontend mapping and native typed allowlist reject credentials, addresses, connection identifiers, paths, reference bytes and unknown fields. Ordinary PNG re-encoding remains metadata-free. No provider defaults, reference originals or deterministic reproduction are asserted; legacy import stays in #92. See [allowlist and pinned GNBP verification](ISSUE-89-IMPLEMENTATION.md).

## Drawing lifecycle and diagnostics (#88)

The durable `dispatching` marker covers the possible-send boundary. Abort ends local waiting, including transports that settle late; it does not prove remote cancellation. Only explicit regeneration can create a new provider request, retaining source identity and deduplicating active replacements. Local recovery inventories and indexed missing-image repair never call providers. HTTP failures retain only category and numeric status, never raw response bodies, credentials or machine paths. Request parameter mapping is unchanged. See [lifecycle contract](ISSUE-88-IMPLEMENTATION.md).

## Drawing queue dispatch (#87)

Queue entries freeze protocol, target IDs, actual model, validated Base URL, parameters and ordered private reference descriptors. #110 prepares the final ordered session snapshot and saves all required originals before atomic batch registration; an unreadable/changed managed input or a failed import prevents that entire batch from sending. Files are captured as byte-backed Blobs at selection; raw binary IPC replaces Base64 on the new import path, without re-encoding the image. Dispatch resolves the same target again, blocks changed/missing targets, reads and verifies original digests inside its slot, and freezes the current Key only in memory. A durable possible-send marker precedes transport invocation. No automatic retry/fallback requests are introduced; local-save retry never invokes transport. Adapter formats remain unchanged. See [queue contract](ISSUE-87-IMPLEMENTATION.md) and [#110](ISSUE-110-IMPLEMENTATION.md).

## Drawing protocol boundary (#83)

### Implemented drawing protocol completion (#101, 2026-10-01)

[Implementation and verification](ISSUE-101-IMPLEMENTATION.md) records the current contract. Optional Gemini temperature is omitted by default and accepts finite 0–2 overrides; [Gemini 3](https://ai.google.dev/gemini-api/docs/gemini-3#temperature) recommends model default 1.0. Optional safety thresholds apply uniformly to the four supported categories and remain omitted by default; output defaults TEXT+IMAGE with explicit IMAGE available. Requests freeze the matching protocol's group; old missing fields retain defaults. Reuse of old Gemini history clears newer overrides. No model probe, automatic parameter removal or retry.

Gemini retains nonempty prompt validation without a borrowed character cap. OpenAI [generations](https://developers.openai.com/api/reference/resources/images/methods/generate) and [edits](https://developers.openai.com/api/reference/resources/images/methods/edit) use a 32,000 Unicode-code-point cap on trimmed submitted text. Standard arrays and pinned GNBP single-object data.b64_json retain all returned images. CR/LF and strict PNG/JPEG/WebP Base64 data-URL wrappers are normalized only within raw/normalized/decoded budgets, with MIME and canonical padding checks. Native image validation remains mandatory; URL-only responses are not downloaded.

Gemini choices participate in draft persistence, task/result snapshots, reuse, explicit PNG parameters and projected settings backup. Native export validates temperature, safety_threshold and response_modalities as Gemini-only allowlisted fields; ordinary PNG remains metadata-free. Drawing settings module v2 declares minimumReaderVersion 2, while document v5/envelope v1/schema v8 remain unchanged. Old settings read without writes and reset advanced overrides when replaced. Future unknown security/output structures reject before writes. Input original bytes, HTTPS/TLS/header authentication, normal runtime proxy policy, shared URL construction and multipart MIME/boundary contracts remain unchanged. Official docs were reread; synthetic tests do not establish live relay compatibility.

### Implemented reference-image inputs (#86, 2026-10-01)

Reference-image selection follows GNBP's PNG/JPG/JPEG/WebP/BMP formats. Ayase adds no input image-count, byte-size or pixel caps and leaves model/relay compatibility validation to the service, reporting failures without silently omitting images. Existing #84/#85 output-response budgets remain unchanged and must not become reference-input limits. Local unreadable, damaged or unavailable files still fail visibly.

Only an explicit official protocol requirement can justify image preprocessing; otherwise the original private bytes, dimensions, format and alpha are preserved. No automatic resizing, JPEG conversion, lossy compression, cropping or alpha flattening is approved. Base64/multipart encoding and accurate MIME declaration are request packaging, not image preprocessing. The reviewed [Gemini image-editing example](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) reads and encodes original PNG bytes, and [OpenAI Images edits](https://developers.openai.com/api/reference/resources/images/methods/edit) uploads original reference files; neither requires GNBP's Gemini-specific 1536-pixel/JPEG-quality-85 preprocessing. Supported input formats and service limits do not themselves require client conversion or authorize additional frontend compatibility gates.

Gemini appends ordered `inlineData` parts after the prompt using the actual image MIME. OpenAI Images uses multipart `image[]` files and `/images/edits` when references exist, retaining model/prompt, `n:1`, `output_format:png` and explicit size/quality; FormData supplies its own boundary header. Without references, the existing JSON `/images/generations` contract remains. The shared endpoint resolver accepts the generation/edit operation; multipart filenames use generated reference numbers, never original filenames or source paths. Input read failure blocks dispatch and is visible. [#86 implementation](ISSUE-86-IMPLEMENTATION.md) records duplicate handling, retention and offline verification; live provider/relay compatibility remains unverified.

### Implemented OpenAI Images and current size options (#85, 2026-10-01)

`src/drawing/openaiImages.ts` implements the [official Images generations contract](https://developers.openai.com/api/reference/resources/images/methods/generate): one non-stream POST with Bearer auth, model/prompt, `n:1`, `output_format:png`, optional size/quality omitted for automatic mode. `resolveOpenAIImagesEndpoint` shares HTTPS validation and path resolution between settings and dispatch. Root URL defaults to `/v1`; nonempty paths are preserved. No GPT Image `response_format` parameter, DALL·E legacy mapping, URL download, fallback or retry. Reference edits are added by #86 above. Returned bounded `data[].b64_json` images use declared PNG/JPEG/WebP (default PNG); the existing native validator checks real bytes. Limits/error redaction/outcome semantics match Gemini below. Runtime explicitly dispatches the selected drawing protocol; task parameter unions and independent draft groups prevent cross-protocol payloads.

[Current official GPT Image guidance](https://developers.openai.com/api/docs/guides/image-generation) adds xhigh/max for 2.5 Sunburst/Flare and documents GPT Image 2/2.5 custom-size constraints. Gemini's [ImageConfig](https://ai.google.dev/api/generate-content#ImageConfig) still records imageConfig, 14 ratios and `512`/1K/2K/4K, so this integration retains that seam and updates its options. Model-specific restrictions and the Flash Lite guide inconsistency are documented in [#85 implementation](ISSUE-85-IMPLEMENTATION.md). Explicit settings may fail for earlier models/relays; never silently remove or retry them. Official contracts and offline fixtures do not establish live compatibility.

Independent drawing uses `gemini-image` (GenerateContent) and `openai-images` (Images generations/edits) as explicit service-connection protocols. Existing four `ChatProtocol` adapters and chat history remain unchanged. A dedicated image transport owns request mapping, authentication, bounded image responses and redacted errors; an application-owned queue handles scheduling and persistence. Shared configuration and deterministic endpoint preview/resolution must distinguish chat and drawing targets, without guessing capability from model names. Optional image parameters are protocol-specific and omitted in automatic mode.

#83 is the scope index; adapter implementations and deterministic validation are recorded in #84/#85/#86/#101. Those records retain their own live-compatibility boundaries. One requested image per task does not justify discarding extra returned images. Unknown URL-only relays are outside the initial byte-response contract. TLS verification remains enabled, credentials stay in headers/runtime snapshots, and uncertain failures never trigger automatic retries or fallback. [#83](ISSUE-83-DRAWING-SPEC.md) links current contracts and the separate historical proposal.

### Implemented Gemini image slice (#84, 2026-10-01)

`src/drawing/geminiImage.ts` uses the [official GenerateContent API contract](https://ai.google.dev/api/generate-content): one non-stream `:generateContent` POST, a user text part, `candidateCount:1`, `responseModalities:[TEXT,IMAGE]`, optional `imageConfig.aspectRatio`/`imageSize`. Automatic values omit the corresponding field. Models are configured explicitly; model names never infer chat/image capabilities. Unsupported optional settings may be rejected by the selected model rather than silently omitted.

`resolveImageGenerationEndpoint` is shared by settings preview and dispatch. Drawing requires HTTPS and rejects credential URLs, query/hash and empty model IDs; model IDs are encoded. Keys use `x-goog-api-key` only. The Tauri fetch wrapper sets `maxRedirections:0`, while the adapter rejects redirected responses, omits browser credentials and uses a 400-second timeout. No TLS bypass, remote image-URL download, fallback, automatic retry or automatic model probe is provided. Model-directory requests reuse Gemini native only after validating the original drawing protocol; chat connectivity tests cannot exercise drawing targets.

The non-stream JSON parser permits one candidate, skips thought image parts, and retains all returned non-thought inline images (camel/snake fields). Safety blocks, non-STOP finish reasons, text-only/no image, malformed JSON/base64/MIME and budgets fail visibly. Supported originals are PNG/JPEG/WebP: at most 8 images, 32 MiB each, 64 MiB total; the encoded JSON body is capped at 90 MiB. Native validation checks actual format and decoding with at most 32,000,000 pixels per image. Provider error text is never stored or displayed because it may echo prompts or Keys; only fixed descriptions and HTTP status are retained. Deterministic fixtures validate contracts; live official/relay compatibility has not been probed.

## Independent Exa API and MCP profiles (#80 revision)

The user's later request adds Exa API separately from MCP. API defaults to `https://api.exa.ai`, requires a nonempty independent Key, and sends one POST to normalized base pathname plus `/search`. It rejects query/hash/userinfo/credential URLs and redirects; `x-api-key` is a header. Payload contains only trimmed current query, configured 1–10 `numResults`, `type:auto` and `contents:{text:true}`; no summaries, agent runs, extra queries or model-generated search terms. The [official API contract](https://exa.ai/docs/reference/search) requires authentication and supplies JSON `results` containing URL/title/text. Local normalization uses the same source/excerpt bounds as MCP; unusable/empty JSON blocks answering. Total timeout 30 seconds, response cap 2 MiB, no retry or automatic fallback. No real API request was made for implementation.

Local settings version 3 retains both Exa profiles and adds default-disabled Tavily/Zhipu profiles. Session mode `exa-api` dispatches direct API, `exa-mcp` dispatches the finite MCP adapter below; settings tests use the explicitly selected profile. All external modes suppress native model tools and share final budget, citations, history projection and Anthropic continuation rules. Each request freezes its selected profile and never uses another service's Key. Backup document v3 accepts Exa API mode/snapshots and both Exa profiles; v1/v2 readers retain their original schema limits. Tavily/Zhipu identities require the original search-module v3 stamp in document v4/v5.

## Fixed Exa MCP external search (#80)

Exa is a client-managed pre-generation step separate from four `ChatTransport` adapters. `src/search/exa.ts` supports Streamable HTTP versions `2025-11-25`, `2025-06-18`, `2025-03-26`: initialize, initialized notification, fixed tool/schema confirmation and one `web_search_advanced_exa` call. All requests use the same validated HTTPS endpoint with fixed `tools=web_search_advanced_exa`. Optional search Key uses `x-api-key`; model credentials never reach Exa. Redirects are refused (`maxRedirections:0` in Tauri). No OAuth, legacy SSE fallback, arbitrary tools, retries or model tool loop.

JSON/SSE responses require matching JSON-RPC IDs and negotiated session/version headers. The advanced tool's single text block must contain JSON `results` with valid HTTP(S) URLs and nonempty text; prose is not guessed into sources. No-results/tool errors/429/500/network/timeout block answering. Total timeout is 30 seconds, each response capped at 2 MiB. Cancellation ends local reads promptly with bounded best-effort notifications/session cleanup, without promising remote cancellation.

Query is only current trimmed user text (1–2000 Unicode codepoints); `numResults` is 1–10 and `textMaxCharacters` 1500. Ordered URL-deduplicated results retain at most 10 sources, 300-codepoint titles, 2048-character URLs, 1500-codepoint excerpts each and 8000 excerpt codepoints total. Final budgeting may reduce data further. JSON data/instructions enter only the latest user request copy; stored original content is unchanged. External mode suppresses native search fields in all adapters; Responses remains `store:false`. Ordinary future history projects citations into readable source URLs and omits external replay. Explicit Anthropic continuation reuses prepared messages/sources without re-search.

Pinned public source supports this contract; hosted deployment, anonymous advanced-tool access, authentication and proxy behavior remain subject to authorized live acceptance. See [design](archive/ISSUE-80-EXA-SEARCH-PLAN.md) and [verification](ISSUE-80-IMPLEMENTATION.md).

## Lightweight files (#63)

除 TXT/Markdown 外，CSV/TSV/JSON/XML/YAML、日志与常见代码/配置文件按 UTF-8 解码为 `text/plain`，使用下表同一文本映射，不解析结构、不执行 HTML/代码。DOCX/XLSX/PPTX 仅在 Responses 映射为 `input_file`，带原名和对应 Office MIME 的 Base64 data URL；不使用 Files API，不进行本地内容提取或格式转换。其他三种协议明确拒绝 Office（包括保留轮次中的历史附件），不丢弃附件或自动降级。

OpenAI 50 MB 检查覆盖同次请求中 PDF 和 Office 的总和，单个文件须小于 50 MB。供应商负责 Office 处理；非 PDF 的内嵌图片/图表不保证进入上下文，表格存在服务端行数处理限制，中转站支持尚未验证。官方合同见 [OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)。Office 类型以扩展名加 ZIP 文件头识别，不承诺完整 OOXML 验证；发送失败保留已提交引用。

## Conversation title requests (#31)

After the first sent message commits, automatic naming makes one additional request through the existing `ChatTransport`, using the connection and model frozen for that send. The request has its own title instruction, non-streaming configuration, a 256-token output cap, and at most 2,000 Unicode code points of the first user text (attachment filenames if text is absent). It does not inherit the chat persona, search, thinking overrides, custom JSON, history, or attachment contents. Provider-default reasoning may still apply. Existing URL resolution, adapter behavior, and Responses `store: false` remain unchanged.

Naming has an independent abort signal and a 60-second timeout, with no automatic retry, fallback model, or secondary provider. Only normal completed output is accepted; failures, empty output, cancellation, and incomplete terminal reasons keep the locally generated first-message title. This extra request is separate from the main reply and does not alter its messages or errors.

## Neutral request

Every adapter receives a base URL, API key, model, ordered local message history, and optional abort signal. The base URL stops before the protocol resource path.

Issue #5 的中立 `ChatMessage` 可以附带附件列表。已发送记录只持有应用私有目录的相对引用、文件名、MIME 与大小，不含原文件路径/二进制；发请求前将保留轮次的引用加载成只在内存存在的 Base64 字节，缺失/损坏立即停止，不能静默丢弃历史附件。新附件草稿只有点击发送时才入库；生成期间可编辑草稿，但须停止当前生成后才能发送。请求包含本次提交的文本与附件，附件单独也能发送。历史预算以完整用户/助手轮次保留或裁剪，附件跟随所属用户消息，媒资计数只能按原始字节做本地估算，不声称供应商计费准确。

| Adapter | Image | PDF | TXT / Markdown |
| --- | --- | --- | --- |
| OpenAI Chat Completions | user `image_url` data URL | user `file.file_data` data URL + filename | labelled UTF-8 `text` part |
| OpenAI Responses | `input_image.image_url` data URL | `input_file.file_data` data URL + filename | labelled `input_text` part; `store: false` |
| Gemini native | user `parts[].inlineData` MIME/Base64 | user `parts[].inlineData` PDF MIME/Base64 | labelled `parts[].text` |
| Anthropic native | user `image.source` Base64 | user `document.source` Base64 | labelled `text` block |

四种 adapter 仅在用户显式发送时内联请求，不调用任何供应商 Files API；不设统一的 10/20 MB 文件/消息上限，也不以原来的 30 MB 历史预读取或 32 MB 四协议应用上限拦截。映射时按当前协议的官方合同判断：OpenAI 文件输入的单个文件须小于 50 MB、同次请求的 PDF/Office 文件合计不超过 50 MB；Gemini 含内联媒体的整次请求不超过 20 MB；Anthropic 内联单张图片的 Base64 数据不超过 10 MB、整次请求不超过 32 MB。这些是各协议自己的限制，不能互相继承；实际中转站若有其他限制，只呈现其响应，不自动改路或重试。校验在新附件私有复制、用户消息入库和网络请求之前完成，失败不留下已发送记录。图片使用可识别的实际 MIME，无法识别时沿用第一阶段支持的文件类型；不要求后缀和内容完全匹配，不在本地完整解码图片，也不先替供应商判定图片/PDF 能否解析。当前模型目录不保存图片/PDF 能力，因此未知模型只提示而不臆断；已知官方注明无视觉输入的 GPT-3.5 Turbo、旧 GPT-4 和 GPT-4 Turbo Preview 则在 UI 与最终映射时禁用图片/PDF 并解释，绝不自动改模型、重试或丢附件。相关官方资料：[OpenAI 图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[GPT-3.5 Turbo 模型能力](https://developers.openai.com/api/docs/models/gpt-3.5-turbo)、[旧 GPT-4 模型能力](https://developers.openai.com/api/docs/models/gpt-4)、[Gemini GenerateContent 图片输入](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)、[Gemini 文档理解](https://ai.google.dev/gemini-api/docs/document-processing)、[Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)、[Anthropic 图像](https://platform.claude.com/docs/en/build-with-claude/vision)。

Issue #3 adds a frozen `SessionConfig` to the neutral request. It carries the system instruction, `auto/custom` numeric modes, stream selection and per-protocol custom JSON. The local context budget is applied before `ChatTransport` and never becomes a fabricated provider Body field. Adapters revalidate config while building their final Body, even when the UI was bypassed.

## Connection selection boundary

供应商仅用于设置界面分组，不进入 transport，也不提供字段继承。每条连接独立保存协议、Base URL、API Key 和模型列表。发送只使用当前对话完整配置快照，并从模型唯一父连接取得协议及凭据。助手是新对话模板，设置页选模只更新该模板。请求开始时冻结对话配置和连接，运行中修改只影响下一次请求。

同一供应商可有多条相同协议连接，同一实际模型 ID 可属于不同连接。浏览连接不改变聊天模型；助手默认模型变化不影响已有对话。删除模型或连接后清除相关助手选择，会话保留失效引用并阻止发送，不自动回退。API Key 不复制到模型目录、会话配置、消息或日志。

## Model catalog boundary

对话页快捷选择模型通过模型引用同步选择父连接的协议、地址和凭据，不改变已发出的请求。思考参数仅按协议提供选项；切换时清除不共通的档位、预算、力度和摘要偏好，恢复可用时不自动开启。四协议均接入原生搜索，联网开关保留并由目标协议映射，不跨协议复制工具字段。不按模型名称预测支持情况，供应商拒绝参数时保留错误，不重试或降级。

模型目录请求与生成请求使用同一连接的协议、Base URL 和 Key，但它是一次独立、用户触发的读取操作。OpenAI Chat 与 Responses 使用模型列表资源，Gemini 与 Anthropic 使用各自的原生列表资源；原生分页游标会被顺序读取、稳定合并并设置安全页数上限。返回条目先归一化为临时候选目录，再由用户逐个添加为配置模型；目录缺失、失败、空结果或取消不会修改已添加模型，也不会触发兼容协议或备用 URL 探测。任何上游错误文本在进入状态或界面前都必须删除其中出现的当前凭据。

模型可用性测试复用对应的 `ChatTransport`，只对用户指定的单个模型发送一次极短请求。它不得并行批量测速、自动重试、自动切换当前模型或复用聊天中的未完成请求。

## URL resolution contract

Three values are deliberately distinct:

- **Configured base URL**: the text supplied by the user.
- **Normalized base URL**: the protocol-aware base after deterministic local normalization.
- **Resolved endpoint**: the exact URL used for the HTTP request and shown in settings.

`urlResolution.ts` validates and resolves all generation and model-directory routes. It trims surrounding whitespace and redundant trailing slashes; only an OpenAI root gains `/v1`. Native Gemini and Anthropic routes append `/v1beta` and `/v1` respectively unless the configured path already ends with that version. Normalization never changes the effective scheme, host, or port and never probes alternative routes. Invalid URLs, non-HTTP(S) schemes, query, fragment, or URL userinfo are rejected before a request. Repeated normalization returns the same result.

| Adapter | Configured example | Normalized base | Resolved endpoint |
| --- | --- | --- | --- |
| OpenAI Chat | `https://relay.example.com` | `https://relay.example.com/v1` | `https://relay.example.com/v1/chat/completions` |
| OpenAI Chat | `https://relay.example.com/custom/v1` | `https://relay.example.com/custom/v1` | `https://relay.example.com/custom/v1/chat/completions` |
| OpenAI Responses | `https://relay.example.com/` | `https://relay.example.com/v1` | `https://relay.example.com/v1/responses` |
| Gemini native | `https://relay.example.com` | `https://relay.example.com` | `https://relay.example.com/v1beta/models/{encoded-model}:streamGenerateContent?alt=sse` |
| Anthropic native | `https://relay.example.com` | `https://relay.example.com` | `https://relay.example.com/v1/messages` |

The UI previews the resolved endpoint but stores the configured value. Gemini has no final endpoint preview until that connection's model is explicitly selected; its model ID is URI-component encoded in the final route. OpenAI SDK requests use the normalized base and are tested against the same resolved endpoint returned to the UI. Invalid addresses use the same resolver message in the editor and send-before-network checks. Automatic fallback from one endpoint to another is prohibited because an ambiguous failure could otherwise duplicate a generation.

## Neutral events

- `text-delta`: append text to the active assistant message.
- `thinking-delta`: append provider-readable reasoning or summary to a separate local display field (all four protocols); never append to answer text or input history.
- `completed`: one successful terminal event, optionally carrying finish reason and token usage.
- `failed`: one terminal event with normalized kind, message, HTTP status, and retryability.
- `aborted`: one terminal event when the caller cancels.

Adapters ignore unknown non-terminal provider events. They must not emit events after a terminal event.

## Endpoint matrix

| Adapter | Method and path | Stream framing | Text event |
| --- | --- | --- | --- |
| OpenAI Chat | `POST /chat/completions` under an OpenAI `/v1` base URL | SSE plus `[DONE]` | `choices[].delta.content` |
| OpenAI Responses | `POST /responses` under an OpenAI `/v1` base URL | named SSE events | `response.output_text.delta` |
| Gemini native | `POST /v1beta/models/{model}:streamGenerateContent?alt=sse` | SSE data records | `candidates[].content.parts[].text` |
| Anthropic native | `POST /v1/messages` | named SSE events | `content_block_delta` with `text_delta` |

With stream disabled, OpenAI Chat and Responses use the same POST paths with `stream: false`; Gemini uses `POST /v1beta/models/{model}:generateContent` (without `alt=sse`); Anthropic uses `POST /v1/messages` with `stream: false`. The shared URL resolver takes the request mode, so the generation endpoint preview and actual Gemini URL agree. Non-streaming adapters parse complete JSON and route readable summary and answer fields independently before exactly one terminal event. Cancellation or error yields exactly one `aborted` or `failed`.

| Config | OpenAI Chat | OpenAI Responses | Gemini Native | Anthropic Native |
| --- | --- | --- | --- | --- |
| System instruction | leading `system` message | `instructions` | `systemInstruction.parts[].text` | top-level `system` |
| Temperature | `temperature` | `temperature` | `generationConfig.temperature` | `temperature` |
| Top-P | `top_p` | `top_p` | `generationConfig.topP` | `top_p` |
| Top-K | unsupported | unsupported | `generationConfig.topK` when user explicitly requests it; model ability may be unknown | `top_k` on models where supported |
| Max output | `max_completion_tokens` | `max_output_tokens` | `generationConfig.maxOutputTokens` | required `max_tokens`, Ayase auto fallback 4096 |

Auto omits optional numeric request fields. Custom sampling values are forwarded without model-specific limits or confirmation. Only finite numbers/safe integers, protocol field mapping and local history-budget constraints are checked. OpenAI Responses always sends `store: false` with local history. Custom JSON cannot set model, input/history, system instruction, stream, output cap, `store`, URL, headers, key, tools, provider-managed state or aliases/nested variants. A positive allowlist limits safe supplements: OpenAI Chat `seed`, `presence_penalty`, `frequency_penalty`, `stop`; OpenAI Responses text-only `metadata`; Gemini `generationConfig.stopSequences` and `generationConfig.seed`; Anthropic `stop_sequences`. Non-allowlisted fields fail validation instead of being forwarded. Each protocol's JSON text is retained separately when the selected protocol changes.

Model IDs do not gate sampling or thinking. The provider decides whether a model accepts a value or a combination of values; the client does not impose thinking-budget/output-cap relations or Anthropic thinking/sampling restrictions. OpenAI Top-K remains unavailable because this client has no mapping for it. An incomplete finish is stored as an incomplete local reply and its whole user/assistant round is omitted from the next input history. Gemini prompt block feedback remains a provider failure even when no candidates are returned.

Official references checked for Issue #3: [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create), [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses/create), [OpenAI reasoning-model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2), [Gemini GenerateContent and GenerationConfig](https://ai.google.dev/api/generate-content), [Gemini 3.x guidance](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5), [Gemini model metadata and Top-K support](https://ai.google.dev/api/models), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), and [Anthropic parameter deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). Relay compatibility is observed separately; it does not define official defaults or model capabilities.

## Relay observations

### Gemini thinking first slice

Gemini 思考首版（2026-09-16）曾按精确型号提供选项。2026-09-19 用户明确取消型号准入与供应商能力预判，当前四协议规则统一如下；旧记录中的显式配置仍保留。

## Issue #16 thinking controls and readable summaries

按用户 2026-09-19 的修订，`thinking.ts` / `geminiThinking.ts` 只描述协议选项和字段映射，不包含模型白名单或名称推断。任意模型 ID（包括新型号、中转别名、跨厂商兼容型号）均使用连接所选协议，模型 ID 原样传递给 adapter；Gemini 保留端点资源名处理。下面列的是客户端能构造的选项，不承诺任何具体模型或线路支持所有值。

| 协议 | 思考选项与请求映射 | 摘要 |
| --- | --- | --- |
| OpenAI Chat | 关闭→`reasoning_effort: "none"`；minimal / low / medium / high / xhigh / max 原值发送 | 按显示偏好读取兼容服务的 `reasoning_content`；不增加请求字段 |
| OpenAI Responses | 同样的强度写入 `reasoning.effort` | 显式开启时 `reasoning.summary: "auto"` |
| Gemini Native | minimal / low / medium / high→`thinkingLevel`；动态→`thinkingBudget: -1`；关闭→0；自定义→输入整数 | 显式开启时 `includeThoughts: true` |
| Anthropic Native | off→disabled；adaptive→adaptive；budget→enabled + `budget_tokens`；独立 low / medium / high / xhigh / max→`output_config.effort` | 显式思考模式下按偏好写入 summarized / omitted |

全部协议都提供“默认”，省略可选模式、强度或预算；Anthropic effort 的默认独立省略 `output_config`。未配置摘要时默认关闭，不额外请求摘要；已有明确保存的 `includeSummary: true` 继续生效。Anthropic 摘要开关本身不会开启思考。Responses 保持 `store: false` 和本地历史。

本地只验证这些控件配置的结构及是否能映射到所选协议；预算为可精确表示的整数，不设型号上下限，不检查预算与输出上限、采样参数间的兼容关系。有限采样数值照用户配置发送，不再要求 Temperature/Top-P 二次确认。供应商返回的拒绝作为请求失败展示，不删字段、改档位或自动重发。自定义 JSON 的受保护字段、附件安全边界、本地历史预算不属于本次取消型号限制的范围。

思考配置按协议分区保存在每个对话的完整设置中，新建时从助手复制。输入区快捷修改只保存当前对话。切换模型或连接不重置参数，切换协议使用对应分区；发送使用冻结快照。未知型号不猜测支持能力或禁用控件。

Responses 解码 reasoning item 的 `summary[].summary_text` 与 `content[].reasoning_text`，协调各自 text delta/done、summary part done、output item done 与 terminal 完整快照；summary/content 的索引独立，已显示部分不重复追加。相同文字但不同事件序号的合法增量保留。Chat 在流式 `choices[].delta.reasoning_content` 和非流式 `choices[0].message.reasoning_content` 读取字符串扩展；缺失/null 忽略，开启显示时错误类型作为协议错误，不从正文 `<think>` 标签推断思考。Anthropic 按 block index 路由 `thinking_delta`，处理初始 thinking block，忽略 signature、redacted 和不透明数据。非流式也使用独立中立思考事件。关闭显示时 adapter 与运行时都丢弃意外返回的片段；取消/失败保留此前已经显示并保存的可读部分。来源：[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[Claude 流式 thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#streaming-thinking)。

2026-09-21 对照官方文档：OpenAI Responses 规范定义 reasoning_text 事件，但 [OpenAI 推理指南](https://developers.openai.com/api/docs/guides/reasoning) 对其托管模型提供的是可选摘要，不承诺公开原始思考；[Chat 官方参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions) 未定义 reasoning_content。该 Chat 字段依据 [DeepSeek 思考文档](https://api-docs.deepseek.com/guides/thinking_mode/) 作为兼容扩展支持。[DeepSeek Responses](https://api-docs.deepseek.com/api/create-response/) 返回 reasoning_text，接受 summary 参数但不生成摘要。加密字段继续忽略，不回传本地展示文本。DeepSeek 的 Chat 关闭思考要求 thinking.type=disabled；当前通用 Chat 的 off 映射不等同于该供应商开关，本次仅修复返回内容显示，不改变通用请求合同或自动重写供应商参数。

DeepSeek 配置可直接使用现有 OpenAI Chat 或 OpenAI Responses 连接，Base URL 填 `https://api.deepseek.com`，Key 填官方密钥，模型通过连接的模型目录读取后选择。#39 本轮按用户要求收窄为修复现有协议，未增加供应商模板；用户已确认桌面手测通过并要求按修订范围关闭。Chat 关闭思考参数差异由低优先级 [#40](https://github.com/AyaseMinami/AyaseStudio/issues/40) 跟踪，暂缓实施。

纯聊天、无工具调用的 Claude 多轮允许省略旧 thinking blocks；Ayase 只回传普通正文，不保存/回传签名或把展示摘要伪装成模型原始思考。工具调用轮次的完整 block 回传要求不属于本 Issue。参见 [Preserving thinking blocks](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks)。Issue #16 当时未执行真实线路探针；本轮 DeepSeek 实测见 DEVELOPMENT.md。没有新增中转站覆盖规则、自动降级或重试。

The initial relay returned HTTP 200 and `text/event-stream` for all four streaming routes. OpenAI Responses also emitted non-standard `codex.rate_limits` and `codex.response.metadata` events. These are treated as optional unknown events; Ayase Studio depends only on standard terminal and text events.

On 2026-09-14, explicit live probes completed successfully for all four adapters across two relays. OpenAI Chat also produced one HTTP 524 before succeeding on a single diagnostic retry; its successful first delta arrived after roughly 12.6 seconds. This is treated as relay latency/timeout behavior, not a reason to add automatic application retries. A public cleartext HTTP endpoint passed protocol probes but is intentionally outside the desktop capability scope.

## Error policy

Issue #14 的“重新生成”是用户确认后发起的一次新请求，使用点击时的当前会话有效配置和连接。它以对应用户消息为末条输入，排除切点后的历史；助手正文不会转换成用户输入。预检通过后旧回复及后续消息被截断，失败/停止保留新请求终态，不回退或自动重发。Anthropic 暂停后的“继续”仍使用原请求保存的配置快照。正文编辑、删除和分支创建不调用 transport。单条删除留下的孤立消息继续展示；上下文预算仍只收集归属匹配且完成的用户/助手轮次。

- 429 is `rate-limit` and retryable.
- 500-599 is `server` and retryable.
- Other non-success HTTP statuses are `http`; retryability depends on the status.
- HTTP failures retain the full response body and status; provider error events retain their payload instead of only the message field. Configured keys, credential fields and Bearer credentials are redacted before display. The UI renders errors as text, never raw HTML. Empty or unreadable bodies use a fallback message.
- Provider-declared stream errors without an HTTP status are `provider`, unless their code identifies a rate limit or server overload.
- Fetch rejection is `network`, unless the request signal is aborted.
- Invalid JSON in a data-bearing standard event is `protocol`.
- v0.1 reports retryable failures but does not retry automatically, avoiding duplicate generations after ambiguous disconnects.

## Native web search (#6)

开启时 Responses 声明 `web_search` 并 include `web_search_call.action.sources`，Chat 设置 `web_search_options:{}`，Gemini GenerateContent 声明 `googleSearch:{}`，Anthropic 声明 `web_search_20250305`。关闭省略本功能字段，不改变 Responses 的 `store:false`。不建立型号白名单或自动兼容降级；搜索专用模型本身可能始终联网。

Gemini 使用标准 JSON 驼峰字段 `googleSearch`。2026-09-19 同线路实测中，`google_search` 请求缺少 grounding 元数据，仅替换为 `googleSearch` 后返回搜索词、来源、引用和建议。这个结果说明该线路的字段兼容差异，不表示 Google 官方废弃下划线写法；不采用失败后自动换字段重试。

引用和来源由响应结构产生，Chat 运行时 annotations 是否存在取决于线路；Gemini grounding 坐标使用 Part 内 UTF-8 字节偏移；Anthropic 网页引用附着于 text block。HTTP 200 搜索工具错误单独展示。Anthropic replay 保留 encrypted/signature 内容，pause_turn 仅由用户继续，不自动循环。具体合同和来源见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
