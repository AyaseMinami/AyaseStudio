# Ayase Studio Repository Instructions

These instructions apply to the entire repository.

## Read first

Use `README.md` for orientation and read the references relevant to the task:

- `docs/DEVELOPMENT.md`: environment, commands, and verification.
- `docs/ARCHITECTURE.md`: module boundaries, state ownership, persistence, and security.
- `docs/PLAN.md`: feature scope and acceptance criteria.
- `docs/PROTOCOLS.md`: transport, URL, streaming, and provider work.
- `CONTEXT.md`: domain terminology.

GitHub Issues record approved feature scope and acceptance criteria. Explicit user changes in the current task take precedence; document any resulting discrepancy without updating the remote unless authorized. Do not broaden the task with adjacent roadmap work.

Complete authorized local edits and relevant checks without asking again for routine implementation choices. Ask when a missing product decision or authorization affects the outcome, and continue independent work while waiting.

## Branch and remote policy

- `main` is the stable baseline; `dev` is the normal integration branch.
- Work in `dev` unless the user explicitly requests another branch or worktree.
- Do not create branches or worktrees merely as a precaution.
- Do not commit, push, open or merge a PR, close an Issue, or publish a release unless the user explicitly requests that remote or Git action.
- Preserve unrelated user changes in a dirty worktree. Never use destructive reset or checkout commands to remove them.

## Secrets and external effects

- Treat `.env.probe.local` and all provider credentials as secrets.
- Read live credentials only when the user explicitly requests or authorizes a live provider probe.
- Never print, log, commit, quote, or copy real keys into documentation, tests, Issues, or PRs.
- Deterministic tests cover 429, 500, malformed streams, network failures, and cancellation. Do not spend real tokens to manufacture those cases.
- Do not send automatic fallback or retry requests after ambiguous generation failures.

## Architecture invariants

- Keep provider behavior behind the neutral `ChatTransport` interface and normalized `ChatEvent` values.
- Each protocol adapter owns endpoint construction, headers, request mapping, stream decoding, unknown-event handling, and provider-specific errors.
- Keep persistence behind repository interfaces; UI modules must not call Dexie directly.
- Share one deterministic URL-resolution seam between settings preview and actual requests.
- Keep Tauri as a thin host. UI Panels and themes belong to React and CSS unless a native capability is required.
- Render model output with `SafeMarkdown`. Raw HTML rendering, `rehype-raw`, and equivalent bypasses are prohibited.
- OpenAI Responses uses local history with `store: false` unless an approved issue changes that contract.
- Prefer deep modules with small interfaces. Do not introduce pass-through abstractions for hypothetical future variants.

## Product boundaries

- Ayase Studio is a new implementation, not a Cherry Studio fork.
- Official provider documentation is authoritative; relay behavior requires an explicit probe.
- Cherry Studio may be inspected for a specific UX or compatibility question. Do not copy its source, text, icons, or assets without an explicit license review and source record.
- An Assistant is a chat preset and conversation container, not an Agent.
- Provider-hosted search does not authorize a general tool runtime, MCP, RAG, or autonomous execution.

## Editing and verification

- Use `apply_patch` for intentional text edits.
- Prefer `rg` and `rg --files` for search.
- On Windows, use `npm.cmd` when PowerShell blocks `npm.ps1`.
- Add or update deterministic tests for changed behavior. Documentation-only edits require content/link review and Git diff checks, not application builds or desktop launch.
- Before handoff, run the checks proportional to the change. The default code gate is:

```powershell
npm.cmd run check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short --branch
```

- Run `npm.cmd run tauri dev` and perform a desktop smoke test for Tauri permissions, runtime networking, window behavior, local files, or theme-first-paint changes.
- Keep `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, and `docs/PROTOCOLS.md` synchronized with changes to their stated contracts.
