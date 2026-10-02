# #105 isolated backup acceptance

This is a backup-only synthetic harness, not acceptance of the complete App lifecycle,
real-provider behavior, power loss, or ordinary-user data. It never mounts chat/drawing
controllers. No native/GUI run is implicit in creating or compiling these files.

All five native configurations use **only**
`io.github.ayaseminami.ayasestudio.data105finish`. The page checks the actual Tauri
identifier before opening the fixed `AyaseStudio` IndexedDB database or calling the
native file fence. Browser mode uses `Data105-browser`, never `AyaseStudio`.
Do not launch this page through the ordinary application configuration.

Start from the repository root; restart the server after every harness edit because
watching and HMR are disabled:

```powershell
npm.cmd exec tsc -- --noEmit -p scripts/data105/tsconfig.json
npm.cmd exec vite -- --config scripts/data105/vite.config.ts
```

The server listens only on `127.0.0.1:1505` with strict port selection. Reports POST
to `/data105-report`, are limited to 2,000,000 bytes and can write only:

- `.data105.local/seed-staging-report.json`
- `.data105.local/seed-applying-report.json`
- `.data105.local/recover-staging-report.json`
- `.data105.local/recover-applying-report.json`
- `.data105.local/browser-report.json`
- `.data105.local/manual-report.json`

Browser entry: `http://127.0.0.1:1505/scripts/data105/index.html`. It mounts the actual
`BackupWorkspace` with the real inspect/conflicts/restore API, simulated files, and
in-memory export/select wrappers. Select returns the most recent exported sample,
or the modern/v1/v3/future-readable sample chosen in the sample selector.
Encryption/password confirmation and merge/copy/replace therefore use production
frontend code without OS dialogs. Browser reports overwrite their fixed report file
with the latest action; save separate evidence if history is needed. A fresh browser
profile/origin is required if unrelated preferences already exist. After copy/replace,
reload retains the marked synthetic state and checks its current projected settings
and full preset content; it does not reseed or clear the edited data.

With the evidence server running, execute the following pairs **sequentially**.
Each seed writes a synthetic journal and programmatically closes the test window;
each matching recovery must finish before the next seed. The recover configs include
`autoclose=1`; remove that query in a local reviewed config to inspect the success page.

```powershell
npm.cmd run tauri dev -- --config scripts/data105/seed-staging.config.json --no-watch
npm.cmd run tauri dev -- --config scripts/data105/recover-staging.config.json --no-watch
npm.cmd run tauri dev -- --config scripts/data105/seed-applying.config.json --no-watch
npm.cmd run tauri dev -- --config scripts/data105/recover-applying.config.json --no-watch
```

The seed refuses an existing journal or unexpected data. It puts a default assistant,
conversation, message and selection, an initial drawing draft/preset, legacy search v1
with an empty Key and legacy appearance omissions. It captures the full private
snapshot, registers a valid `staging`/`applying` restore journal owning one UUID
`.txt` attachment, then writes that attachment in this identifier's private directory.
The applying arm changes
synthetic assistant/search/appearance values after journaling. A script-only
`data105.synthetic.expected` localStorage key stores only the BEFORE hash, UUID
reference and phase; it is outside production snapshot preference registration.

Recovery calls `recoverBackupAtStartup()` with real native fences, IndexedDB and native
files. Success requires exact BEFORE snapshot hash restoration, no journal, removal
of the journal-owned attachment, a second recovery returning false, and production
v5 export/encode/decode preserving migrated legacy/default behavior without writes.
Each recovery also decodes fixed v1/v3 samples and confirms future-readable optional
parameter warnings survive reexport while retaining the original raw sample.
Reports contain hashes, phases and flags, not raw snapshots or credential values.
Fetch permits the same-origin report/fixture endpoints and, only in native mode,
Tauri's internal `ipc:` / `http://ipc.localhost` fallback. External provider URLs
remain blocked; internal IPC is not counted as a provider request.
Programmatic close/startup is separate from title-bar interaction and sudden power loss.

For real OS save/open-dialog acceptance, finish recovery first and launch:

```powershell
$data105PreviousTitlebar = $env:AYASE_NATIVE_TITLEBAR
try {
  $env:AYASE_NATIVE_TITLEBAR = '1'
  npm.cmd run tauri dev -- --config scripts/data105/manual.config.json --no-watch
} finally {
  if ($null -eq $data105PreviousTitlebar) { Remove-Item Env:AYASE_NATIVE_TITLEBAR -ErrorAction SilentlyContinue }
  else { $env:AYASE_NATIVE_TITLEBAR = $data105PreviousTitlebar }
}
```

Both browser/manual initialization generate these fixed synthetic files through
the allowlisted `/data105-fixture` POST endpoint (the same 2,000,000 byte limit):

- `.data105.local/fixture-modern.ayasebackup`
- `.data105.local/fixture-v1.ayasebackup`
- `.data105.local/fixture-v3.ayasebackup`
- `.data105.local/fixture-future-readable.ayasebackup`

The files use fixed sample rows, normalized defaults, empty/omitted credentials,
no assets and checksummed plaintext envelopes. They never contain raw local
preference texts. The future-readable sample retains its original extra parameter;
inspection filters it in a private copy and reexport retains the path-only warning.
Select these files in the real open dialog to check old-version import and the
future-parameter warning without manually constructing a backup.

This window is titled `#105 隔离验收（合成数据）`, initializes the real native fence and
startup recovery, then mounts `BackupWorkspace(createBackupApi(...))` against the
isolated synthetic repository. Export only this sample, then open that exported file.
Check save/open cancel, plaintext/encrypted export, wrong/right password, confirmation,
and merge/copy/replace manually. Do not select real user backups. `manual-report.json`
records readiness and says manual acceptance is pending; it does not attest those
interactions. Record observed results separately. Manual reload retains changes;
later seed phases still refuse a snapshot that differs from their captured BEFORE
hash. Preserve evidence before using a fresh isolated profile for another seed run.

If an ordinary debug executable is already running, preserve it and set a separate
build directory in the test shell before any native launch:

```powershell
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.data105.local/native-target'
```

Only one instance of this dedicated identifier may run at a time. Never delete or
move ordinary application data to make the harness pass. Interrupted seeds may leave
synthetic files/journals; run the matching recovery rather than resetting storage.
