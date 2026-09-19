# Ayase Studio

Ayase Studio is a deliberately small, local-first desktop chat client. It uses Tauri 2 as the host, keeps generation behind the neutral `ChatTransport` interface, and isolates model discovery behind `ModelCatalogClient`.

## Current capabilities

- OpenAI Chat Completions
- OpenAI Responses with `store: false`
- Gemini native GenerateContent streaming
- Anthropic native Messages streaming
- Incremental Markdown rendering and cancellation
- Protocol-based thinking controls for arbitrary model IDs for all four protocols, with separate local summaries for Gemini, OpenAI Responses, and Anthropic; official Chat Completions has no readable-summary contract
- Normalized HTTP, network, protocol, and abort outcomes
- Three-level supplier → connection → model configuration, including repeated protocols, per-connection model discovery/testing, persisted active-model selection, and deterministic legacy migration
- Assistant presets with shared configuration across their conversations, safe legacy migration, and Dexie persistence
- User and assistant message copying, editing with confirmed history truncation, single-message deletion, explicit regeneration, and independent conversation branches
- Assistant-managed system instruction, model, validated generation settings, local input-history budget, protocol-specific safe JSON supplements, and streaming/non-streaming generation
- Top-level chat/settings navigation with a dedicated, categorized settings center
- Persistent light, dark, and system-following appearance modes with safe custom colors and private local backgrounds
- PNG/JPEG/WebP/PDF/TXT/Markdown attachments from picker, chat drag/drop, or image paste: unsent drafts stay transient; sending stores private copies and history references without a post-send in-memory image cache, with read-only previews

Raw HTML in model output is rendered as inert text. Alpha credentials are stored as plaintext in the local WebView profile; do not use untrusted relay credentials.

## Development

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

The first Rust build can take several minutes. Later incremental builds are much faster.

For a new Windows machine, cross-machine Git workflow, local probe setup, verification commands, and troubleshooting, read [the development guide](docs/DEVELOPMENT.md).

## Base URL behavior

OpenAI Chat and Responses add `/v1` to a relay root; an existing version suffix or custom path is preserved. Gemini and Anthropic append their own versioned resource paths without adding a generic OpenAI `/v1` prefix. The connection editor keeps the entered Base URL and shows the normalized base and resolved generation endpoint. Gemini shows a complete endpoint only when that connection has an explicitly selected model. Invalid URLs are rejected before catalog, model-test, or chat network requests.

## Local relay probes

Copy `.env.probe.example` to `.env.probe.local` and fill only the local file. It is ignored by Git. Automated tests use synthetic responses for 429, 500, malformed SSE, and cancellation, so they do not spend provider tokens.

Run real, token-consuming compatibility probes explicitly:

```powershell
npm.cmd run probe:live -- --disableConsoleIntercept
```

The live probe uses short prompts, caps output where the protocol supports it, disables automatic retries, and redacts configured API keys from reported failures. Remote HTTP endpoints are suitable only for diagnosis; use HTTPS for credentials and message content.

## Project documentation

- [Development guide](docs/DEVELOPMENT.md): Windows prerequisites, setup, cross-machine workflow, commands, credentials, and checks.
- [Architecture and project structure](docs/ARCHITECTURE.md): technology stack, runtime topology, module seams, state ownership, and security invariants.
- [v0.1 plan](docs/PLAN.md): current product scope, roadmap, known issues, and acceptance gates.
- [Protocol compatibility contract](docs/PROTOCOLS.md): URL resolution, provider event mapping, and error policy.
- [Codex instruction audit](docs/CODEX-INSTRUCTIONS.md): GPT-6 Astra official sources, local instruction cleanup, and verification boundaries.
