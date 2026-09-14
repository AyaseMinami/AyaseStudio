# Ayase Studio v0.1 Plan

## Goal

Build a fast, local-first desktop chat client with a deliberately small feature set. Ayase Studio is a new implementation, not a Cherry Studio fork.

## v0.1 scope

- Ordinary Tauri 2 desktop window using React, TypeScript, Vite, and Tailwind CSS.
- Plain-text multi-turn chat with streamed Markdown rendering.
- One current conversation slot for the v0.1 vertical slice; multiple saved conversations are deferred.
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

## Explicitly out of scope

- Agents, MCP, RAG, knowledge bases, tools, web search, and file attachments.
- Accounts, cloud sync, telemetry, auto-update, plugins, and marketplace features.
- Global shortcuts, tray behavior, frameless-window tricks, and multi-window behavior.
- Provider-managed conversation state. OpenAI Responses uses local history with `store: false`.
- Rendering raw HTML from model output. `rehype-raw` is prohibited.
- Multiple saved conversations, conversation search, folders, pinning, and automatic title generation.

## Module seams

The UI knows only the `ChatTransport` interface and neutral `ChatEvent` values. Each provider adapter owns endpoint construction, headers, request mapping, SSE decoding, unknown-event handling, and provider-specific errors.

Conversation storage sits behind `ChatRepository`; UI code does not call Dexie directly.

URL resolution will sit at one seam shared by settings preview and transports. The UI supplies the configured base URL; the resolver returns the normalized base URL and final endpoint. Adapters must not independently duplicate normalization rules.

## Configuration model

The current fixed one-profile-per-protocol map is temporary. The next configuration slice uses named connection profiles:

```text
ConnectionProfile
- id
- name
- protocol
- configuredBaseUrl
- apiKey
- model

AppSettings
- activeProfileId
```

- Multiple profiles may use the same protocol; protocol is never a profile identity.
- Selecting a profile selects its protocol, Base URL, key, and model atomically.
- The active profile ID is persisted and restored on startup.
- Missing, deleted, or corrupt active-profile references fall back deterministically without deleting valid profiles.
- Keys remain local and are never copied into conversations or tracked by Git. Keychain storage remains a later security upgrade.
- Migration preserves valid values from the current `ProviderProfiles` storage shape.

## Conversation roadmap

The current `current` snapshot intentionally represents one multi-turn conversation. This is sufficient for the transport and persistence vertical slice, but not the final daily-use experience.

After connection profiles are stable, multiple conversations can add create, switch, rename, and delete operations behind `ChatRepository`. Each conversation should remember a `lastUsedProfileId`; it references a connection profile rather than duplicating credentials. Search, folders, pinning, and automatic titles remain separate later decisions.

## Delivery stages

1. **Transport tracer bullet**: one public streaming interface, deterministic tests, all four adapters, and Tauri HTTP wiring.
2. **Single-conversation UI**: settings, Markdown transcript, composer, streaming, stop, and visible errors.
3. **Persistence**: conversations/messages in Dexie with throttled writes and unfinished-message recovery.
4. **Acceptance**: packaged Tauri smoke tests against the configured relay, including cancellation and provider switching.

## Next implementation slice

Add protocol-aware URL resolution before expanding the feature set:

- Trim whitespace and redundant trailing slashes.
- For OpenAI Chat and Responses only, append `/v1` when the configured URL has no path.
- Preserve an existing `/v1` suffix and any non-root custom path.
- Do not change scheme, host, or port, and do not perform fallback network requests.
- Resolve Gemini and Anthropic automatically from a relay root by appending their complete versioned resource paths (`/v1beta/models/...` and `/v1/messages`); do not prepend an extra generic `/v1` to their normalized base.
- Show the exact final request endpoint below the Base URL field before sending.
- Cover root, trailing-slash, existing-version, custom-path, port, and invalid-URL cases with deterministic tests.

## Known issues

- Provider profiles are persisted, but the selected protocol is not. Startup currently always selects `openai-chat`; configuration persistence must validate, store, and restore the last selected protocol, with `openai-chat` only as the fallback for missing or invalid data.
- The current profile storage allows only one profile per protocol and has no user-defined profile names; migrate it to the connection-profile model above.
- Markdown soft line breaks are currently collapsed by CommonMark rendering. Preserve model-provided single newlines without enabling raw HTML, and cover the rendered line-break behavior with a regression test.

## Acceptance gates

- Streamed text is incremental and ordered.
- A request produces exactly one terminal outcome: completed, failed, or aborted.
- Deterministic tests cover HTTP 429, HTTP 500, network failure, malformed SSE, and cancellation; real providers are not required to manufacture failures.
- Unknown SSE event types are ignored without losing later standard events.
- URL normalization is deterministic and idempotent, and the endpoint shown in settings exactly matches the requested URL.
- Restart restores the last selected protocol and its matching profile; corrupt stored selection falls back safely.
- Model-provided single newlines remain visually distinct without enabling raw HTML.
- Secrets and local probe configuration are ignored by Git.
- `npm test`, TypeScript build, Rust check, and production bundle build pass.

## Reference policy

Official provider documentation is authoritative. Relay behavior is verified by probes. Cherry Studio may be inspected only for a specific UX or compatibility question; its architecture is not imported and code is not copied without an explicit license review and source record.
