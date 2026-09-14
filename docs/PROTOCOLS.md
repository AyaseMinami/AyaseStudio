# Protocol Compatibility Contract

## Neutral request

Every adapter receives a base URL, API key, model, ordered local message history, and optional abort signal. The base URL stops before the protocol resource path.

## URL resolution contract

Three values are deliberately distinct:

- **Configured base URL**: the text supplied by the user.
- **Normalized base URL**: the protocol-aware base after deterministic local normalization.
- **Resolved endpoint**: the exact URL used for the HTTP request and shown in settings.

Normalization never changes the scheme, host, or port and never probes alternative routes. URLs containing an invalid scheme, query, or fragment are rejected before a request. Repeated normalization must return the same result.

| Adapter | Configured example | Normalized base | Resolved endpoint |
| --- | --- | --- | --- |
| OpenAI Chat | `https://relay.example.com` | `https://relay.example.com/v1` | `https://relay.example.com/v1/chat/completions` |
| OpenAI Chat | `https://relay.example.com/custom/v1` | unchanged | `https://relay.example.com/custom/v1/chat/completions` |
| OpenAI Responses | `https://relay.example.com/` | `https://relay.example.com/v1` | `https://relay.example.com/v1/responses` |
| Gemini native | `https://relay.example.com` | unchanged | `https://relay.example.com/v1beta/models/{model}:streamGenerateContent?alt=sse` |
| Anthropic native | `https://relay.example.com` | unchanged | `https://relay.example.com/v1/messages` |

The UI previews the resolved endpoint but stores the configured value. Automatic fallback from one endpoint to another is prohibited because an ambiguous failure could otherwise duplicate a generation.

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
