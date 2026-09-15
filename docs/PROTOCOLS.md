# Protocol Compatibility Contract

## Neutral request

Every adapter receives a base URL, API key, model, ordered local message history, and optional abort signal. The base URL stops before the protocol resource path.

## Connection selection boundary

供应商只用于设置界面的分组，不进入 transport，也不提供父级字段继承。每条连接完整持有名称、协议、Base URL 与 API Key，并拥有自己的已添加模型。当前聊天由持久化的 `activeModelId` 指向一个已添加模型；运行时从模型的唯一父连接读取 transport 类型、地址和凭据，因此不会把一个连接的协议与另一个连接的 Key 或模型混合。

同一供应商可以配置多条相同协议的连接，以表示一个中转站的不同 URL、账号或渠道。复制已有值只发生在新建连接时，只复制地址和密钥而不复制模型；后续编辑互不影响。相同实际模型 ID 可以分别存在于不同连接下。浏览某条连接不会改变当前聊天模型；只有显式选择模型才改变 `activeModelId`。删除当前模型或其祖先会清空选择，不自动回退。供应商模板不产生 provider-specific transport 分支。API Key 不复制到模型目录、对话快照、消息或日志。

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

## Relay observations

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
