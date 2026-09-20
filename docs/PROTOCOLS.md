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

供应商仅用于设置界面分组，不进入 transport，也不提供字段继承。每条连接独立保存协议、Base URL、API Key 和模型列表。发送只使用当前对话完整配置快照，并从模型唯一父连接取得协议及凭据。助手是新对话模板，设置页选模只更新该模板。请求开始时冻结对话配置和连接，运行中修改只影响下一次请求。

同一供应商可有多条相同协议连接，同一实际模型 ID 可属于不同连接。浏览连接不改变聊天模型；助手默认模型变化不影响已有对话。删除模型或连接后清除相关助手选择，会话保留失效引用并阻止发送，不自动回退。API Key 不复制到模型目录、会话配置、消息或日志。

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
- `thinking-delta`: append provider-readable thought summary to a separate local display field (Gemini, Responses, Anthropic); never append to answer text or input history.
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
| OpenAI Chat | 关闭→`reasoning_effort: "none"`；minimal / low / medium / high / xhigh / max 原值发送 | 未接入兼容线路摘要扩展 |
| OpenAI Responses | 同样的强度写入 `reasoning.effort` | 显式开启时 `reasoning.summary: "auto"` |
| Gemini Native | minimal / low / medium / high→`thinkingLevel`；动态→`thinkingBudget: -1`；关闭→0；自定义→输入整数 | 显式开启时 `includeThoughts: true` |
| Anthropic Native | off→disabled；adaptive→adaptive；budget→enabled + `budget_tokens`；独立 low / medium / high / xhigh / max→`output_config.effort` | 显式思考模式下按偏好写入 summarized / omitted |

全部协议都提供“默认”，省略可选模式、强度或预算；Anthropic effort 的默认独立省略 `output_config`。未配置摘要时默认关闭，不额外请求摘要；已有明确保存的 `includeSummary: true` 继续生效。Anthropic 摘要开关本身不会开启思考。Responses 保持 `store: false` 和本地历史。

本地只验证这些控件配置的结构及是否能映射到所选协议；预算为可精确表示的整数，不设型号上下限，不检查预算与输出上限、采样参数间的兼容关系。有限采样数值照用户配置发送，不再要求 Temperature/Top-P 二次确认。供应商返回的拒绝作为请求失败展示，不删字段、改档位或自动重发。自定义 JSON 的受保护字段、附件安全边界、本地历史预算不属于本次取消型号限制的范围。

思考配置按协议分区保存在每个对话的完整设置中，新建时从助手复制。输入区快捷修改只保存当前对话。切换模型或连接不重置参数，切换协议使用对应分区；发送使用冻结快照。未知型号不猜测支持能力或禁用控件。

Responses 只解码 reasoning item 的 `summary_text`，协调 summary text delta/done、summary part done、output item done 与 terminal 完整快照；已显示部分不重复追加。相同文字但不同事件序号的合法增量保留。Anthropic 按 block index 路由 `thinking_delta`，处理初始 thinking block，忽略 signature、redacted 和不透明数据。非流式也使用独立中立摘要事件。关闭摘要时 adapter 与运行时都丢弃意外返回的片段；取消/失败保留此前已经显示并保存的可读部分。来源：[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[Claude 流式 thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#streaming-thinking)。

纯聊天、无工具调用的 Claude 多轮允许省略旧 thinking blocks；Ayase 只回传普通正文，不保存/回传签名或把展示摘要伪装成模型原始思考。工具调用轮次的完整 block 回传要求不属于本 Issue。参见 [Preserving thinking blocks](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks)。未执行真实线路探针；没有新增中转站覆盖规则、自动降级或重试。

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
