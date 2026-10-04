# Ayase Studio Development Guide

## Application updates and GitHub releases #76 (2026-10-04)

The first updater-enabled candidate is prepared as `0.1.0-beta.4`; all npm, Cargo and Tauri version sources agree, and the third-party inventory hashes reflect the updated locks. `v0.1.0-beta.3` already exists and must not be reused. Candidate build, installer acceptance and publication remain separate steps in the release runbook.

The first cloud candidate build and asset readback succeeded; the user reported native candidate acceptance. Publication then exposed GitHub's draft-by-tag 404 while authenticated listing/by-ID returned the same draft. The publication script now resolves that exact draft through pagination and canonical ID after 404 only, keeping all byte/signature/version/ancestry checks and refusing ambiguous matches or other API failures. Deterministic regressions cover pagination, identity changes, missing/duplicate drafts, malformed metadata and non-404 failures. This repair affects publication tooling only; the accepted Beta 4 installer remains unchanged.

Startup-check follow-up adds the default-on device preference in General settings and a once-only 10-second check after workspace initialization, including no selected conversation. Readiness is latched so ordinary operations do not reset the delay. Manual checking wins the timer; disabled/unconfigured/error builds do not automatically check, and background failure stays quiet without retry. The notification links to About without downloading/installing. General preferences v2 migrate v1 read-only and remain excluded from backup; see [the data contract](DATA-CONTRACTS.md). Regression suites cover preferences/defaults/reopening/zero writes, controller timing/cancellation/quiet errors, StrictMode hook replay, switches/notice and an actual empty-assistant App integration.

Final follow-up verification passes `npm.cmd run check`: 22 release-script tests, 16 data-contract tests, 178 Vitest files / 2975 tests and production build; locked Cargo check, fixture TypeScript check and independent Sol/high review also pass. The same isolated native startup probe reads local updater availability and exits successfully; it does not contact the production update channel. Browser fixture acceptance confirms default-on UI, the real delayed startup offer, 查看更新 leading to About without download, disabling before the delay causing zero checks, a failed automatic check returning quietly to idle, and light/dark layout without horizontal overflow. Holding readiness false also produces zero requests; enabling it starts the delay and offers one notification, whose close action retains the available update. Dark 720×620 screenshot: ignored `.update76.local/startup-update-dark.png`. All fixture preferences remain in memory; production localStorage, providers, real update networking and installed upgrade/restart are not exercised.

`npm.cmd run check` now includes `check:release` (deterministic release-contract tests), then existing data contracts, Vitest and production build. Run locked Cargo tests/check and `cargo test --locked --manifest-path src-tauri/Cargo.toml --features release-tools --bin verify-updater-signature` for the official minisign verifier. `scripts/update76` is an isolated production About/controller fixture for manual check, progress/cancellation, failure, installation confirmation and light/dark/narrow layouts; it does not access the user's database, provider credentials or actual updater. See [fixture instructions](../scripts/update76/README.md).

GitHub setup and manual main-only candidate/publication steps are in [RELEASING.md](RELEASING.md). Local development keeps an empty updater public key and does not generate signed updater artifacts; the candidate workflow injects the real public key from a repository variable and obtains the private key only in signing steps. Never ship an unconfigured candidate: preflight fails closed. Existing releases without updater need one manual upgrade. Keep real GitHub execution, Windows fresh install/reinstall/upgrade/data retention and installer restart acceptance separate from mock/browser checks and native startup. No release, remote branch or secret is created by editing the workflow files locally.

Local verification on 2026-10-04: final `npm.cmd run check` passed 17 release-script tests, 16 data-contract tests, 176 Vitest files / 2945 tests and the TypeScript/Vite build. The subsequent stable-publication rollback gate passed all 22 release-script tests. Locked Cargo check passed; Rust library tests passed 163 tests with one existing ignored test, and the release signature-helper test passed. The strengthened cancellation test starts the work before sending cancellation and confirms its future is dropped; both targeted updater tests pass. An actual Tauri CLI signature generated with temporary synthetic keys accepted the original version and rejected both a relabeled version and tampered bytes; temporary signing files were removed. Independent Sol/high review has no remaining concrete finding. The initial default-affinity encrypted-backup test and Rust compilation failed; the final run used the existing temporary process-affinity workaround (`[intptr]4294967280`) and Rust `CARGO_INCREMENTAL=0`/one build job without changing or relaxing application checks. A targeted App stream test also intermittently counted a background request; its isolated rerun, subsequent 67-test integration run and final full suite passed without source changes.

The isolated native startup probe compiled, invoked `update_status` (current version `0.1.0-beta.3`, Beta, disabled without a configured public key), and exited successfully. Its report is ignored `.update76.local/native-probe.json`. This does not establish GitHub networking or installer/restart acceptance. Real Actions execution, fresh install/reinstall/upgrade/data retention and end-to-end in-app update remain pending; candidate publication requires the runbook's real installer acceptance, with in-app end-to-end acceptance recorded separately after publication.

In-app browser acceptance used the isolated production About/controller fixture. It covered explicit check, current/unavailable/error states, known and unknown download size, cancellation after actual transfer settlement, failed signature preventing installation, explicit install confirmation/cancellation/reconfirmation, literal HTML-looking notes with bounded scrolling, and the maintained mirror/code with intercepted external navigation. Light 1280×800 and dark 720×620 showed no horizontal page overflow. Clipboard interaction reported a successfully copied extraction code. Ignored screenshots are `.update76.local/about-update-light.png` and `.update76.local/about-update-dark.png`; all download/install operations were synthetic, with no provider or production data access.

## 本轮人工验收与交付（2026-10-04）

用户确认本轮所有功能已手动测试通过，并授权提交、推送工作区全部改动及关闭对应 Issue #118、#119。本次交付不追加测试、构建或独立 review，仅核对提交范围、分支同步、Git diff 格式和远端状态。下述实现阶段记录中的待人工验收状态已由本次确认更新；此前自动化与浏览器检查结果仍作为历史证据。

## Model grouping #119 (2026-10-04)

Focused deterministic coverage includes `src/chat/modelGroups.test.ts`, `src/backup/modelGroups.test.ts`, `src/ui/settings/ModelGroupManagement.test.tsx`, `src/ui/settings/ConnectionSettings.groups.test.tsx`, and the existing provider-session and chat picker tests. Covers legacy/repeated reads without writes, automatic fallback, empty groups, same-connection references, full-batch validation, failed persistence, restore merge/copy/replace/re-export/rollback, hidden selections, deletion confirmation and connection switching. Independent Sol/high review found no production defect; its preview add-provider/add-connection signature finding was corrected before delivery.

Validation: `npm.cmd run check` passed 16 contract tests, registry coverage, 175 Vitest files / 2913 tests, TypeScript and production build; `cargo check --locked --manifest-path src-tauri/Cargo.toml` passed. The final group-assignment CSS refinement is checked by rebuilding and browser inspection; successful unrelated checks are not repeated.

Run the isolated preview with `npm.cmd run dev -- scripts/model-groups119 --config scripts/model-groups119/vite.config.ts`, then open `http://127.0.0.1:1520/`. It uses production settings/picker components with synthetic models, empty credentials, namespaced preview preferences and mocked avatar/native/provider boundaries. Browser acceptance covered create/assign/rename/delete, automatic fallback, picker group search and connection context, refresh restoration, hidden selections and save failure, generation guards, light/dark themes at the default 1280×720 viewport and an 820×760 narrow viewport. No live user data, provider requests, native window interaction or installer acceptance was performed; user visual preference acceptance remains open. See [preview instructions](../scripts/model-groups119/README.md).

## Batch management #118 (2026-10-04)

Focused coverage lives in `src/chat/batchDeletion.test.ts`, `src/ui/chat/ConversationNavigation.batch.test.tsx`, `src/ui/settings/ConnectionSettings.batch.test.tsx` and the existing workspace/provider-session tests. Cover empty and single selections, exact batch target sets, assistant migration versus cascade, Cancel/Escape, scope changes, generation during flush, stale targets, storage failure/transaction rollback and one durable settings write. Existing navigation performance and single-delete tests remain applicable.

Run the default `npm.cmd run check`, locked Cargo check and diff checks. Independent review is required for the new cross-module commands and mutation guards. For browser acceptance, run `npm.cmd run dev -- scripts/batch118 --config scripts/batch118/vite.config.ts` and use the isolated fixture at `http://127.0.0.1:1519/`; see [fixture instructions](../scripts/batch118/README.md). Each page uses a uniquely named synthetic Dexie database, memory-only avatars/themes and blocked native/provider requests. Check light/dark, narrow navigation, parent/child scopes, empty selection, cancellation, cascade/migration and generation protection. Native styling remains user acceptance; this change adds no native capability.

Validation: `npm.cmd run check` passed 16 data-contract script tests, 171 Vitest files / 2878 tests, TypeScript and the production build; locked Cargo check also passed. The frontend gate used the existing temporary process-affinity workaround documented below. Independent Sol/high review has no remaining P1/P2 finding after correcting cancellation during external generation and returning focus to an enabled, non-inert management or navigation control.

Isolated in-app browser acceptance covered all four scopes at 1280px and 640px, light/dark dialogs, mandatory confirmation for empty parents/connections, assistant move versus cascade, default-assistant protection, scope-specific selection, generation blocking, Cancel/Escape preserving selection, and focus after cancellation/success. No horizontal page overflow was observed at 640px. Real user data, provider requests, installer/upgrade and native rendering were not exercised. No commit, push or remote Issue update was performed.

Layout follow-up: management actions now sit beside their own list/detail title, with an aligned selection toolbar, selectable rows, separate hover/selection feedback and provider impact summaries. The confirmation surface uses the existing 16px radius/24px padding. The 91 focused navigation/connection tests pass, including entry/exit focus regressions; locked Cargo check and diff checks pass. In-app browser checks covered 1280px/640px, both themes, long-name ellipsis, whole-row selection, Space/Escape and management focus. The final shared-worktree gate passed 16 data-contract tests, 175 Vitest files / 2913 tests and production build, using temporary process affinity. Earlier checks were blocked by parallel model-group test type errors, which were resolved before this final run; this gate includes those parallel changes but does not independently accept their feature scope. Native visual acceptance remains pending.

## Beta 3 release verification

Version `0.1.0-beta.3` includes the post-Beta-2 drawing output configuration and workspace interaction fixes. All npm, Cargo and Tauri version declarations agree; the third-party inventory lockfile hashes were regenerated without dependency changes.

Release checks passed: 16 data-contract script tests, 168 Vitest files / 2839 tests, TypeScript/Vite production build, 160 Rust tests (one existing ignored test), locked Cargo check and nine NSIS installer-policy cases. These checks and packaging temporarily use process CPU affinity `0xfffffff0` to avoid locally observed unstable execution positions; this is an environment constraint, not a crypto-code fix or a permanent system setting. No tests were skipped or relaxed for this release. Earlier default-affinity failures below remain historical evidence, not the latest controlled-run result.

Actual installation, upgrade/data retention, native folder dialogs and real provider requests remain outside this release's automated acceptance. The two machine-specific diagnostic files remain local and excluded from Git.

## Workspace delivery verification (2026-10-03)

Cherry import now uses a workspace-level `canImport` predicate rather than send readiness: empty assistants and no selected conversation may import, while pending operations, stale snapshots, maintenance locks and failed selected-transcript hydration still block. Entry, native chooser and commit share the predicate. The 114 focused session/workspace tests, TypeScript/production build, Cargo check and independent review pass. The confirmation dialog's explicit auto margin restores centering after Tailwind preflight.

The remaining full-suite failure is an intermittent encrypted-backup roundtrip in unchanged `src/backup/codec.test.ts`: default parallel runs and a two-worker run fail at different encrypted cases, while an isolated run passes all 88 codec tests. Temporary synthetic-only diagnostics identified Node WebCrypto `OperationError` with cause `Cipher job failed`; diagnostics were removed, and neither crypto implementation nor test gates were weakened. Root cause remains unresolved. Latest two-worker suite: 2838 passed, 1 failed out of 2839. This delivery does not establish that all bugs or the complete test gate are cleared.

## Configurable drawing output (2026-10-03)

Development defaults to repository-root `output/` (ignored by Git); installed builds use executable-adjacent `output/`. General settings can choose another folder or restore the default. Validate probe failure without changing the previous preference, cancel, restart, output A → B with old A preview/recovery retained, batch binding before dispatch, and no provider call on a failed preflight. Unit cases live in `drawing_output.rs`, `queue.test.ts` and `DrawingOutputSettings.test.tsx`. User-selected paths and immutable task locations are native device-only records excluded from backup; see [data contracts](DATA-CONTRACTS.md#本机可配置绘图输出2026-10-03).

Validation: all 58 drawing Rust tests pass; the data-contract gate, production build, Cargo check and independent Sol/high review pass. Full frontend suite: 2834 passed, 3 failed, all failures in the unrelated untracked `src/chat/useChatSession.cherry.test.tsx`. In-app browser checks with mocked native commands cover selection, cancel, permission-error retention, reset and narrow long-path wrapping. The isolated native startup/close probe reported `guard-settled` at `2026-10-03T14:19:41.594Z` and exited 0. Actual OS folder selection and Explorer interactions remain manual acceptance; no live providers, user-file migration or installer update were performed. Legacy queued tasks without files or bindings select their location on first dispatch; existing file-backed tasks remain in place.

## Drawing output layout v2 (2026-10-03)

Before configurable output, layout v2 placed generated originals directly in the app-data `drawing` root as `<task UUID>_<image UUID>.<ext>`. That layout remains readable; new tasks now use the configured output described above. Task manifests/pending journals and new scoped reference-import receipts lived under `drawing/meta`; selected input originals still remain under `drawing/references`. Existing task folders remain readable in place, with no automatic move of user files. Persisted drawing references are logical identifiers resolved by the native file layer, not paths to open directly. See [data contracts](DATA-CONTRACTS.md#绘图输出目录布局-v22026-10-03) for compatibility and downgrade limits.

Run `cargo test --lib --locked --manifest-path src-tauri/Cargo.toml drawing::tests`, the normal frontend/data-contract gate, Rust check and an isolated `tauri dev` smoke using `scripts/drawing110/close-probe.config.json`. Native tests use temporary directories and synthetic image bytes; do not modify the real app-data directory or call providers. Compilation/startup does not establish Explorer interaction acceptance.

Validation: 51 drawing Rust tests pass, as do data-contract checks, frontend production build, Rust check and diff checks. The isolated close probe started and reported `guard-settled` at `2026-10-03T13:53:27.557Z`, exiting 0. Initial incremental compiler/linker access violations were bypassed with `CARGO_INCREMENTAL=0` and `cargo test --lib -j 1`; no repository build settings changed. Full frontend run: 2818 passed, 4 failed in untouched backup encryption and Cherry-import test files. Independent Sol/high review found no P0/P1/P2 defect in this layout change. No live provider call, real-file migration, installer delivery or Explorer interaction acceptance was performed.

## Beta 2 packaging (2026-10-03)

`0.1.0-beta.2` packages the current `dev` baseline as a Windows x64 NSIS prerelease. npm, Cargo and Tauri versions are aligned; the locked dependency inventory is regenerated after the root version change. This release includes the post-Beta-1 chat/workbench appearance, navigation performance, general preferences and tray menu, shared controls, and documented cache/backup fixes.

At the user's request, packaging does not rerun additional tests or independent review. `npm.cmd run build:windows` executes the production TypeScript/Vite build, Rust release compilation and NSIS packaging. Artifact version, size, signature status, SHA-256, remote tag and uploaded asset digest are checked separately. Existing implementation verification remains historical evidence; fresh installation, upgrade/data retention, native tray interactions and real provider compatibility are not established by packaging.

Packaging succeeded after two rustc process crashes (`0xc0000005`, then `0xc0000374`) and a package-scoped Release cache clean; no source or optimization settings changed for recovery. Final TypeScript/Vite build, optimized Rust compilation and NSIS packaging passed. Both application and installer report `0.1.0-beta.2`; installer size is 7758146 bytes, Authenticode status is `NotSigned`, SHA-256 is `87174d11a37a0e7a0b010e946088cb406c30ece9bed0d02a3ed31b6e2dc878d0`. Build logs are kept under the ignored `release-beta2.local/` directory.

## Switch and checkbox unification (2026-10-03)

Explicit shared classes in `src/ui/ToggleControls.css` style boolean settings as switches and retain checkboxes for selection/confirmation. Callbacks, disabled boundaries, save timing and persisted formats are unchanged. The workbench fixture now supplies in-memory general preferences for safe interaction checks.

Validation: `npm.cmd run check` passed 166 suites / 2811 tests, data-contract checks, TypeScript and production build. A subsequently added stream-control regression and related tests passed 5 suites / 55 tests; the final CSS alignment adjustment was followed by another successful production build. Cargo check, fixture TypeScript and Git diff checks passed. Existing large-chunk build advice remains.

In-app browser checks used the workbench and select116 fixtures: light/dark settings, 640px narrow general/appearance layouts, 36×20 switch geometry, aligned general controls, Space-key toggling, conversation disabled fieldset feedback, and search/drawing controls. Browser inspection caught and corrected a specificity conflict that removed the general switches' automatic left margin. Import partial selection, backup confirmations and resource management remain covered by component regressions; those flows and forced-colors rendering were not separately exercised in the browser this round. No provider requests or native window behavior were tested. Local screenshot: `.chat108.local/toggle-general.png`; full check log: `.chat108.local/toggle-check.log`.

## Background mask tuning verification (2026-10-03)

Range 0–90 and default/reset 50: `npm.cmd run check` passed (166 files / 2811 tests, data-contract checks and production build), as did `cargo check --manifest-path src-tauri/Cargo.toml` and `git diff --check`. Deterministic tests cover zero-mask persistence, restart, library switching, backup encode/decode, missing defaults and preservation of saved 65. In-app browser inspection of the isolated workbench fixture confirmed the rendered control has min 0, max 90 and value 50; that fixture disables the background control, so slider interaction/reset is covered by component tests, not browser interaction acceptance. No live provider or native interaction was exercised.

## Nonvisual release audit (#57 / #106, 2026-10-03)

[Audit record](ISSUE-57-106-AUDIT.md) distinguishes the reviewed baseline and scoped fixes from concurrent UI/tray edits, records cache boundaries, and keeps native pressure/installation acceptance separate. Focused regression commands:

```powershell
npm.cmd test -- src/chat/contextBudget.test.ts src/ui/chat/SentAttachmentPreview.test.tsx src/backup/restore.test.ts src/ui/settings/BackupWorkspace.test.tsx
node scripts/inventory-third-party.mjs
```

The second command regenerates the [locked dependency inventory](THIRD-PARTY-DEPENDENCIES.md) using installed npm metadata and offline Cargo metadata; it does not validate an installer or install dependencies. See [license and asset attribution](THIRD-PARTY-LICENSES.md) for missing texts, compound licenses and pending brand permissions.

## Rounded tray menu verification (2026-10-03)

Compact follow-up: the menu is now 224×131 inside a 240×147 host; the earlier 150/166 heights below describe the initial version. Removed the permanent bottom error row; errors appear as a first-item subtitle within the existing row. Browser measurement confirmed approximately 7px at both top and bottom with no overflow. All 8 tray tests passed; production build, locked Cargo check and diff check passed. This sizing change still needs the updated native executable for desktop confirmation.

`tray.html` is a separate Vite build entry. Preview it on an isolated localhost origin without loading the main app; browser mode does not invoke native commands. The fixed 240×166 logical-pixel host includes an 8px transparent shadow gutter. Browser acceptance checked the actual renderer in light/dark themes, its 224×150 menu without overflow, ArrowDown and End navigation; deterministic tests also cover action dispatch, Escape/Tab cycling, repeated-click suppression, errors and read-only appearance updates. Native geometry tests cover work-area edges, negative monitor origins and scale-adjusted menu sizes.

Validation: `npm.cmd run check` passed 166 suites / 2792 tests, data-contract checks, TypeScript and the two-entry production build (existing large-chunk advisory). Targeted tray/general/App tests passed 58 tests; Rust tray tests passed 2 tests, locked Cargo check and scoped diff checks passed. Independent Sol/high review found no confirmed P1/P2 defect.

Native startup is **unverified**: `npm.cmd run tauri dev -- --no-watch --config .tray-smoke.local/native.config.json` could not replace the already-running development executable (Windows access denied). An ignored separate harness executable failed before startup with `0xc0000139`; it supplies no native acceptance evidence. The running user application was preserved. Actual tray right-click, focus/blur dismissal, multi-monitor mixed-DPI placement, fallback while the main window is hidden, and accepted exit terminating both WebViews remain manual acceptance after restarting with the updated build. Local browser captures and diagnostic harness files are under ignored `.tray-smoke.local/`.

## Shared selector browser fixture (#116)

Use [scripts/select116/README.md](../scripts/select116/README.md) for isolated selector acceptance with actual production components and synthetic long-label data. From the repository root:

```powershell
npx.cmd tsc -p scripts/select116/tsconfig.json
npx.cmd vite build --config scripts/select116/vite.config.ts
npx.cmd vite --config scripts/select116/vite.config.ts
```

Open `http://127.0.0.1:1557/scripts/select116/index.html`. Port 1557 is strict and HMR/watching are disabled; restart the server after source edits. Toolbar buttons switch between connection settings, network search, background display, all four drawing protocols, generation statistics, assistant/conversation configuration and selectors inside a native HTML dialog. The statistics page also hosts the actual thinking toolbar in a glass composer to check fixed-popup placement.

The fixture uses in-memory drafts/search configuration, synthetic search results and a separate `Select116Synthetic` avatar database. It does not import the application entrypoint or read real preferences/credentials; runtime fetch and external-link opening are blocked, and its callbacks do not invoke native capabilities or send provider requests. Check light/dark themes, responsive sizes, long labels, search/grouping, keyboard/IME behavior, disabled choices, nested menus and dialog focus. Per-control acceptance and screenshots are tracked in [#116 implementation and coverage](ISSUE-116-IMPLEMENTATION.md); fixture compilation alone is not browser visual or native Tauri interaction acceptance.

## General settings / residency verification (#114)

Implementation, executed evidence and subsequent user acceptance are recorded in [#114](ISSUE-114-IMPLEMENTATION.md); Git delivery, automated checks and detailed desktop interaction evidence remain separate.

The subsequent tray Settings entry uses `ayase-open-settings` to open General in the existing app. Its deterministic regressions cover repeated navigation, draft preservation, protected startup/backup pages and StrictMode listener disposal. The `settings.config.json` fixture checks the production native event path with synthetic data; actual right-click selection remains manual acceptance.

Run `npm.cmd test -- src/general src/drawing/useDrawingWorkspace.test.tsx src/ui/settings/SettingsWorkspace.test.tsx src/App.test.tsx`, the data-contract checker and normal full code gate. The isolated actual-app origin and native SDK probe are documented in [scripts/general114/README.md](../scripts/general114/README.md). Use its dedicated identifier and never real credentials or user data. Check generic cancellation/opt-out, separate risk cancellation, storage rejection, repeated close, unmounted continuations and maintenance protection. Compilation and startup are separate from real hide/restore/process-exit evidence. Tray mouse clicks, titlebar X, OS Alt+F4 and subjective appearance remain user manual acceptance even when SDK probes pass.

## UI closeout evidence (#98 / #108, 2026-10-03)

The [closeout record](ISSUE-98-108-CLOSEOUT.md) supersedes the old prototype-only status for optional glass and the chat-first visual work. It records the final independent switches (sidebar off / composer on), confirmed settings/drawing opaque workbench, existing gates, new production-browser frame/long-task measurements and user acceptance boundaries. The user subsequently reported no material issue in actual use and authorized closing both Issues; their final scope and evidence were synchronized and both were closed as completed on 2026-10-03. This general acceptance does not establish unperformed per-operation native tests or quantitative GPU results. Historical trial measurements below remain historical. The new harness lives only in [chat108](../scripts/chat108/README.md); no production behavior, provider request, migration or native capability changes. The user subsequently authorized committing and pushing this round's docs, samples and harness to dev.

## Settings and drawing workbench material trial (2026-10-03)

The [isolated fixture](../scripts/workbench-material/README.md) compares the real settings/drawing workspaces against the previous illustrated wallpaper. See the [comparison record](WORKBENCH-MATERIAL-COMPARISON.md). Production panels use one opaque theme-derived surface (panel98/text2), 8% text-color edges, 12px corners and a small 1px/2px shadow at 3.5%. Settings lose the redundant page frame; drawing and connection panel gaps are 8px, reference grouping uses a subtle inset fill, and the drawing canvas remains opaque. No persistent settings, provider contracts or native capabilities change. The 7%/15% translucent variants remain fixture-only candidates.

Verification: five scoped UI/stylesheet suites pass 132 tests; production TypeScript/build, fixture TypeScript and diff checks pass. In-app browser checks cover light/dark illustrated backgrounds at 1600×1000, light responsive layout at 1280×900 and 640×820, dark 640×820 with mask45, and both no-image themes. No document horizontal overflow was observed. Actual panels share the opaque fill and .08 edges, the drawing gap measures 8px, no panel backdrop filter is applied, and the image stage keeps its original opaque theme canvas. All six settings sections were inspected with isolated data, including a mock user avatar. Native window/file/provider acceptance was not performed; Rust and full regression gates were not repeated for this CSS-only production change. Local captures and measurements are under ignored `.chat108.local/workbench-material/`.

## Shared titlebar and icon rail (2026-10-03)

The icon rail now uses 48px with 6px horizontal insets after the user's follow-up to the initial 52px trial. Its 36px buttons and 28px logo retain their sizes. It and the 40px titlebar use one background with a 12px inner corner. The scoped browser recheck confirms 48px actual/preview rails, 36px buttons, 6px insets, both chat/settings headers at x=48/y=0 and no horizontal overflow at 680px. Appearance exposes a shared background transparency slider (default 40%; sidebar default 50%; message bubbles default 12%); the unified slider also updates this fourth region. Local/backup missing-field defaults, strict validation and module v3 compatibility are documented in [DATA-CONTRACTS.md](DATA-CONTRACTS.md). Use the isolated [chat108 fixture](../scripts/chat108/README.md) for theme/background/width, actual appearance controls, preview and page switching. It never opens production configuration or calls providers. Native startup and browser checks do not verify OS dragging, minimize/maximize or Snap Layout; those remain manual acceptance.

Earlier four visual rounds compared chrome 85/75/65%, sidebar 0/15/20/25/40% and glass on/off with isolated synthetic backgrounds. That round's selected 75% chrome / 20% sidebar pair was checked in light and dark themes with gradient, dense alternating stripes and no image. Saved explicit values are retained; per-region resets use the new defaults. Comparison captures are local artifacts under the ignored `.chat108.local/opacity-comparison/` directory. This is browser evidence with synthetic data, not acceptance of the user's actual wallpaper or native interactions.

Current illustrated-wallpaper tuning: see [comparison record](APPEARANCE-TRANSPARENCY-COMPARISON.md). Defaults are chrome40/sidebar50/bubbles12, preserving explicit existing values. Browser evidence covers six rounds in light/dark at 1440×900, short and long text, mask65/mask45, no-image themes, per-region reset and reload, matching actual/preview alpha .6/.5/.88, and 640×820 navigation overlays. Non-glass overlays render a .94 opacity floor to reduce underlying chat-text interference; docked sidebars retain .5 and glass toggles retain their existing filter without rewriting saved transparency. The help text explains the overlay behavior.

Verification: `npm.cmd run check` passes data-contract checks, 155 suites / 2713 tests, TypeScript and production build. Initial targeted appearance/backup/UI checks pass 11 suites / 233 tests. After adding the overlay CSS guard and help text, targeted stylesheet/settings checks pass 2 suites / 24 tests and production build passes again. Fixture TypeScript, Git diff check and independent Sol/high default/data review pass. Earlier locked Cargo check remains applicable to unchanged Rust. The isolated native executable starts successfully after final tuning with `npm.cmd run tauri dev -- --no-watch --config scripts/chat108/native.config.json`; OS dragging, minimize/maximize and Snap Layout remain manual acceptance. Generated wallpaper, prompt and comparison screenshots are ignored local assets in `.chat108.local/anime-opacity/`.

## Composer material trial (#98, 2026-10-03)

The final default configuration is sidebar glass off and composer glass on. Fresh settings, omitted legacy fields and reset share these defaults; explicit saved false remains false. The reset help text and backup omission comparison use the same contract. Five targeted suites pass 176 tests; full `npm.cmd run check` passes data-contract checks, 155 files / 2692 tests, TypeScript and build. Locked Cargo check and independent Sol/high review pass. A fresh isolated in-app browser origin confirms initial sidebar filter none / composer blur8px, explicit composer disable surviving reload, and reset restoring false/true. Earlier default-off verification below is historical and superseded by this decision.

The subsequent outline adjustment strengthens only the sidebar's theme-specific white edge and 1px top highlight. Fill, gradient and `blur(8px) saturate(1.1)` remain unchanged. Production build passes; isolated in-app browser checks confirm matching light/dark preview rims, the actual light docked border and the dark overlay border/highlight at 680×780. This CSS-only adjustment did not repeat the earlier full regression or Rust checks; native appearance remains user acceptance.

The subsequent implementation replaces the always-on trial with two independent persisted controls in Appearance. Browser checks on an isolated localhost origin verified default-off controls, enabled preview filters, saved transparency surviving toggles and reload, independent disable restoring the saved alpha, and actual chat navigation/composer filters. Light and dark themes were checked; at 680×780 the settings notices wrap without document overflow, and overlay navigation has an outer shadow while docked navigation has only its inner highlight. Message preview bubbles have no backdrop filter. Full `npm.cmd run check` passes data-contract checks, 155 files / 2690 tests, TypeScript and build (existing bundle-size advisory); `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks pass. Independent Sol/high review reports no remaining actionable P1/P2 finding. Historical backup test fixtures were corrected to omit new glass fields when constructing v1–v3 documents; production version rejection remains intact. Native WebView2 appearance, complex personal wallpapers and quantitative GPU/scrolling performance remain pending; the browser's native-image cleanup warning reflects its unavailable Tauri file boundary, not a glass failure.

The initial blur-only trial passed 27 Composer/AppearanceSettings tests. Following user feedback, the CSS-only second trial uses 8px blur, 1.15 saturation, theme-specific translucent fill, a subtle gradient, inset highlight and shadow; it overrides displayed composer alpha without changing saved preferences. TypeScript and production build pass (existing bundle-size advisory). An isolated in-app browser fixture with real App.css and a synthetic striped background was visually checked in light theme at 760px and dark theme at 320px, including text entry and focus. This is not full-application/menu acceptance or a performance measurement. Native WebView2 appearance and scrolling remain user acceptance; Rust and full regression checks were not repeated for this CSS-only iteration.

## Navigation list performance verification (2026-10-03)

`ConversationNavigation.performance.test.tsx` first reproduced repeated row-icon rendering through the real navigation component (2 initial renders became 12 after visibility operations), then passed with the memoized list. Five navigation/controller/docking/drag suites pass 63 tests, including fresh committed command callbacks, generation/selection updates, busy/dialog guards, hidden deletion reset, focus restoration and conversation reorder. Independent Sol/high review found no confirmed P1/P2 defects. Full `npm.cmd run check` passes 155 files / 2672 tests, data-contract checks, TypeScript and build; `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks pass. Build retains its bundle-size advisory.

The ignored `.nav-perf.local` fixture compares committed navigation `23d6987` with current sources, using real `ConversationNavigation` and `ChatWorkspace`, 80 synthetic messages / 98,431 content characters (paragraphs, tables and code), a 1280×720 in-app browser and 200/1000 conversation metadata rows. No production credentials/data or provider requests are used. The measurement is elapsed time from the existing button's programmatic click to the second requestAnimationFrame, averaged over five repetitions after excluding the first warmup. It includes early render/layout work, not input-device latency or completion of the 200ms animation; timings are local observations, not a native-performance guarantee.

| Conversations | Build | Close before → after | Open before → after |
| --- | --- | --- | --- |
| 200 | Development | 145 → 71 ms | 164 → 68 ms |
| 1000 | Development | 557 → 200 ms | 492 → 187 ms |
| 200 | Production | 76 → 75 ms | 71 → 62 ms |
| 1000 | Production | 240 → 199 ms | 224 → 191 ms |

Final production runs were sequential with no concurrent test/build tasks. For 1000 rows, development React profiler duration fell from 132–175ms to about 2ms; production builds disable this profiler, so zero profiler output is not interpreted as zero rendering cost. Remaining DOM/layout cost is visible in the measurements. Navigation and body-width animations, full mounted list, scrolling and interaction semantics remain unchanged; virtualization and discrete body-width transitions were not introduced.

Browser interaction checks confirmed all 1000 rows and 80 messages remain mounted, a bounded 513px message scroll viewport, no page horizontal overflow, identical list scrollTop after close/reopen, focus return to the selected assistant on close, pending deletion cleared while hidden, and Shift+F10 menu / Escape focus restoration without closing the pane. Native desktop feel and private real-history acceptance remain with the user.

## Confirmation dialog verification (2026-10-03)

Connection settings and App integration tests pass with explicit asynchronous decisions (90 tests); drawing close and SDK permission tests pass (16 tests). Existing chat, avatar, background and drawing confirmation suites pass (141 tests after updating the message-delete test to target the destructive action instead of the first styled button). Independent review reran 105 tests from these overlapping suites with no confirmed P1/P2 findings. TypeScript and diff checks pass. The isolated `close-probe` native startup compiled, reported `guard-settled` with zero tasks/results at `2026-10-02T17:53:14.037Z`, and exited with code 0. This proves idle native startup/close, not real title-bar interaction during active generation or native modal focus behavior; those remain manual acceptance. No production credentials/data or provider requests were used.

## Chat visual prototype verification (#108, 2026-10-02)

The later centering adjustment removes narrow-workspace anchoring and centers within the area remaining after docked navigation; the historical x630 measurements below are superseded. Per user request, these visual iterations are handed over for user acceptance without repeating full builds or regression suites.

Alignment/motion trial: wide mode aligns both bubbles left with user avatars on the left; narrow mode aligns user bubbles/avatars right. Browser measurements confirmed both endpoints, intermediate CSS transition positions and no page overflow during a rapid reversal sequence. At 390px, user surfaces and page had matching scroll/client widths. Reduced-motion emulation reduced surface/avatar transition duration to the global near-zero value; emulation was cleared afterward. Subjective animation feel remains for user review.

Subsequent user correction removes the second iteration's fixed 54rem/44rem bubble caps. Width follows the existing wide/narrow control again. The 864px cap observation below records the superseded iteration, not the current contract.

Second iteration: contained 32px avatar column, aligned content/actions, no user-name header, bounded bubble widths and subdued persistent controls. Targeted MessageList / AppearanceChatPreview / AppearanceSettings tests passed (45 tests) and the production TypeScript/build passed. Browser checks covered 390px long Markdown/code/table content, image-bearing messages and editing without surface/page horizontal overflow after navigation settled; 1920px wide mode capped the long assistant bubble at 864px and kept names/body aligned. Light/dark, synthetic backgrounds and the actual appearance preview were inspected. Native visual feel remains pending; the initial full-suite evidence below is from the first iteration.

[scripts/chat108](../scripts/chat108/README.md) mounts real chat/navigation/appearance-preview components at a separate localhost origin using `Chat108Synthetic`. The fixture never imports production App startup or provider credentials; message actions operate on synthetic data, sending inserts a fixed local reply, and the fixture's CSP restricts connections to same origin. Theme, background, transparency and palette controls allow repeatable visual checks. HMR is disabled; restart the fixture and reload after source edits.

The initial full `npm.cmd run check` passed 151 files / 2609 tests, data-contract checks, TypeScript and production build; `cargo check --locked --manifest-path src-tauri/Cargo.toml` also passed. Browser checks covered light/dark, synthetic complex backgrounds, custom bubbles, contained identity/actions, message editing, navigation expansion/docking/overlay, composer expansion, and 390/720/1280/1920px widths without horizontal page overflow. At 1920px, real narrow message content and the scaled appearance preview both start at x630; the new outer bubble alone supplies alpha. Reduced-motion navigation/backing transitions were checked in browser. Independent review identified preview positioning and user-action state-contrast defects; both were corrected and re-reviewed with no remaining findings. Browser custom dark user bubbles retain white icons during hover, keyboard focus and active state; version switching reaches 2/2. Native window operations, actual WebView2 interaction feel and subjective acceptance remain user checks; no real provider requests or production data were used.

## Supplier verification (#100)

The isolated supplier fixture includes a transparency acceptance mode: it materializes all 11 bundled marks through the actual PNG encoder, checks transparent and opaque pixels, crops a synthetic Alpha PNG and renders the real supplier/assistant/user avatar components. Check both themes, image and crop container backgrounds, and 24px tree versus library sizing. The fixture owns only temporary image URLs and memory state; it does not rewrite existing user snapshots.

Run `npm.cmd run check`, `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks. Supplier, avatar, backup and hook tests use synthetic state. The [supplier fixture](../scripts/providers100/README.md) supports in-app browser light/dark and responsive acceptance without production storage or provider probes. Persistence/interface changes require independent Sol/high review. See [#100 scope, sources and evidence](ISSUE-100-IMPLEMENTATION.md).

## Search providers verification (#82)

Run `npm.cmd run check`, `cargo check --locked --manifest-path src-tauri/Cargo.toml` and `git diff --check`. Search adapter/runtime, chat preflight, UI settings/selectors and backup search82 tests use synthetic credentials without provider calls. [The isolated search fixture](../scripts/search82/README.md) supports in-app browser acceptance and separate native startup; real account/API, billing and native interactions remain separate. Independent Sol/high review is required for protocol and persistence changes. See [implementation evidence](ISSUE-82-IMPLEMENTATION.md).

## Grok/Seedream verification (#103, 2026-10-02)

Run `npm.cmd run check`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks. Adapter tests cover generation/ordered JSON reference edits, explicit profiles, MIME/budgets and uncertain errors. `compatibility103.test.ts` covers durable frozen batches, restart, reuse/export, owner retention and local-save retry. Drawing backup integration covers old/current stamps, missing groups and zero-write refusal. Independent Sol/high review is required.

The [#103 fixture](../scripts/drawing103/README.md) mounts real UI with synthetic inputs and injected adapter responses, without production settings, credentials or databases. Native startup uses a separate application identifier. Browser interactions, startup, native file dialogs/export and live service/relay acceptance remain separate evidence; see [#103 record](ISSUE-103-IMPLEMENTATION.md).

## Adaptive navigation docking (#97, 2026-10-02)

User acceptance (2026-10-02): the user confirmed the desktop reading experience and accepted the current 560/576px rule, then authorized committing/pushing this scope and closing #97. The screenshot feedback confirmed that further narrowing already affects reading, so insufficient-space navigation should overlay. This confirms the user's current experience without extending the synthetic checks to all native interactions or arbitrary content.

Navigation now uses the actual workspace width minus the current CSS navigation target occupancy. It docks when at least 560 CSS px remain; returning from overlay requires 576px. A zero-height, inaccessible width probe shares the pane width variables without inheriting their animation. ResizeObserver watches only the full workspace and probe, so chat resizing cannot feed back into the decision. Window resize is also observed; cleanup disconnects observers and ignores late callbacks. No persistence or native capability changes. The 860px initial visibility and pane sizing rules remain independent.

Focused verification: `npm.cmd test -- src/ui/chat/useNavigationDocking.test.tsx src/ui/chat/ConversationNavigation.test.tsx`. Browser acceptance uses the existing isolated [navigation fixture](../scripts/navigation81/README.md) with synthetic data and no provider requests. Native interaction and subjective comfort at the 560px threshold remain user acceptance. The current user decision supersedes the Issue's pending design discussion; the remote Issue is unchanged.

Verification passed: 22 focused tests, full `npm.cmd run check` (137 files / 2172 tests, data contracts, TypeScript and production build), `cargo check --locked --manifest-path src-tauri/Cargo.toml`, and diff checks. Independent read-only review found stale boundary text in two architecture sections; these and the UI history wording were corrected, with no remaining findings on re-review.

In-app browser on isolated port 1517 verified actual CSS geometry: at a 1000px viewport the workspace is 932px, compact two-pane occupancy is 316px and chat docks at 616px; full two-pane occupancy is 508px and overlays. A genuine browser mouse click in the input restores compact docking. Resizing the workspace to 872px overlays, 880px remains overlay, and 892px returns to docking with 576px chat width. A 600px viewport overlays and respects the existing constrained pane width; a 760px viewport with only the avatar column docks at 624px chat width. A 1200px viewport docks full navigation at 624px. Both themes were exercised without page horizontal overflow. No provider requests or production database access, and no native interaction acceptance is claimed.

## Chat generation statistics verification (#107, 2026-10-02)

See [#107 evidence](ISSUE-107-IMPLEMENTATION.md) and the [isolated browser/native startup fixture](../scripts/usage107/README.md). Focused deterministic tests cover four-protocol stream usage, final provenance, timing, per-conversation generation, continuation/history, strict storage and backup compatibility. The fixture uses synthetic data and an independent database without provider settings or requests. Live short relay responses do not establish positive cache hits or long-conversation behavior; the user will test those separately.

## Assistant navigation verification (#81, 2026-10-02)

See [#81 implementation evidence](ISSUE-81-IMPLEMENTATION.md) for interaction, data compatibility and acceptance boundaries. The [isolated navigation fixture](../scripts/navigation81/README.md) mounts real frontend components with synthetic local data and no provider requests. Targeted checks use `npm.cmd test -- src/ui/chat/ConversationNavigation.test.tsx src/backup/automaticAvatar.test.ts src/avatar/automaticAvatar.test.ts`; the initial implementation full check passed 123 files / 1984 tests, data contracts, TypeScript and production build. Independent review and in-app browser checks passed. Desktop interaction and subjective focus/animation feel remain user acceptance.

The performance follow-up uses `npm.cmd test -- src/ui/chat/useConversationNavigation.test.tsx src/ui/chat/ConversationNavigation.test.tsx src/chat/SafeMarkdown.performance.test.tsx src/chat/SafeMarkdown.test.tsx src/ui/chat/ChatLayout.test.tsx` (57 tests). It checks controller ownership/subscription cleanup, page remounts, no-op snapshot identity, actual Markdown parse counts and changed text/search metadata. Independent review, these tests, data-contract checks, TypeScript/Vite build, Rust check and diff checks passed. The shared-tree full run had 2125/2128 tests pass; rerunning the two failing files passed 29/30, with the remaining committed-edit/read-failure test affected by concurrent session repository changes. Those changes were preserved. Browser measurements use ignored `.navigation81.local/perf` with synthetic data, actual final production sources and render counters only; details and dev/native limitations are in the implementation record.

Navigation user-feedback follow-up: `npm.cmd run check` passed 132 files / 2143 tests, data contracts, TypeScript and production build; Rust check and diff checks also passed. This later shared-tree run supersedes the earlier failing snapshot above. The updated click-range and avatar suites cover actual model modal controls, scrolling/secondary/keyboard events, pre-effect commits on mount/Blob reload/remount, image failures and StrictMode URL cleanup. Independent review found no remaining defect. The isolated navigation fixture on port 1512 verified body/tool clicks, decoded synthetic PNG after assistant/conversation selection, and genuine modal-backdrop mouse-down/up closure preserving navigation. Normal desktop feel and the user's actual images remain manual acceptance. No native host capability or data contract changed.

Avatar image-loading follow-up: `npm.cmd run check` passed 133 files / 2156 tests, data contracts, TypeScript and production build; Rust check and diff checks passed. The content-cache and display suites pass 23 tests, including real SHA keys, concurrent lease/decode deduplication, changed equal-sized bytes/MIME, LRU/pixel memory bounds, failure retry, HMR-style disposal, StrictMode, late cancellation, same-owner replacement and cross-owner isolation. Message-list image tests wait for decoded readiness and clean their mock/cache state. Independent review and browser evidence are recorded in [#81](ISSUE-81-IMPLEMENTATION.md).

Navigation busy-state visual follow-up: `npm.cmd run check` passed 133 files / 2158 tests, data contracts and TypeScript/Vite build; `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks passed. 18 navigation tests include two delayed-operation regressions that preserve disabled guards and generation restrictions while marking transient waits for stable styling. Isolated in-app browser sampling observed 298 transient disabled control records with opacity 1, stable create-button color and generation-restricted deletion at opacity 0.4; see [#81 evidence](ISSUE-81-IMPLEMENTATION.md). Native desktop visual acceptance remains a user check.

Expanded chat busy-state audit: `npm.cmd run check` passed 134 files / 2166 tests, data contracts and TypeScript/Vite build; Rust check and diff checks passed. The presentation signal now distinguishes the first transcript read (including failure/retry) from later workspace waits without changing readiness/send/command guards. Tests cover tool/dialog blocking, sending restrictions, unavailable message actions and version boundaries. Isolated in-app browser checks observe unchanged opacity/color/background in both themes during real conversation switches; ongoing generation retains dimmed clear/message controls. Independent review's initial-load finding was fixed and its final review found no remaining P1/P2; native subjective acceptance remains manual. See [#81 evidence](ISSUE-81-IMPLEMENTATION.md).

Titlebar lifetime follow-up: `npm.cmd run check` passed 136 files / 2168 tests, data contracts and TypeScript/Vite build; Rust check passed. Actual App tests mock the native bridge and prove all titlebar/button DOM identities, maximize state and the single native subscription survive conversation changes. Same-title identity changes dismiss old clear confirmation and returning does not revive it. Independent read-only review found no P1/P2. Isolated browser selection keeps the same header/clear DOM and bounding rectangle. Native startup smoke was attempted with an isolated identifier and synthetic navigation frontend but the running debug executable could not be replaced (Windows access denied); the active process was preserved. Native subjective acceptance remains manual.

## Global scrollbar verification (#104, 2026-10-02)

Delivery acceptance (2026-10-02): the user confirmed that concurrent changes had also been verified and authorized committing/pushing the whole current worktree and accepting the corresponding Issues. This includes the scrollbar follow-ups and supersedes the phase-specific pending-delivery/acceptance wording below. The final combined `npm.cmd run check` passed 136 files / 2168 tests, data contracts, TypeScript and production build; Rust check and diff checks passed. Browser/native coverage remains exactly as documented; this acceptance does not turn synthetic measurements into native performance guarantees.

Latest hover correction: a stationary pointer over chat body must not keep the scrollbar visible. Visibility now requires scroll activity or proximity to the actual scrollbar edge (track plus 6px of adjacent content); delegated pointermove updates this while staying inside the same container. CSS thumb hover colors also remain transparent after fade cleanup. The failing regression reproduced the old whole-container `:hover` at idle, then passed after the correction. The 19 targeted tests include content/edge transitions, idle on the edge, nested owners, horizontal/RTL edges and touch/disposal. Full `npm.cmd run check` now passes data contracts, 132 files / 2140 tests and TypeScript/production build; Rust and scoped diff checks pass. Earlier failures recorded below were resolved in the other concurrent tasks without scrollbar changes to those modules.

Browser acceptance used ignored `ui-review.local/scrollbar104-chat.html`, mounting the actual chat/navigation components from the isolated `Navigation81Synthetic` fixture, with the global helper installed. At idle, `.message-scroll-region` still matched `:hover` while its thumb background was fully transparent and transient fade state cleared. Wheel scrolling while remaining over text revealed it and returned to complete transparency after idle; approaching the right edge revealed it. Dragging changed scrollTop from 344px to about 174px, held active feedback beyond the timeout while moving into the body, and became transparent after release/idle with the pointer stationary there. Both plain and synthetic gradient background/transparent panels passed, with content width fixed at 756px. Screenshot: ignored `ui-review.local/scrollbar104-chat-idle-background.jpg`. No provider or production database was accessed; actual native Windows acceptance remains the user's experience.

The fade follow-up adds 150ms reveal / 200ms hide (ease-out), continuing from the current alpha on reversal, with the existing 700ms idle delay. A registered non-inherited numeric property animates on activity-discovered owners; only their scrollbar pseudo-elements inherit it. Existing component transitions remain untouched. Reduced-motion and forced-colors changes cancel animations; unsupported APIs switch visibility directly. Each transition checks at most 500 descendants and skips animation at that limit, since Chromium still restyles large subtrees during custom-property animation. This is automatic for new content and does not require page configuration.

Fade verification: 13 targeted tests passed, covering prior activity/timer behavior, pointer transitions through descendants, reversal and stale finish callbacks, motion/contrast changes, disposal, large nested subtrees and content growing during activity. TypeScript/production build, Rust check and scoped diff checks passed; independent read-only review found no actionable defects. Full `npm.cmd run check` passed data-contract checks but stopped with two out-of-scope chat test failures: committed-edit recovery in `src/chat/useConversationWorkspace.test.tsx` and subscription spying (`Cannot redefine property: subscribe`) in `src/ui/chat/useConversationNavigation.test.tsx` (129 files / 2113 tests passed, 2 files / 2 tests failed at that run). Their module changes belong to other concurrent work and were preserved.

The isolated browser fixtures use ignored `ui-review.local/vite104.config.ts` on port 1504 (no HMR/watch). `scrollbar104-fade.html?small` uses 100 synthetic rows and samples actual thumb background alpha throughout the 150/200ms animation, confirming intermediate colors and no remaining animation after idle. Genuine pointer hover affects the corresponding container, and a dragged thumb remains visible past 700ms, including moving outside while held; release outside immediately begins fade-out. PageDown without hover reveals then hides, new content inherits styles, reduced-motion switches directly, and forced colors restores standard `auto` styling. Content width stays 346px.

Performance samples compare three-second idle and five reveal/hide cycles using the same test-only frame sampler. In this browser, idle p95 frame gap was 7.0ms; 100-row animated content was 7.0ms and protected 5000-row content 7.1ms, with no ongoing idle animation. Before the protection, 5000-row cycles spent about 1.8s recalculating styles; afterwards about 0.10s, and 100-row cycles about 0.12s. Layout count stayed two in each sample (test report changes), and width stayed fixed. These are bounded synthetic browser results, not a native WebView or hardware-wide guarantee. Firefox/native Windows interactions remain unverified; the user already accepted the baseline and idle hiding, with fade acceptance pending their local experience.

`src/scrollbars.css`, imported by `App.css`, owns all scrollbar visuals. New scroll containers require only ordinary overflow styles. Keep `scrollbar-gutter` decisions local and do not add component-level width/color or pseudo-element overrides; Chromium standard width/color must remain `auto` so the detailed pseudo-element styling applies. Dimensions, fallback and forced-colors rules are recorded in [UI-DESIGN.md](UI-DESIGN.md).

The initial idle-hiding follow-up (before the hover correction above) enabled hiding through `src/ui/scrollbarAutoHide.ts`, installed once in `main.tsx` and disposed on HMR. It revealed on whole-container hover or scroll activity; the latest correction narrows hover to the scrollbar edge. Isolated frontend fixtures must explicitly install the same helper, otherwise CSS intentionally retains the original visible-thumb fallback. `npm.cmd test -- src/ui/scrollbarAutoHide.test.ts` covers non-bubbling/new/nested/document scrolling, independent/reset idle timers and detached/disposed cleanup. The original verification below describes earlier idle-hiding and visible-thumb baselines.

Follow-up verification passed the five targeted tests and full `npm.cmd run check` (124 files / 1989 tests, data contracts, TypeScript and production build), Rust check, scoped diff checks and independent read-only review. In-app browser checks confirmed idle transparency, hover reveal limited to the corresponding region, dynamic content inheriting idle hiding, and genuine PageDown scrolling without hover showing the thumb until the idle timeout. Content width remained 346px in idle, hover, scroll and drag states. Holding the dragged thumb past the idle delay retained active feedback; releasing outside the container hid it. Viewport wheel scrolling with the pointer outside the page likewise showed then hid the root thumb. Light/dark and forced-colors fallback passed; screenshot: ignored `ui-review.local/scrollbar104-autohide-dark.jpg`. No native WebView interaction was automated.

Verification: `npm.cmd run check` passed data-contract checks, 123 test files / 1984 tests and TypeScript/Vite production build; `cargo check --locked --manifest-path src-tauri/Cargo.toml` passed. Scoped diff checks passed. The shared working tree's full diff check additionally reported a blank line at EOF in unrelated `src/avatar/assistantDefaults.ts`; that file was left untouched by #104. The production build retained the existing large-chunk warning.

The baseline in-app browser verification used a separate localhost origin on port 1504 with the existing `scripts/navigation81/vite.config.ts`. The ignored `ui-review.local/scrollbar104.html` fixture imports the real global stylesheet and appearance resolver, with synthetic lists, nested containers, textareas, horizontal/two-axis overflow, body-mounted content and a dynamically appended scroll area. All inherited 12px scrollbar styling without a scrollbar-specific class. Light/dark, reading and custom canvas colors were checked; keyboard vertical scroll, horizontal wheel scroll and thumb dragging worked. Dragging moved the list from 0 to about 506px without changing its 346px content width. A 320×520 fixture had document width 320px. Real chat navigation at the default viewport inherited the same styles; the real browser-only drawing fixture at 720×520 also inherited them, with document width 720px. Forced-colors emulation restored `auto` scrollbar width/color and browser button/radius defaults. Light/dark screenshots are saved in the ignored review folder; fade screenshot: `ui-review.local/scrollbar104-fade-dark.jpg`.

This is frontend styling only: no provider calls, live credentials, production databases, native capability or stored preference changes. Firefox fallback and actual Windows 10/11 WebView scrollbar interactions were not separately exercised; no native automation or Tauri restart was needed for this frontend change. The user accepted the baseline appearance and idle hiding; the fade follow-up remains their hands-on acceptance.

## Chat toolbar layout entry (#95, 2026-10-02)

The header and composer width toggles share the existing `useChatLayout` state/callback and preference. Input height expansion remains local to Composer, using up/down double chevrons. Run `npm.cmd test -- src/ui/chat/ChatLayout.test.tsx src/ui/chat/Composer.test.tsx` for entry synchronization, generation-time switching, remount persistence, independent height state and draft/selection preservation. No new storage fields or native behavior are introduced.

Verification: 12 targeted tests, the full `npm.cmd run check` (1939 tests, data contracts and production build), `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks passed. Independent scoped review found no actionable defects. The in-app browser mounted real ChatWorkspace/Composer with synthetic content and no providers/credentials at a separate localhost origin: 1440×900, 720×520, 360×520 and 320×360; light/dark, compact/expanded states, long model label, synchronized widths/pressed state, mouse and Enter/Space toggling, Escape collapse and preference restoration passed. Controls stayed within the viewport with no page horizontal overflow. Browser acceptance does not establish native WebView interaction; no native launch or live provider request was needed for this frontend change.

## Idle native close permission regression (2026-10-02)

An idle dev window could remain in its closing state with `window.destroy not allowed`. Tauri's installed SDK calls `destroy()` after an `onCloseRequested` handler allows the event, so main needs both `core:window:allow-close` and `core:window:allow-destroy`. Only the latter permission was added; confirmation, settling and unsaved-image guards stay unchanged. Permission edits require restarting `npm.cmd run tauri dev`, not just frontend hot reload.

`src/drawing/windowClosePermissions.test.ts` runs the real SDK listener wrapper against an IPC mock gated by the capability configuration; it failed with the same error before the fix. That test plus the existing close-hook suite pass (8 tests). An isolated native check uses the real `useDrawingWorkspace` with an empty private database, the production capability and a separate `closeprobe` identifier. Start the evidence Vite server documented in `scripts/drawing110/README.md`, then run `npm.cmd run tauri dev -- --config scripts/drawing110/close-probe.config.json --no-watch` (use the isolated target directory if the ordinary executable is in use). It writes `.drawing110.local/close-report.json` before requesting close; successful exit of the native process, not the report alone, is the acceptance signal. This run initialized idle with zero tasks/results and exited with code 0; log: `.drawing110.local/close-native.log`. It exercises a programmatic native close request, not an automated title-bar click. The user's original-window retest remains separate; no credentials or model requests are involved.

The final probe additionally wraps only its own controller's `settleForClose`: it awaits local `guard-entered` and `guard-settled` reports around the real method. Acceptance requires the final `guard-settled` report **and** process exit code 0, proving the application guard ran rather than merely observing an unguarded window exit. Both were confirmed in the final run at 2026-10-02 01:27:01 Asia/Shanghai. The evidence server has watching disabled, so restart it after editing probe code to avoid testing cached transforms.

## Session reference preparation (#110, 2026-10-02)

Selection captures a byte-backed Blob once; full native import and durable task ownership wait for explicit submission. The baseline before/after measurement harness is [scripts/drawing110](../scripts/drawing110/README.md), port 1496, independent identifier `io.github.ayaseminami.ayasestudio.drawing110`; its fetch never contacts providers. `interactive.html` provides actual workspace controls with isolated mock boundaries. Follow [the implementation contract](ISSUE-110-IMPLEMENTATION.md) for legacy draft compatibility, scoped native import receipts, cancellation, maintenance reload protection, measurements and remaining native acceptance. Do not run the normal App against real data for these tests.

## Reference preview loading (2026-10-01)

Managed references use first-visible native thumbnails and retain mounted-card URLs until source change or unmount. New session references preview their captured original-byte Blob directly; explicit preview clicks read managed originals and closing releases dialog URLs. The thumbnail command accepts managed imported-reference paths as well as results, without a durable cache or changes to provider bytes. `DrawingReferences.test.tsx` covers reader separation, thumbnail failure without automatic original fallback, visibility, promotion, close cleanup and late responses. Rust drawing tests cover reference thumbnail dimensions/alpha, unchanged originals, format mismatch and invalid paths. #110 moves full native import to submission and uses binary IPC; its measurements and limitations are recorded separately.

列表拖动即时触发（2026-10-01）：供应商、连接、助手、聊天的名称与把手统一采用 6px 移动门槛，取消 400ms 长按等待。定向回归为 `src/ui/chat/useNavigationListDrag.test.tsx` 与 `src/ui/settings/ConnectionSettings.test.tsx`，检查即时移动、静止长按／轻微抖动点击、拖动释放抑制、取消与原有排序边界；历史长按验收记录不代表当前触发规则。

本轮 70 项拖动定向测试、数据契约检查、TypeScript/Vite 构建、Rust check 通过，独立只读复核无发现。全量 1857 项中 1856 通过，1 项聊天思考设置用例失败；该文件单独复跑 34 项全部通过，保留全量波动记录。隔离内置浏览器以无密钥样例实测四类名称按下后移动即时激活，助手释放不误展开、普通点击仍展开，连接名称拖动成功换序且详情不切换。未调用供应商，未验证原生 WebView／触屏手感。

## Drawing task/log surface simplification (2026-10-01)

The 2026-10-01 decision removes the gallery page and adds a homepage output-directory opener; #111 subsequently unifies generation and task/log content in one workspace. Task tabs stay below the form and keep the preview mounted. Queue/results/reference persistence, backup exclusions and crash-recovery receipts remain unchanged. The opener has no frontend path argument and uses the host-chosen existing `drawing/` tree; its original UUID layout includes `references/` and recovery manifests. Browser checks mock this native boundary and do not verify Windows Explorer. Native checks include fixed-directory creation/preservation/collision/reparse-point tests, cargo check and an isolated Tauri startup smoke. Actual folder-window display remains manual acceptance.

The task log shows known persisted milestones/status/diagnostics; it is not a newly persisted full event stream. Metadata still loads as a complete snapshot. Earlier #94 measurements and screenshots describe the earlier three-view revision and remain historical evidence. For #111 reuse `scripts/drawing110/interactive.html` with its browser-only in-memory synthetic repository, files and transport; start `npx.cmd vite --config scripts/drawing110/vite.config.ts --port 1497`. Verify list/log tabs and keyboard focus, full task details, all task actions, independent pagination, persistent preview, wide/narrow and low-height light/dark layouts. Keep long prompts, expanded advanced options and multiple references reachable, with a bounded task scroll area. This entry does not mount App, read credentials or contact providers. See [#111 local implementation and evidence](ISSUE-111-IMPLEMENTATION.md).

## Drawing integration acceptance #94 (2026-10-01)

`DrawingWorkspace` 的任务／成果库／生成历史卡片每显示页 50 条，三者分别保存页码，删除后收敛到有效页；生成历史随外部选中成果跳到所在页，新完成成果保持可见。controller／repository 仍保留完整记录；全选、所选导出／删除及完成／失败历史清理跨页使用全部适用 ID，不增加参考图、等待队列或总记录上限。生成历史使用 memo 卡片，成果序号以 O(n) 映射预计算。#111 后续任务标签直接取既有 UUID 前 8 位，详情／悬停显示完整 ID，操作与确认始终绑定完整记录；测试覆盖重排、删除、重新挂载和同短前缀的独立操作。所有绘图视图显示仅内存保存失败的任务／图片数和增长／退出风险，提示用户暂停或本地重试；不自动暂停、丢图或限定保留容量。

新增 `src/drawing/integrationAcceptance.test.ts` 和 `chatIntegrationAcceptance.test.ts` 使用隔离 fake IndexedDB 与真实 controller／SessionStore 验证 199 项混合协议队列、并发 1→4→1、冷恢复、同时聊天、请求归属及失败／删除／迟到回调。`DrawingWorkspace.test.tsx` 核对三种 51 项分页、历史跨页选择／外部新成果跳页、跨页全量操作、删除后页码和内存风险提示。执行常规 `npm.cmd run check`、Rust 门禁及 diff 检查；实际性能数字和未完成接受项见 [#94 验收记录](ISSUE-94-ACCEPTANCE.md)，不能用历史切片通过替代本轮结果。

本地合成入口为 [scripts/drawing94](../scripts/drawing94/acceptance.tsx)，不挂载普通 App 或读取正式数据库／设置／凭据；真实 adapter 使用注入 fetch，供应商请求始终模拟。浏览器文件边界模拟；原生使用独立应用 identifier／私有目录。入口分别为 `index.html`（图库／队列及备份）、`probe.html`（原字节参考图）、`memory.html`（持续写盘失败）；报告在忽略目录 `.drawing94.local/`。开发服务运行方式：

```powershell
npm.cmd exec tsc -- --noEmit -p scripts/drawing94/tsconfig.json
npm.cmd exec vite -- --config scripts/drawing94/vite.config.ts
```

内置浏览器打开 `http://127.0.0.1:1495/scripts/drawing94/index.html`。服务关闭 HMR／文件监听，修改源码后必须重启服务。原生可使用 [native.config.json](../scripts/drawing94/native.config.json)／[native-probe.config.json](../scripts/drawing94/native-probe.config.json)，启动前核对隔离 identifier、devUrl 和目录；带 `autorun=1` 自动执行五轮合成压力，已存在的合成成果可能复用，必须按 `seedReport` 记录实际起点。JS 堆和进程 private／WS 都是采样结果，WS 共享页可能重复计数；开发模式／debug 测量不等于 Release 门禁、真实供应商兼容、系统文件窗口或实际关闭重启接受。

## Drawing protocol completion #101 (2026-10-01)

Gemini 选项共享 `geminiOptions.ts` 校验，缺失时保持原默认；controller 冻结独立组，重启恢复写入之前预检全部历史新参数。`imageResponse.ts` 有界规范化服务响应 CR/LF 与严格图片 data-URL，不改变参考图原字节或供应商重试规则。新绘图设置模块 v2／最低读者 2；实际类型字段策略、备份投影和旧设置默认／未来参数边界同步。功能入口沿用现有控件，最终 UI 设计后置。

定向门禁包括 `src/drawing`、`src/backup/drawingIntegration.test.ts`、`src/ui/drawing/DrawingWorkspace.test.tsx` 及 Rust drawing 测试，随后执行常规 check、cargo check、diff；独立 Sol/high 审查与隔离浏览器／Tauri 启动证据见 [#101 记录](ISSUE-101-IMPLEMENTATION.md)。不读取正式数据库／凭据，不调用真实服务；文件窗口、实际重启和 #94 压力单列接受。

## Persistent data development #105 (2026-10-01)

2026-10-02 finishing work adds strict appearance save/export/restore gates and search nested-field checks. Keep appearance display fallbacks separate from durable compatibility: unsupported original preferences must remain unchanged. The deterministic journal regressions now close the database and reopen it before recovery. Reproducible isolated browser/native/manual acceptance lives in [scripts/data105](../scripts/data105/README.md); its native identifier must be checked before opening the default database. Never run the seed/recovery probe with the production identifier. The full gate, independent review, actual staging/applying process recovery and browser restores passed; the user subsequently confirmed the isolated file-dialog/synthetic-backup manual acceptance passed. See [the #105 record](ISSUE-105-IMPLEMENTATION.md) for evidence and limits; full App lifecycle, pressure and power loss remain separate.

Follow [DATA-CONTRACTS.md](DATA-CONTRACTS.md) as part of every persistent-data feature, without waiting for a user reminder. Register tables and preference keys (including exclusions and legacy sources), bind exhaustive field/nested policies to actual persisted types and real export projections, and define module versions, minimum readers, capabilities, migration steps and missing-field defaults. Local and backup reads reuse the pure migration seam; invalid structure must fail before writes and preserve original data. Future optional-parameter filtering is limited to declared session and drawing-setting areas; unknown protocols, credentials, references, preset structure and outer structure remain strict.

`npm.cmd run check:data-contracts` runs deterministic checker regressions and TypeScript AST registration inspection; it is included in `npm.cmd run check`. The current registry covers 13 tables and 8 preference keys. Arbitrarily computed runtime storage keys are outside guaranteed static coverage and need explicit registration/review/tests. Type coverage cannot replace nested policies, semantic/resource validation or independent review. Changes to data format, migrations, cross-module protocols, security or release gates require independent Sol/high review.

Add synthetic regression cases proportional to the change: old/current/skipped/repeated versions, approved defaults, invalid data with zero writes, compatible optional filtering and strict refusal boundaries, retained path reports, re-export warnings, and transaction/journal rollback. Never clear real WebView data or read real credentials to simulate upgrades. #93 exports backup document v5 with envelope v1; historical v1–v4 retain original contracts, including v4's seven-module set. Drawing settings/presets are `projected`, with separate `projectedBackupTables` inventory backed by real field policies; raw local rollback snapshots are private. #105 drawing integration and deterministic cross-version examples are supplied; remaining actual native acceptance and #94 pressure work are separate. [The #105 implementation record](ISSUE-105-IMPLEMENTATION.md) and [#93 implementation record](ISSUE-93-IMPLEMENTATION.md) track verification; older entries below retain historical test counts, format versions and pre-#93 gates.

## Drawing settings and explicit preset backup #93 (2026-10-01)

Local implementation adds optional, independently declared `drawing.settings` and `drawing.presets` with matching module stamps; new exports include both and add no Dexie schema version. Local draft/settings/preset reads share clone-based defaults and strict validation before task recovery. OpenAI size remains editable text without a new per-field length limit; transport validates generation dimensions. Preset bodies retain whitespace and duplicate names remain independent by ID. Merge/copy preserve local settings; replacement applies only present categories, patches current settings while keeping prompt/references, and missing old modules never clear drawing. Tasks, results, images and native pending-save receipts stay local. Restore planning maps drawing targets, reports retained history frozen provider/connection ID, protocol/address/upstream-model changes, and never adds drawing file writes.

Before normal App reload, synchronous chat/drawing command gates drain queued writes, all loaded chat stores, drawing drafts/presets and reference/export/delete/save operations. Active requests and automatic naming must finish or be explicitly cancelled at their existing entry; maintenance never auto-aborts. Memory-only unsaved images refuse reload. Queued jobs survive; failed preparation releases gates and restores prior pause state. Native backup startup includes the drawing file mutex before recovery, business roots and GC. Cold maintenance preserves stale historical running markers for later ordinary drawing initialization. Backup journal rollback precedes drawing's own receipt recovery; old journals without drawing snapshots leave that scope alone.

Focused synthetic verification should cover `drawing/settingsData.test.ts`, `drawing/repository.test.ts`, `drawing/controller.maintenance.test.ts`, `backup/drawingPresets.test.ts`, `backup/drawingIntegration.test.ts`, snapshot/compatibility/restore/runtime tests and App maintenance entry. Use isolated databases and mocked files/requests to exercise all strategies, old/missing categories, repeated imports, write failures and restart rollback with zero provider dispatch and zero drawing file read/write/delete. Record large text-preset/parameter processing time and available memory metrics under the existing 8 MiB text, 80 MiB document and 128 MiB file budgets; refuse over-budget input explicitly. Full-gallery pressure belongs to #94.

Local verification is complete for `npm.cmd run check` (Node/checker tests, frontend tests, TypeScript and Vite), Rust tests, `cargo check --locked --manifest-path src-tauri/Cargo.toml`, scoped regressions after follow-up changes and Git diff checks. Independent Sol/high review cleared material findings, including frozen provider/connection identity checks. The isolated in-app browser used actual Dexie restore to verify retained prompt, future-parameter warnings and re-export; isolated Tauri compilation/startup verified the process. Exact run scopes and evidence are in [the #93 implementation record](ISSUE-93-IMPLEMENTATION.md). Isolated browser visual acceptance is complete at 1280×900 in light theme and 720×900 in dark/custom theme, with screenshots reviewed and no horizontal overflow; native file dialogs and actual close/restart are separate #94 manual acceptance, and real providers remain unauthorized. Local implementation is not commit/push, Issue closure or native interaction acceptance.

## Drawing prompt presets #90

Run `npm.cmd run check`, `cargo check --locked --manifest-path src-tauri/Cargo.toml` and Git diff checks. Preset CRUD, reopen persistence, v7-to-v8 preservation and five-field allowlisting are covered by `drawing/presets.test.ts`; controller integration covers direct text-only application, frozen queued inputs, close waiting, write failures, history/cross-protocol isolation, invalid models, missing references and zero provider dispatch. `ui/drawing/DrawingPresets.test.tsx` covers editor cancellation, focus, explicit update/save-as/delete, failures and duplicate submission; workspace tests cover task actions. The historical #90 preset-only backup ban is superseded by #93: `backup/drawingPresets.test.ts` now covers projection with a preset-only database. Browser acceptance must use an isolated origin/database and synthetic files/transport, with provider counters staying zero. See [#90 evidence and acceptance boundaries](ISSUE-90-IMPLEMENTATION.md).

## Drawing gallery #89

Run `npm.cmd run check`, `cargo test --locked --manifest-path src-tauri/Cargo.toml drawing::`, `cargo check --locked --manifest-path src-tauri/Cargo.toml` and diff checks. Ownership/reuse/export cases live in controller/repository/exportParameters tests; visibility/interaction in DrawingResults/workspace/hook/App tests. Native tests cover PNG/alpha, thumbnails, independent reads and completed cleanup. Latest gate: 1430 frontend and 29 drawing Rust tests pass. Browser acceptance is synthetic. Native startup initially met an occupied executable; after the user authorized ending that dev instance, the isolated retry compiled and created the Ayase window successfully (test entry HTTP 200). No Computer Use was required; dialogs/restart/live services remain pending. See [#89 evidence](ISSUE-89-IMPLEMENTATION.md).

## Drawing lifecycle #88

Run `npm.cmd run check`, `cargo test --locked --manifest-path src-tauri/Cargo.toml drawing::`, `cargo check --locked --manifest-path src-tauri/Cargo.toml`, and diff checks. `queue.test.ts` includes history deletion/regeneration/cancellation races, exact recovery inventory, indexed local-save retry, continuous disk failure and explicit memory release; `repository.test.ts` rejects deleted-row revival and preserves results. Native tests cover receipt inventory, indexed repair and scoped cleanup. Browser/native/pressure boundaries are recorded in [#88 implementation](ISSUE-88-IMPLEMENTATION.md). This supersedes the pending full #88 management note below.

## Batch drawing queue #87

Queue regressions: `src/drawing/queue.test.ts`, `controller.test.ts`, `repository.test.ts`, `useDrawingWorkspace.test.tsx`, drawing UI and App/chat concurrency tests. Run the default frontend/check gate plus `cargo test --locked --manifest-path src-tauri/Cargo.toml drawing::`. Tests never call providers. See [implementation and native startup limitation](ISSUE-87-IMPLEMENTATION.md). Full #88 history management remains separate.

## Multiple reference images #86 (2026-10-01)

本地完成多参考图输入、编号／排序／查看／移除、成果追加、持久草稿及冻结请求输入。PNG/JPG/JPEG/WebP/BMP 原字节私有保存和发送，无新增输入数量、容量或像素预算，无预处理；Gemini 使用 inlineData，OpenAI 有参考图时使用 multipart edits。完整归属和范围见 [#86 实施记录](ISSUE-86-IMPLEMENTATION.md)。

`npm.cmd run check` 通过 95 文件／1350 项测试、TypeScript 与生产构建；Rust 绘图测试 19 项及 `cargo check --locked` 通过。独立审查无可操作发现。内置浏览器在隔离合成数据下通过选择／拖入／粘贴、去重／排序／预览、成果追加、运行草稿隔离、重载及失败／取消，覆盖浅深主题与桌面／窄窗口。原生隔离实例启动烟雾检查通过并停止；真实服务、原生文件选择器及实际关闭重启仍待用户验收。未读取真实凭据或请求供应商；实施检查阶段尚未执行 Git／远端交付，后续用户已授权提交、推送和 #86 验收通过，交付结果见 Issue 评论。

## OpenAI Images #85 (2026-10-01)

本地接入 `openai-images` 与当前官方 GPT／Gemini 尺寸选项；[实施记录](ISSUE-85-IMPLEMENTATION.md) 列明协议边界、模型限制和验证。定向测试：`npm.cmd test -- src/drawing src/ui/drawing src/chat/settings.test.ts src/chat/urlResolution.test.ts src/ui/settings/ConnectionSettings.test.tsx`，再运行默认代码检查。使用合成 Base64、HTTP 故障和原生文件 mock；不得为验证错误而发真实请求。浏览器隔离验收入口 `.drawing85.local/` 不读取真实数据或供应商凭据。原生网络与系统对话框必须与离线／浏览器／启动检查区分。

## List sorting #99 (2026-10-01)

续作补齐助手／聊天列表拖动和菜单上下移：`src/Workspace.test.tsx` 与 `src/ui/chat/useNavigationListDrag.test.tsx` 覆盖真实 repository 换序／重挂载、选中模型／草稿保持、手势取消／跨列表／首尾及误点击隔离；`src/chat/workspace.test.ts` 覆盖旧最近更新时间排序、原位不冻结、手动顺序、消息活动／重载／新建、同助手边界、助手排序和迁移。备份 snapshot／restore 测试覆盖可选排序字段及旧记录兼容。供应商／连接的原有定向用例继续执行。最终检查和浏览器验收详见 [#99 实施记录](ISSUE-99-IMPLEMENTATION.md)。

最终全量 99 文件／1454 项测试、TypeScript、生产构建与 `cargo check --locked` 通过；独立审查无遗留发现。内置浏览器完成隔离真实指针／键盘换序、重载、取消、跨列表、窄屏滚动和浅深主题检查。桌面实际关闭重启仍待手动验收。以下历史切片失败记录不代表当前检查状态。

以下为昨晚供应商／连接切片的历史验收，助手／聊天待讨论及当时构建阻碍由续作最终结果取代：

历史 #99 连接树切片（触发方式已由上方即时拖动说明取代）：连接配置页为 1:2 双栏，以及供应商／连接的左侧把手和名称长按拖动；连接限定在所属供应商内排序。助手／聊天列表拖动仍待讨论，远端 Issue 未修改。

最终定向检查 `npm.cmd test -- src/ui/settings/ConnectionSettings.test.tsx src/ui/settings/SettingsWorkspace.test.tsx src/App.test.tsx` 68 项通过；`npm.cmd test -- src/chat/settings.test.ts src/chat/useChatSession.concurrency.test.tsx -t moves` 4 项通过。覆盖手势激活与取消、误点击隔离、组内边界、原位、边缘滚动、菜单首尾、顺序保存与活动连接／模型保持，以及后台聊天和绘图忙碌保护。独立 Sol/high 只读审查发现的失焦缺少释放事件及候选长按取消后点击问题均已修复并复核，无本切片遗留发现。`cargo check --locked --manifest-path src-tauri/Cargo.toml` 与 `git diff --check` 通过。

内置浏览器在隔离来源 `127.0.0.1:1486` 使用已有合成配置及无密钥供应商模板，以真实指针输入验证供应商／连接把手拖动、名称长按拖动、插入线、当前详情不切换、连接跨组拒绝、菜单换序及刷新持久化。1280px 与 600px 视口检查把手位置和横向溢出。未读取真实密钥、请求供应商或使用原生 UI 自动化；桌面主观效果仍由用户验收。

本切片早期 TypeScript／Vite 构建通过。最后一次全量检查时，工作区并行绘图扩展导致 `openaiImages.test.ts` 引用当时尚未存在的模块，及 `settings.test.ts` 绘图模型选项旧断言未包含新增 `protocol`；1232 项通过、1 项断言失败、1 个测试文件加载失败。独立构建随后在并行绘图模型类型与新增 `openai-images` 协议的既有聊天预览调用处失败。此轮不将全量测试或最终构建记为通过，也不修改并行绘图实现来完成排序任务。

## Background blur #96 (2026-10-01)

用户报告外观预览调高模糊后背景整体放大。确定性回归先失败：32px 时仍输出额外缩放 `1.32`；修复后取消模糊与缩放绑定，改为共享图片内部模糊及外缘像素延展。初步浏览器验证发现直接删除 scale 会造成亮边，且仅设置 SVG `edgeMode` 未消除该亮边；显式延展八个边缘／角落采样区后亮边消失，原图尺寸与取景不变。

最终 `npm.cmd run check` 通过 94 文件／1215 项测试、TypeScript 和 Vite 构建；`cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过。保留既有大 chunk 提示。新增回归覆盖预览 0／16／32px、填充／适应、非中心取景与用户缩放、布局宽度变化后的模糊半径换算和 observer 清理。

内置浏览器通过隔离合成图片页面 `.blur96.local/index.html` 检查真实预览组件及共享背景渲染路径：1280×900／720×520、浅深主题、cover／contain、0／16／32px 共 24 组，取景 viewBox 与背景边界不随模糊改变，背景无额外 transform，容器保持裁切。截图检查强模糊无原先泛白边缘、contain 留白和前景文字清晰；证据保留在忽略目录 `.blur96.local/`。未读取用户背景或凭据，未调用供应商。独立只读审查未发现遗留可操作缺陷。未进行原生 WebView2 视觉验收、极大图片压力测试或安装包验证；本次没有原生权限、窗口或主题首屏改动。面板局部毛玻璃已独立建立 [#98](https://github.com/AyaseMinami/AyaseStudio/issues/98)，#96 保持打开等待交付验收。

## Gemini single-image implementation #84 (2026-10-01)

用户认可 #83 常驻大图布局，并明确授权直接完成 #84。正式应用新增绘图入口与 Gemini 单张生成、任务状态／取消、自动私有保存、重启恢复、大图与历史切换、普通 PNG 导出及本地参数复用；完整实现范围见 [实施记录](ISSUE-84-IMPLEMENTATION.md)。参考图、批量调度及完整图库／备份属于后续任务。共享设置区分聊天／绘图；新增数据库 version 7，仅增加绘图表。绘图配置／数据存在时，旧备份的入口和底层 snapshot/restore 均明确阻断，直到 #93 扩展格式。

最终 `npm.cmd run check` 通过 94 文件／1210 项测试、TypeScript 与 Vite 构建；`cargo test --locked --manifest-path src-tauri/Cargo.toml` 115 通过、1 ignored（其中 drawing 15 项）；`cargo check --locked` 与 `git diff --check` 通过。修正了旧 Cherry 迁移测试的最终数据库版本期待，以及 Vite 中已失效的 `@ts-expect-error`；保留既有构建大 chunk 提示。独立 Sol/high 审查发现并修复：保存失败退出静默丢图、原图先于成果清单的恢复缺口、生成页未显示本次失败，以及退出整理期间可再提交的竞态；最终复核无剩余可操作发现。

内置浏览器用隔离 `localhost:1486` 验证实际 App 导航／共享设置／手动绘图模型配置、聊天选择器排除绘图模型、草稿及模型重载恢复、旧备份禁用提示。未填真实 Key、未点击模型目录或发起真实请求。独立合成接口／文件边界验证实际绘图组件及 controller：连续成功自动预览、历史切换同一窗口、失败保留旧图、保存失败后只重试本地写入（合成请求计数不增加），覆盖浅深主题、1040×760／720×520／600×740，页面无横向溢出。合成大图截图位于忽略目录 `.drawing-check.local/drawing84-desktop.png`；开发过程有验收入口 HMR 重新建 root 及 Vite 配置重启记录，重载后继续验证，不将这些临时 harness 提示视为正式应用错误。

`npm.cmd run tauri dev -- --config .drawing-check.local/native-smoke.json --no-watch` 使用独立 application identifier 与本地前端完成最终编译、原生进程／窗口启动烟雾检查；随后仅停止此次隔离实例。未使用原生截图／桌面自动化。真实 Gemini／中转、真实 Tauri HTTP 请求、系统导出对话框、原生退出确认／窗口交互和实际关闭后重启仍待用户手动验收；确定性故障／模拟窗口事件和成功启动不能代替这些验收。原有安装包归档及同时出现的 Cherry 导入修改保持，未并作本需求修改；无 commit、push、远端 Issue 变更或 Release。

## Drawing design review #83 (historical, 2026-09-30)

后续用户按旧 GNBP UI 参考明确要求生成页常驻大图预览。草图已改为最新成功图自动显示、历史缩略图切换同一窗口、失败／取消保留上一张图，并提供当前预览图的直接复用／参考／导出入口；规格与 UI 约定已同步。脚本语法及离线 DOM 模拟通过空态、连续完成自动更新、历史切换不弹窗、后续成功回到最新图、失败保留及当前图参考／导出。当前 `file://` 页面被浏览器 URL 安全策略阻止自动化访问，未绕过；本次大图版本的浏览器视觉／响应式验收未完成，由用户刷新草图评审。下段浏览器记录和 `drawing83-sketch.jpg` 属于此前网格版本，不代表此次修改已取得视觉验收。

当时交付 [独立绘图历史设计规格](archive/ISSUE-83-DRAWING-DESIGN-HISTORY.md) 与 [离线交互草图](archive/design/drawing-workspace-83.html)，尚未修改生产模块、协议实现、数据库或原生宿主。用户已确认独立模块、共享设置、并发 1–4、自动保存及默认无参数导出、重启后手动继续未发送队列；具体候选细则和性能目标待整体评审。已有 #91 后置，远端未更新。

文档相对链接、脚本语法、diff 检查通过；内置浏览器验证浅深／1040×760／720×520／600×740、队列／动态并发／模拟退出恢复／图库／参考引用／复用／导出说明及提交防重，无页面横向溢出及捕获到的 warn/error。独立 Sol/high 审查的草图重复入队与成果输入归属问题已修复并复核。具体范围及验证边界见规格末节，合成截图保存在忽略目录 `ui-review.local/drawing83-sketch.jpg`。草图的 500ms 忙碌模拟不是正式持久化防重方案；实际生图、文件操作、性能及原生重启没有在本次测试。文档任务不需要应用／Rust 构建；原有安装包归档修改保留。

## Custom context-menu verification #74 (2026-09-30)

本次按用户修订范围完成四类列表的本地右键菜单与默认菜单屏蔽，范围见 [UI 约定](UI-DESIGN.md) 和 [计划](PLAN.md)。消息保留原按钮；输入框、编辑框及可编辑内容保留默认编辑菜单，Gemini 搜索建议 iframe 使用同一策略。共用 `ActionMenu` 及按目标 ID 派生的操作定义；不增加数据库、宿主权限或供应商请求。

最终 `npm.cmd run check` 通过 87 文件／1151 项测试、TypeScript 与 Vite 构建；`cargo check --locked --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过。仅保留既有大 chunk 构建提示。确定性回归覆盖不同菜单所有者互斥、实际未选中对象、默认助手保护、运行中删除保护、对话行内确认与焦点交接、当前状态禁用更新、删除／隐藏／切换后关闭、供应商模板菜单互斥、键盘与重命名 Tab 草稿保存、输入例外以及 iframe 监听绑定／清理。独立 Sol/high 审查发现并修复重命名 Tab 提前关闭问题，最终复核无剩余发现；iframe 补充也经过独立复核。

浏览器以 `127.0.0.1:1494`、独立合成数据库 `Ayase-Context74-Synthetic-v2` 和禁止模型／目录／搜索请求的模拟边界验证实际组件。覆盖助手、对话、供应商、树与概览中的连接菜单；右键不切换当前对象、删除转到行内确认且取消不删除、连接编辑、重命名取消与键盘完成、浅深／自定义主题、1440×900／1040×760／600×740、四角定位和无页面横向溢出。检查到主页面正文与 iframe 正文的 contextmenu 已取消，而主页面和 iframe 文本框事件未取消；输入 Ctrl+A 保留选区。实施截图保存在忽略目录 `ui-review.local/context74-menu.png`。

`npm.cmd run tauri dev -- --config ui-review.local/context74-tauri.json --no-watch` 使用独立 identifier 与上述模拟页面完成编译及进程／窗口启动烟雾检查，随后仅停止本次验收实例；已有安装版进程保留。未使用原生截图或桌面 UI 自动化，浏览器检查和成功启动不代表原生编辑菜单的交互验收。用户随后反馈“效果不错，我测试了”，确认本需求通过并授权提交、推送和关闭 #74；交付状态以 Git 与 Issue 的实际记录为准。未读取真实凭据、调用供应商或打包发布；已有安装包归档相关修改保留在工作区，不并入本需求提交。

## Exa API / MCP external search #80 (2026-09-30)

后续用户修订为独立 Exa API（必填 Key）与 Exa MCP（Key 选填）。新增直接 API 适配器、两套配置迁移与四模式选择，备份 document v3 仍读取 v1/v2；接口见 [PROTOCOLS.md](PROTOCOLS.md)，当前行为见 [实现记录](ISSUE-80-IMPLEMENTATION.md)。以下 1049 项记录为首次 MCP-only 实现快照。

本次最终 `npm.cmd run check` 通过 86 文件 / 1129 项测试、TypeScript 与 Vite 构建，Cargo check locked 通过。独立 Sol/high 审查发现的完整 v3 备份修复损坏配置问题已修复，回滚回归及独立复核通过。浏览器以模拟网络验证两卡保存隔离、API 缺 Key 阻断、MCP 空 Key、测试取消、重新加载、四模式及 API 搜索引用，覆盖浅深主题与宽窄视口；新增截图 `ui-review.local/search80-split-modes.png`。隔离 Tauri 程序再次编译启动；真实 API/MCP、模型、实际 Tauri HTTP 和原生交互未验证。Rust 未修改，下面 Cargo test 数字为首次实现记录。

本地实现与验收范围见 [ISSUE-80-IMPLEMENTATION.md](ISSUE-80-IMPLEMENTATION.md)。网络搜索设置与聊天使用同一有限适配器；测试页面打开、保存、恢复备份和加载历史都不自动联网。确定性测试使用注入 fetch，覆盖 MCP 初始化、固定工具/schema、JSON/SSE、凭据隔离、错误、边界和取消；聊天测试覆盖四协议、最终预算、命名阻断、候选和并行会话、Anthropic continuation。真实服务探测仍需用户明确授权，不读取 `.env.probe.local`。

最终 `npm.cmd run check` 通过 85 文件 / 1049 项测试、TypeScript 与 Vite 构建；`cargo test --locked --manifest-path src-tauri/Cargo.toml` 95 通过、1 ignored，Cargo check 通过。Rust 代码未修改。独立 Sol/high 只读审查的两处 Markdown 引用定位问题已修复并回归，最终无遗留发现。构建保留既有大 chunk 提示；本次未测量安装包/常驻内存增量。

内置浏览器以隔离数据库、合成 Key、模拟搜索/模型接口检查实际设置与聊天组件：1440×900、600×740 浅深主题，显式保存/测试/停止、模式菜单键盘与焦点、来源摘录和引用、失败阻断、取消及持久化状态。页面无横向溢出。`tauri dev -- --no-watch` 使用隔离 identifier 与模拟页面编译启动；验收用 Vite 配置忽略 Rust target，避免原生编译的 DLL 文件锁中断监听。真实 Exa、匿名/Key、代理、Tauri HTTP 与原生窗口交互仍待授权或人工验收。未提交、推送、修改远端 Issue 或发布。

## Ayase backup verification #79

数据管理入口页样式整理：统一单一页面标题、两个同宽同圆角无阴影卡片，标题和按钮都在卡片内左对齐，移除两个独立页面容器叠加的大间距；修正 Ayase 说明为完整连接／密钥备份可选择加密。设置、Cherry 导入与工作区相关 46 项测试、TypeScript/Vite 构建和 diff 检查通过；隔离浏览器确认浅色宽屏两卡片左边缘／宽度／按钮左边缘一致，标题 16px、正文 14px，间距 16px；600px 深色页无页面横向溢出，按钮在模拟边界响应。原生与导入行为未修改。

最新范围修订：依据用户明确指示，以当前实现行为完成 #79，并更新了远端 Issue 描述。导出固定包含连接及 API Key，仅有一个默认关闭的加密开关；明文可直接导出，加密密码二次确认只检查一致性，任何长度和字符均接受。备份准备时冻结应用交互并等待工作区队列与全部已加载会话写入完成，之后才重新加载用于导出。前次验证记录的测试数是当时快照，最终验证数据见本次提交记录。浏览器合成数据验证不读取真实凭据；原生文件窗口、真实用户备份恢复及重启／断电场景仍需人工验收。以下记录保留此前设计及验收背景，以本段和备份指南为当前行为。

2026-09-30（历史记录）：已完整读取 Issue 正文及交接信息，在原有 `dev` 工作区分阶段完成本地实现，保留原 `PLAN.md` 修改和 `ISSUE-79-BACKUP-RESEARCH.md`。范围、格式、冲突政策与操作方法见 [AYASE-BACKUP.md](AYASE-BACKUP.md)。既有 Cherry 导入仍单独保留；当时尚未提交、推送或修改远端 Issue。

后续按用户新要求，将“加密备份”改为独立且默认关闭的开关；加密不再取决于是否包含 API Key。明文含密钥可无密码直接导出、校验和恢复，仅显示提示；开启时任何备份都需密码，关闭时清空密码，取消连接仍取消密钥但不改变加密状态。格式版本仍为 1，旧备份保持可读。Issue 的旧强制加密要求现已在远端描述中按当前代码行为修订。此前阶段验证了含密钥明文导出不出现密码、直接预览并另存副本（对话 1→2），无连接／无密钥时仍可加密，关闭后可直接导出；完整四种密钥／加密组合也通过 runtime 保存载荷与恢复回归。未读取真实密钥或调用供应商。

阶段验收：

- 数据清单与格式：显式允许字段、八张持久表、受支持偏好和原始资源；不含运行时草稿、源绝对路径和派生背景缩略图。默认包含连接、不含 API Key，含密钥强制整包认证加密。覆盖密码错误、篡改、未知版本、字段排除、资源摘要、大小与图像像素预算、候选消息及已删除提问的历史回复。
- 恢复一致性：覆盖合并保留现有密钥、另存副本重映射、替换明确确认、缺失模型、文件碰撞、文件／数据库／偏好阶段失败、重复回滚及启动恢复。日志读取也失败时保留回滚错误并锁住所有后续操作。数据库版本升至 6，新增恢复日志；旧表不被升级清空。
- 独立只读审查：修复图像解码前尺寸预算、Base64 大输入正则溢出、转义容器上限不一致、历史孤儿回复、空工作区入口、头像上限和回滚失败锁定。没有扩大到供应商协议或真实凭据探测。
- 浏览器：内置浏览器在 `localhost:1486` 的忽略目录 `backup-acceptance.local/` 使用独立 `Ayase-Backup-Synthetic-Acceptance` 数据库、合成密钥及模拟文件窗口，实际调用格式、计划及恢复仓库。验证导出选项联动、密码确认、加密导出与摘要、错误密码零写入、解密前无内容预览、替换范围和密钥单独确认。另存副本后对话由 1 增至 2；随后损坏文件拒绝且写入次数仍为 1。浅色 1440×900、深色 420×740 均无横向溢出，预览和策略可纵向滚动；主观最终视觉尚待用户确认。
- 原生：Rust 合成测试覆盖受管引用、大小、格式、路径穿越、目录链接／Windows junction、写入不覆盖、预留检查及删除；原有真实样本测试保持 ignored。Windows 文件 symlink 权限不具备时该分支没有实际创建链接，不能宣称已验证。`tauri dev -- --no-watch` 完成编译并启动；开发时入口热更新曾产生重复 createRoot 警告，已将根组件移入 `BackupApp.tsx` 并重新启动验证。

最终检查：`npm.cmd run check`（77 文件 / 882 项测试、TypeScript 与 Vite 生产构建）、`cargo test --locked --manifest-path src-tauri/Cargo.toml`（95 通过、1 ignored）、`cargo check --locked --manifest-path src-tauri/Cargo.toml` 和 `git diff --check`。完整运行曾暴露原有并发测试在 React 快照未就绪时编辑的时序问题；测试改为等待 `workspace.canSend()` 后执行用户操作，未改变生产编辑逻辑。构建保留既有大 chunk 提示。浏览器测试不读取用户内容、真实凭据，不发供应商请求。

待人工验收：在原生设置 → 数据管理检查保存／选择窗口及取消；分别导出不含连接、含连接无密钥、含密钥三种备份，逐类核对助手、对话、候选消息、附件、头像、背景及偏好；在可丢弃数据上检查三种策略，特别是替换范围及密钥确认；检查真实桌面中断／重启后的日志恢复。真实用户数据、原生文件窗口、实际断电和窗口交互未由本轮浏览器或编译验收替代。

## Cherry import verification (#77)

2026-09-30 空对话归属回归：两个获授权本地 1.9.13 格式 6 样例均在预览阶段复现 `cherry-conflicting-owner`；原因是空对话唯一属于某个助手列表，但元数据仍引用另一个现存助手。最小合成测试修复前失败；新增唯一归属恢复、重复归属拒绝、非空归属冲突拒绝、消息归属冲突拒绝及 Chromium ZIP 全流程回归。修复后两份原样例各解析出 7 个话题 / 37 条消息，通过临时本地桥接调用真实 TypeScript 映射及仓储，在 fake-indexeddb 隔离数据库中各导入 8 条分支对话 / 38 条消息，原始消息 ID 全部保留，再次导入跳过全部 8 条。分支展开会复制共有消息。未写入用户当前应用数据库，也未进行原生文件选择与安装版交互验收；私有投影文件及临时桥接测试已清理。

本轮验证：导入相关前端 76 项、Rust 100 项测试通过（另 1 项私有样例测试默认忽略，已对两份授权样例单独执行）；Rust check 与 diff 检查通过，独立审查无可操作发现。`tauri dev` 使用独立应用标识和端口 1491 编译并启动原生进程，随后停止；只证明启动，不代表导入弹窗或原生交互通过。全量前端检查当时为 1153 通过 / 1 失败，失败属于工作区已有的绘图导航测试；单独生产构建被绘图组件新增必填属性尚未接入的 TypeScript 错误阻挡。未修改这些无关工作，也未打包或发布。

The importer accepts only the pinned backup structures documented in [CHERRY-IMPORT.md](CHERRY-IMPORT.md). Local implementation, deterministic fixtures and acceptance boundaries are recorded in [ISSUE-77-IMPLEMENTATION.md](ISSUE-77-IMPLEMENTATION.md). Run `npm.cmd run check`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, and `cargo check --locked --manifest-path src-tauri/Cargo.toml` before handoff. Native tests construct synthetic ZIP, Chromium and SQLite snapshots; the ignored private-sample comparison runs only with explicitly supplied local inputs, prints aggregate results, and never writes active application data. Do not add real backup content, credentials or source IDs to fixtures or documentation.

## Built-in color presets #66 (2026-09-29)

阅读入口恢复：顶部恢复四个并列按钮，阅读快捷应用浅色纸页；退出阅读回到默认方案，其他配色保留独立明暗切换。新增进入/退出阅读回归，`npm.cmd run check` 通过 66 文件 / 683 测试及 TypeScript/Vite 构建，Cargo check 通过。内置浏览器隔离来源 `127.0.0.1:1486` 确认四项同排，键盘进入阅读同步选中纸页，退出至深色同步恢复晴蓝；截图 `ui-review.local/reading-restored.png`。未调用真实模型或原生文件接口，未重复原生启动；构建保留既有大 chunk 提示。

后续圆形色卡微调：七项改为单排圆形多色色卡，移除常驻中文名，保留名称悬停提示、无障碍名称和选中角标。外观组件 10 项定向测试与 diff 检查通过。本轮内置浏览器连接报 `nodeRepl.fetch request failed`，未取得修改后的视觉验收；以下全量检查和浏览器记录属于微调之前的实现。

最终 `npm.cmd run check` 通过 66 文件 / 679 项测试及 TypeScript/Vite 构建，Cargo check 和 diff 检查通过，独立只读审查无遗留可操作发现。构建保留既有大 chunk 提示。截图：`ui-review.local/presets66-light.png`（忽略的本地隔离验收证据）。

新增七套浅深主题配色、主题卡片内缩略选择器和只恢复颜色的入口。确定性用例覆盖每套方案保存/重建、跟随系统变化、微调保留与恢复、旧 ID/非法 ID、背景及透明度隔离、浅深文字/按钮/焦点及不同透明度用户气泡对比度，以及 UI 回调范围与缩略色值。

内置浏览器使用独立 `127.0.0.1:1486` 来源和空连接配置，无真实凭据或供应商请求，验证宽屏 1600×900、窄屏 720×520、方向键从青竹切到海盐、深色配色和刷新后琥珀/深色恢复，页面与方案网格无横向溢出。纯浏览器缺少 Tauri 文件接口，现有背景清理提示不作为原生文件验收。隔离 identifier 执行 `npm.cmd run tauri dev -- --no-watch --config ui-review.local/presets66-tauri.json`，编译并启动成功，有 libpng iCCP profile 警告。启动不等于真实桌面主题切换、首屏观感或窗口操作验收，这些仍由用户手动确认。未提交、推送或修改远端 Issue。

## Input history #64 (2026-09-29)

用户随后确认功能正确，并要求在输入框占位提示中加入历史浏览快捷键。提示已补充，Composer 7 项测试及 diff 检查通过；用户确认后授权提交、推送并关闭 #64。真实 Windows IME 未单独取得专项验收记录。

实现第一/最后显示行 ↑/↓ 浏览当前对话已提交用户文本，原草稿与候选修改分别暂存、按对话隔离，发送沿用修订号保护。需求细则及软折行交界处的保守光标策略见 [UI 约定](UI-DESIGN.md#历史输入浏览64)，数据归属见 [架构说明](ARCHITECTURE.md#input-history-64)。不增加持久化表或原生权限，未修改远端 Issue。

最终 `npm.cmd run check` 通过 66 文件 / 659 项测试及 TypeScript/Vite 构建，Cargo check 和 Git diff 检查通过；保留既有大 chunk 提示。新增确定性测试覆盖历史顺序/边界、精确保留原草稿和光标、候选修改、删除/换版本后的修改稿保留、对话隔离与运行期生命周期、发送恢复、预检失败、后台提交期间继续编辑及切换对话、键盘/选区/IME 标记保护、选择事件竞态和模拟折行几何。独立只读复核无遗留可操作发现。

内置浏览器使用隔离数据库及 `127.0.0.1:1485/ui-review.local/history64.html`，真实 Composer/工作区 hook/CSS，模拟发送只消费草稿，不访问供应商。已验证原草稿恢复、历史修改往返、A/B 隔离、页面卸载重挂后保留、模拟发送恢复原草稿、宽/窄输入区、浅/深色及自动折行中间行移动；窄输入内容宽约 299px 时，Ctrl+Home → End → ↑ 能从首行末尾调出历史，调出光标为 0。浏览器发现并修复了同次按键旧 selection 事件覆盖目标光标的问题。合成 IME 事件保护有测试，真实 Windows 中文候选操作仍待人工验收；本次无原生改动，未运行原生 UI 自动化或重复 Tauri 启动。

## Send scroll #75 (2026-09-29)

`MessageList` 根据相邻列表的用户消息 ID 识别成功加入的新发送，在绘制前恢复跟随并滚到底部，复用既有流式滚动。新增 3 项组件用例覆盖文字/空正文消息、发送后继续跟随、再次上滚暂停、下一次发送重新恢复，以及同用户 ID 的编辑/回复更新不强制滚动。定向 25 项和全量 64 文件 / 640 项测试通过，TypeScript/Vite 构建、Cargo check、diff 检查通过；构建保留既有大 chunk 提示。独立只读复核确认重试与版本切换复用用户 ID、会话切换重建组件，无可操作发现；未将真实重试/版本切换与滚动组件串成集成测试。

内置浏览器隔离来源 `127.0.0.1:1483/ui-review.local/scroll75.html` 使用真实 MessageList/CSS 与合成消息。上滚后更新回复保持 scrollTop 2815，发送后距底部 0，新增流式段落后仍为 0；再次上滚后新增段落保持 scrollTop 3806，再发送回到底部（约 1px 的取整差）。截图 `ui-review.local/scroll75.png` 为忽略的本地验收证据。未读取凭据或调用供应商；此次仅改前端消息滚动，未重复原生启动。用户随后确认“效果不错”，验收通过，并授权提交、推送及关闭 #75。

## Chat empty state #73 (2026-09-29)

按用户当前要求，空状态复用当前助手头像，只保留“发送消息以开始对话。”，文字固定为 65% 不透明度，容器固定透明且无边框、阴影；不新增入口。与 Issue 原正文的引导方向差异已记录在 UI 约定。

`npm.cmd run check` 通过 64 文件 / 637 项测试及 TypeScript/Vite 构建，Cargo check 通过，保留既有大 chunk 提示。新增组件回归覆盖空状态唯一文案、自定义/内置头像、切换助手、图片损坏回退、无助手默认与进入已有消息后隐藏空状态。浏览器发现头像尺寸受样式顺序影响后提高局部选择器优先级，最终确认 48px，并重跑前端构建。

隔离内置浏览器使用 `127.0.0.1:1481/ui-review.local/empty73.html`，真实 MessageList 与 CSS 搭配合成头像和渐变背景。浅色 1280×800、深色 720×520、切换助手及有/无背景均核对；容器计算背景为 `rgba(0, 0, 0, 0)`、边框 0、阴影 none，无页面横向溢出。截图 `ui-review.local/empty73.png` 为忽略的验收证据。未读取真实凭据或发送模型请求。后续句号及文字透明度微调通过 MessageList 22 项测试与 diff 检查，用户确认效果并授权提交、推送及通过 #73。

## Local background library #70 (2026-09-29)

持久缩略图后续：新增 `backgrounds/thumbnails/<原文件名>.png`（长边最多 512、等比、不放大、保留透明度），导入时生成，旧图库按需补图；缺失/损坏可重建。图库只为可见区域附近解析小图，选中才解析原图；二者会话缓存与失败重试独立，原图保存不变。原生导入/解析/清理由共享互斥锁串行保护，在后台工作线程执行；现有 tempfile 从开发依赖移到运行依赖实现同目录原子持久化，锁文件版本未变。清理保留当前/图库/草稿原引用对应的整对文件，释放最后引用时删除原图及缩略图，并整理托管孤立小图。

本轮验证：64 文件 / 636 前端测试通过，TypeScript/Vite 构建通过（测试中 Array.at 与既有目标不兼容已改为下标）；17 项 Rust 背景测试、Cargo check 通过。内置浏览器隔离来源确认 6 张图库图片实际为 512×288、候选原图仍 960px 宽，重开全部加载且无读取提示，截图 `ui-review.local/background70-thumbnails.png`。模拟适配器不代表真实 asset 协议验收；原生启动烟雾已尝试，因用户现有 `target/debug/ayase-studio.exe` 占用导致拒绝访问，未关闭该进程。桌面选图、私有缩略图实际显示与重启恢复仍待手动验收。未提交或推送。

重复打开加载优化：控制器按不可变文件引用缓存预览解析结果及进行中的读取，关闭弹窗不清空；失败不缓存，图片重试强制刷新，应用/恢复/启动仍重新校验，清理时移除无引用项。缓存只持有资源地址与元数据，原图保存方式不变。新增 6 项回归覆盖重复/并发读取、失败与强制刷新、旧请求竞态、删除与控制器重建，以及真实控制器下弹窗卸载重开和图片错误重试。`npm.cmd run check` 通过 63 文件 / 629 测试及构建，Cargo check 和 diff 检查通过。内置浏览器隔离页面关闭重开后 6 张合成图片全部加载完成，截图 `ui-review.local/background70-cache.png`；真实桌面大图的耗时未量化，浏览器验证使用模拟文件适配器。

弹窗内参数编辑后续：复用外观页的适配、遮罩、模糊及恢复控件，取景编辑器作为同窗子页使用；完整原图保存方式不变。候选参数按图片版本暂存，只有最终应用所选图片时才一次持久化库参数与当前外观；取消丢弃草稿，失败可重试，过期版本不可覆盖替换后的图片。定向 38 项测试通过，最终 `npm.cmd run check` 通过 63 文件 / 623 项测试及 TypeScript/Vite 构建；Cargo check、diff 检查及独立只读复核通过。新增覆盖参数隔离/切图保留、取消/恢复默认值、取景子页取消与焦点、原子保存失败及版本校验；修复取景缩放滑块在函数式更新中读取已失效事件的旧问题。

同一隔离浏览器来源确认：1600×900 浅色下控件位于右侧预览下，参数/取景调整不改变外观页；取消重开恢复原值，点击应用后外观页同步为 35% 遮罩和 1px 模糊。取景预览继承候选的效果参数且只有一个 dialog；Escape 回到图库并恢复“调整取景中心”焦点。720×520 深色下控件可滚动访问，无横向溢出，底栏位于视口内。截图：`ui-review.local/background70-controls-light.png`、`ui-review.local/background70-controls-dark.png`。本轮未修改原生接口或文件保存方式，未重复原生启动；之前的原生选图与桌面恢复待验收边界仍然有效。

按用户确认统一头像库语义：背景库提供无命名导入、横向图片宫格、候选预览与显式应用、管理多选/全选/批量删除、单选替换预览与保存。删除和替换不改变当前背景，停用/恢复与恢复默认保留图片参数。旧背景兼容入库；替换后的旧图仅由当前背景持有，图库与当前均不引用后清理。远端 #70 的删除回退及不做批量管理规则已被本次用户指示替代，远端未修改。

确定性测试覆盖独立导入、每图参数、旧图替换保留及释放、批量删除/重裁/停用重启恢复、默认外观恢复、旧格式兼容、整批保存失败、替换重试、应用失败、导入清理互斥、草稿引用保护、物理清理失败重试、缺失资源与损坏元数据保护。UI 覆盖候选与管理选择分离、当前候选初始化、显式应用、替换/导入保存失败重试、取消和 Escape、焦点、失败图片重试；补充稳定原生解析回调回归，避免无关界面更新重复读取/解码图库与停用背景。最终 `npm.cmd run check` 通过 63 文件 / 616 项测试及 TypeScript/Vite 构建，保留既有大 chunk 提示；独立只读复核无遗留可操作发现，`git diff --check` 通过。

内置浏览器使用隔离来源 `127.0.0.1:1477/ui-review.local/background70.html`，真实 App/外观控制器搭配合成图片和模拟文件适配器，无凭据、真实图片或模型请求。已验证：从 18 张库图中批量删除包含当前背景的两张后剩余 16 张，当前背景仍显示、未删除候选保留；显式应用后替换同一库项，当前缩略图内容不变；停用刷新后状态及 45% 遮罩保留并可重新启用；导入后取消应用仍保留库项；全选删除后空库入口可用、当前图仍可重裁。浅色 1600×900 和深色 720×520 下无横向溢出；低高度弹窗内容滚动、底部确认按钮固定可达。浏览器按钮使用键盘操作。截图：`ui-review.local/background70-light.png`（忽略目录，仅为隔离验收证据）。

Rust 背景专项 8 项测试及 `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过。使用隔离 identifier 执行 `npm.cmd run tauri dev -- --no-watch --config ui-review.local/background70-tauri.json`，因现有 `src-tauri/target/debug/ayase-studio.exe` 被占用而拒绝访问，原生启动烟雾未完成，未关闭用户现有进程。Windows 原生选图、实际私有目录运行时加载及桌面重启恢复仍待人工验收；浏览器模拟与 Rust 测试不替代这些原生验收。未提交、推送、关闭 Issue 或发布。

## Local avatar library #69 (2026-09-28)

紧凑宫格与批量管理：64px 头像、6px 间距，去掉名称输入/重命名，自动以文件名作为内部标签。管理选择与应用候选独立；批量删除在一个事务中校验、解除来源并删除，任一失败全部回滚。全量 59 文件 / 588 项测试、TypeScript/Vite 构建、Rust check、diff 检查与独立只读复核通过。隔离浏览器 `127.0.0.1:1473/ui-review.local/avatar-grid.html` 用 18 张合成头像核对宽屏布局，实测勾选两张、确认删除后剩余 16 张，退出管理保留未删除候选；720×520 下实测单元 64px、间距 6px，网格 scrollWidth/clientWidth 均为 598，无横向溢出。本次没有访问真实图片、凭据或模型，没有重复 Windows 原生选图验收。

用户头像与头像库合并卡片：顶部唯一导入按钮复用库的选图/裁切/命名流程，保存后自动选中新候选，但显式应用前不写用户头像。定向 22 项测试、全量 59 文件 / 581 项测试、TypeScript/Vite 构建、Rust check 与 diff 检查通过；独立只读复核无本次变更的可操作发现。内置浏览器检查 1920×1080 与 720×520 的合并卡片、唯一入口和布局。导入选中、显式应用、取消保留候选及焦点、重裁与恢复默认由确定性测试覆盖；此次未重复原生选图验收。

头像页紧凑布局后续调整：合并外层页面留白，聊天预览改为宽屏右侧固定列、左侧配置独立滚动；与外观页共用 1440×700 的分栏条件。定向设置/头像库/助手头像组件 21 项测试与 TypeScript/Vite 构建通过。隔离内置浏览器在 1600×900 下确认左右分栏，左侧滚动 28px 后预览顶部仍为 162.6px；720×520 下回到纵向布局，页面和配置区无横向溢出。本次仅调整前端布局，未重复原生启动或改动头像持久化。主观视觉效果以用户反馈为准。

后续删除语义调整：从头像库删除只原子解除用户/助手的来源关系并移除库条目，已有对象保留原图、缩略图和裁切；已选草稿和正在重裁的对象在之后保存时转为独立图片。提示不再列出使用者或阻止删除。新增覆盖各版本与无关对象保留、删除失败整体回滚、删除/保存并发、过期草稿可保存、重裁和重新读取。最终 `npm.cmd run check` 通过 59 文件 / 580 项测试及 TypeScript/Vite 构建，Rust check 和 diff 检查通过，独立只读复核无遗留发现。构建仍有既有大 chunk 提示。

此次浏览器回归使用同一隔离来源：先让用户与助手共同选用合成图片，从库删除后条目消失，但两者图片仍能加载；用户重裁为 101% 并保存，刷新后图片及该裁切值保留。原生选图/桌面恢复沿用下述待验收边界，不将浏览器刷新等同于原生重启。以下首次实现的阻止删除验收属于历史记录，已被本次规则取代。

头像库与用户头像现在保存在 WebView 的 `AyaseStudio` IndexedDB 专用表，助手仍保存自身图片快照。旧 `ayase-studio-avatars` 在首次读取用户头像时兼容复制，保留旧数据库作为备份；空记录标记已迁移/已恢复默认，避免旧图复活。此前手工备份要求包含完整 WebView 数据目录；#79 自有备份使用显式字段和 Blob 清单，见 [备份指南](AYASE-BACKUP.md)。四项已确认的产品规则及版本持有/回收约定见架构文档和计划文档，远端 Issue 未修改。

确定性验证重点：导入格式/大小/命名/解码失败、裁切与取消、候选与正式应用、多个对象独立裁切、替换版本保留、删除保护、过期草稿、并发保存与删除、旧用户和助手兼容迁移、损坏回退、失败迁移后的显式恢复、迟到迁移不能覆盖新值，以及成功保存后刷新失败不得重复导入。相关用例位于 `src/avatar/library.test.ts`、`src/avatar/useUserAvatar.test.tsx`、`src/ui/avatar/AvatarLibrary.test.tsx` 和 `src/ui/chat/AssistantAvatarEditor.test.tsx`。

首次实现 `npm.cmd run check` 通过 59 个文件、577 项测试及 TypeScript/Vite 生产构建，保留既有大 chunk 警告。头像库仓库专项 36 项、相关界面定向 21 项通过；`git diff --check` 通过。独立只读审查发现的旧备份读取失败阻止显式恢复、保存成功后刷新失败造成重复导入两项问题已修复并回归，无遗留可操作发现。

内置浏览器使用隔离来源 `127.0.0.1:1469/ui-review.local/avatar69.html` 和合成图形/助手数据，无模型服务配置。已确认选择候选不会直接应用、显式用作用户头像、刷新恢复、删除使用中的资源列出用户及助手并禁用确认、助手选择器与设置页共享同一库、文件选择→裁切/命名→保存到库、Escape 返回保留候选、取消助手编辑保留入库资源且原助手不变、恢复默认保留库并刷新使用关系。检查浅/深色、720×520 与 1280×900、长名称省略与完整提示；页面和网格无横向溢出。按钮主要使用键盘，文件选择采用浏览器 filechooser 接口；这些不等于 Windows 原生选图验收。截图：`ui-review.local/avatar69-dark.png`。

`cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过。尝试隔离 identifier 的 `npm.cmd run tauri dev -- --no-watch --config ui-review.local/avatar69-tauri.json` 时，编译因现有进程占用 `src-tauri/target/debug/ayase-studio.exe` 而报拒绝访问；保留现有进程，未强制关闭。此次原生启动烟雾未通过，Windows 原生文件选择及真实桌面重启恢复仍待人工验收。未读取真实凭据、发送模型请求、提交、推送或关闭 Issue。

## Assistant avatars #67 (2026-09-28)

提交前验证：最终 40px 聊天头像版本通过 `npm.cmd run check`（57 个文件、529 项测试及 TypeScript/Vite 构建）、`cargo check --locked --manifest-path src-tauri/Cargo.toml`。构建保留既有大 chunk 提示；下文 32px 浏览器测量属于此前版本，本次未重复视觉或原生交互验收。

后续用户确认未设置用户图片时也应显示默认头像：用户消息和设置预览新增默认人形图标，图片加载失败、移除时回退该图标。消息与用户头像两套测试共 22 项通过，TypeScript 和 diff 检查通过；新增覆盖双方头像共存、切换助手互不影响、图片失败和移除回退。内置浏览器合成数据确认用户人形头像与助手图片同时显示，均为 32×32，无页面横向溢出。此轮仅调整前端默认显示，不重复原生检查或全量构建。

`npm.cmd run check` passed 54 files / 516 tests and TypeScript/Vite production build. After adding focused component tests and correcting sidebar square sizing, five targeted suites passed 31 tests (assistant defaults, persistence, display, crop editor, message regression); the worker also checked the existing user-avatar suites. `cargo check --manifest-path src-tauri/Cargo.toml` passed. Independent read-only review found no actionable defect in persistence, request privacy, crop lifecycle, or defaults. The build retains the existing large-chunk warning.

The isolated in-app browser origin `127.0.0.1:1467/ui-review.local/assistant67.html` uses synthetic local image/chat data and no configured provider. Verified crop zoom/drag, Escape cancel retaining the outer editor, Apply followed by Save Assistant, 256×256 thumbnail recovery after reload, removal falling back to the saved built-in and editor cancellation retaining the custom image, and a changed global default appearing in a new assistant draft. At 720×520 the message avatar is 32×32 with no page horizontal overflow; dark low-height crop controls remain visible. The normal light viewport was also inspected. Controls were exercised by keyboard and crop dragging by pointer; no native file dialog was automated.

Screenshot: `ui-review.local/assistant67-crop-dark.png` (ignored local evidence). Native file selection and actual desktop restart remain manual acceptance; no native permission, filesystem command, or transport contract changed, so this run did not relaunch the desktop app. Subjective visual acceptance remains with the user. No commit, push, or remote Issue update was performed.

## User avatar #32 / #34 verification (2026-09-28)

首次实现时头像原图、裁切参数及缩略图保存于 WebView 的 `ayase-studio-avatars` IndexedDB，手工备份需包含 WebView 本地目录，没有单独的头像文件目录。后来头像库已迁入 `AyaseStudio`，#79 自有备份按允许清单导出头像 Blob。浏览器验收数据与桌面应用分离。

头像仓库/几何、Hook 保存失败、MessageList 和 SettingsWorkspace 共四个文件 28 项定向测试通过；TypeScript/Vite 构建、Cargo check 和 diff 检查通过。独立只读审查无待修复问题。未运行全量协议测试或真实供应商探针。

内置浏览器使用隔离来源 `127.0.0.1:1462`、合成聊天和仓库图标验收：本地选图、正方形预览、缩放、指针拖动、重裁、取消保留旧取景、损坏图片、移除及页面刷新恢复通过。检查浅/深主题、1280×900 与 720×520，消息头像为 32px，无横向溢出；低高度裁切按钮可见。按钮使用键盘操作，因浏览器点击自动化未触发；拖动可用。未读取凭据或发送供应商请求。

使用临时隔离 identifier 配置运行 `npm.cmd run tauri dev -- --no-watch --config ui-review.local/avatars-tauri.json`，编译并启动成功。原生文件选择、生产 WebView 图片显示及真实桌面重启恢复仍待人工验收；启动成功和浏览器验收不代表这些原生交互已通过。

2026-09-28 后续外观微调：色盘、透明度和背景数值旁补充单项恢复按钮；统一色和统一透明度分别原子恢复其覆盖范围内的方案默认值。沿用用户暂不测试的要求，仅做源码复核与 diff 检查，dev 视觉和交互由用户确认。

## 统一主题色与独立子项（2026-09-28）

配色新增统一主题色、独立组件色与用户气泡色，默认方案保留不同色；助手和画布不受统一操作影响。同步更新接口样例和旧对比度预期，补充统一覆盖、独立修改、同色同步、重启与预设恢复的确定性测试源码。遵循本次用户要求，未运行测试、构建、浏览器或原生启动；只做源码复核和 diff 空白检查，视觉效果由用户正在运行的 dev 验收。

## 浅色配色预设（2026-09-27）

默认配色改为中性灰助手气泡与较明显的浅蓝用户气泡，原暖灰配色保留为外观设置的“阅读”预设，具体色值及交互见 [UI 约定](UI-DESIGN.md#确认状态)。按用户要求不运行测试、构建或启动新的 dev 实例；仅做源码检查及 diff 空白检查，现有测试中的默认值与接口样例同步更新但未执行。用户使用已运行的 dev 直接确认视觉效果，运行时和视觉验收尚未完成。

## 最新一轮问答版本与快捷键（#17 / #50，2026-09-27）

按用户要求执行最小相关验证：`npm.cmd test -- src/chat/roundVersions.test.ts src/chat/repository.test.ts src/chat/useChatSession.messages.test.tsx src/chat/useChatSession.concurrency.test.tsx src/ui/chat/MessageList.test.tsx src/ui/chat/Composer.test.tsx`，6 文件 47 项通过；修复箭头切换后的焦点恢复后，仅重跑 MessageList 的 19 项通过。`npx.cmd tsc --noEmit`、`git diff --check` 通过。独立只读审查覆盖存储、请求上下文、附件引用、并发保护、恢复和 UI，未发现剩余确认缺陷。

内置浏览器通过隔离 origin `127.0.0.1:1458/ui-review.local/round50.html` 运行真实 App、Dexie、会话逻辑与组件，仅替换 transport 为本地合成回复，不读取真实凭据或发送供应商请求。验收 Enter / Ctrl+Enter 发送、Shift+Enter 换行、编辑 Ctrl+Enter 直接发送、Enter 仅保存、Escape 取消；重新生成及修改提问产生 3 个候选，箭头同步恢复对应问答，刷新保持 2/3 选择。箭头切换到边界后焦点转到可用箭头，可连续键盘切换。继续下一轮后旧候选入口消失，保留选中问答；新一轮可独立新增候选。720×520 深色与默认尺寸浅色布局无页面横向溢出，浏览器无 error 日志。

验收截图：`ui-review.local/round50-versions.png`、`ui-review.local/round50-dark.png`；样例、模拟 transport 和独立 Vite 配置均位于忽略目录，不随仓库交付。不运行全量测试、Rust 检查或原生启动；本轮无原生合同变更。真实 Windows 输入法选词仍需用户实机确认，合成事件测试只验证组合输入保护分支。未提交、推送或修改远端 Issue。

## Issue #62 消息内图片预览（2026-09-27）

粘贴默认名规则补充：附件 UI 16 项与 TypeScript 通过，确定性测试覆盖同批/同秒连续粘贴编号、跨秒重置、明确名称保留、扩展名及原字节/MIME/修改时间保留。内置浏览器通过合成 clipboard paste 事件验证两张默认名分别变为时间名和 `-2`，`风景.png` 保留，改名后可点击预览且发送计数为 0；截图 `ui-review.local/paste-names62.png`。这验证应用粘贴处理，不代表 Windows 系统剪贴板格式兼容性的全面验收。

后续补充待发送图片标签点击预览，保持紧凑标签和独立移除按钮。附件 UI 15 项测试、TypeScript 与 diff 检查通过；新增测试覆盖显式打开才读取、关闭再打开重新读取、草稿保持、附件移除后关闭、读取失败且不发送。内置浏览器 `ui-review.local/draft62.html` 合成图片验证鼠标打开、Escape 关闭后标签焦点恢复、草稿文字及附件保留，点击 × 只移除，发送计数始终为 0。截图 `ui-review.local/draft62-preview.png`。未运行全量或原生检查，未改变附件保存/传输协议。

按用户确认实施适当尺寸的消息内图片预览：单图最大 560×420px，多图最多两列、每格最大 280×280px，窄内容区域单列，等比完整显示且不放大小图。见 [UI 规则](UI-DESIGN.md#消息内图片预览issue-62) 与 [临时读取生命周期](ARCHITECTURE.md#message-image-previews-62)。

最低限度验证：`npm.cmd test -- src/ui/chat/AttachmentUi.test.tsx src/ui/chat/MessageList.test.tsx` 首轮 29 项通过；末张导航焦点修复后只重跑附件 UI，13 项通过（消息组件既有 17 项此前通过）。`npx.cmd tsc --noEmit` 与 `git diff --check` 通过。新增测试覆盖可视范围读取/释放、迟到结果丢弃、图片失败、弹窗切换和焦点返回。独立只读审查发现的中等宽度单格超限、末张导航焦点逃逸已修复并复核，无剩余确认缺陷。

内置浏览器使用隔离 origin `127.0.0.1:1456` 和 `ui-review.local/images62.html`，真实消息组件配合合成图片与读取回调。1200×850 下单图外框 560×420px、多图两列各 280×280px；横图、竖图和长截图完整显示，80×60 小图不放大。720×520 窗口中的 320px 内容区改为单列，无页面或消息区横向溢出；浅深主题均检查。鼠标打开/关闭、左右键切图、Escape 返回、末张导航后 Tab 回到关闭按钮通过；读取失败、解码失败、延迟加载均保留稳定占位。20 条长对话在底部仅挂载附近两张图片，滚到顶部后换为前两张且总高度不变。刷新合成样例后图片重新读取并正常显示。

浏览器验收修复了首版长图裁切和多图意外单列问题。截图保存在 `ui-review.local/images62-single.png`、`images62-multi-light.png` 与 `images62-narrow-dark.png`。这是隔离样例的组件/布局验收，不代表原生私有附件持久化或真实供应商验收；不调用真实供应商，不读取凭据，未运行全量测试、生产构建、Rust 或原生启动。未提交、推送或修改远端 Issue；最终主观视觉效果由用户确认。

## Issue #63 轻量附件扩展（2026-09-27）

后续按用户反馈取消选择器的协议过滤：所有连接（包括尚未选择模型）都列出 DOCX/XLSX/PPTX，加入草稿后再提示 Responses 发送要求。切换连接保留草稿，非 Responses 的发送限制不变。

该修复通过 9 项附件 UI 测试、TypeScript 与 diff 检查；内置浏览器确认 Anthropic 下文件输入 accept 包含三个 Office 后缀，添加后显示限制原因并禁用发送。此轮未操作 Windows 原生选择对话框。

新增 UTF-8 结构化文本/代码，以及仅 Responses 可发送的 DOCX/XLSX/PPTX 原文件。Office 仅验证 ZIP 文件头，不做完整 OOXML 解析；预览只读元数据，无新增依赖。验收范围及远端需求差异见 [计划](PLAN.md#issue-63-lightweight-attachments)。

定向前端 5 个文件、54 项测试通过（格式识别、请求映射、私有存储接口、会话附件生命周期及 UI），生产构建通过，保留既有大 chunk 提示。Rust 附件 14 项测试和 cargo check 通过。独立只读审查未发现确认缺陷。未运行无关全量测试，也未读取凭据或请求真实供应商。

内置浏览器使用独立 `127.0.0.1:1453` 与 `ui-review.local/attachments63.html`，真实组件和请求映射配合合成附件、本地模拟存储。通过键盘验证添加草稿、切换协议保留附件且阻止发送、切回 Responses 后产生原 Office Base64 与 CSV 正文、Office 信息预览及 CSV 中文预览、Escape 关闭；浏览器刷新恢复仅验证模拟存储，正式持久化由既有会话测试及本轮 Rust 副本测试覆盖。720×520 浅深主题均无横向溢出；截图为 `ui-review.local/attachments63-light.png` 与 `attachments63-preview.png`。鼠标点击工具未改变页面，未将其计为通过。

`tauri dev --no-watch` 启动检查因用户正在运行的 `target/debug/ayase-studio.exe` 被占用，链接替换报 Windows 拒绝访问而未完成；保留该实例，不强制关闭。原生文件对话框与真实供应商兼容性未验收，浏览器检查不替代它们。

## Issue #59 区域透明度（2026-09-27）

后续按用户要求将预览改为固定 1920×1080 的完整模拟画布并整体缩放，背景取景明确为 16:9。10 项相关测试、TypeScript、生产构建和 diff 检查通过；测试覆盖容器宽度变化、observer 清理、固定预览取景及真实窗口默认取景。内置浏览器实测内部尺寸始终 1920×1080，在 1280px 宽窗口显示为 948×533.25，在 1440px 双列设置页显示为 597×335.8125；720×520 下无横向溢出，浅深主题和透明度实时更新正常。截图为 `ui-review.local/preview-1080p.png`，独立只读复审无确认缺陷。本轮仅改预览与可选背景比例参数，未重复全量测试、Rust 或原生启动。

统一滑块覆盖侧栏、输入栏、双方消息气泡；独立调整只覆盖对应区域，差异以橙色叹号提示，手动恢复一致后同步统一值。预览包括两级侧栏、双方气泡与输入区，方案见 [UI 约定](UI-DESIGN.md#透明度设置issue-59)。

最终 `npm.cmd run check` 通过 49 个测试文件、489 项测试和 TypeScript/Vite 构建；`cargo check --manifest-path src-tauri/Cargo.toml` 通过。新增确定性测试覆盖统一一次存储、独立覆盖与收敛、恢复偏好、旧配置/非法值回退、重置、差异提示、提示层视口边界，以及浅深主题和自定义配色下每个整数透明度的用户文字对比度。构建保留既有大 chunk 提示。

内置浏览器使用隔离 `127.0.0.1:1445` origin 和 `ui-review.local/opacity.html`，供应商请求被阻断，背景适配器提供合成图形。实测统一 100%、单项变 0%、手动恢复 100% 的提示出现/消失，以及统一 30% 后侧栏 40% 刷新恢复；预览与实际聊天对应底板 alpha 相同，内容 opacity 保持 1（侧栏原有开关动画除外）。浅深主题、1440×900 与 720×520 均无页面横向溢出，键盘聚焦显示差异说明；最终截图为 `ui-review.local/opacity-dark.png`。导航和精确数值测试通过键盘 Enter/方向键完成，另实测鼠标拖动统一滑块将三个区域同步为 60%，差异标识消失。

独立审查发现并修复高透明度下深色画布上的用户文字对比不足，以及说明提示在滚动区或窗口边缘裁切；复审无剩余确认缺陷。浏览器确认深色无背景图、100% 气泡透明度时用户文字为白色，实际聊天与预览一致；说明提示使用 body portal，Escape 关闭。

未访问真实密钥或供应商、未提交或修改远端 Issue。本轮不涉及原生权限、网络、文件实现或主题首屏机制；未重启用户正在运行的桌面实例，浏览器验收不代表原生安装/启动与用户主观视觉验收。

## Issue #9 标题栏样板（2026-09-27）

按用户确认，Windows 原生标题栏与聊天顶部栏合并，对话标题居中，模型选择迁移至输入框底部，宽窄与清空在窗口三键左侧独立成组。设置页同样保留窗口三键。用户随后要求将聊天顶部栏收紧至 40px；内置浏览器实测高度 40px，三键贴顶对齐，无页面横向溢出。

用户在上述调整后明确授权提交代码，并将 #9 标记为已完成。关闭依据是用户本轮指示，不将其扩大为全部原生交互测试或安装发布验收通过；以下已验证范围及 Snap Layout 限制继续保留。

默认自主 UI 验收使用 Codex 内置浏览器，详见 [AGENTS.md](../AGENTS.md#editing-and-verification)。只有用户明确要求时才使用 Computer Use 或其他原生 UI 自动化。原生能力仍需相关编译、启动检查；浏览器无法验证的行为明确交由用户手动验收，不用浏览器模拟替代。

本轮 `npm.cmd run check` 的 48 个文件、482 项测试与生产构建通过，`cargo check --manifest-path src-tauri/Cargo.toml` 通过；构建保留既有大 chunk 提示。窗口测试覆盖浏览器/原生装饰分支、三键分发、最大化状态同步、迟到状态忽略、重复命令防护、错误呈现和卸载监听清理。后续仅 CSS 微调重跑相关 32 项测试和 TypeScript 检查。

独立只读审查确认并复核修复了最小窗口下长标题与操作区重叠的问题，未发现其余确认的 P1/P2 缺陷；该审查不替代下面列出的原生体验验收。

内置浏览器使用独立 `127.0.0.1:1441` origin 与 `ui-review.local/titlebar.html` 样板，拦截原生命令且不请求供应商。720×520 下浅深主题、模型弹窗与 Escape 焦点回退可用；长标题居中（聊天区域与标题中心均为 x=392），标题右缘 472px、操作区左缘约 487px，无重叠及页面横向溢出。截图 `ui-review.local/titlebar-720-dark.png` 为浏览器模拟的原生按钮外观，不是原生窗口截图。

`npm.cmd run tauri dev` 已编译启动，原生可访问性树确认窗口三键出现，并读取到真实最大化状态。用户新增默认浏览器验收要求前尝试的 Computer Use 截图报 `FrameArrived timed out`，点击报 `coordinate input geometry is unavailable`；因此未声称拖动、双击、三键原生动作、阴影或系统菜单通过。启动日志仍出现 IPC 自定义协议回退到 postMessage 的警告。

Windows 11 最大化按钮悬停 Snap Layout 尚未接入：普通 HTML 按钮与 `toggleMaximize` 不提供原生 `HTMAXBUTTON` 命中行为。其余 Snap、系统菜单、阴影和缩放也待用户实机确认；若原生体验明显退化，应按 #9 保留原生标题栏，不将当前样板视为发布通过。可在启动前设置 `$env:AYASE_NATIVE_TITLEBAR = '1'` 恢复原生装饰，自定义三键会随之隐藏；移除此环境变量并重启可恢复样板。官方依据：[Tauri 窗口定制](https://v2.tauri.app/learn/window-customization/)、[Microsoft 自定义标题栏 Snap Layout](https://learn.microsoft.com/windows/apps/desktop/modernize/apply-snap-layout-menu)。

## Alpha 2 候选包验证（2026-09-27）

版本统一为 `0.1.0-alpha.2`，继续仅构建 Windows x64 NSIS 安装程序。`npm.cmd run check` 通过：46 个文件、473 项确定性测试及 TypeScript/Vite 生产构建；`cargo test --manifest-path src-tauri/Cargo.toml` 的 20 项单元测试和 `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

默认测试由 `vitest.config.ts` 限定为 `src/**/*.test.{ts,tsx}`，覆盖全部正式前端测试，避免误收集被忽略的本地供应商探针。真实供应商探测仍由独立的 `probe:live` 显式运行，本轮未调用。App 请求断言已区分主聊天和后台自动命名请求；命名行为本身仍由专门测试覆盖。生产构建保留大于 500 kB 的 chunk 提示。

此记录不代表安装或升级验收。发布前仍需检查全新安装、覆盖升级、聊天/连接凭据/附件/背景保留，以及窗口尺寸与最大化状态的关闭重启恢复。候选包提交到 `dev → main` PR 供用户检查，PR 创建不等于合并或正式发布。

本轮 `npm.cmd run tauri dev` 编译并启动成功，系统确认主窗口存在且响应正常，检查后已关闭。该检查未操作窗口恢复或安装器；日志包含 libpng 颜色配置警告。独立只读审查覆盖并发任务归属、标题写入保护及窗口状态插件生命周期，未发现确认的 P1/P2 缺陷。

`npm.cmd run build:windows` 构建应用成功；后续仅修改安装模板，使用 `npm.cmd run tauri -- bundle --bundles nsis` 重新封装。当前候选包为 `src-tauri/target/release/bundle/nsis/Ayase Studio_0.1.0-alpha.2_x64-setup.exe`（6,063,106 字节）；应用 ProductVersion 为 `0.1.0-alpha.2`。安装包签名状态为 `NotSigned`，SHA-256：`7E9F0F2134B3815864248E4ABD2A1D5D53143616308EB74C63D2CD14F7A11BAC`。本地 `check-alpha.local.log`、`build-alpha.local.log`、`desktop-alpha.local.log`、`bundle-overwrite.local.log` 保存对应日志且不提交。

覆盖升级调整：同版本 NSIS 重装和向上升级直接跳过“先卸载/不卸载”选择页，继续原有文件覆盖安装；首次安装、降级和 WiX 迁移保留上游流程。模板来源与维护说明见 [Windows installer template](../src-tauri/windows/README.md)。`pwsh -NoProfile -File scripts/test-installer-policy.ps1` 使用 NSIS 编译并执行真实版本比较和策略代码，六项用例通过；独立只读审查未发现安装流程缺陷。测试不写安装注册表或应用数据，不能替代实际界面和数据保留验收。本轮未改应用代码，未重复前述全量测试。

## Issue #54 窗口尺寸记忆

用户本轮将需求明确为“记住上次关闭时的窗口大小”；远端 Issue 未修改。首次启动使用 1040×760，正常关闭后保存普通窗口尺寸及最大化状态，后续启动恢复；仍允许手动调整，保留 720×520 最小尺寸。状态文件为应用配置目录下的 `.window-state.json`，与聊天数据独立。

桌面验收步骤：首次启动检查默认尺寸；调整为其他尺寸后关闭并重启，确认恢复；最大化后关闭重启，确认最大化并可还原至原普通尺寸；最小化后通过任务栏关闭再启动，确认窗口正常可见。不能以浏览器窗口或 Rust 编译结果替代这些原生交互验证。

2026-09-27：`cargo check --manifest-path src-tauri/Cargo.toml`、现有 20 项 Rust 单元测试及 `git diff --check` 通过。`npm.cmd run tauri dev` 已编译启动，操作系统报告主窗口存在且响应；未完成上述尺寸往返和视觉验收，现有单元测试也不覆盖原生窗口恢复。启动日志有 IPC 自定义协议转 postMessage 及异步回调丢失警告，不将进程启动记作完整桌面验收。本次未修改前端，未运行前端全量测试或真实供应商探测。

## Issue #31 定向验证（2026-09-27）

按用户要求不运行全量测试，使用 Codex 内置浏览器验收，不操作原生桌面。确定性检查覆盖 `conversationTitle.test.ts`、`conversationTitle.repository.test.ts`、`useChatSession.title.test.tsx`，以及受影响的 workspace、消息发送、附件与跨对话并发测试。新增 UI 回归确认仅编辑标题才设 manual 标记；仅修改参数不锁定标题。旧测试的请求观察器现在区分主聊天和额外命名请求，相关失败已定向修复并重跑通过。`npx.cmd tsc --noEmit` 和 `git diff --check` 通过；未运行全量 check、Rust 编译或真实供应商探测。

独立审查发现并修复了 Responses/Gemini 输出截断被误收为标题，以及首条附件消息提交后停止漏掉命名的分支；后者用延迟附件 verify 的确定性用例覆盖。复审未发现剩余运行时问题。

内置浏览器使用独立 `127.0.0.1:1438` origin 和忽略目录 `ui-review.local` 的模拟 transport，实际渲染 App 并操作发送/编辑/导航。确认长原文立即截断为标题、成功后顶部与侧栏同步显示摘要、失败保留原文、后续消息不重命名、手动标题不被迟到结果覆盖，以及刷新后持久化。截图：`ui-review.local/title-success.png`、`ui-review.local/title-verified.png`。模拟请求只验证界面与应用编排，不代表真实模型标题质量或供应商兼容性验收。

## Issue #55 pre-push verification

供应商连接列表与返回入口的提交前检查：`npm.cmd test -- src` 的 43 个文件、458 项测试通过，包含新增的列表字段与多连接跳转、返回时未保存模型编辑确认、删除取消/确认、生成期间禁用、焦点恢复及空状态用例。`npm.cmd run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml` 通过；构建仍提示部分 chunk 超过 500 kB。

默认 `npm.cmd run check` 首次执行误收集了被忽略的 `.gemini-search-diagnosis.local/probe.test.ts`，其已有结果防重复保护在调用前阻止执行。因此改用上述 `src` 测试范围与独立构建，不将默认 check 记为通过，不删除或重跑本地探针。新增测试的确认框模拟在修正后通过。用户已确认连接列表与返回功能；详情页最后一轮对齐及全局下拉框样式仍未完成全面视觉验收，本次未启动桌面或调用真实供应商。

## Issue #51 切换对话定位定向验证

2026-09-27：用户确认 #42 与 #51 手动验收均已完成并通过，授权关闭两项 Issue 并提交代码。此记录为用户提供的界面验收结果。

复用 #42 已有的绘制前定位实现，新增两组组件回归覆盖缓存历史直接挂载、异步历史加载、从上滚暂停的对话切走并切回，以及新建空对话。通过父组件 layout effect 读取子组件位置，验证在 passive effect 前已经到底，避免只检查最终位置而漏掉首屏跳动。happy-dom 的容器尺寸由测试模拟，不能替代实际绘制验收。

验证命令：`npm.cmd test -- src/ui/chat/MessageList.test.tsx`（16 项）、`npx.cmd tsc --noEmit` 和 `git diff --check`。按用户要求不运行全量测试或 Computer Use，切换时无可见滚动过程及空对话显示由用户手动验收。

## Issue #42 流式滚动定向验证

`npm.cmd test -- src/ui/chat/MessageList.test.tsx` 的 14 项测试通过；新增用例模拟滚动容器尺寸，覆盖流式跟随、上滚滚轮先于 scroll 事件时暂停、底部附近继续上滚仍暂停、滚动条回到底部 48px 内恢复、附件预览滚轮不误暂停聊天，以及清空消息和切换会话重置。`npx.cmd tsc --noEmit` 通过。按用户要求不运行全量测试和 Computer Use；实际滚轮与滚动条交互由用户验收，组件模拟不代表实机验证。

## UI #44–#47 定向验证（2026-09-26）

按用户要求使用内置浏览器，避免全量测试和原生桌面自动化。定向回归范围为 `src/App.test.tsx`、`src/Workspace.test.tsx`、`src/ui/chat/MessageList.test.tsx`、`src/ui/settings/SettingsWorkspace.test.tsx`、`src/ui/settings/AppearanceSettings.test.tsx`、`src/ui/settings/ConnectionSettings.test.tsx`。覆盖页面/会话切换、生成状态保护、消息入口、主题/滑块回调、树展开与节点选择分离、模型浏览不改默认、放弃编辑后不残留草稿。前端构建和 Git diff 检查补充验证；未修改 Rust、权限、协议或持久化。

浏览器使用独立 `127.0.0.1:1437` origin 与忽略目录 `ui-review.local` 中的合成供应商、模型和聊天样例，不读取真实密钥、不调用模型。首轮宽屏 1440×900 曾检查贴边级联面板，但该外观被用户指出偏离保留悬浮面板的要求，不能作为视觉接受证据，720×520 验证覆盖导航前后输入框 x/width 不变、分级 Escape、草稿保留和连接详情可访问；浅深主题与透明度回调均实际检查。该证据不等于原生文件选择、背景持久化、安装包升级或真实供应商验收，用户主观视觉反馈仍可继续调整。

首轮上述定向文件的 62 项回归均通过（分别执行，失败修复后仅重跑受影响文件），另对前景色 token 调整执行外观控制器与搜索结果的 28 项相关回归，通过；TypeScript/Vite build 与 diff 检查通过，构建仍有既有大 chunk 提示。独立审查指出并修复了同连接模型切换的编辑残留、最后一个模型删除后的焦点回退和浅蓝前景/焦点对比度。首轮页面截图保存在忽略目录 `ui-review.local/{chat,appearance,connections}.png`，不包含真实聊天或凭据，不代表后续调整版本。

2026-09-27 阶段性提交：依据用户反馈恢复悬浮聊天侧栏、连接两级树，设置页面和分组采用小圆角卡片，外观预览增加用户消息并支持宽屏固定。两级树修正后 App 的 20 项及连接设置的 3 项定向测试通过；后续菜单排版调整重跑连接设置 3 项通过。外观设置 2 项测试在结构调整后通过。用户已要求不再进行截图验收，后续视觉效果由其亲自检查；字体大小、字重、中文字体回退仍待下一轮共同调整。

## Issue #49 图片预览回归

按用户最终确认的样式，待发送附件在输入框上方显示紧凑标签：文件图标、文件名、移除按钮。长文件名省略、多附件换行，完整名称、MIME 与大小放入悬浮提示；草稿不再解码图片或创建 object URL，也不需要扩展 CSP。已发送图片仍可打开预览，解码失败显示明确错误，不改变附件或消息正文。定向回归命令：`npm.cmd test -- src/ui/chat/AttachmentUi.test.tsx`。

2026-09-26：初版曾验证缺少 `blob:` CSP 来源导致缩略图被拦截；用户随后要求改为紧凑标签，最终实现移除草稿缩略图及对应 CSP 改动。桌面自动化截图超时后，按用户要求使用内置浏览器做视觉验收。安装版需重新构建更新后才能获得修复；全程不需真实供应商调用。

已发送附件弹窗的失败提示、关闭再打开及消息保留由组件测试覆盖；浏览器验收聚焦草稿标签布局和交互，不代表原生附件持久化验收。

最终紧凑标签版：426 项测试及前端构建通过；内置浏览器确认标签高 24px、长名称省略、720×520 窗口下多附件换行和单独移除正常。完整文件信息仍可从悬浮提示查看，未发起供应商请求。

用户随后明确确认测试通过，已按授权将 #49 关闭为已完成。此为用户提供的验收结果，不扩大为安装包发布或升级验证。

## Issue #39 现有 OpenAI 兼容协议修复

2026-09-21：按用户本轮要求复用现有 Chat/Responses adapter，补齐 Chat `reasoning_content` 与 Responses `reasoning_text` 的本地显示；保留 OpenAI 官方摘要、显示开关、正文隔离和本地历史规则。用户将 #39 范围修订为修复现有协议，不新增协议或供应商模板，并确认按此范围验收关闭。DeepSeek Chat 关闭思考参数差异另由低优先级 [#40](https://github.com/AyaseMinami/AyaseStudio/issues/40) 跟踪，暂缓处理。OpenAI/DeepSeek 官方合同及参数差异见 [协议说明](PROTOCOLS.md#issue-16-thinking-controls-and-readable-summaries)。

全量 420 项测试、TypeScript/Vite build、Rust check 通过；定向回归覆盖两个协议的流式/非流式思考字段、关闭显示、错误类型、摘要与内容索引隔离、重复终态快照、合法重复增量、思考期间停止、null/空正文输出截断及拒绝文本。最终快照先补齐正在显示的片段，再追加未出现过的摘要或内容，避免将摘要插入半截思考文本。构建仍提示现有大 chunk，不影响构建完成。

使用用户授权的本地 DeepSeek 配置，通过实际 `ChatTransport` 与 Node fetch 请求模型目录及四个短生成请求。`deepseek-flash` 的 Chat/Responses × 流式/非流式均 HTTP 200，正文均为 `42`，思考字段在传输前后字符数分别一致（55/61/62/59），每次一个正常终态。未重试或自动改协议。该证据仅证明 DeepSeek 线路兼容，不代表 OpenAI 官方端点或 Tauri WebView 联网/桌面交互验收。

尝试 `npm.cmd run tauri dev` 时原生目标编译完成，但 Vite 报 1420 端口已被占用；本轮未完成新增桌面烟雾验收，未停止已有应用或服务。

随后用户确认桌面手动测试已通过，并授权提交、推送及关闭 #39。这是用户提供的桌面验收结果，不扩大为 OpenAI 官方端点的真实调用验收。

本机凭据在 Git 忽略的 `.env.deepseek.local`，脱敏统计在 `.deepseek-probe.local/results.json`；这些本地文件不随仓库分发。现有 `probe:live` 仍读取 `.env.probe.local`，不会自动读取 DeepSeek 专用文件。不要将真实 Key 或完整思考文本加入报告。

Issue #36 / #61 定向验证：`npm.cmd test -- src/chat/CodeBlock.test.tsx src/chat/SafeMarkdown.test.tsx src/ui/chat/SearchResults.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。覆盖代码高亮、未知语言、逐段流式更新、原文复制（缩进、空行、CRLF、末尾换行）、复制失败与既有公式/引用安全边界，以及每块独立换行、流式更新保留选择和两种模式下复制原文。浏览器检查浅深主题、窄窗口自动折行与关闭后的局部滚动；桌面剪贴板实际交互仍需桌面验收。本项不改变原生权限、存储或供应商协议。

2026-09-27 #61 本地验证：`npm.cmd run check` 通过（50 个测试文件、497 项测试及生产构建），Rust check 通过；构建仍有大 chunk 提示。内置浏览器合成样例验证浅深主题、320px/900px 内容容器：窄容器代码正文 clientWidth/scrollWidth 为 286/286，关闭换行后为 286/1877，页面仍为 680/680；900px 容器中换行正文为 866/866，页面为 1100/1100。真实 MessageList 合成消息在 320px 容器中正文为 231/231，页面无横向溢出。键盘 Enter 可切换模式，模拟流式追加至闭合围栏后保持选择。鼠标自动化点击无状态变化，未记作通过。复制按钮显示成功，但浏览器剪贴板读取接口返回空值，原文一致性以组件测试为证，真实剪贴板仍待手动确认。未调用供应商或原生桌面自动化。

本指南用于在办公室、家里或新的 Windows 开发环境中稳定地继续 Ayase Studio 的开发。仓库中的锁文件是依赖版本的权威来源；真实 API Key 与本地运行产物不进入 Git。

## Issue #27 本地验证记录

2026-09-20：按用户本轮确认改为“宽屏正文平滑让位、窄屏覆盖”，替代远端 Issue 中所有窗口正文不移动的约束；未修改远端 Issue。导航使用 200ms CSS 过渡、关闭时 inert/aria-hidden，助手菜单独立 portal，避免动画定位与层叠问题。

`src/Workspace.test.tsx` 与 `src/ui/chat/MessageList.test.tsx` 共 31 项定向测试通过，前端构建通过；独立审查发现的菜单层级与焦点回退问题已修复并复审。内置浏览器检查了宽屏让位、720×520 覆盖（输入框 x/width 开关前后相同）、浅深主题、菜单和三级 Escape、外部点击、隐藏状态及 reduced-motion。未进行本机 Tauri 桌面交互验收或真实供应商请求，这些不由浏览器检查替代。

后续交互修正：按用户反馈移除导航的外部点击遮挡层，正文点击与输入不再强制关闭导航；23 项工作区回归（含展开双栏后直接聚焦、输入且保持展开）及构建通过。该规则替代上方初版验收中的外部点击关闭行为。

## Application identity and existing development data

2026-09-20 本地收尾验证：全量前端 386 项、Rust 20 项测试通过，TypeScript/Vite build、Rust check 通过。Chat 摘要的回归断言改为验证禁用且未选中；Markdown 覆盖 LF/CRLF、硬换行、代码、公式及跨行引用。独立 Edge 浏览器在 720/1280 宽度检查用户/助手/摘要，修正用户消息换行叠加后两行正文均占两行，无页面异常。

本机迁移在应用关闭后完成，自动重载曾生成的新目录先保留为带时间戳的备份；旧 Roaming/Local 目录迁移前后分别 3/2172 个条目的路径、大小、修改时间一致。`tauri dev` 启动后通过实际 WebView 检查设置/聊天导航、输入与清空、刷新恢复：3 个助手、11 个对话及 11 份聊天记录的计数保持一致，无页面异常。仅统计记录数量，不读取凭据或聊天内容，不发供应商请求。上述结果不覆盖附件/背景逐项预览、安装包、升级或开发到生产 origin 的数据迁移。

首次 Alpha 的应用标识为 `io.github.ayaseminami.ayasestudio`，替代未发布开发版的 `io.github.ayaseminani.ayasestudio`。后续发布不得将标识当作可随意修改的显示名称。

Windows 旧开发数据需要同时处理以下两个目录：

| 内容 | 旧目录 | 新目录 |
| --- | --- | --- |
| 附件、背景及数据锁 | `%APPDATA%/io.github.ayaseminani.ayasestudio` | `%APPDATA%/io.github.ayaseminami.ayasestudio` |
| WebView 配置、localStorage、IndexedDB | `%LOCALAPPDATA%/io.github.ayaseminani.ayasestudio` | `%LOCALAPPDATA%/io.github.ayaseminami.ayasestudio` |

这是首次发布前的本机维护步骤，不是应用自动迁移。修改标识前先停止开发监听器，避免配置热重载自动创建新配置目录。迁移前关闭 Ayase Studio、开发启动器及使用任一配置目录的 WebView2 进程；检查两个来源、两个目标和目录占用。目标已有数据时停止，不覆盖、不合并；若确认采用旧数据，可先将两个目标目录分别改名为带时间戳的备份，完整保留新目录内容。将同一父目录内的旧目录重命名为新目录，保留全部内容，不解析聊天或凭据；若第二个目录改名失败，回退第一个及已移动的备份。迁移前后按相对路径、文件大小和修改时间核对文件清单，成功后才启动新标识版本。不要把目录内容或包含用户文件名的详细清单写入 Git 或报告。

应用保存的是附件/背景稳定引用，原生层通过新的 `app_data_dir()` 重新解析路径；WebView 配置随整目录迁移。目录清单一致只证明文件未遗漏，启动成功也不能替代聊天恢复、配置、附件和背景的实际交互验收。开发 origin 与生产 origin 可能隔离存储，不能承诺开发聊天自动成为安装版聊天；安装版升级保留须使用同一发布标识与生产 origin 单独验证。未发布的旧开发版不能在迁移后继续使用，以免重新创建旧目录并形成两份数据。

## Application icon

图标母版为 `assets/branding/ayase-icon.svg`。应用导航与网页 favicon 直接引用该 SVG；
Tauri 打包使用 `src-tauri/icons` 中的 PNG、Windows `icon.ico` 和 macOS `icon.icns`，
路径已由 `src-tauri/tauri.conf.json` 的 `bundle.icon` 配置。
修改母版后运行 `python assets/branding/export.py`（需要 Pillow 及已安装的项目 npm 依赖），
统一重建预览、ICO 和现有桌面打包资源。不要只修改生成的某一张 PNG。
已有 EXE 不会随资源文件自动更新，需重新构建；Windows 图标缓存可能延迟显示变化。
正式安装包和任务栏外观需另行实机验收。

当前 Beta 阶段只发布 NSIS 安装程序（setup EXE），暂不发布 MSI。统一运行
`npm.cmd run build:windows` 构建 NSIS 包，输出位于
`src-tauri/target/release/bundle/nsis`。应用及安装包版本使用 `0.1.0-beta.N`，首个 Beta 基线为 `0.1.0-beta.1`；
每次成功打包会保留 Tauri 标准文件，并复制一份带本机日期时间后缀的安装包，
例如 `Ayase Studio_0.1.0-alpha.3_x64-setup_20260930-205336.exe`；若同一秒重复打包，
文件名会追加序号以保留每份产物。
若内部临时测试 MSI，Tauri 要求 MSI 预发布标识为数字，因此 alpha／beta 字符串版本不能用于 MSI。
仓库默认 bundle target 与打包脚本均限制为 NSIS。
`bundle.windows.nsis.installerIcon` 和 `uninstallerIcon` 显式指向 `icons/icon.ico`；
它们控制 NSIS 安装/卸载程序自身图标，区别于 `bundle.icon` 控制的应用图标。
MSI 文件在资源管理器中通常显示 Windows Installer 的文件类型图标。
仅修改安装器配置且已有当前源码对应的 release 程序时，可运行
`npm.cmd run tauri -- bundle --bundles nsis` 重新封装；此命令不编译源码，
不能代替代码或应用资源变更后的完整打包。

## Supported development environment

Ayase Studio 当前以 Windows 桌面端为首要目标。按照 [Tauri 2 官方先决条件](https://v2.tauri.app/start/prerequisites/)，Windows 开发环境需要：

- Microsoft C++ Build Tools，并安装 `Desktop development with C++` 工作负载。
- Microsoft Edge WebView2 Runtime。
- 通过 `rustup` 安装的 Rust 工具链。
- Node.js LTS 与 npm。

2026-09-14 的已验证本地环境如下。这是已知可工作的参考组合，不是当前由仓库强制锁定的最低版本：

| Tool | Verified version |
| --- | --- |
| Node.js | `v22.22.3` |
| npm | `10.9.8` |
| rustc | `1.96.0` |
| cargo | `1.96.0` |

前端依赖由 `package-lock.json` 锁定，Rust 依赖由 `src-tauri/Cargo.lock` 锁定。不同机器首次安装时应使用锁文件，不要手工复制 `node_modules`、`target` 或构建目录。

## First checkout

```powershell
git clone https://github.com/AyaseMinami/AyaseStudio.git
Set-Location AyaseStudio
git switch dev
npm.cmd ci
```

PowerShell 如果禁止执行 `npm.ps1`，请继续使用本项目文档中的 `npm.cmd` 命令。

启动完整桌面应用：

```powershell
npm.cmd run tauri dev
```

首次 Rust 构建可能需要几分钟；后续增量构建通常更快。`npm.cmd run dev` 只启动 Vite 页面，聊天网络层依赖 Tauri HTTP 插件，因此日常功能调试应优先使用 `tauri dev`。

## Daily cross-machine workflow

以下是需要同步机器时的人工操作示例，不是代理每次任务的启动脚本。先检查工作区；仅在任务需要同步且现有修改可安全保留时更新 `dev`，依赖未变化时无需重复安装：

```powershell
git status --short --branch
git switch dev
git pull --ff-only origin dev
npm.cmd ci
```

如果 `git status` 显示未提交修改，不要直接拉取、重置或覆盖。先确认这些修改属于哪台机器和哪个任务，再决定继续完成、提交，或向用户请求处理方式。

办公室与家里之间通过 Git 远端交换已检查的工作。提交、推送和 PR 操作需要用户明确授权；已有授权涵盖本次操作时不重复询问。没有授权时完成本地工作并报告待同步状态。

当前分支约定：

- `main`：稳定基线与阶段版本。
- `dev`：日常集成开发分支。
- GitHub Issues：记录需求范围、验收标准和依赖。
- 达到一个可发布阶段后，通过 Pull Request 将 `dev` 合并到 `main`。
- 除非用户明确要求，不为普通工作额外创建分支或 worktree。

## Local credentials and live probes

Issue #14 / #37 的定向回归可运行 `npm.cmd test -- src/chat/messageOperations.test.ts src/chat/useChatSession.messages.test.tsx src/chat/useConversationWorkspace.test.tsx src/ui/chat/MessageList.test.tsx`。其中使用合成模型、附件存储与 transport，覆盖保存保留历史且不清理附件、编辑并发送、取消确认、截断重发、停止/失败、分支附件引用、配置与生成归属；不消费供应商 Token。配合 `npm.cmd run build` 做类型与打包检查。界面验收关注确认框、键盘访问、窄窗口、复制原文及分支后附件预览；消息编辑区还需检查黑色/深色、自定义背景和浅色主题下的文字、边框与按钮可读性。

应用内连接的 API Key 保存在本机 WebView 的版本化 localStorage 配置中。供应商只是分组；每条连接独立保存名称、协议、Base URL 与 Key，并拥有自己的已添加模型列表。助手默认模型与当前对话模型引用分别保存在 Dexie 助手记录和对话完整快照中；发送通过对话模型所属连接原子地解析请求协议和凭据。旧全局模型 ID 仅作为首次助手迁移的输入。旧版单模型连接与 `ProviderProfiles` 会由应用确定性迁移，开发和测试不应手工复制其中的真实值。

“获取模型列表”和“测试模型”都是用户显式触发的真实网络请求。前者只更新所选连接的临时候选目录，用户仍需逐个添加；后者发送一条极短请求并显示首段与总耗时，可能产生少量 Token 或中转站费用。应用不自动探测、批量测速或在失败后改路重试。

连接编辑器保留用户输入的 Base URL，同时显示协议归一化后的地址和最终生成端点。OpenAI Chat/Responses 的根地址自动补 `/v1`，非根自定义路径保持原样；Gemini 和 Anthropic 在其地址下追加各自版本路径。Gemini 只有在该连接的模型被明确选为当前模型后才显示完整端点。非法网址、非 HTTP(S) scheme、查询参数、片段和 URL 内的用户名/密码会在目录、测速或聊天网络请求之前报错；不要为了兼容性手工试探备用路径。端点预览不显示 API Key 或请求头。

真实中转站配置只存放在 `.env.probe.local`。每台机器分别从示例文件创建：

```powershell
Copy-Item -LiteralPath .env.probe.example -Destination .env.probe.local
```

填写本机文件后运行真实兼容性探针：

```powershell
npm.cmd run probe:live -- --disableConsoleIntercept
```

规则：

- `.env.probe.local` 已被 Git 忽略，不应强制添加或粘贴到 Issue、PR、日志和聊天记录中。
- 探针会消耗少量真实模型 Token，只在用户明确授权该次真实调用范围后运行；技术上需要验证不等于已获授权。
- 429、500、畸形 SSE 与取消行为由确定性测试覆盖，不需要用真实服务制造故障。
- 远程凭据和消息内容使用 HTTPS；明文 HTTP 仅允许 `localhost` 与 `127.0.0.1` 调试。

## Local appearance assets

Issue #30/#33：助手气泡支持独立颜色和 0–100% 透明度（默认 6%），用户气泡仍跟随强调色。背景选择打开中心取景弹窗，参考框可拖动、允许超出图片边缘，图片可缩放 25%–400%；“恢复居中”恢复中心与默认缩放，确认后保存，取消不改当前背景。窗口比例变化时围绕保存的中心重新取景，不固定裁掉原图。填充/适应决定基础大小，遮罩与模糊继续独立。

2026-09-21 早期裁切版曾通过 32 项定向测试、构建、Rust check 和浏览器检查；这些结果不作为后续中心取景版的验证证据。中心取景版按用户明确要求不运行测试、构建或浏览器验收，只做 TypeScript 与 diff 静态检查。后续如需验收，重点检查不同窗口比例、自由超框和留白、缩放、确认/取消与持久化恢复。原生选图、asset URL 与桌面重启的实际交互仍未验证。

自定义背景只支持 PNG、JPEG 和 WebP，单文件上限为 20 MB（20,000,000 字节）。原生文件选择器在 Rust 命令内完成选择、大小检查、内容格式识别和完整解码，再把副本写入应用数据目录的 `backgrounds` 子目录。React 只收到 `backgrounds/<uuid>.<ext>` 稳定引用与应用私有副本路径，不接收或持久化用户所选原文件的绝对路径。

偏好设置保存在现有版本化外观 localStorage 记录中；图片本体不进入 localStorage、聊天、供应商请求、日志、测试快照或 Git。启动恢复会重新校验私有副本；缺失、损坏或无效引用会清空并回退到基础主题。替换、移除与启动整理只删除该专用目录中符合 Ayase Studio UUID 命名规则且不再被偏好引用的副本，不修改原文件，也不处理目录中的非受管文件。

涉及这条能力的变更除前端测试外，还应运行 Rust 单元测试，并在 `npm.cmd run tauri dev` 中实际验证文件选择、重启恢复、替换、移除、浅色/深色切换，以及 720×520 最小窗口下的可操作性。单纯启动进程不算完成交互烟雾测试。

## Assistant/conversation regression checks

Issue #21 快捷选模定向验证：`npm.cmd test -- src/chat/modelSwitch.test.ts src/Workspace.test.tsx src/chat/useChatSession.messages.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。检查顶部弹窗搜索、连接/协议分组、选中标记、Escape/Tab、窄窗口；保存仅影响当前会话，正在生成的目标不变，下一次请求同步切换连接和协议。测试使用合成配置，不调用真实供应商。不可用的思考选项切回后不自动恢复；四种协议的联网开关均可用。

Issue #25 紧凑布局补充：图标在助手名称左侧，采样与预算字段按表单可用宽度自动分列，自定义数值位于对应选项下方。高级 JSON 默认折叠，校验错误时保持展开；恢复默认配置位于固定底栏。内置浏览器检查了 1280×900、720×520 和 480×640，确认自动减列、无横向溢出以及图标/自定义数值操作；JSON 折叠、错误可见与草稿保留由工作区定向测试覆盖。

Issue #25 的定向回归使用 `npm.cmd test -- src/Workspace.test.tsx`，再运行 `npm.cmd run build` 和 `git diff --check`。覆盖助手菜单导航隔离、排序、默认助手删除限制、Escape 焦点返回，以及弹窗取消/关闭丢弃草稿；既有保存、迁移和生成归属测试保留。2026-09-20 本地 18 项工作区测试及构建通过，内置浏览器完成浅色/深色与 720×520 检查：居中弹窗、固定标题和操作栏、表单滚动、Tab 焦点循环、取消不保存、菜单键盘入口，以及两栏标题/新建按钮/首行对齐均通过。未调用真实供应商；原生截图接口失败后按用户要求停止 computer-use，桌面实际效果由用户验收。此项仅调整 React/CSS 界面，不运行全量协议或 Rust 测试。

助手与对话存储沿用 Dexie v3；不要手工清除真实 WebView 数据来模拟升级。历史 v1/v2 升级将 current 配置转入默认助手，将旧对话参数和模型引用存入本地 `legacyConversationConfigs` 备份，不重新启用该备份作为请求配置，也没有 UI 恢复入口。当前初始化对没有 `settings` 的对话一次性合成所属助手设置与旧覆盖，保存完整快照；已有快照不随助手修改或重启刷新。`src/chat/workspace.test.ts` 用真实旧表形状验证升级、备份、重复初始化、回滚及安全删除；工作区用模拟 transport 验证对话配置隔离和切换期间的请求归属，不访问真实 Provider。

交互验收包括助手创建/编辑/排序、对话新建/切换、标题与配置编辑、独立对话配置与请求冻结、删除助手时迁移/永久删除分支，以及重启恢复。宽窗口和 `720×520` 均检查助手左栏与对话右栏的横向级联、独立滚动、整体联动收起与恢复、只收起对话栏、选择对话后保持展开，以及输入区和停止操作。侧栏采用本文 #27 的宽屏让位、窄屏覆盖规则。早期原生截图返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)` 后停止了 computer-use；该历史记录不代表当前交互验收已完成，启动成功不计作交互验收通过。

内置浏览器已通过真实点击验证助手创建、新建对话及系统指令继承；刷新阶段开发服务连接中断，内置浏览器错误页被 URL 策略拦截，因此没有把刷新恢复或窄窗口视觉检查标为通过。重启恢复和删除分支已由确定性测试覆盖，仍需用户桌面验收。

## Commands reference

供应商排序与浮动菜单补充：用户确认只对供应商排序，增加拖动手柄及菜单上移/下移。定向命令为 `npm.cmd test -- src/chat/settings.test.ts src/App.test.tsx src/ui/settings/SettingsWorkspace.test.tsx`；覆盖顺序持久化、模型/连接选择保持、拖动落下及菜单边界。2026-09-20 的 33 项用例及构建通过；内置浏览器通过实际鼠标拖动观察到插入提示、落下后顺序改变，菜单上下移可用且不撑高分组。此为当前用户对 #26 范围的补充，未更新远端 Issue。

Issue #26 连接页的定向验证：`npm.cmd test -- src/App.test.tsx src/ui/settings/SettingsWorkspace.test.tsx`，配合 `npm.cmd run build` 和 `git diff --check`。检查分组折叠不改变连接/模型选择、同供应商多连接、菜单重命名与删除焦点、模型编辑未保存切换确认、接口折叠后模型管理可用、请求地址默认折叠且校验错误可见。视觉验收检查浅/深主题、1280×900 与 720×520、长名称及左右独立滚动。此项沿用连接存储与协议接口，不需重复全量协议或 Rust 测试；无真实供应商请求。

2026-09-20：23 项 App/设置定向测试和生产构建通过，独立审查无遗留问题。内置浏览器使用独立本地来源的无密钥样例配置，验证非当前连接重命名不切换详情、同供应商同协议连接创建、接口折叠后添加模型、刷新恢复，以及 720×520 浅/深主题和 1280×900 浅色布局。窄窗口页面、导航、详情及模型编辑表单均无横向溢出；未调用真实供应商，未将浏览器检查表述为原生桌面交互验收。

Issue #19 的最小定向验证：`npm.cmd test -- src/ui/chat/ChatLayout.test.tsx` 和 `npm.cmd run build`。检查默认窄屏、生成中切换及重新挂载恢复；浏览器在 1440×900 和 720×520 下检查消息列/输入框同步伸缩、侧栏保持、无页面横向溢出和刷新恢复。此项仅改变前端布局偏好，无供应商请求或原生窗口行为改动。

Issue #15 的定向回归：`npm.cmd test -- src/chat/SafeMarkdown.test.tsx src/ui/chat/MessageList.test.tsx src/ui/chat/SearchResults.test.tsx src/chat/useChatSession.messages.test.tsx`。全量门禁使用下表命令。数学排版检查三处消息展示、浅深主题、窄窗口局部横向滚动及刷新恢复；本轮按用户要求用浏览器验证，不使用 computer use。KaTeX CSS/字体须与 rehype-katex 实际使用的引擎版本一致，可用 `npm.cmd ls katex` 检查；不加载 CDN 字体。

2026-09-19 验证：全量前端 365 项、Rust 20 项测试通过，TypeScript/Vite 生产构建与 Rust check 通过。使用 Playwright 驱动本机 Edge 的独立无头浏览器验证实际消息页面及生产预览：用户/助手/摘要公式、720×520 与 1280×900、浅深主题、长公式局部滚动、刷新恢复和本地字体加载通过，无页面异常；未使用 computer use、未访问真实模型，也未将浏览器验证表述为原生桌面交互验收。

短公式滚动条回归：KaTeX `.vlist-t2` 的负右边距会产生 2px 的排版溢出，行内公式滚动容器需为其留出右侧空间。浏览器检查 `a_n`、数列上下标、极限与分式等用户/助手消息：修复前 20 个短公式中 12 个满足 `scrollWidth > clientWidth`，修复后为 0；720/1100 宽度、浅深主题及 100%/125%/150% 缩放均通过。长行内和独立公式仍可局部滚动，消息容器不溢出。此项依赖真实浏览器布局，不能由 happy-dom 渲染测试代替。

| Purpose | Command |
| --- | --- |
| Tauri desktop development | `npm.cmd run tauri dev` |
| Unit and integration tests | `npm.cmd test` |
| Test watch mode | `npm.cmd run test:watch` |
| TypeScript and Vite build | `npm.cmd run build` |
| Persistent data registry and checker regressions | `npm.cmd run check:data-contracts` |
| Frontend check bundle | `npm.cmd run check` |
| Rust compile check | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Production desktop bundle | `npm.cmd run tauri build` |
| Live provider probe | `npm.cmd run probe:live -- --disableConsoleIntercept` |

## Required verification before handoff

纯文档修改检查内容、相对链接和 `git diff --check`，并查看 `git status --short --branch`；无需构建、启动桌面或运行真实探针。普通代码修改默认运行：

```powershell
npm.cmd run check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short --branch
```

涉及 Tauri 权限、运行时网络、窗口、主题首屏或本地文件能力时，还要运行：

```powershell
npm.cmd run tauri dev
```

并完成与修改范围相称的桌面烟雾测试。真实 API 探针仅用于确有需要且用户已授权的兼容性验证。检查通过后，只有相关修改、失败或新的疑点才需要扩大或重复检查。

## Troubleshooting

- `npm` 被 PowerShell 执行策略拦截：改用 `npm.cmd`。
- 首次构建长时间编译 `build-script-build.exe`：通常是 Cargo 正在编译依赖；核对其路径位于本仓库的 `src-tauri/target` 后再判断安全软件告警。
- `failed to run light.exe`：按照 Tauri 官方文档检查 Windows 的 VBSCRIPT 可选功能；它只影响 MSI 打包。
- 页面能打开但发送失败：确认使用的是 `npm.cmd run tauri dev`，而不是单独的 Vite 浏览器页面。
- 新机器行为不一致：先比较 Node、npm、rustc 和 cargo 版本，再确认使用了当前锁文件执行 `npm.cmd ci`。

## Related documents

- [Architecture and project structure](ARCHITECTURE.md)
- [v0.1 plan](PLAN.md)
- [Protocol compatibility contract](PROTOCOLS.md)
- [Persistent data contracts](DATA-CONTRACTS.md)

## Conversation configuration and deterministic checks

Issue #16 思考扩展可针对运行 `npm.cmd test -- src/chat/thinking.test.ts src/ui/chat/Thinking.test.tsx src/Workspace.test.tsx src/chat/transport.test.ts src/chat/requestMapping.test.ts src/chat/geminiThinking.test.ts`。覆盖任意模型 ID 的协议映射、默认字段省略、显式摘要偏好、协议配置隔离、预算和采样组合原样发送及数值结构校验、流式与非流式摘要分离、关闭摘要、Responses 重复/最终事件、完整错误正文/状态与凭据脱敏、失败和历史不回传摘要。默认代码门禁仍为 `npm.cmd run check` 与 Rust check。

交互验收检查 Chat 的摘要能力提示、Responses 独立摘要开关、Anthropic 模式与 effort 独立选择、预算应用、切换型号后思考选项与预算保持不变及重启恢复；在浅色/深色和 720×520 下确认弹层可滚动且输入区常驻高度不变。真实供应商调用需要授权，不能用自动重试绕过参数错误。只启动桌面程序不能算完成交互或联网验收。

2026-09-19 本地内置浏览器以无密钥配置手动添加 `claude-opus-4-6`，实测灯泡弹层、预算选择、720×520 浅色/深色布局和刷新后配置恢复通过。`tauri dev` 编译并启动桌面进程成功；当前工具的原生窗口控制不可用，未将原生交互或真实线路验收记为通过。

Gemini 思考首版的针对性检查可运行 `npm.cmd test -- src/chat/geminiThinking.test.ts src/ui/chat/Thinking.test.tsx src/chat/transport.test.ts src/chat/requestMapping.test.ts src/chat/sessionStore.test.ts src/Workspace.test.tsx`，再运行前端构建和 Rust check。输入区底部附件与思考图标同排，点击灯泡向上展开强度列表，摘要勾选位于弹层内的独立分区；Escape 关闭并将焦点还给灯泡，点击外部或 Tab 离开时收起。Issue #28 起快捷菜单保存当前对话配置；自定义预算需要点击“应用预算”，助手编辑器内则仍需“保存助手”。验收应检查协议选项、切换型号后选择和预算保持不变、独立摘要开关、流式摘要折叠、停止后保留内容及重启恢复。模拟 transport 的验收不代表真实中转站兼容性已验证。

按用户最新确认，助手仅提供新对话模板，每个对话独立保存模型、系统指令、生成参数、思考、搜索和四协议 JSON。铅笔入口统一编辑标题和配置；底部“恢复助手默认值”将助手当前设置复制到草稿，保存才生效，取消不写入。清空消息保留设置，分支复制配置，迁移助手仅改变归属。发送从对话快照读取，修改助手不影响已有对话。

Issue #28 完整快照调整的定向检查包括 `src/chat/conversationConfig.test.ts`、`src/chat/workspace.test.ts`、`src/chat/useConversationWorkspace.test.tsx`、`src/chat/useChatSession.messages.test.tsx`、`src/Workspace.test.tsx` 与配置相关 App 用例，再运行 `npm.cmd run build` 和 `git diff --check`。重点验证旧记录一次性转换、重启不刷新、清空/分支/迁移保留配置、恢复草稿及取消、模型失效阻止发送、运行中冻结。无需 Rust 或协议全量测试，不调用真实供应商。

2026-09-20 早期稀疏覆盖版的 49 项用例与浏览器验收属于历史记录；同日按用户确认改为完整对话快照，最新验收以完整快照语义为准。

完整快照版验证：存储/迁移、工作区、请求编排、思考控件与 7 项 App 配置用例定向通过，生产构建通过，独立审查无遗留 P1/P2。内置浏览器确认旧配置转换后模型和参数保留、所有逐项来源提示移除、独立设置刷新保留、恢复可取消及保存后生效。没有运行全量测试、调用真实供应商或进行原生截图验收。

本地输入预算是 Token **估算**，不是供应商公布的模型上下文上限。已知 OpenAI 模型按对应本地 BPE 分词，未知或非 OpenAI 模型按 UTF-8 字节保守估算；消息封装开销仍可能与供应商计费值不同。真实中转站若出现传输差异，应先核对官方协议，再把中转站观测单独记录。桌面烟雾测试需要实际操作配置面板、非流式停止、协议切换与恢复，单纯启动 `tauri dev` 不构成交互验收。

## Concurrent conversation checks (Issue #53)

Run `npm.cmd test -- src/chat/generationTasks.test.ts src/chat/useChatSession.concurrency.test.tsx src/chat/useChatSession.messages.test.tsx src/chat/useChatSession.attachments.test.tsx src/chat/useConversationWorkspace.test.tsx src/Workspace.test.tsx`, then the default code gate. Deterministic transports control A/B event ordering without real credentials or provider tokens. Verify simultaneous sends, isolated text and terminal persistence, current-conversation Stop, same-conversation duplicate rejection, preparation failure, final-save ownership, deletion protection and unmount cancellation. App tests also exercise sending from B while A is still generating. These checks do not establish live-provider throughput or native desktop interaction acceptance.

2026-09-26 内置浏览器行为验收通过：在独立本地 origin 上使用合成配置和可控 SSE，保留真实 App、任务管理、IndexedDB 和 OpenAI Chat 协议解析，仅替换 Tauri 网络入口。通过页面结构读取及键盘操作确认 A 生成时 B 可编辑历史并发送、双任务同时生成、停止 B 不影响 A、A 失败或完成不解除 B 的生成保护，以及刷新后独立恢复消息与终态。未使用截图；浏览器点击接口报错，因此本轮不声称验证了鼠标点击路径或视觉布局。未读取真实密钥、调用供应商或验证原生窗口；临时验收文件和服务已清理。

## Attachment checks (Issue #5)

Windows 窗口禁用 Tauri 原生路径拖拽截获，使用 HTML5 `DataTransfer.files` 获取实际拖入的 `File`，不向原生命令传送任意来源路径。

已发送但后来因清空或删除而无主的附件不会立即永久删除：先移动到私有隔离目录，仍可凭引用预览；至少 30 天后经过两次间隔一小时以上的无主引用扫描才彻底回收。打开时可读取隔离副本，重新扫描有主引用可恢复活动副本。发送前新副本位于私有暂存目录；聊天记录提交失败或发送前中止时立即删除，成功提交后副本可凭引用读取，启动或后续引用整理时转入活动目录。异常退出后，已发送副本仍可从暂存目录读取并恢复；无主暂存副本会被清理。清理失败不得伪装成消息保存失败。

输入框左下角的附件按钮、拖入聊天区域和粘贴图片仅形成本次运行内的当前对话草稿。草稿只保留 `File` 句柄和元数据，仅读取一小段格式头识别 MIME，不提前读入或缓存整图 Base64。第一阶段只提供 PNG/JPEG/WebP/PDF/TXT/Markdown，文本须能作为 UTF-8 文本映射；不设统一的单文件 10 MB 或单消息 20 MB 应用上限。图片后缀与内容不一致时使用识别出的实际 MIME；本地不完整解码图片，也不因图片/PDF 无法在本地解析而预先拒绝，供应商可能自行拒绝不合规内容。选择/拖入不会联网或留下永久副本；点击“发送”才逐项完整读入文件、复制到应用私有暂存目录并和文本一起进入本次请求；每项读取后检查中止。新用户消息写入数据库成功、原生层核对全部副本可访问且大小一致后才开始网络请求；这一步不在 JS 重新加载图片。发送后的历史消息只持有私有副本引用及元数据，不在对话状态中缓存图片字节；一次请求和打开的预览短暂在内存中持有内容，请求结束或关闭预览后不建立长驻缓存，具体回收时点由运行时决定。已发送消息上的附件按钮只读打开图片、文本/安全 Markdown 或按页本地 PDF.js 预览；原文件删掉后仍应能读出。清空和删除对话会按所有对话仍持有的引用清理副本，不能误删其他对话共用的引用。桌面主窗口仅在取得应用数据锁后创建，重复启动通常聚焦已有窗口，避免跨进程误删暂存文件。

本地确定性测试和 Rust 单元测试覆盖校验、协议映射、存储、草稿不跨重启、引用清理和预览入口。桌面烟雾测试要亲自验证文件选择、Windows 文件拖入、图片粘贴、仅在点击发送后发起一次请求、出错后的预览以及 PDF 页面渲染；不读取实际密钥或花费真实 Token 时，可先检验草稿和本地保存/预览，联网请求仍标记未验证。

## Issue #6 定向验证

本次按用户要求不运行全量测试；只检查搜索解析、引用 UI、会话保存/手动续接，再运行 `npm.cmd run build`、`cargo check --manifest-path src-tauri/Cargo.toml` 和 `git diff --check`。外链新增 Tauri opener 权限；Gemini 建议需要在浏览器与桌面实际检查容器布局及外链。进程启动不代表桌面交互通过，真实供应商探针仍需单独授权。实施范围见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。
