# Ayase Studio

Ayase Studio is a deliberately small, local-first desktop chat client. It uses Tauri 2 as the host and keeps provider behavior behind one TypeScript transport interface.

## Current capabilities

- OpenAI Chat Completions
- OpenAI Responses with `store: false`
- Gemini native GenerateContent streaming
- Anthropic native Messages streaming
- Incremental Markdown rendering and cancellation
- Normalized HTTP, network, protocol, and abort outcomes
- Local provider profiles and a Dexie-backed current conversation
- Composable React application shell with focused settings and chat modules
- Persistent light, dark, and system-following appearance modes

Raw HTML in model output is rendered as inert text. Alpha credentials are stored as plaintext in the local WebView profile; do not use untrusted relay credentials.

## Development

```powershell
npm.cmd ci
npm.cmd run tauri dev
```

The first Rust build can take several minutes. Later incremental builds are much faster.

For a new Windows machine, cross-machine Git workflow, local probe setup, verification commands, and troubleshooting, read [the development guide](docs/DEVELOPMENT.md).

## Base URL behavior

At the current snapshot, OpenAI-compatible Base URLs must include their `/v1` prefix. Gemini and Anthropic use the relay root because their adapters append `/v1beta/models/...` and `/v1/messages` respectively.

Protocol-aware route completion for all four adapters and a live preview of the exact resolved endpoint are specified in the v0.1 plan as the next implementation slice; they are not implemented yet. OpenAI root URLs gain `/v1`, while Gemini and Anthropic append their complete `/v1beta/models/...` and `/v1/messages` routes directly.

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
