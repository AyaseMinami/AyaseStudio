# Protocol Compatibility Contract

## Neutral request

Every adapter receives a base URL, API key, model, ordered local message history, and optional abort signal. The base URL stops before the protocol resource path.

Issue #5 的中立 `ChatMessage` 可以附带附件列表。已发送记录只持有应用私有目录的相对引用、文件名、MIME 与大小，不含原文件路径/二进制；发请求前将保留轮次的引用加载成只在内存存在的 Base64 字节，缺失/损坏立即停止，不能静默丢弃历史附件。新附件草稿只有点击发送时才入库；请求包含最新文本与附件，附件单独也能发送。历史预算以完整用户/助手轮次保留或裁剪，附件跟随所属用户消息，媒资计数只能按原始字节做本地估算，不声称供应商计费准确。

| Adapter | Image | PDF | TXT / Markdown |
| --- | --- | --- | --- |
| OpenAI Chat Completions | user `image_url` data URL | user `file.file_data` data URL + filename | labelled UTF-8 `text` part |
| OpenAI Responses | `input_image.image_url` data URL | `input_file.file_data` data URL + filename | labelled `input_text` part; `store: false` |
| Gemini native | user `parts[].inlineData` MIME/Base64 | user `parts[].inlineData` PDF MIME/Base64 | labelled `parts[].text` |
| Anthropic native | user `image.source` Base64 | user `document.source` Base64 | labelled `text` block |

四种 adapter 仅在用户显式发送时内联请求，不调用任何供应商 Files API；不设统一的 10/20 MB 文件/消息上限，也不以原来的 30 MB 历史预读取或 32 MB 四协议应用上限拦截。映射时按当前协议的官方合同判断：OpenAI 文件输入的单个 PDF 须小于 50 MB、同次请求的 PDF 合计不超过 50 MB；Gemini 含内联媒体的整次请求不超过 20 MB；Anthropic 内联单张图片的 Base64 数据不超过 10 MB、整次请求不超过 32 MB。这些是各协议自己的限制，不能互相继承；实际中转站若有其他限制，只呈现其响应，不自动改路或重试。校验在新附件私有复制、用户消息入库和网络请求之前完成，失败不留下已发送记录。图片使用可识别的实际 MIME，无法识别时沿用第一阶段支持的文件类型；不要求后缀和内容完全匹配，不在本地完整解码图片，也不先替供应商判定图片/PDF 能否解析。当前模型目录不保存图片/PDF 能力，因此未知模型只提示而不臆断；已知官方注明无视觉输入的 GPT-3.5 Turbo、旧 GPT-4 和 GPT-4 Turbo Preview 则在 UI 与最终映射时禁用图片/PDF 并解释，绝不自动改模型、重试或丢附件。相关官方资料：[OpenAI 图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[GPT-3.5 Turbo 模型能力](https://developers.openai.com/api/docs/models/gpt-3.5-turbo)、[旧 GPT-4 模型能力](https://developers.openai.com/api/docs/models/gpt-4)、[Gemini GenerateContent 图片输入](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)、[Gemini 文档理解](https://ai.google.dev/gemini-api/docs/document-processing)、[Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)、[Anthropic 图像](https://platform.claude.com/docs/en/build-with-claude/vision)。

Issue #3 adds a frozen `SessionConfig` to the neutral request. It carries the system instruction, `auto/custom` numeric modes, stream selection and per-protocol custom JSON. The local context budget is applied before `ChatTransport` and never becomes a fabricated provider Body field. Adapters revalidate config while building their final Body, even when the UI was bypassed.

## Connection selection boundary

供应商只用于设置界面的分组，不进入 transport，也不提供父级字段继承。每条连接完整持有名称、协议、Base URL 与 API Key，并拥有自己的已添加模型。当前聊天由所属助手持久化的 `defaultModelId` 指向一个已添加模型，设置页的 `activeModelId` 从它派生；运行时从模型的唯一父连接读取 transport 类型、地址和凭据，因此不会把一个连接的协议与另一个连接的 Key 或模型混合。助手统一保存模型引用和生成配置，对话不再复制或覆盖；请求的目标和配置在发送时冻结。

同一供应商可以配置多条相同协议的连接，以表示一个中转站的不同 URL、账号或渠道。复制已有值只发生在新建连接时，只复制地址和密钥而不复制模型；后续编辑互不影响。相同实际模型 ID 可以分别存在于不同连接下。浏览某条连接不会改变当前聊天模型；显式选择模型更新当前助手的引用，同一助手所有对话的后续请求共用此模型。删除模型或其祖先会清空相关助手选择，不自动回退。供应商模板不产生 provider-specific transport 分支。API Key 不复制到模型目录、对话快照、消息或日志。

## Model catalog boundary

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
- `thinking-delta`: append provider-readable thought summary to a separate local display field (Gemini Native first slice); never append to answer text or input history.
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

With stream disabled, OpenAI Chat and Responses use the same POST paths with `stream: false`; Gemini uses `POST /v1beta/models/{model}:generateContent` (without `alt=sse`); Anthropic uses `POST /v1/messages` with `stream: false`. The shared URL resolver takes the request mode, so the generation endpoint preview and actual Gemini URL agree. Non-streaming adapters parse the complete JSON before yielding text followed by exactly one `completed`; Gemini routes each part to `text-delta` or `thinking-delta`, while the other adapters yield one `text-delta`. Cancellation or error yields exactly one `aborted` or `failed`.

| Config | OpenAI Chat | OpenAI Responses | Gemini Native | Anthropic Native |
| --- | --- | --- | --- | --- |
| System instruction | leading `system` message | `instructions` | `systemInstruction.parts[].text` | top-level `system` |
| Temperature | `temperature` | `temperature` | `generationConfig.temperature` | `temperature` |
| Top-P | `top_p` | `top_p` | `generationConfig.topP` | `top_p` |
| Top-K | unsupported | unsupported | `generationConfig.topK` when user explicitly requests it; model ability may be unknown | `top_k` on models where supported |
| Max output | `max_completion_tokens` | `max_output_tokens` | `generationConfig.maxOutputTokens` | required `max_tokens`, Ayase auto fallback 4096 |

Auto omits optional numeric request fields. Custom Temperature and Top-P together require explicit confirmation. Protocol/model limitations and ranges are checked before network. OpenAI Responses always sends `store: false` with local history. Custom JSON cannot set model, input/history, system instruction, stream, output cap, `store`, URL, headers, key, tools, provider-managed state or aliases/nested variants. A positive allowlist limits safe supplements: OpenAI Chat `seed`, `presence_penalty`, `frequency_penalty`, `stop`; OpenAI Responses text-only `metadata`; Gemini `generationConfig.stopSequences` and `generationConfig.seed`; Anthropic `stop_sequences`. Non-allowlisted fields fail validation instead of being forwarded. Each protocol's JSON text is retained separately when the selected protocol changes.

Known OpenAI reasoning families (`o1`, `o3`, `o4-mini`, GPT-5/5.1/5.2 and GPT-6 Astra) reject custom Temperature and Top-P because Ayase does not request `reasoning.effort: none`. Unknown model IDs retain an unknown capability label. For Gemini 3.x, the UI relays Google's recommendation to use automatic sampling; the model's precise Top-K support remains unknown without model metadata. Anthropic `top_k` accepts zero, and Ayase does not invent a provider maximum; numeric input is limited to a JavaScript safe integer. An incomplete finish is stored as an incomplete local reply and its whole user/assistant round is omitted from the next input history. Gemini's documented prompt block feedback is a provider failure with its block reason, even when no candidates are returned.

Official references checked for Issue #3: [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create), [OpenAI Responses](https://platform.openai.com/docs/api-reference/responses/create), [OpenAI reasoning-model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2), [Gemini GenerateContent and GenerationConfig](https://ai.google.dev/api/generate-content), [Gemini 3.x guidance](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5), [Gemini model metadata and Top-K support](https://ai.google.dev/api/models), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), and [Anthropic parameter deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). Relay compatibility is observed separately; it does not define official defaults or model capabilities.

## Relay observations

### Gemini thinking first slice

Official GenerateContent [thinking table and summary contract](https://ai.google.dev/gemini-api/docs/generate-content/thinking) checked 2026-09-16. `geminiThinking.ts` uses exact documented text-model aliases; unknown, relay-renamed, image and future models receive no thinking fields. Recognized Gemini 3 models use only their listed `thinkingLevel` values (3.8/3.7 Flash exclude `minimal`); 2.5 Pro/Flash/Flash-Lite use validated `thinkingBudget`, with `-1` for dynamic and `0` only where disabling is supported. Flash's zero budget is presented separately as Off. Unsupported choices and invalid budgets fail at the final request boundary. Model changes restore incompatible saved selections to default with a visible notice.

Default effort omits level/budget. The independent summary preference defaults on for recognized models and adds `generationConfig.thinkingConfig.includeThoughts: true`; turning it off with default effort omits the whole thinkingConfig. Both streaming and non-streaming decoders route only parts with `thought === true` to summaries; all other text remains answer text. When summary display is off, returned thought parts are discarded rather than leaked into the answer. Opaque signatures are ignored. No model-internal duration is inferred. Summary request support on a relay is not proven by official documentation and there is no retry/fallback. Other protocols' thinking request/decoding paths are unchanged.

The initial relay returned HTTP 200 and `text/event-stream` for all four streaming routes. OpenAI Responses also emitted non-standard `codex.rate_limits` and `codex.response.metadata` events. These are treated as optional unknown events; Ayase Studio depends only on standard terminal and text events.

On 2026-09-14, explicit live probes completed successfully for all four adapters across two relays. OpenAI Chat also produced one HTTP 524 before succeeding on a single diagnostic retry; its successful first delta arrived after roughly 12.6 seconds. This is treated as relay latency/timeout behavior, not a reason to add automatic application retries. A public cleartext HTTP endpoint passed protocol probes but is intentionally outside the desktop capability scope.

## Error policy

- 429 is `rate-limit` and retryable.
- 500-599 is `server` and retryable.
- Other non-success HTTP statuses are `http`; retryability depends on the status.
- Provider-declared stream errors without an HTTP status are `provider`, unless their code identifies a rate limit or server overload.
- Fetch rejection is `network`, unless the request signal is aborted.
- Invalid JSON in a data-bearing standard event is `protocol`.
- v0.1 reports retryable failures but does not retry automatically, avoiding duplicate generations after ambiguous disconnects.
