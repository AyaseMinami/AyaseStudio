# Ayase Studio Architecture

## Persistent data contracts (#105)

[DATA-CONTRACTS.md](DATA-CONTRACTS.md) is the development contract for persisted records and backups. `src/storage/dataRegistry.ts` registers all 13 current Dexie tables and 8 persistent preference keys, including exclusions and legacy sources; its module data versions are independent of the application version, Dexie schema version, backup document version and encryption envelope version. `src/storage/dataPolicies.ts` uses exhaustive `FieldPolicy<T>` declarations against the actual persisted types and nested records. `backupFields` feeds the real allowlist projections in `src/backup/snapshot.ts`; a registration alone does not validate resources or arbitrary extension objects.

`src/storage/dataContract.ts` owns pure clone-based stepwise migration. Search v1 → v2, connections v2 → v3 and strict session reads share this seam. Workspace initialization preflights persisted assistant/conversation/history configuration inside its transaction before publishing defaults or repairing rows. Unsupported structural configuration aborts initialization and preserves existing rows. Missing legacy fields receive only their explicitly approved defaults; failed reads never authorize writing those defaults over original data.

Normal startup repairs any restore journal, strictly reads current connections, then mounts business controllers; a failed read keeps them unmounted. The `#backup` maintenance root can perform an explicitly confirmed complete replacement of incompatible configuration with validated connection/credential data; prior raw values remain journal-protected and rollback on failure. #93 replaces the broad drawing-data/configuration ban with coordinated maintenance and active-work checks. Historical Dexie schema v3 preflights only the session/model fields it moves inside its upgrade transaction; refusal retains the old schema and rows, without claiming blanket validation of every old-schema field.

New backups use document v5 and unchanged envelope v1. Documents v1–v4 retain their original strict contracts, including v4's fixed seven modules. Optional `drawing.settings` and `drawing.presets` declare their scopes separately, with matching `drawingSettings` and `drawingPresets` module stamps; new exports include both. Known module stamps, `minimumReaderVersion` and `requiredCapabilities` delimit readability. `src/backup/compatibility.ts` permits filtering only declared optional session or drawing-setting parameter areas of a compatible future module; protocol maps, security, credentials, resource references, preset structure and outer structure remain strict. Budget checks precede cloning and normalization; full semantic/resource validation precedes a restore plan and any persistent writes. Filtered paths carry no discarded values. The private compatibility preference participates in journal rollback and preserves later export warnings; source backup files are never rewritten. See [the format contract](AYASE-BACKUP.md), [#105 foundation](ISSUE-105-IMPLEMENTATION.md) and [#93 implementation/remaining gates](ISSUE-93-IMPLEMENTATION.md).

Drawing drafts and prompt presets are registered as `projected`. `projectedBackupTables` is a separate static inventory from portable `backupTables`, backed by the real field-policy projections. Settings export only aspect ratio, resolution, configured model ID, OpenAI size/quality, optional Gemini temperature/safetyThreshold/outputMode, count, concurrency, completion sound and optional reused protocol; explicit presets export their five text/identity/timestamp fields. Automatic draft prompts, references, task/result/image history and native pending-save receipts are excluded. The raw current draft and presets belong only to the private restore journal for rollback, never to portable rows. #93 adds no Dexie schema version. Local and backup drawing readers share clone-based defaults and strict validation; an invalid local draft fails before controller task recovery. Editable OpenAI custom-size strings survive persistence without a new per-field length limit; generation transport validates dimensions, and portable documents retain the overall budgets. #93 local code gates, focused regressions and independent Sol/high review are complete; #105 drawing integration and deterministic cross-version examples are supplied. Isolated browser restore verified draft retention and filtered-parameter/re-export warnings, and isolated Tauri compilation/startup was verified. Isolated browser visual acceptance is complete for light and dark/custom themes at wide and narrow viewports, with no horizontal overflow; #94 pressure/native window and dialog interactions/actual close-restart remain pending; see [the evidence record](ISSUE-93-IMPLEMENTATION.md).

## Drawing prompt presets and history reuse (#90)

Database version 8 adds only `drawingPromptPresets`; chat and drawing records stay intact. `src/drawing/presets.ts` exposes independent CRUD through a repository, stores only `{id,name,content,createdAt,updatedAt}`, preserves prompt whitespace and accepts independently identified duplicate names. `DrawingController` loads presets with drawing initialization, serializes explicit preset writes and waits for them during close preparation. Failed writes retain saved records; unreadable initialization never becomes an empty writable workspace. Applying a preset changes only draft prompt text and does not dispatch the queue. Editing the draft never updates a preset implicitly.

Task and result reuse share one controller implementation behind the reference lifecycle queue: restore prompt, validated configured target, only the matching protocol's options and ordered input descriptors; preserve the other protocol's independent draft options. Missing targets retain historical protocol controls with no automatic substitution. Missing input files are reported individually; history records remain unchanged. Copy uses the clipboard without loading a draft or generating. React preset dialogs hold temporary fields until explicit Save and retain them on failure; cancellation does not write. The historical pre-#93 backup gate included preset-only databases; #93 now coordinates maintenance and projects explicit presets. PNG export remains the #89 allowlist; old PNG import remains #92. See [implementation and verification](ISSUE-90-IMPLEMENTATION.md).

## Drawing results and ownership (#89)

Results persist independently of history; completed task provenance retains inputs, not unowned outputs. Deletion shares the reference queue, removes rows transactionally, then rereads and validates durable owners before scoped cleanup; damaged metadata/uncertain drafts prohibit cleanup. Whole output groups survive any owner; both completed cleanup routes reconcile manifest/pending identities and hashes. Native ≤256px PNG thumbnails and originals have separate visibility lifetimes. Explicit exports use frontend/native allowlists. Draft `reusedProtocol` preserves invalid historical target controls until explicit reselection. See [implementation and acceptance boundaries](ISSUE-89-IMPLEMENTATION.md).

## Drawing task lifecycle (#88)

`dispatching` is persisted before provider invocation; cancellation races settle locally once and late callbacks cannot commit. History management shares the reference lifecycle queue, while save retries and deletion reserve task ownership synchronously. Only `enqueue` creates rows; transactional `saveTask`/`complete` reject deleted rows. Regeneration freezes a new task with `sourceTaskId`, reuses an active replacement, and permits later independent actions. Native receipt inventory releases durable payloads; indexed local retry fills only missing receipt entries. Terminal history deletion preserves independent results and their references; explicit journal cleanup is scoped to unowned task outputs. See [recovery, failure memory and cleanup limits](ISSUE-88-IMPLEMENTATION.md).

### Background blur rendering (#96)

`BackgroundImage` accepts a blur radius in logical CSS pixels and keeps the existing `backgroundViewport` geometry independent of it. A layout-width observer converts the radius into SVG user units, excluding the fixed-preview stage transform. Nonzero blur samples the original image plus eight explicitly extended outer pixel strips/corners, applies an SVG Gaussian filter, and clips the result to the original image bounds. Explicit padding avoids relying on Chromium support for `edgeMode`; transparent source pixels retain their alpha. Outer background containers clip to the viewport. Zero blur bypasses the filter and padding. No image bytes, persisted focus/zoom, native permissions, or transport contracts change.

## Independent drawing module (#83 / #84)

#87 supersedes the single-active-task contract below: `DrawingController` atomically enqueues 1–99 immutable tasks through `DrawingRepository.enqueue`, with transaction-assigned FIFO order and 1–4 slots covering preparation/network/local save/DB commit. Preferences use optional draft fields without schema migration. A durable running marker precedes dispatch; restart repairs journals, restores preparing as queued, pauses queued work and never resends possibly sent tasks. Shared settings protection does not block chat sends. See [queue/recovery boundaries](ISSUE-87-IMPLEMENTATION.md); older #84–#86 notes below describe the baseline.

2026-10-01 [requirements audit](ISSUE-83-DRAWING-SPEC.md#14-2026-10-01-全面核对与需求修订) supersedes old candidate limits: planned batches 1–99/no extra queue-count cap, concurrency 1–4; task-local save failures do not pause subsequent work. Pure-text presets and complete history reuse load directly. Special terminal deletion needs an impact warning while independent saved results survive. #89 owns optional sanitized parameter PNG export; #92 later reads legacy PNGs. These remain follow-up requirements; the implementation contracts below describe current #84–#86 only.

#85 extends this module with `openai-images`, a dedicated Images generations adapter and explicit runtime dispatch. Shared service configuration includes both drawing protocols while `ChatProtocol` stays unchanged. `DrawingParameters` is a discriminated union; drafts retain independent Gemini and OpenAI option groups, and old drafts default to automatic OpenAI values. No database schema rewrite or new queue is introduced. Settings and dispatch share the OpenAI endpoint resolver; model catalogs reuse only the matching read-only client after drawing HTTPS validation. The pre-#93 backup gate initially protected both drawing protocol configurations; #93 supersedes it with coordinated maintenance. See [#85 contracts and validation](ISSUE-85-IMPLEMENTATION.md).

#101 adds optional Gemini temperature, safety threshold and output mode through drafts, frozen task/result parameters, history reuse and explicit parameter PNG export. Drawing settings export as module v2 with minimum reader 2; older missing fields retain the original defaults, without a database schema rewrite. Startup validates all saved task/result Gemini options before recovery writes or file operations. The two adapters accept bounded CR/LF and matching Base64 data-URL wrappers; OpenAI additionally accepts a single-object image response while retaining every image in standard arrays. Gemini has no borrowed prompt-length cap; OpenAI checks 32,000 Unicode code points in the trimmed submitted prompt. See [#101 contracts and evidence](ISSUE-101-IMPLEMENTATION.md).

The user confirmed drawing as the second business module beside chat, with shared provider/connection/model settings but separate protocol targets, drafts and task ownership. Drawing does not belong to an Assistant or Conversation. Concurrent chat/drawing is part of integration acceptance; image exchange is deferred to the existing #91. The approved #84 slice implements Gemini single-image generation; #85 adds OpenAI Images and #86 adds ordered reference inputs. The broader #83 queue/export proposals remain future scope.

#86 stores optional reference descriptors in existing drafts and frozen task/result parameters without a schema rewrite. Imports copy original PNG/JPEG/WebP/BMP bytes into `drawing/references/<UUID>.<ext>`; result reuse references an existing immutable result file. The controller serializes reference edits and draft persistence, and pins active inputs before asynchronous preparation. Explicit removal releases only imported files absent from the persisted draft, all tasks/results and active inputs; uncertain draft persistence prevents cleanup. Registered failed/cancelled/unknown tasks retain inputs. Startup does not scan or garbage-collect orphan references. Preview Blob URLs are released with the mounted reference view; generation reads original files in order and preserves raw bytes, dimensions and alpha. See [#86 implementation and acceptance](ISSUE-86-IMPLEMENTATION.md).

`src/drawing` owns a root-mounted controller, Gemini image transport, repository interface and transient preview. Navigating pages unmounts panels, not the controller. Shared `ServiceProtocol` adds `gemini-image`; `ChatProtocol` and chat target queries remain chat-only. Drawing drafts select their own configured model ID. A submission freezes parameters and a runtime-only Key, registers the task before dispatch, and makes one request without retries or fallback. Cancellation before dispatch is cancelled; possibly sent cancellation, network failure and HTTP 5xx are unknown. Saving becomes uncancellable local work. Failures remain visible on the generation page and preserve the prior preview.

Database version 7 adds `drawingDrafts`, `drawingTasks`, `drawingResults` without rewriting prior tables. `DexieDrawingRepository.complete` atomically registers all files/results and the completed task. Native `drawing.rs` owns immutable originals under `drawing/<task UUID>/`, image validation and ordinary PNG export. Before writing originals it durably publishes a bounded pending receipt with fixed file UUIDs and SHA-256; a complete receipt can publish the manifest after a crash. Matching local retries fill only absent files. Restart repairs receipts and DB registrations; a sent task without a receipt becomes unknown and is never resent. Incomplete local bytes remain save-failed. No generated-result cleanup/GC is introduced. File synchronization and reparse-point checks follow the existing host boundary; arbitrary hostile external-process races and Windows directory-entry survival after sudden power loss are not guaranteed.

Returned images awaiting disk persistence remain in memory for explicit local-save retry. Close preparation freezes new drawing commands and flushes drafts, waits for local saving or stops the request. Unsaved pixels require a separate explicit loss confirmation; refusal restores the editing gate. Blob previews belong to selected results and release URLs on changes/unmount. Ordinary export decodes/re-encodes PNG pixels without hidden generation metadata and cannot overwrite private app resources. The historical broad backup ban is superseded by #93: before reload, App synchronously gates chat and drawing commands, pauses drawing dispatch and drains prior writes and resource operations. Active drawing requests and chat generation/automatic naming must finish or be explicitly cancelled at their normal entry; maintenance never aborts them automatically. Memory-only unsaved images refuse reload, queued work survives, and failed preparation releases both gates and restores the prior pause state. Native startup fences drawing files alongside attachments/backgrounds before journal recovery, controller mounting or GC. Cold maintenance preserves stale persisted task markers for later ordinary drawing initialization; those markers do not imply a live request.

[The #83 specification](ISSUE-83-DRAWING-SPEC.md) records confirmed choices and reviewable proposals: a separate image-generation transport, application-owned queue (default concurrency 1, maximum 4), repository-owned durable drafts/tasks/results, immutable private image references, local result commit recovery, metadata-safe export and backup maintenance coordination. Results are saved automatically; ordinary export omits generation parameters. Restart restores data with dispatch paused, and possibly sent tasks are never retried automatically. Detailed lifecycle rules and budgets remain proposals until user acceptance; these planned contracts do not supersede current chat behavior.

## Object action menus (#74)

`src/ui/ActionMenu.tsx` owns the shared portal, viewport clamping, enabled-item keyboard navigation and dismissal/focus behavior. `useActionMenu<T>` stores only a local target ID/type, anchor and opener; owners derive menu actions from the latest workspace/settings snapshot on every render. Opening broadcasts the document-local `ayase:open-action-menu` event with a React owner ID, causing other hook instances to clear their transient menu state without restoring focus. No menu state or event is persisted or sent outside the WebView.

`ConversationNavigation` owns assistant and conversation commands, and `ConnectionSettings` owns provider/connection commands (tree and overview share one target). Existing management buttons and right-click share those definitions and existing confirmation paths. Conversation deletion hands focus to its inline confirmation button; other deletion flows retain their established dialogs. The workspace command queue remains the final generation guard; the UI additionally disables deleting a generating conversation or its owning assistant. Deleted/hidden targets and selection/context changes dismiss the menu. Rename forms retain normal Tab traversal and save only on explicit submit.

`BackupApp` installs the default context-menu policy for normal, recovery and backup views. It cancels `contextmenu` outside inputs, textareas and editable text, without cancelling event propagation, text selection or editing shortcuts. `bindDefaultContextMenuPolicy(document)` is also bound and cleaned up by `GeminiSuggestion` for its existing same-origin scriptless sandbox; iframe events do not bubble to the parent. Editable checks use DOM node type and closest editing ancestor across JS realms. Only the four object lists open custom menus; messages use existing buttons. No native permissions, repository contracts, schema, provider protocol or network behavior change. Native WebView edit-menu interaction acceptance is tracked separately from browser and deterministic tests.

## Exa external search (#80)

`src/search` owns one fixed search step before chat generation. The user's later revision adds independently configured Exa API and Exa MCP. Local configuration version 2 stores `exaApi` and `exaMcp` profiles under the existing `ayase-studio.search.v1` key; a legacy version-1 profile migrates in memory into MCP only, preserving its address/Key without writes or enabling API. Explicit card save merges that profile into the last saved configuration, preserving the other profile and its separate draft. API requires Key before save/test/send; MCP permits blank Key. Mount/save never probe. The finite MCP adapter performs initialization, fixed tool/schema confirmation and bounded JSON/SSE parsing; API performs one direct JSON `/search` POST. Both normalize bounded sources, reject redirects and never retry or switch providers. Arbitrary MCP/Agents/RAG remain excluded.

The session freezes mode and the selected profile with model configuration. Legacy `webSearch:true` means native; `webSearchProvider:"exa-mcp"` or `"exa-api"` selects external only when enabled, unknown values stay off. After configuration/mandatory-content/attachment preflight and commit, the same generation task searches once with only current trimmed user text. Failure/cancellation prevents answer and automatic naming. Retrieval success remains completed if final budgeting or answering fails. JSON external data enters only the latest user request copy and final context budget; original text/system/attachments stay intact. All four transports suppress native search parameters in external mode and Responses retains `store:false`.

Sources, excerpts and AST-validated `[ayase-source:<id>]` citations belong to each answer candidate. Code/math/HTML/link and escaped markers do not become badges. Original Markdown and UTF-16 positions stay stored; copy projects verified markers to numbered links. Ordinary future history projects them to source title/URL text and omits external provider replay, avoiding old excerpts/internal IDs reentering requests. Explicit Anthropic pause/resume retains its exact final request snapshot, attachment references and original sources, without another search or changed global settings. Continuations contain no Key/header/MCP Session.

Backup document v3 introduced both search profiles and API/MCP snapshots; #105 introduced v4 module compatibility metadata, and #93 now exports v5 with unchanged envelope v1 crypto. Documents v1–v4 remain importable under their original field contracts. Legacy absence and merge/copy preserve current search configuration. A v2 replacement applies only MCP and preserves local API; v3/v4/v5 replacement applies both profiles, preserving corresponding local Keys when credentials were excluded. The settings key participates in restore journaling/rollback. This is the approved exception to older client-search/MCP exclusions. See [implementation and verification](ISSUE-80-IMPLEMENTATION.md).

## Ayase backup and restore (#79)

`src/backup` owns the allowlisted versioned format, credential selection, Web Crypto encryption, bounded semantic/resource validation, snapshot mapping and restore journal. React never accesses Dexie. Database version 6 added `backupJournal`; #93 keeps schema v8 from #90. Settings retains Cherry migration beside the Ayase entry. Before entering maintenance, coordinated chat/drawing gates drain prior operations, and chat flushes every loaded `SessionStore`, including stores from conversations visited earlier; a failed flush keeps the user in Settings and reports an error. Entering Ayase maintenance then explicitly reloads the WebView; chat, drawing and resource controllers are not mounted there. Bootstrap fences previous native attachment/background/drawing operations and repairs any backup journal before normal UI, initial appearance or automatic cleanup; drawing's own receipt recovery follows in its ordinary initialization.

Export exposes only one default-off encryption switch and always includes connection configuration and credentials. `BackupExportOptions.encrypted` controls encoding and is kept out of document options; the version-1 envelope records the actual encryption state. Plaintext credentials are accepted on import and warned about in the UI. Passwords are confirmed by equality only, without length or character restrictions; empty matching passwords also work. The password is encoded as UTF-8 without trimming or normalization, and import accepts the same unrestricted input. Older backups excluding categories remain supported and replacement confirmation remains independent. The user confirmed this behavior as current, and remote Issue #79 now records the same requirement.

Restore checks new managed paths are absent, journals the prior database/preferences and all new references, writes/syncs new files, atomically commits portable tables and current drawing draft/presets plus journal phase, then applies supported preferences. Journal deletion is the cross-store commit point. Precommit errors/restart restore old database/preferences before removing exact reserved files; failed recovery keeps the gate closed. Older journals missing drawing snapshots leave drawing untouched. Merge/copy preserve current drawing settings; preset merge retains matching IDs, copy allocates new IDs and duplicate names remain independent. Replacement changes only included drawing categories, patches settings while retaining current prompt/references, and never clears drawing for old/missing modules. Model references use the shared mapping and require drawing protocols; preview reports unavailable retained draft targets and historical frozen provider/connection ID, protocol/address/upstream-model changes without rewriting history. Tasks, results, images and native pending-save receipts remain local, and no restore asset plan contains drawing paths. Old files are never overwritten and successful restore defers old-resource cleanup to existing owners. The native module shares attachment/background/drawing mutexes, canonical reference rules and image validation; it rejects existing links/junctions. File dialogs and atomic backup save contain only the already-encoded envelope. See [format and operation contract](AYASE-BACKUP.md) for budgets, conflict policy, missing references, source records and credential boundaries. Transport/provider contracts are unchanged.

## Cherry chat backup import (#77)

Legacy empty topics use their unique assistant-list membership when topic metadata retains a stale `assistantId`, with a preview warning even if the referenced assistant still exists. Duplicate topic membership and existing nonempty topic/message ownership conflicts remain errors; this exception neither drops topics nor changes source IDs.

`src/import/cherryMapping.ts` maps allowlisted native chat fields to an import plan, preserving every supported answer path as an independent conversation. `cherryImport.ts` stages and verifies files through the shared attachment lifecycle before `cherryRepository.ts` atomically commits assistants, conversations, chats and source markers. Database version 5 adds `cherryImports`; existing records and workspace selection remain intact. Failed precommit work discards only newly staged files. Postcommit cleanup failures retain committed data and report warnings. Source IDs, timestamps and unavailable attachment names are local provenance, never provider configuration.

Tauri exposes session-token-scoped ZIP selection, file reading and release. The read-only parsers accept pinned format 5 JSON, format 6 Chromium storage (1.9.13), and format 7 SQLite (2.1.3 with 26 exact migration fingerprints). Format 6 never treats incidental SQLite as authoritative. The native boundary rejects unsafe archive paths, damaged snapshots and excessive allocation, returns only chat fields, and reads attachments only from identified internal entries. It does not execute imported code, migration SQL or tools, read external paths, or download URLs. Import creates neutral assistants with no model binding and never sends a request or names conversations automatically. The settings panel owns preview selection and duplicate mode; it does not access Dexie. See [migration guide](CHERRY-IMPORT.md) and [implementation evidence](ISSUE-77-IMPLEMENTATION.md) for support and acceptance boundaries.

## Input history (#64)

`useConversationWorkspace` owns runtime-only input history within each conversation view: draft revision, caret selection, original draft, active candidate identity (message ID plus source text), and edited candidate copies. `inputHistory.ts` handles navigation and revision-guarded consumption against the current visible transcript; changed/deleted sources cannot overwrite modified unsent copies. Modified copies whose source disappeared remain temporary draft candidates, never persisted or restored to the transcript. Hidden round versions, assistants and attachment-only messages are not input history.

`Composer` handles unmodified, non-IME arrow eligibility and measures first/last visual lines using a temporary typography/width-matched DOM mirror, independently of textarea scroll. It reports selection separately from text edits, restores requested selection without taking focus, and suppresses stale selection events during history navigation. History navigation increments the same draft revision used by the existing async send guard. A committed recalled message restores the original only if that revision still owns the input; the captured workspace closure targets the originating conversation even after navigation. No repository schema, provider protocol or native host changes.

## Local background library (#70)

Original and thumbnail resolution use separate controller-lifetime caches keyed by immutable original reference, including in-flight reads. They hold asset URLs, not image bytes. Startup, application and restoration validate originals afresh; explicit preview retry bypasses the relevant cache. Cleanup evicts unretained references and destruction clears both caches.

Each original keeps its unchanged bytes and owns a derived PNG under `backgrounds/thumbnails/<original-filename>.png`, with a maximum 512-pixel edge, preserved aspect ratio/alpha and no upscaling. Import decodes once and atomically persists the thumbnail; failed generation rolls back the new original. Old libraries need no metadata migration: missing, corrupt or explicitly refreshed thumbnails regenerate on demand. Hot thumbnail resolution validates only the small PNG (2 MiB and 512-pixel limits), checking original existence/size without decoding it. `resolve_background_image` accepts optional `thumbnail` and `refresh` flags, defaults to original validation, and returns the original reference with the requested asset path. Thumbnail failures never fall back to original pixels.

Grid tiles resolve thumbnails only while visible/nearby through IntersectionObserver and unmount offscreen images. Only the selected candidate loads an original for full preview/focus editing. Native file operations run in blocking workers behind one background-file mutex, serializing import/decoding/thumbnail generation/cleanup. Cleanup uses the existing union of original references to retain or delete both files, and removes orphaned managed thumbnails while preserving unknown files. A current image removed from the library still retains its original and thumbnail until its last reference is released. Original and thumbnail preview failures have independent retry paths. No provider, metadata-schema or asset-permission changes.

The library dialog holds per-file-version `BackgroundLibraryEdit` drafts locally. `applyLibraryBackground(id, edit?)` checks the immutable file reference against the current library entry, validates display parameters, resolves the image, and saves the selected entry's parameters and the applied background in one metadata write before publishing. Missing/replaced versions or failed persistence leave both unchanged. Cancelled and unselected edits never reach the controller; imports and completed management retain their independent persistence. The same `BackgroundDisplayControls` and `BackgroundFocusEditor` serve the outer settings and inner dialog; the latter embeds focus editing as a modal subview, without changing original image bytes or native interfaces.

2026-09-29: `AppearanceController` owns library metadata and the independently applied background in the same `ayase-studio.appearance.v1` localStorage record. `backgroundLibrary` holds IDs, filenames and immutable managed file references with per-image fit/focus/mask/blur; `backgroundReference` and its display fields describe the current image version. `backgroundEnabled` controls display without dropping that reference. Replacing or removing library entries never alters the applied version. Current display edits update a library entry only if it still references that same immutable file. No history archive or extra physical copy is required.

Library mutations, application and background display edits save the entire metadata record before publishing success. A failed write leaves the prior library/current configuration untouched; batch removal validates every ID and commits all metadata in one write. Physical deletion is deferred until after commit, retaining the union of persisted/current library files, the applied image (including disabled), pending imports and the focus draft. Failed cleanup is reported as saved-but-not-cleaned and retried at startup, never rolled back into references to deleted files. A malformed/unreadable metadata record disables cleanup for that controller lifetime. All background mutations hold the busy guard through import and cleanup, preventing a native import from racing cleanup. Ordinary color/theme changes retain the existing best-effort persistence behavior.

Pre-library records with a valid background reference become one “原有背景” library entry while retaining all display parameters and the same private file. Explicit empty libraries remain empty, including after deletion of the current image from the library. Missing/corrupt files render the base canvas and retain metadata for recovery; they do not block startup. Restore Default resets global colors/transparency and disables the image without modifying saved per-image parameters. Tauri continues to validate/copy PNG/JPEG/WebP up to 20,000,000 bytes; import additionally returns only the original basename as a label, never the original path. No permission, transport or provider contract changes.

These #70 rules supersede historical single-background replacement/removal cleanup descriptions below. Files remain under app-private `backgrounds`; metadata remains in the WebView profile, so backups require both locations.

## Local avatar library (#69)

`removeMany(ids)` deduplicates IDs and validates all entries before writes in one read/write transaction across the library, user-avatar and assistant tables. It detaches matching provenance while preserving owned image snapshots, then bulk-deletes the entries; a missing entry or any write failure aborts the entire batch. Single removal delegates to the same implementation. UI management multi-selection is separate from the apply candidate; deleting the candidate clears it only after commit. UI no longer exposes naming/renaming; imports derive the internal label from the filename with a nonempty fallback.

The settings library panel composes the current user-avatar controls and library into one card. It owns the single import picker and candidate selection; confirming a settings import persists the entry and selects it locally, while only explicit Apply writes the user-avatar snapshot. Cancelling import preserves the previous candidate. The assistant selector keeps its existing draft and selection behavior.

2026-09-28 用户在当前开发对话确认：每个对象独立裁切；替换库图片仅影响之后的选用；从库中删除不影响已有头像；在助手选择器中明确保存到库的图片不因取消助手编辑而删除。删除规则按后续用户指示替代此前“使用中阻止删除”的方案；远端 Issue 未修改。

`src/storage/database.ts` owns the existing `AyaseStudio` schema. Version 4 adds dedicated `avatarLibrary` and `userAvatar` tables. `src/avatar/library.ts` exposes library operations; UI never calls Dexie. A library entry owns its latest original, thumbnail, default crop and version ID. Selecting it creates a full independently owned image/crop snapshot with `{resourceId, version}` provenance. User and assistant recropping retains that provenance, without changing the library or other owners. Replacement writes a new library version atomically; previous bytes live only in existing owner snapshots and are released when those owners replace/remove their image or are deleted. There is no unbounded version archive. This deliberately trades duplicate image storage for simple, atomic ownership and compatibility with existing assistant records.

Library deletion detaches matching user and assistant provenance, including snapshots of older versions, in the same read/write IndexedDB transaction as entry deletion. The owners keep their exact original, thumbnail and crop, so display and recropping continue after restart. An error rolls back both detachment and deletion. Both user and assistant saves normalize missing provenance to a standalone snapshot in their write transaction, so a previously selected draft or ongoing recrop remains savable after deletion without reintroducing dangling references. Loading an owned snapshot with missing provenance also retains its image. Library membership is not a dependency for rendering. Selection only updates the assistant draft; Save Assistant commits the complete assistant. A successfully imported library entry is independently persistent, even if the outer assistant editor is cancelled. Renaming changes only the resource name. Restore Default removes the object's snapshot and provenance, leaving library entries untouched.

On first user-avatar load, the old `ayase-studio-avatars` user record is copied into the main database without changing original, thumbnail or crop. The target record doubles as an idempotent migration marker, including an empty tombstone after removal; concurrent initialization cannot overwrite a newer target. Failed source reads or target writes surface as errors and can retry. Explicit user save/remove can establish a new value/tombstone even when the legacy backup is unreadable. Library usage checks do not require migration: legacy standalone avatars have no library provenance. The legacy database is retained as an untouched compatibility backup, never read again after a target marker exists; its backup bytes are not part of normal version reclamation. Existing assistant avatars remain independently owned and do not need conversion or implicit import into the library. Missing or unreadable owned image bytes fall back to default avatars; missing library provenance alone does not. No original user files are removed. Backups must include the WebView profile containing both databases.

Avatar tables and assistant avatar fields never enter conversation configuration, message attachments, request mapping, logging, telemetry or sync. Rendering uses short-lived object URLs; import and crop use local image decoding and canvas. No new native permission or provider contract is introduced.

## Assistant avatars (#67)

Each `AssistantPreset` may contain an `avatar` (original Blob, cropped 256×256 PNG, crop coordinates, and optional library provenance) and a `defaultAvatar` built-in ID. `ChatRepository` saves the full assistant atomically; cancel or a failed save retains the previous record, and deleting the assistant deletes its image in the same transaction. Images belong directly to their assistant; library provenance follows the #69 contract above. Conversation configuration and provider requests never include these fields.

`AssistantAvatarEditor` reuses the user crop dialog and holds changes in the editor draft until Save Assistant. Display object URLs are released on replacement/unmount; invalid images fall back to the saved built-in avatar, legacy Emoji, or system default. Sidebar and historical assistant messages resolve the current owner assistant, including after conversations move to the default assistant. The local preference `ayase-studio.assistant-default-avatar` is copied when opening a new assistant draft and never changes existing assistants. Old Emoji data remains readable; its selector is replaced with image controls and bundled vector defaults. No native file permissions, upload, sync, or provider protocol changes are introduced.

## Local user avatar (#32 / #34)

`src/avatar/repository.ts` owns the user-avatar repository interface: original Blob, 256×256 PNG thumbnail, and square crop coordinates/zoom. The original #32/#34 separate database is migrated by #69 as described above. In the desktop app the data lives in its WebView local profile, not in `backgrounds` or `attachments`. One atomic put replaces the complete object snapshot; removal writes an empty migration tombstone.

`useUserAvatar` is owned by App, independently of chat/session state. UI receives an object URL for the thumbnail, never a message attachment. Settings locally decode PNG/JPEG/WebP (up to 20 MB), preview a square crop, and persist only after confirmation; recropping uses the retained original. Cancel and failed persistence retain the prior avatar. Unset, removed, or failed user images display the bundled person icon in messages and the unset settings preview; user and assistant avatars coexist. Loading failures permit replacement/removal. Object URLs are revoked on replacement/unmount. CSP permits `blob:` only in `img-src`; no network or native filesystem permission is added. Avatars never enter model requests, telemetry, or logs.

## Latest-round versions and shortcuts (#17 / #50)

2026-09-27 用户将历史需求收窄为仅保存最新一轮的问答候选。`roundVersions.ts` 管理最后一组 user/assistant 的候选和选择；可选 `StoredChatMessage.roundVersions` 只放在该轮用户消息上，候选不递归包含版本元数据。可见消息是当前版本的权威内容，离开当前版本或新增候选前更新其槽位。旧记录无该字段仍按单版本读取，不新增表或索引。

最新提问编辑并发送、最新回复重新生成新增候选；暂停回复的继续生成更新当前版本。`select-round-version` 走工作区命令队列、生成保护、仓库事务和 SessionStore 重新加载，同时切换问答，不请求网络。仅保存编辑修改当前版本，不新增候选。生成失败或停止保留候选；重启将活动 streaming 回复恢复为 aborted，切换前保存恢复后的状态。

下一条新用户消息提交并完成附件核验后，只保留选中的上一轮问答，清除候选；提交前失败或附件核验回滚恢复原列表。网络失败/停止不恢复已清除候选。旧轮编辑发送/重新生成仍截断后续记录，不保留多轮分支。独立“分支”复制仅复制可见消息；删除最新问答任一方清除该轮候选。附件引用扫描包含非活动候选，清理只释放所有对话和候选均不再引用的资源。供应商请求仍只取可见历史，不发送版本元数据。

编辑发送和重新生成的按钮/快捷键均直接执行，不再弹窗；单条删除仍确认。该用户修订优先于此前截断确认合同。

## Message image previews (#62)

输入栏的 `Composer` 图片标签新增显式预览入口，复用 `SentAttachmentPreview` 与 `materializeDraftAttachment`，只在弹窗期间读取草稿 `File`，关闭或附件离开当前草稿后卸载预览。传给预览的 reference 仅为运行时草稿 ID，不交给私有附件仓库。草稿显示仍不提前读取完整图片；除发送之外，用户主动预览也允许临时完整读取，但不触发持久化、网络或请求准备。

`MessageList` 经既有 `onReadAttachment` 仓库边界读取已发送图片。`SentImageAttachment` 使用消息滚动区作为 IntersectionObserver 根，在可视区域附近按需加载，离开后释放组件持有的图片数据，忽略已失效的异步结果；不建立全局图片缓存。稳定的预览占位使图片读取/解码不改变消息高度。`SentAttachmentPreview` 继续在弹窗打开期间读取，新增同消息图片导航与焦点管理。此规则将原先的“预览仅在打开期间读取”扩展为消息内可视预览和显式弹窗两种临时生命周期；草稿、发送、私有引用、原图字节及协议合同均不变。

## Lightweight attachment expansion (#63)

按 2026-09-27 用户确认，新增常用 UTF-8 文本/代码和 Responses 的 DOCX/XLSX/PPTX 原文件输入。文本复用 `text/plain` 与受管 `.txt` 副本，保留原文件名；Office 使用对应 MIME 与原字节，受管引用保留 Office 后缀。`attachments.ts` 统一前端格式识别、选择器列表及协议提示，Rust 校验与副本读写保持一致。Office 仅检查 ZIP 文件头，不解压或验证完整 OOXML，不能将此检查视为完整真实性或损坏检测。

不新增解析器、OCR、转码或 Files API。Office 预览只显示已有元数据，不读取完整二进制；文本作为纯文本预览，Markdown 沿用 SafeMarkdown。切换协议保留草稿，Office 在非 Responses 下阻止发送；最终请求映射也检查保留的历史附件。原有持久化、取消、引用整理和请求临时内存生命周期保持不变。

## Issue #31 对话自动命名

首条新用户消息及附件提交成功后，后台命名先将原文合并空白并截断到最多 40 个 Unicode 码点（含省略号）；无正文时用附件文件名。随后使用发送时冻结的连接和模型，发起一次独立标题请求。成功则替换原文标题，失败、超时或不完整输出保留原文标题。这一用户修订替代远端 #31 的“失败保留新对话”验收；远端未修改。

`conversationTitle.ts` 负责文字处理和中立请求聚合。`useChatSession` 在消息及附件提交完成后启动任务，使用独立 AbortController 和 60 秒超时，不占用主聊天生成状态；卸载时取消。首条已提交后按停止仍执行命名，提交前停止或提交回滚不命名。网络等待不进入工作区命令队列；`useConversationWorkspace.updateAutomaticTitle` 仅将短数据库命令放入现有队列，不设置全局 busy、不改变导航选择。

`Conversation.titleNaming` 是可选元数据，保存首条消息 ID、命名源文及 pending/finished，或 manual 标记。仓库 start/finish 命令事务内检查当前记录，拒绝手动命名、已尝试命名、不同首条消息、被编辑/清空/删除后的迟到结果。消息保存只更新 transcript 和时间，不覆盖标题。失败及应用重启均不自动重试命名；旧记录无元数据时仍须是默认标题且本次为首条发送才进入命名。对话配置弹窗仅在实际编辑标题时提交 title，修改其他参数不会产生手动命名标记；即使手动命名为“新对话”也受保护。不增加表或索引。

Issue #42：自动跟随状态仅由 `MessageList` 在内存中持有。消息更新默认直接滚到消息容器底部；上滚滚轮或容器位置向上移动时暂停，向下滚回距底部 48px 内后恢复。避免逐段流式输出反复发起平滑滚动。清空消息或切换对话（沿用 `ChatWorkspace` 的会话 key 重建）恢复默认跟随，不新增持久化字段。

Issue #51：复用上述滚动实现，切换到已有对话时在 `useLayoutEffect` 中、浏览器绘制消息前直接设置消息容器位置。不播放从顶部到底部的滚动动画；缓存历史直接挂载和异步历史加载后均执行定位。切回曾经上滚的对话也显示最新内容，新建空对话仍显示原有空态。

Issue #75：新用户消息提交并加入列表时，`MessageList` 在同一布局阶段恢复跟随并直接定位底部，之后流式更新沿用 #42 逻辑。用相邻列表中的用户消息 ID 判断新发送，编辑、重新生成和版本切换保留用户 ID，不恢复已暂停的跟随；发送后再次主动上滚仍会暂停。发送前校验失败或提交回滚未加入新消息时不触发滚动，无新增接口或持久化字段。

Issue #36 / #61：SafeMarkdown 通过 remarkCodeBlocks 保留代码节点的语言和复制文本，CodeBlock 负责语言标签、复制反馈与 lowlight 语法树的 React 渲染。常用语言和 PowerShell 本地打包，未知语言不自动检测，按纯文本显示；不注入 HTML、不执行代码。围栏内文本保留换行形式和末尾换行，列表/引用容器的缩进仍由 Markdown 解析器处理。高亮按代码与语言缓存，组件类型保持稳定，流式更新不重建代码块。代码区通过 CSS 主题变量同步适配底板、标题栏、按钮状态与高亮：浅色为极浅暖灰底与深色文字，深色为炭灰底与浅色文字。默认通过 CSS 自适应换行；每块可独立切为正文横向滚动。换行选择仅在 CodeBlock 挂载期间保留，不持久化，流式内容更新不重置。视觉折行不插入字符、不自动补续行缩进，复制仍直接使用原始代码；消息存储、整条消息复制和请求内容不变。所有 SafeMarkdown 使用位置共用此行为。

聊天内容宽度由 App 持有的 `useChatLayout` 管理，以独立 localStorage 键 `ayase-studio.chat-layout.v1` 保存本机全局偏好。默认窄屏，宽/窄模式只通过聊天容器 CSS 变量同步约束消息列与输入框，不进入助手配置、会话数据库或请求。存储不可用时当前运行仍可切换。

## Purpose

聊天顶部的窄内容模式与窄窗口是两个概念：大于 1100px 的窗口中，窄内容列以原聊天工作区的中心为锚点，优先让侧栏占用左侧留白，只有侧栏侵入该列时才向右让位；宽内容模式仍按侧栏占用宽度让位。不超过 1100px 的窗口维持覆盖布局。

界面排版使用本机字体，Windows 的拉丁字符优先 Segoe UI，中文明确回退到 Microsoft YaHei UI / Microsoft YaHei；其他系统回退到 PingFang SC、Noto Sans CJK SC 等。不随应用分发这些系统字体文件。App.css 统一维护 12px 提示、13px 次要文字、14px 控件、16px 区块标题四档字号；聊天正文为 16px、1.75 倍行高，代码与 KaTeX 保留各自字体。

Ayase Studio 是一个轻量、local-first 的桌面聊天客户端。架构目标不是复制 Cherry Studio 的规模，而是用少量稳定的模块接口承载四种协议、多个连接配置、助手与对话，以及后续附件和供应商原生搜索能力。

本文件描述当前实现与已确认的目标方向。GitHub Issue 决定功能范围，代码与测试决定当前事实；未来能力在实现前不得被当作已经可用。

## Technology stack

| Area | Choice | Responsibility |
| --- | --- | --- |
| Desktop host | Tauri 2 | Windows 窗口、WebView、权限与原生能力入口 |
| Native language | Rust 2024 edition | Tauri 启动、插件注册和少量必须的宿主逻辑 |
| UI | React 19 + TypeScript | 页面模块、交互状态和应用编排 |
| Build | Vite 8 | 前端开发服务器和生产构建 |
| Styling | Tailwind CSS 4 + CSS | 布局、语义化主题变量和 Markdown 样式 |
| HTTP | Tauri HTTP plugin | 从 WebView 发起允许的跨域请求 |
| OpenAI client | OpenAI JavaScript SDK | OpenAI 协议类型与流式请求支持；其他协议仍使用显式适配器 |
| Persistence | Dexie 4 / IndexedDB | 本地设置、会话和消息持久化 |
| Rendering | react-markdown + remark-gfm + remark-math + rehype-katex | 安全 Markdown 与数学公式渲染，不启用原始 HTML |
| Tests | Vitest 5 | 确定性协议、存储和 UI 逻辑测试 |

`package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock` 是实际依赖版本的权威来源，本表用于解释选型，不替代锁文件。

## Runtime topology

Issue #9 本地标题栏样板：Windows 主窗口由 Rust builder 关闭系统装饰，React 聊天工具栏与标题栏合并；设置页也提供相同的窗口控件。`src/ui/window/windowController.ts` 是窗口 API 边界，`WindowControls` 读取实际最大化状态并监听 resize，组件卸载释放监听。窗口命令限定为当前主窗口的最小化、最大化/还原、关闭和拖动，不新增通用原生命令。空白与标题元素使用 `data-tauri-drag-region`，交互按钮不设置该属性。非 Windows 保留原生装饰；浏览器及已启用原生装饰的窗口不显示重复三键。

用户确认模型选择移到输入框底部附件、思考、联网之后；沿用当前对话模型保存与下一次请求生效的合同。对话标题按聊天区域居中，左右预留对称控制区，宽窄切换与清空位于窗口三键左侧。`AYASE_NATIVE_TITLEBAR` 环境变量存在时恢复 Windows 原生装饰，供兼容性回退。此版本为待原生验收的样板：HTML 最大化按钮尚未提供 Windows 11 原生悬停 Snap Layout 集成，不得据此宣称 #9 完整验收或发布就绪；验收边界见开发指南。

Windows NSIS 打包使用 `src-tauri/windows/installer.nsi`（基于锁定 Tauri CLI 版本的官方模板）。同版本重装和向上升级跳过卸载选择页，沿用原安装位置恢复、运行中程序检查与文件覆盖流程，不调用旧卸载器或删除应用数据。降级与 WiX 迁移保留上游分支；升级 CLI 时需同步核对模板。

Issue #54：按用户进一步确认，桌面窗口记住上次正常关闭时的普通窗口尺寸与最大化状态。取得应用数据目录进程锁后、手动创建主窗口前注册官方 `tauri-plugin-window-state`，仅启用 `SIZE | MAXIMIZED`；状态保存在应用配置目录的 `.window-state.json`，不进入聊天数据库。首次启动或状态文件无法读取时沿用配置的 1040×760，最小尺寸仍为 720×520，用户可继续调整窗口。位置、最小化、可见性和全屏状态不恢复。插件限定在兼容现有 Tauri 的 2.4 系列；无需前端插件调用或新增 IPC 权限。

```text
React UI
  │ neutral ChatRequest / ChatEvent
  ▼
ChatTransport interface
  ├─ OpenAI Chat adapter
  ├─ OpenAI Responses adapter
  ├─ Gemini Native adapter
  └─ Anthropic Native adapter
  │
  ▼
Tauri HTTP plugin ── HTTPS ── Provider or relay

React UI
  │ ChatSnapshot
  ▼
ChatRepository interface
  ▼
Dexie / IndexedDB

React appearance settings
  │ stable background reference
  ▼
AppearanceController
  │ dedicated Tauri commands
  ▼
App data / backgrounds

React chat runtime
  │ runtime-only attachment drafts / sent stable references
  ▼
AttachmentStore → validated Tauri commands → App data / attachments
  │ reference ownership from ChatRepository across all conversations
  ▼
ref-safe private-copy cleanup
```

Tauri 是宿主，不是界面控件库。Panel、主题和布局属于 React 与 CSS；Rust 层不承载聊天业务状态，除非浏览器环境无法安全或可靠地实现某项能力。

## Current project structure

供应商顺序沿用配置记录中 `providers` 数组的顺序保存；连接顺序沿用其所属供应商的 `connections` 数组。供应商和连接的拖动及菜单“上移 / 下移”分别共用 `moveProvider`、`moveConnection`，命令均受共享配置忙碌保护。`moveConnection` 拒绝跨供应商、缺失及原位操作，不改变连接归属、对象 ID、字段、模型或当前选择，无新增存储字段和迁移。

`useConnectionTreeDrag` 只拥有连接配置树的瞬时指针手势与插入目标。把手移动 6px 后激活，名称长按 400ms 后激活；未到长按时限即移动取消候选。根据目标供应商标题或连接行的上下半区显示插入线，列表边缘自动滚动；松手再次验证目标并交给配置命令持久化。Escape、失焦、隐藏、resize、指针取消、源项消失和生成开始取消手势。已激活手势的释放点击被拦截，不改变查看、展开、模型编辑或默认模型；卸载清理计时器、帧、指针捕获与监听。供应商与连接菜单共用既有键盘导航，均提供排序；连接另有编辑、重命名和删除。

Issue #26 的连接配置采用左侧供应商 → 连接分级导航、右侧连接详情两栏。导航分组折叠与当前连接选择独立；导航和详情分别滚动，模型列表不另设纵向滚动层。接口配置可手动折叠，模型管理位于折叠区域之外；只读请求地址详情默认折叠，URL 校验错误仍显示在输入框附近。菜单提供供应商及连接重命名、删除，名称沿用失焦保存，地址与密钥沿用即时保存，模型编辑仍显式提交。布局状态仅在当前页面内存中保存，不增加存储或迁移；设置页模型选择仍作用于助手的新对话默认模型。

```text
AyaseStudio/
├─ src/
│  ├─ App.tsx                 application-shell composition root
│  ├─ App.css                 semantic theme tokens and shared component states
│  ├─ main.tsx                React entry point
│  ├─ appearance/
│  │  ├─ appearance.ts        validated preferences and theme controller
│  │  ├─ bootstrap.ts         pre-render theme application
│  │  ├─ browser.ts           localStorage and matchMedia adapters
│  │  ├─ backgroundResources.ts Tauri command and asset URL adapter
│  │  └─ useAppearance.ts     React subscription seam
│  ├─ chat/
│  │  ├─ types.ts             neutral request, event and transport interface
│  │  ├─ transport.ts         four protocol adapters and error normalization
│  │  ├─ runtime.ts           Tauri HTTP adapter wiring
│  │  ├─ sse.ts               SSE framing parser
│  │  ├─ repository.ts        ChatRepository and Dexie adapter
│  │  ├─ attachments.ts       draft format metadata and transient content
│  │  ├─ attachmentResources.ts Tauri-only file storage/reading interface
│  │  ├─ settings.ts          supplier/connection/model domain and v1/v2 migration
│  │  ├─ modelCatalog.ts      protocol-aware remote model discovery client
│  │  ├─ urlResolution.ts     shared Base URL validation and endpoint resolution
│  │  ├─ modelGrouping.ts     stable configured/discovered model grouping
│  │  ├─ modelAvailability.ts explicit single-model availability test
│  │  ├─ useChatSession.ts    chat runtime and persistence orchestration
│  │  ├─ SafeMarkdown.tsx     safe Markdown rendering
│  │  └─ *.test.ts[x]         deterministic tests
│  └─ ui/
│     ├─ AppShell.tsx         top-level chat/settings navigation and workspace
│     ├─ chat/                header, message list, composer and workspace
│     └─ settings/            categorized settings workspace and pages
├─ src-tauri/
│  ├─ capabilities/           Tauri permission declarations
│  ├─ src/                    Rust application entry points
│  │  ├─ background.rs        validated private background import and cleanup
│  │  └─ attachments.rs       validated sent-copy storage and managed ref cleanup
│  ├─ Cargo.toml              Rust dependencies and release profile
│  └─ tauri.conf.json         desktop application configuration
├─ scripts/
│  └─ provider-probe.live.ts  opt-in real-provider compatibility probe
├─ docs/
│  ├─ PLAN.md                 current product plan and acceptance gates
│  ├─ PROTOCOLS.md            protocol and URL contract
│  ├─ ARCHITECTURE.md         this document
│  └─ DEVELOPMENT.md          environment and workflow guide
├─ .env.probe.example         tracked secret-free probe template
├─ package.json
└─ vite.config.ts
```

`App.tsx` 只组合外观、聊天会话、顶层页面选择与界面模块。`useChatSession` 无条件位于组合根中，因此聊天和设置页面切换不会重建聊天运行状态。聊天请求、流式终态、取消和持久化队列集中在 `useChatSession`；设置页、标题栏、消息列表与输入区不重复实现这些规则。

## Stable module seams

### Desktop presentation (#44–#47)

Issue #55：供应商详情直接展示 `selectedProvider.connections`，含名称、协议与原始 Base URL，采用带加粗字段名的紧凑分列列表；铅笔入口复用已有连接选择，详情标题上方的返回按钮复用供应商选择及未保存模型编辑确认，返回所属供应商列表。删除复用原回调，不复制连接状态，沿用全局生成期间禁用及具名确认，从概览删除后焦点回到添加连接按钮。无新增持久化字段或协议改动；提交前自动化检查见 DEVELOPMENT.md，视觉确认状态见 UI-DESIGN.md。

聊天导航保留级联与原宽窄窗口交互，保留悬浮面板的外部间距、细边框与阴影，外框圆角从 12px 收敛为 8px；消息操作常显图标，名称、提示、忙碌状态及键盘入口保留。用户消息继续跟随强调色。默认强调色为浅色 `#60A5FA`、深色 `#93C5FD`；文字/图标使用独立的 `--color-accent-text`（浅色默认 `#2563EB`），焦点环使用 `--color-focus`，避免浅蓝填色直接用于小字和焦点边界。自定义强调色继续沿现有对比度派生，同时更新前景色并在恢复默认时清除覆盖。

外观页使用 8px 小圆角分组卡片、独立标题和行内分隔，主题模式保留原生 radio 分组。预览在固定 1920×1080 的内部画布中展示两级侧栏、双方消息及输入区，ResizeObserver 按容器宽度统一缩放；BackgroundImage 的可选 aspectRatio 用于固定预览取景为 16:9，省略时仍使用真实窗口比例。窗口至少 1440×700 时，左侧设置独立滚动、右侧预览保持固定，较小窗口采用顶部预览。连接页与外观页共享外层宽度、边距及页面标题规则，设置框架和连接树/详情区也采用小圆角卡片。仍通过现有 AppearanceController 回调更新颜色、透明度、背景和取景，无新存储合同。

连接管理采用供应商 → 连接渠道的两级导航，模型仅在右侧连接详情中管理。展开按钮只控制可见层级，节点按钮只选择右侧详情，两种操作不互相替代；浏览连接不会改变助手默认模型或当前对话目标。节点选择与折叠属于组件本地状态，连接字段、模型 CRUD、目录和测试继续使用现有回调。切换详情确认放弃的模型编辑会被清除；删除后沿既有引用校验和焦点恢复路径处理。没有新增数据库、协议或宿主权限。

### ChatTransport

Gemini 思考由 `geminiThinking.ts` 集中维护协议选项、数值结构校验和请求字段映射。助手配置中的可选 `geminiThinking` 保持旧记录兼容；输入区快捷修改持久化到当前对话配置。发送时冻结整个有效配置。`thinking-delta` 与 `text-delta` 独立，`StoredChatMessage.thinkingSummary` 仅用于本地展示，不进入 `ChatMessage` 请求历史；复用现有节流保存与中止恢复。`ThinkingSummary` 用 SafeMarkdown 渲染供应商可读摘要，不展示或存储 thoughtSignature。折叠状态属于组件临时状态，用户手动展开后不随正文增量强制收起。

Issue #16 的 `thinking.ts` 为四协议控件提供协议选项、结构校验与配置读写；Gemini 委托原模块，其他协议使用可选 `SessionConfig.thinking[protocol]` 独立保存。2026-09-19 按用户修订移除模型能力白名单、型号档位限制、预算与输出/采样冲突拦截。模型 ID 不参与思考配置准入；供应商验证能力与参数组合。同协议切换模型不重置配置；Issue #21 快捷选模跨协议切换使用目标协议独立值，并清除两端不共通的选项，详见下文。缺字段即供应商默认，摘要默认关闭，无数据库版本迁移。Anthropic 模式/预算与 effort 分开表达。最终请求由 `requestMapping.ts` 验证结构和可映射字段；本地历史、受保护 JSON 与附件安全边界保留。

供应商 HTTP 错误保留状态码和完整响应正文，流式错误保留错误载荷；凭据在 transport 内脱敏后进入中立错误事件，界面以文本展示。错误不会触发自动降级、删除参数或重试。

Responses 的 `responseThinking.ts` 是 adapter 内部的思考文本拼接器，按 item、summary/content 类型、各自索引和事件序号协调增量与完整结果，避免 done、output item、terminal 重复添加内容。除官方 summary_text 外，也读取明确返回的 reasoning_text。Chat 在现有 adapter 中读取兼容服务的 reasoning_content 扩展，不增加供应商协议或模型白名单。Anthropic 只接收 thinking block 的可读字段；签名、密文和 redacted block 不保存。每次生成拥有独立解码状态；adapter 和会话运行时均按冻结配置丢弃被关闭的思考内容。普通无工具多轮仅回传正文，不增加供应商托管状态或结构化思考历史。

界面只提交中立的聊天请求并消费中立事件。每个协议适配器独占以下知识：

- 端点和请求头。
- 消息与参数映射。
- SSE 或非流式响应解码。
- 供应商错误归一化。
- 未知事件兼容与唯一终态。

调用者不应判断供应商事件名称，也不应在界面层拼接协议路由。

### ChatRepository

界面通过仓库接口加载、保存和清除对话，不直接操作 Dexie。随着多对话、附件和迁移规则增加，复杂性应继续留在存储模块内，而不是分散到各个 Panel。

Issue #14 的消息编辑、单条删除与分支通过工作区命令队列执行；修改前等待该对话写入结束，数据库事务成功后刷新消息视图。Issue #37 将保存编辑改为只更新所选消息，保留后续历史和附件，不请求模型、不整理附件引用；编辑助手正文仍清除该消息失效的搜索引用和续接数据。单条删除不连带删除其他消息，并按剩余引用整理附件。助手消息用 `replyToId` 绑定用户消息，旧记录在读取和删除前按原顺序补齐，删除后不重新猜测归属。缺失原提问的回复仍可查看，但不能重新请求，也不会与其他提问拼成请求轮次。

仅用户消息提供“编辑并发送”，按钮和 Ctrl+Enter 直接执行。此操作将编辑文本交给现有重发流程，预检失败或提交前停止不修改历史；预检通过后，一次保存修改后的提问和新回复占位。最新一轮保留成对候选，旧轮操作截断后续历史；请求失败或提交后停止不自动回滚或重试。附件整理核对所有会话及非活动候选引用。编辑区使用不透明主题底板、明确的文字和边框颜色，避免聊天背景或用户气泡文字色影响可读性。

重新请求复用正常发送的配置冻结、附件读取、预算、流式保存和停止流程；输入截至对应用户消息，预检成功后保存新回复占位，再发起一次请求。最新一轮新增问答候选；更早轮次仍丢弃原回复及后续记录。失败不自动重试。运行中对话的消息修改、版本切换与分支被阻止，导航不改变请求归属。分支事务复制截至切点的可见消息、丢弃候选元数据、重建消息 ID 与回复引用，附件共用已有私有副本。新对话保存在原助手下，标题使用 `(N)` 后缀；`creationConfig` 只记录创建时的模型引用与生成配置，不含连接凭据，不参与当前对话的运行配置。无需新增数据库索引，新增可选字段兼容旧记录。

### URL resolution

`urlResolution.ts` 为配置预览、四种生成 adapter 与模型目录提供同一套 Base URL 校验、协议归一化和最终端点解析。配置值、标准化 Base URL 和最终请求端点是三个不同概念；设置页只保存用户输入，直接从当前连接和明确选中的模型计算预览，Gemini 无模型上下文时不显示虚假的最终端点。OpenAI SDK 接收解析后的标准化 Base URL；原生协议 fetch 接收解析后的最终端点。聊天发送、目录读取和模型测速都在建立运行时请求前调用这一校验；解析确定、幂等，且不能通过自动回退发送第二次生成请求。

### Connection settings

连接配置使用一个版本化 localStorage 记录，并通过 `settings.ts` 的纯函数完成加载、校验、迁移、CRUD 和活动引用校验。React 界面不直接读写 localStorage。供应商只提供命名分组；连接完整持有名称、协议、Base URL 与 API Key；每条连接再拥有零到多个已添加模型。同一供应商可以建立多条相同或不同协议的连接，相同实际模型 ID 也可以分别存在于不同连接中。

运行时模型只读取 `Conversation.settings.modelId`，从模型唯一父连接原子取得协议、Base URL 与 Key。设置页的 `activeModelId` 表示助手默认模型，只用于以后新建对话；已有对话通过编辑弹窗修改或恢复助手默认值。删除模型或连接后，会话引用保留为失效状态并阻止发送，不回退到助手或其他线路。会话配置不复制连接凭据。

加载顺序优先采用 v3 记录；若不存在有效 v3，则将 v2 的单模型连接迁移为每条连接下的一个稳定模型实体；再无 v2 时才迁移旧 `ayase-studio.provider-profiles.v1`。迁移使用稳定 ID 和固定协议顺序，因此重复加载不会产生重复对象。内置 OpenAI、Google Gemini 与 Anthropic 只是只读创建模板；创建结果与自定义供应商使用相同数据类型和运行时路径。

### Model discovery and availability

`modelCatalog.ts` 以连接为请求边界，按四种协议构造模型目录 GET 请求、凭据头、分页和响应映射；返回值是内存中的候选目录，不直接写入配置。界面可以搜索、分组并显式把单个候选项添加为 `ConfiguredModel`。并非所有中转站都实现目录端点，因此失败或空刷新只作为该连接的可见状态，不删除上次成功结果，也不阻止手动添加。显示错误前必须删除其中出现的当前 API Key。

`modelAvailability.ts` 复用该连接协议对应的 `ChatTransport` 发起一次受限的极短请求，消费统一 `ChatEvent` 并记录首段与总耗时。测试必须由用户对单个模型显式触发；同一时刻最多运行一个，可取消、有超时，且不自动重试或自动选择模型。用户取消优先于随后发生的超时，配置变化会使旧异步结果失去写回资格。

### AppShell, Settings and Theme

`setUnifiedTransparency(null)` 在一次偏好更新中恢复四个透明度字段的默认值（统一/侧栏/输入栏 0%，气泡 6%），保留其余偏好。单项透明度及遮罩/模糊的恢复入口读取 `defaultAppearancePreferences`，通过已有单项 setter 应用，不触发全局外观重置。

各色盘的恢复入口通过对应 setter 传入 null 清除覆盖。`setUnifiedThemeColor(null)` 一次清除组件色、用户气泡色及最近统一色，回到当前方案的两个独立默认值，不调用全局外观重置，也不修改助手气泡、画布、图片或透明度。

2026-09-28 配色覆盖规则更新：`accentColor` 仅控制组件；新增可空 `userBubbleColor` 独立覆盖用户气泡，以及 `unifiedThemeColor` 记住最近统一色。`setUnifiedThemeColor` 在一次偏好更新中覆盖组件与用户气泡，两个子项 setter 互不修改对方，手动同色时同步最近统一值。快照提供实际用户气泡色，UI 据它和实际组件色显示差异状态。未配置的字段继续跟随默认/阅读预设。旧记录缺少用户气泡字段时，复制旧自定义强调色以保留用户的同色意图；显式 null 保持预设默认，不持续联动。预设和恢复默认重置新增字段。组件底色不再因对比度改变用户所选色，文字/焦点及前景另行派生，用户气泡前景按实际底色与透明度合成结果计算。

外观页保留跟随系统/浅色/深色，并恢复第四项阅读快捷入口。阅读复用 `colorPreset: reading` 与 `themeMode: light`，无需新增持久化字段；该组合仅选中阅读按钮。进入阅读应用纸页并切为浅色；从阅读切到前三项时恢复默认方案。其他状态切换 `themeMode` 不清除方案或颜色微调。下方纸页色卡仍保留，已有浅色阅读记录直接对应顶部阅读选中态。

`src/appearance/colorPresets.ts` 定义七个稳定 ID（`default / reading / sage / ocean / violet / rose / amber`）及浅深两组组件、画布、用户和助手气泡色，供控制器与 UI 预览共用。`AppearanceController.setColorPreset` 一次保存方案并清空组件、用户气泡、助手气泡、画布及最近统一色，保留主题模式、背景图片及区域透明度；“恢复方案配色”调用同一操作。缺失或非法 ID 按 `default` 解析，无数据库迁移；旧 `default / reading` 和单项覆盖继续读取。预设表面复用画布派生、组件/焦点对比度和气泡前景计算，初始主题与运行时使用同一派生函数。自定义颜色优先，原全局恢复外观仍重置为默认方案。用户气泡与组件颜色独立，仅统一主题色同时覆盖两者；前景对比度使用实际气泡色与画布的合成结果。

`AppShell` 提供固定的顶层功能导航，并在聊天和设置两个工作区之间切换。聊天工作区组合助手栏、对话栏、标题栏、消息列表与输入区；设置工作区拥有自己的分类导航，当前将连接配置与外观拆分为两个页面。页面选择由 `App.tsx` 管理，不引入路由框架，也不会因为切换视图而取消或重发聊天请求。这些是固定职责的 React 与 CSS 模块，不是可插拔 Panel 或 IDE 停靠系统。助手栏和对话栏在这个组合根内参与布局，不混入聊天运行逻辑。

主题模块以 `themeMode`、`resolvedTheme`、自定义颜色、背景显示参数和更新操作作为 React 接口。普通界面模块只使用语义化 CSS 变量，不知道具体的 `stone` 或 `violet` 色阶，也不各自监听系统主题。浅色、深色和跟随系统的解析、系统变化订阅、安全颜色派生、遮罩下限、损坏配置回退与本地持久化集中在 `AppearanceController` 内。自定义组件色派生组件底色、安全前景色与焦点变量，用户气泡色独立派生；自定义画布色按实际浅色或深色主题调整到可读范围，并重新派生 Panel、输入、悬停和边框表面。原始自定义值保持不变，因此跟随系统切换后可以基于新的实际主题重新计算。顶层页面与设置分类属于瞬时导航状态，由应用组合根拥有，不混入外观偏好存储。

外观偏好使用一个版本化的 localStorage 记录，保存颜色、`backgrounds/<uuid>.<ext>` 稳定引用、填充/适应、35%–90% 遮罩、0–32 px 模糊和可选的相对原图取景中心及缩放。`bootstrap.ts` 在主 React 入口前应用已保存或系统解析后的实际主题与颜色；React 随后通过同一个解析规则建立实时订阅，并异步解析背景私有副本。只有资源重新通过大小、类型、完整解码和引用校验后，asset URL 才进入共享背景渲染组件。

Issue #30 支持助手回复气泡独立颜色。Issue #59 按用户确认扩展为统一、侧边栏、输入栏、消息气泡四个 0–100% 透明度滑块（0% 不透明，100% 完全透明）。助手栏与对话栏共享侧边栏值，输入框及工具区共享输入栏值，用户与助手气泡共享消息值；双方气泡颜色分别设置，独立于组件颜色。仅背景 alpha 改变，正文、思考摘要和按钮不变透明。高度透明或自定义低对比颜色不保证任意背景上的对比度，用户可自行搭配遮罩。

AppearanceController 通过一次偏好更新完成统一覆盖，单项更新只覆盖对应区域；三项手动相等时同步统一值，否则保留最近统一值供滑块定位。UI 根据三个值是否相等显示橙色叹号及“各项不同”，不新增锁定模式。现有 localStorage 记录新增 `unifiedTransparency`、`sidebarTransparency`、`composerTransparency`，历史 `assistantBubbleTransparency` 字段复用为双方气泡值。缺失或非法值回退为统一/侧栏/输入栏 0%、气泡 6%，重置外观一并恢复；不增加数据库迁移。预览与实际界面共享三个 alpha 变量，启动主题应用与运行时均走现有外观控制器。用户气泡文字按实际气泡色与有效画布色的 alpha 合成结果检查对比度，低于 4.5:1 时切换为对比度更高的黑色或白色；不读取或采样私人背景图片，因此复杂图片仍需遮罩配合。这是当前会话确认的 #59 方案，远端未修改。

Issue #33 按用户后续修订改为中心取景与图片缩放：保留完整私有原图，保存相对原图的中心 x/y 和可选 zoom（默认 1，支持 0.25–4）。中心允许超出 0–1，不吸附或限制在图片边缘；超框区域显示画布色。固定比例参考框只辅助定位，实际显示窗口按当前宽高比重新计算取景范围，填充/适应决定基础缩放，再应用用户 zoom。早期未发布裁切配置读取时采用原矩形中心，丢弃固定裁切范围。新图片导入先进入临时草稿，确认才更新引用与取景设置，取消保留旧背景；原有私有资源清理和持久化失败引用保护不变。背景、设置预览与取景预览共用 BackgroundImage，无新原生命令、上传或图片重新编码。远端 Issue 未修改。

背景选择、复制、恢复与清理由 `background.rs` 的专用 Tauri 命令完成。选择器不把原文件路径返回 React；导入只复制到应用数据目录的 `backgrounds` 子目录。替换、移除和启动整理按当前稳定引用集合删除未引用的受管副本，永不删除原文件或非 UUID 管理文件。asset protocol 只开放 `$APPDATA/backgrounds/**`；CSP 的图片源允许同源、`asset:`/`http://asset.localhost` 和已发送附件预览的 `data:`，不开放任意远程图片源。待发送附件在输入框上方显示文件图标、文件名和移除按钮组成的紧凑标签，不解码图片或创建 object URL；已发送图片解码失败时显示明确提示，保留附件记录与消息正文。背景内容不会进入聊天或任何供应商 transport。

## Domain direction

当前连接配置、助手和对话的数据关系如下：

```text
ProviderGroup
└─ ConnectionProfile
   ├─ id
   ├─ name
   ├─ protocol
   ├─ configured base URL
   ├─ API key
   └─ ConfiguredModel[]
      ├─ internal id
      ├─ actual model id
      └─ optional display name

Assistant
├─ default model reference
├─ default system instruction
├─ default generation settings
└─ Conversation
   ├─ title and timestamps
   ├─ independent full configuration snapshot (including model reference)
   ├─ Message
   │  ├─ text
   │  ├─ sent attachment references (app-private copies)
   │  └─ citations/search metadata
   └─ text / attachment draft (in memory, per conversation)
```

供应商只负责分组，不提供父级配置继承。助手提供新对话的默认配置；当前对话通过自身快照中的已添加模型引用解析所属连接，不复制连接配置或凭据。修改助手不更新已有对话，分支复制完整配置，恢复助手默认值须显式保存。助手是预设与对话容器，不是 Agent；附件和供应商托管搜索不会自动引入 MCP 或通用工具执行循环。

### Application identity and Windows storage

首次 Alpha 前将应用标识固定为 `io.github.ayaseminami.ayasestudio`。Windows 下 Tauri 的 `app_data_dir()` 位于 `%APPDATA%/<identifier>`，存放附件和背景；默认 WebView 数据目录位于 `%LOCALAPPDATA%/<identifier>`，其中的浏览器配置承载 localStorage 和 IndexedDB。旧开发版的 `ayaseminani` 拼写只作为迁移来源，不增加运行时双目录回退。更名须关闭旧版及其 WebView，并将两个完整目录成对迁移；目标已有数据时禁止覆盖或合并。变更标识不改变浏览器 origin，开发版与生产版的存储仍可能按 origin 隔离，开发版数据迁移不等于安装版升级验收。操作边界见 [开发指南](DEVELOPMENT.md#application-identity-and-existing-development-data)。

## State ownership

- 瞬时视图状态：顶层页面与设置分类由应用组合根管理，局部交互由拥有它的 React 界面模块管理。
- 聊天运行状态：集中管理流式消息、取消、唯一终态和持久化队列。
- 外观状态：由主题控制器管理主题模式、实际配色、安全派生、背景稳定引用、显示参数与系统变化订阅；原生 adapter 管理私有文件生命周期。
- 用户设置：通过明确的加载、校验、确定性迁移与保存入口管理；当前模型由单一 ID 标识，父连接按归属关系解析。
- 供应商差异：只存在于协议 adapter 内。
- 长期数据：通过 repository seam 进入 Dexie 或后续本地文件存储。

不要仅为了减少属性传递引入全局状态库。只有多个相距较远的真实调用方共享同一状态并且现有接口明显失去局部性时，才重新评估。

## Security invariants

- 模型输出和搜索结果不渲染原始 HTML；`rehype-raw` 与等价绕过方式禁止使用。
- API Key 不进入消息、Issue、PR、测试快照、错误日志或 Git。
- Alpha 阶段凭据仍是本机明文配置，界面必须如实提示，不使用伪加密制造安全错觉。
- Tauri 网络权限保持最小化；远程请求使用 HTTPS，本地开发仅允许 `localhost` 和 `127.0.0.1` 的 HTTP。
- OpenAI Responses 继续使用本地历史和 `store: false`，除非单独 Issue 明确改变隐私模型。
- 不对模糊网络失败自动重试生成请求，避免得到重复回复或重复计费。
- 自定义请求参数不能覆盖模型、消息、System Instruction、流式模式、最大输出和其他受保护字段。
- 背景图片不进入消息、模型请求、遥测、日志或 Git；原文件路径不持久化，asset protocol 只暴露应用私有背景目录。

## Testing strategy

- SSE framing、协议字段映射、错误分类、取消与存储恢复使用确定性测试，不依赖真实网络。
- 每个请求恰好产生一个终态：`completed`、`failed` 或 `aborted`。
- 真实探针只回答中转站是否透传某项能力，不替代确定性回归测试。
- 供应商、重复协议连接和模型的增删改、v1/v2 迁移、当前模型恢复及删除时清空引用使用注入式内存存储完成确定性测试。
- 四种协议的模型目录路径、请求头、响应归一化、去重分组和安全错误，以及模型测试的耗时、失败、取消和超时均使用合成 transport/fetch 测试，不访问真实服务。
- 连接设置界面覆盖“浏览连接不会改变助手默认模型”、供应商折叠与连接选择独立、目录候选需显式添加，以及删除当前对象不静默回退。
- 顶层页面导航、设置分类或主题变化必须保留发送、流式增量、停止生成、草稿与错误状态，以及重启恢复行为。
- 主题解析、系统变化、持久化与损坏配置回退使用注入式依赖完成确定性测试。
- 自定义颜色安全派生、背景显示参数、缺失资源回退和引用集合清理通过 `AppearanceController` 接口测试；Rust 测试覆盖 20 MB（20,000,000 字节）、PNG/JPEG/WebP 完整解码、稳定引用、复制不改原文件和受管副本清理。
- 涉及 Tauri 权限、窗口或本地文件的改动必须完成桌面烟雾测试。

## Change rules

新增能力时优先加深现有模块：让适配器隐藏协议复杂性，让 repository 隐藏存储复杂性，让主题模块隐藏配色解析。只有行为确实存在两个实现时才建立新的 seam；不要创建只转发参数的浅模块。

架构变化满足以下任一条件时，应在同一 PR 更新本文档：

- 新增或改变稳定模块接口。
- 改变依赖方向、数据所有权或持久化位置。
- 新增协议、宿主权限或安全边界。
- 当前结构与本文的目录说明不再一致。

## Issue #3 conversation generation configuration

助手默认值保存在 `AssistantPreset.defaultConfig/defaultModelId`，仅作为模板。每个对话在 `Conversation.settings` 保存完整的 `{ modelId, config }` 快照，发送、标题、预检和预算只读取该快照。新建对话复制助手当时设置，修改助手不传播到已有对话。“恢复助手默认值”把助手当前完整设置复制到编辑草稿，保存后生效；不改变标题或消息。`SessionStore` 只写消息，清空消息保留设置；`creationConfig` 仅是历史记录。

## Issue #4 assistants and conversations

Issue #99 的导航拖动由 `useNavigationListDrag` 管理临时手势、同列表目标与点击隔离，UI 不直接写数据库。`reorder-assistant`／`reorder-conversation` 按目标前后插入，`move-conversation` 与既有助手菜单按相邻位置移动；工作区命令队列执行单个 repository 事务，数据库边界再次检查聊天所属助手。原位和相邻同位置不写顺序。助手沿用 `sortOrder`；聊天新增可选 `Conversation.sortOrder`，无此字段的旧记录保持最近更新时间排序，首次实际手动换序只给同助手聊天赋连续序号。消息保存只更新 `updatedAt`，不覆盖顺序；新建和分支在已排序列表顶部插入并归一化序号。删除助手迁移聊天时保留目标手动顺序并追加来源聊天，目标未排序则清除来源序号、沿用最近更新时间。排序不修改导航选择、消息、模型、配置或运行时草稿，也不占用生成任务；无新表、索引或启动迁移。备份导出和校验保留可选有限数字 `sortOrder`，旧备份仍可恢复；替换／复制恢复保留该字段。

`workspace.ts` 定义助手预设、对话元数据、导航记录及完整操作命令。Dexie v3 保留 `chats`、`assistants`、`conversations`、`workspace`，新增 `legacyConversationConfigs`。历史 v1/v2 升级事务将旧对话配置和模型引用按对话 ID 备份，再移除活跃记录中的对应字段；消息与时间戳不变。v1 的 `current` 配置迁入默认助手；v2 的助手配置保留为后续完整快照初始化的模板，原对话差异仅保存在本地备份，不重新参与请求。当前已有对话以自身 `settings` 为唯一配置来源，不随助手更新。备份没有 UI 恢复入口，不会被后续保存覆盖，永久删除对应对话时一同删除。初始化在单个事务内创建不可删除的默认助手，将旧 `current` 和孤立消息记录原地归属，修复失效助手/导航/模型引用。重复初始化不复制数据；加载错误显示重试入口，不按空数据库继续写入。

初始化事务对没有 `settings` 的旧记录一次性合成助手配置与旧 `overrides`，保存完整快照并移除旧覆盖字段；没有覆盖的记录复制所属助手设置。转换在助手模型引用修复前完成，保留原有失效引用，不采用历史 `creationConfig` 或重新启用 v2 备份。已有快照在重启时不从助手刷新，转换失败会回滚整个事务。沿用 Dexie v3 元数据字段，无需新索引。分支深拷贝原对话快照；迁移到默认助手只改归属，保留配置和消息。永久删除对话同时移除快照。

`useConversationWorkspace.ts` 拥有导航操作队列、按 ID 缓存的 Store 和消息/草稿/错误/参数校验/上下文提示视图。`useChatSession` 保持生成编排与连接操作，发送时冻结会话有效配置、模型及连接目标、目标 Store 和对应视图更新函数；切换视图或编辑配置不改变旧请求。Issue #53 将生成改为不同对话可并发、同一对话最多一个任务。`GenerationTasks` 在首次异步准备前同步登记任务及独立 AbortController；占用覆盖预算计算、附件准备、请求和最终保存，统一 finally 按任务身份释放，取消不提前解锁。聊天界面的生成状态和停止按钮只作用于当前对话，侧栏列出后台生成对话；全局连接设置使用是否存在任意任务作为保护。消息修改、分支、清空和删除只检查目标对话；删除助手检查其下全部对话。应用卸载中止全部任务并拒绝新的发送，现有任务仍完成各自终态保存。保存失败后的写入栅栏会尝试重新保存当前状态一次，持续失败则保留错误。任务登记是运行时状态，不增加数据库字段；协议适配器、按对话保存队列和附件引用保护保持原有职责。

Issue #5 附件草稿是同一按对话 ID 保留的会话内视图状态，只持有 `File` 句柄和元数据，仅读取小段文件头识别 MIME，仅在本次运行保留，不写入 IndexedDB，也不提前缓存整图 Base64。文件选择、拖入聊天区域和图片粘贴只加入草稿；读取途中禁用发送。点击发送后先预算，再逐项读取本次草稿与所需历史附件，每项之后检查中止；新附件只在此时转为请求内联内容并复制到 `$APPDATA/attachments/staging`，得到不包含来源路径的稳定引用。用户消息及占位助手消息通过 `SessionStore` 成功持久化后，原生层按引用一次核对全部副本仍可访问且大小一致（不在 JS 重新加载整图），随后才发起供应商请求；副本缺失则先回滚消息记录且不联网，即使此时用户按了停止也核对所有已入库副本。已入库副本可以留在暂存目录供预览和历史读取，启动或后续引用整理才将其转入活动目录，因此联网前没有批量转正/部分转正的回滚问题。若提交失败或发送前中止，立即清掉未提交暂存副本。即使生成失败或取消，已发送用户消息仍拥有附件，重启可只读预览。清空、删对话或删助手时，仓库汇总所有现存消息引用后原生层只清理不再被引用的托管文件；无法读取数据库时不清理。文件保存和清理串行化，新文件在尚未完成消息提交时作为临时保留引用参与清理计算，避免跨对话误删。桌面主机先持有应用数据目录的进程级文件锁，再手动创建主窗口；Tauri 单实例插件处理重复启动的聚焦，文件锁弥补其 Windows 初始化竞态。消息级操作留给 Issue #14，并必须遵守相同引用规则。

原生清理对活动目录的无主 UUID 文件先同卷移动到私有 `attachments/quarantine`，不信任前端列表立即永久删除可能已发送的副本；已发送预览及历史请求读取同时检查活动、暂存和隔离目录，后来重新扫描为有主时恢复活动副本。隔离满 30 天后仍无主，先记一次扫描，再至少一小时后的独立扫描仍无主才最终回收；此保留期是避免清理错误立即破坏已发送引用的磁盘空间权衡。暂存目录既可容纳尚未完成提交的副本，也可容纳已被数据库引用、待整理转正的副本；明确提交失败或发送前中止只删除未提交副本。启动整理依据数据库权威引用转正已提交副本、清理无主暂存副本。所有操作仅接受受管 UUID 引用，不读取任意用户路径，Windows 拖入使用 HTML5 `File`。

上下文提示按对话只缓存计数摘要，不缓存请求消息或已发送图片 Base64。未发送草稿在当前运行内暂存 `File` 句柄；生成期间仍可编辑文本、添加或移除附件，但当前生成停止前不接受新发送。点击发送才完整读入内容；异步准备完成后，只清除本次已发送且未被继续编辑的文本及本次已发送附件，保留准备期间新增或修改的草稿。历史只保留应用私有文件引用和元数据。历史附件在该次请求中按引用读取；预览按本文 #62 的消息内可视范围或弹窗打开期间读取，结束后不建立跨请求或跨预览的内存图片缓存。最终 Body 只检查对应协议可直接测量的官方输入限制，不再使用统一的应用级附件大小或请求体大小上限；校验失败不复制新附件、不写入用户消息也不请求供应商。发送和预览期间的临时 RAM 占用是允许的，实际 GC 释放时点由运行时决定。

`ConversationNavigation` 使用横向级联的两栏导航：助手栏在左，点击助手在右侧展开其对话栏，两栏保留悬浮卡片外观、4px 外部间距与轻阴影，外框使用 8px 圆角；两栏标题为 13px，新建入口和列表为 14px、36px 行高，图标及文字统一对齐，200ms 位移与透明度过渡。按当前用户对 #27 的新约定，窗口宽度大于 1100px 时聊天区以同周期边距动画让位；不超过 1100px 时覆盖聊天区，保持正文宽度不变（替代远端 Issue 原先要求所有窗口不让位的设计）。关闭的栏保留 DOM 以完成退场，同时 inert/aria-hidden 禁止交互与聚焦；减少动态效果偏好取消过渡。顶部按钮联动隐藏或恢复两栏；对话栏按钮收起对话栏；Escape 优先关闭菜单/弹窗，再收对话栏、最后关闭导航，并恢复到可用入口。按用户后续反馈取消外部点击关闭及遮挡层：导航展开时可直接点击、选择正文或输入，不自动收起导航（替代 #27 原外部点击关闭约定）。点击当前助手也可切换对话栏。选择或创建对话后保持导航展开。宽度不超过 860 px 时缩窄两栏，初始隐藏导航。助手行显示自选 Emoji 或仅用于显示的默认轮廓图标，长名称省略；`ConversationNavigation` 通过共享 `ActionMenu` 将编辑、排序和删除收纳到行右侧菜单，并为助手／对话行提供右键入口，菜单通过 portal 挂到 document.body，避免侧栏动画的 transform 与层叠上下文影响定位，菜单 Escape 不收起对话栏。新建和编辑助手复用 `SessionConfigPanel` 字段和请求校验，以应用窗口居中的弹窗呈现，标题和取消/保存操作固定，表单独立滚动。取消或关闭丢弃草稿，显式保存仍经现有工作区命令执行，不改变配置作用域。对话草稿仅在当前应用会话中按 ID 保留，导航选择和助手排序持久化；不提供搜索、置顶或工具执行；自动标题见本文 Issue #31 契约。

`sessionConfig.ts` 负责模式、范围、字段错误和双采样确认；`requestMapping.ts` 负责协议能力、受保护字段、JSON 安全补充字段与最终 Body 构造。界面发送前校验，四个 adapter 在最终构造处再次校验。生成请求冻结配置，生成时修改的配置仅供下一次发送。运行状态表示“正在生成”，流式和非流式都可停止。

`contextBudget.ts` 只构造请求副本：必须保留系统指令与最新用户消息，从新到旧纳入完整且成功的 user/assistant 轮次；失败、取消、空内容及未完成轮次不进入后续请求。自动预算不裁剪完整轮次，自定义预算不足以容纳必保内容时阻止发送。原始消息不截断、不改写。已识别的 OpenAI 模型用本地对应 BPE 分词器，消息封装开销仍是估算；其他模型用 UTF-8 字节保守估算，界面均标注“估算”。分词数据按需加载，避免增加首屏主包。

助手编辑与对话行的铅笔入口共用紧凑参数弹窗；对话标题与完整配置原子保存，取消丢弃草稿。编辑任意对话绑定其 ID，不切换当前聊天。没有逐字段继承、覆盖或来源提示，仅底部提供“恢复助手默认值”。思考和搜索快捷入口自动保存当前对话配置；运行中修改只影响后续请求。助手编辑阻止保存无效配置，对话可保存未完成设置，但错误修正前不能发送。移除顶部独立设置按钮，对话行保留编辑和删除。

### Issue #52 conversation deletion

对话行删除使用本地待确认状态：右侧垃圾桶首次点击向左展开为“确认删除”，右边缘固定，第二次点击才执行现有 `delete-conversation` 命令；不弹确认窗口，不提供 Ctrl 跳过确认。取消、Escape、焦点离开该行、点击行外、切换对话/助手、收起导航或窗口失焦均清除待确认状态；鼠标移开不清除。Escape 在收起导航之前先取消删除。确认失败仍由现有工作区错误提示呈现，重新删除需要再次确认。助手删除弹窗和底层生成占用、存储及附件清理规则不变。

## Provider-native search

### Issue #21 quick model selection

聊天顶部为单层工具栏：左侧是侧栏图标和对话标题，右侧是仅显示模型名的选择按钮、宽窄切换和清空。助手名保留在侧栏与标题悬浮提示中，供应商和连接保留在模型悬浮提示及选择弹窗中。正文不再重复标题和模型栏；长名称省略，操作提供悬浮、按下和键盘焦点反馈，动效遵循系统减少动态效果偏好。

对话标题的模型按钮打开 `ModelPicker`：仅搜索本地已配置模型，按供应商和连接分组，显示协议及当前选择，不拉目录、不测试、不自动生成。选择通过现有 `configure-conversation` 保存当前对话完整快照中的模型引用，助手模板及其他对话不变；模型唯一父连接决定协议、地址和凭据。生成中的请求仍使用冻结目标，切换仅影响下一次请求。

思考选项仅依据 `thinkingOptions` 的协议契约，不按模型名推断。跨协议切换清除两端不共通的已选思考档位、预算和力度，切回不会复活不可用参数；共通选项保留各协议自己的值，包括四协议都支持的本地思考显示偏好。同协议换模型保留参数。四协议均已提供联网映射，保留会话联网开关并由目标 adapter 生成对应字段。Chat Completions 的思考显示复选框可用，并注明内容取决于兼容服务是否返回。此实现遵循 #28 完成说明中的独立会话快照，取代 #21 旧正文的持续跟随助手语义。

搜索通过 ChatTransport 的 `search-update` 与 `provider-replay` 事件进入会话。SearchRecord 是展示快照；Anthropic ProviderReplay 保留完整原始块，按连接 ID/地址隔离，仅在原协议回传。paused 消息携带冻结配置与初始历史；用户显式继续，普通后续消息仍按完整轮次裁剪。记录不含凭据。

SafeMarkdown 继续禁止原始 HTML。Gemini searchEntryPoint 只进入 scriptless sandbox iframe 的独立文档；主 DOM 不注入供应商 HTML，父组件绑定链接和高度。外链统一使用受限 HTTP(S) opener。新可选字段沿用 repository 持久化，无新增表/索引；编辑正文清除引用和 replay，删除使旧续接失效。详见 [#6 实施记录](ISSUE-6-NATIVE-SEARCH-PLAN.md)。

### Issue #15 math rendering

普通文本的 LF/CRLF 单换行在搜索引用定位完成后转换为 Markdown break 节点，用户消息、助手正文和摘要统一生效；代码和数学节点不改写，不再使用用户消息段落的 `white-space: pre-wrap` 作为换行补丁，避免显式换行与空白样式叠加。CRLF 的源码引用偏移先映射到解析后的文本位置，转换仍只影响显示。

用户消息、助手正文和思考摘要共享 SafeMarkdown，用户消息同时支持安全 Markdown，普通段落保留单换行。remark-math 提供数学节点，markdownMath.ts 在 Markdown 解析阶段识别 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`；双美元及 `\[...\]` 使用独立公式排版。单美元内部首尾不能留空白，结束符后不能紧接数字，以避免常见货币误判；有歧义的美元文本使用 `\$`。不做全局替换，原文位置供搜索引用继续使用；公式内的引用角标放在公式后。

行内代码、缩进代码及围栏代码（包括 math 标签）保持字面显示。rehype-katex 使用 `trust: false`，非法公式沿用插件的可读源码降级；不开放原始 HTML 或可信命令。KaTeX 引擎与 CSS/字体版本保持一致并本地打包；公式继承主题文字颜色，超长公式局部横向滚动。所有转换限于渲染树，持久化、复制、编辑及请求仍使用原始消息，无数据库迁移或协议变更。
