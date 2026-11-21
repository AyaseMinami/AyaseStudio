# Ayase Studio Repository Instructions

These instructions apply to the entire repository and serve as the shared repository rule entry point for both Codex and Antigravity.

## Read first

Use `README.md` for orientation and read the references relevant to the task:

- `docs/DEVELOPMENT.md`: environment, commands, multi-agent handoff, and verification.
- `docs/ARCHITECTURE.md`: module boundaries, state ownership, persistence, and security.
- [docs/DATA-CONTRACTS.md](docs/DATA-CONTRACTS.md): mandatory persistence registration, field policies, migrations, backup compatibility, and acceptance boundaries.
- [docs/UI-DESIGN.md](docs/UI-DESIGN.md): read before UI work; the authoritative current UI contract (derived tool summaries in `DESIGN.md`, `PRODUCT.md`, and `.impeccable/design.json` defer to `docs/UI-DESIGN.md` and explicit current user instructions on any conflict).
- `docs/PLAN.md`: feature scope and acceptance criteria.
- `docs/PROTOCOLS.md`: transport, URL, streaming, and provider work.
- `CONTEXT.md`: domain terminology.

GitHub Issues record approved feature scope and acceptance criteria. Explicit user changes in the current task take precedence; document any resulting discrepancy without updating the remote unless authorized. Do not broaden the task with adjacent roadmap work.

Complete authorized local edits and relevant checks without asking again for routine implementation choices. Ask when a missing product decision or authorization affects the outcome, and continue independent work while waiting.

## Branch, worktree, and handoff policy

- `main` is the stable baseline; `dev` is the normal integration branch.
- Work in `dev` unless the user explicitly requests another branch or worktree.
- Do not create Git branches or worktrees merely as a precaution; if a tool needs to create an actual Git branch or worktree, follow repository authorization first.
- Single-writer serial relay on `dev`, with parallel read-only review allowed. Codex and Antigravity may swap implementer/reviewer roles by task or hand off mid-task.
- Write authority transfers only on explicit handoff: the outgoing implementer stops writing first and provides the baseline commit, ownership of uncommitted files, editable scope for the incoming agent, checks already run, and pending acceptance items. The incoming agent inspects `git status` and relevant `git diff` before editing. Handoff does not require committing by default.
- When delegating to subagents that share the current workspace (such as `inherit`), the main agent must either assign strictly non-overlapping write scopes or restrict parallel subagents to read-only review.
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

## Persistent data changes

Apply [the data contract rules](docs/DATA-CONTRACTS.md) whenever adding or changing a persisted table, preference, field, nested record, resource reference or backup module. This is part of implementing the feature; do not wait for a user reminder.

- Register every Dexie table and persistent preference in `src/storage/dataRegistry.ts`, including intentional exclusions and legacy sources. Update exhaustive `FieldPolicy<T>` declarations in `src/storage/dataPolicies.ts` against the actual persisted TypeScript records and nested records; use those policies in the real backup projections.
- Decide and document module versions, minimum readers, required capabilities, migration steps, missing-field defaults, credential handling, resource ownership and backup disposition. Preserve unknown or invalid original data; unsupported structure must fail before durable writes instead of silently resetting it.
- Reuse the pure clone-based migration seam for local reads and backup reads. Do not infer semantic conversions, silently change protocols/targets, or filter unknown security, credential or reference fields as optional parameters.
- Add deterministic coverage for old/current versions, repeated and skipped-version migrations, defaults, unsupported structure with zero writes, parameter filtering reports, re-export warnings and rollback as relevant. Run `npm.cmd run check:data-contracts` (also included in `npm.cmd run check`); static inspection does not prove coverage of arbitrary dynamically computed keys.
- Data-format, cross-module, migration, security or release-gate changes require independent read-only review in a separate context covering the deliverable diff, relevant contracts, and verification evidence; the main agent verifies findings and fixes. Codex continues using `comprehensive_reviewer` (or equivalent high-reasoning reviewer); Antigravity may run an equivalent independent read-only reviewer or hand a fixed scope to Codex for cross-review (and vice versa). Independence follows actual participation: if both agents edited the same major change, an uninvolved independent reviewer must review the final diff—swapping roles does not turn an author into an independent reviewer. Keep #93 integration, cross-version examples and #94 pressure/native acceptance distinct; local implementation is not Issue closure.

## Product boundaries

- Ayase Studio is a new implementation, not a Cherry Studio fork.
- Official provider documentation is authoritative; relay behavior requires an explicit probe.
- Cherry Studio may be inspected for a specific UX or compatibility question. Do not copy its source, text, icons, or assets without an explicit license review and source record.
- An Assistant is a chat preset and conversation container, not an Agent.
- Provider-hosted search does not authorize a general tool runtime, MCP, RAG, or autonomous execution.

## Editing and verification

- Use the agent's native targeted editing tool for intentional text edits (e.g. `apply_patch` in Codex, `edit_file` or equivalent minimal local edits in Antigravity), preserving unrelated changes.
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

- Run autonomous frontend UI acceptance (layout, themes, responsive sizes, navigation, dialogs, and frontend interactions) only in a verified built-in isolated browser against isolated local test pages, synthetic data, and mocked native/provider boundaries; never read live credentials, send provider requests, or reuse a browser profile carrying real user cookies/sessions/data. Codex uses the Codex in-app browser; Antigravity runs browser acceptance only when verified to be using its built-in isolated browser—if switched to an external browser (such as attaching to a running Chrome instance) or if isolation is uncertain, hand browser acceptance directly to Codex.
- Store temporary verification fixtures, logs, and handoff screenshots under ignored `*.local/` directories (such as `.verify.local/<task>/`) and report workspace-relative paths readable by both agents during handoff.
- Do not try Computer Use, native desktop screenshots, or other native UI automation by default, including as a preliminary step or fallback after browser verification. Use them only when the user explicitly requests them.
- For Tauri permissions, runtime networking, window behavior, local files, or theme-first-paint changes, run the relevant native checks and `npm.cmd run tauri dev` startup smoke check. Record native-only interactions (such as window dragging, minimize/maximize, Snap Layout, and OS file dialogs) as pending user manual acceptance when they cannot be verified in an isolated browser. Browser checks, compilation, or successful startup must not be reported as native interaction acceptance.
- Keep `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/PROTOCOLS.md`, `docs/DATA-CONTRACTS.md`, and `docs/UI-DESIGN.md` synchronized with changes to their stated contracts. When UI contracts change, also update derived design summaries (`DESIGN.md`, `PRODUCT.md`, and `.impeccable/design.json`) so they do not contradict `docs/UI-DESIGN.md`.
