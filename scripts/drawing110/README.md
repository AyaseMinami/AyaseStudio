# Drawing #110 isolated measurements

For the separate idle-close regression, use `close-probe.config.json` instead of
the measurement config. It mounts the real drawing hook under the independent
`io.github.ayaseminami.ayasestudio.closeprobe` identifier with no provider calls.
Success requires `.drawing110.local/close-report.json` to say `guard-settled` and
the native process to exit with code 0. Restart this Vite server after editing
probe code because this isolated configuration disables watching/HMR.

Start the evidence server from the repository root:

```powershell
npx.cmd vite --config scripts/drawing110/vite.config.ts
```

Interactive browser entry: `http://127.0.0.1:1496/scripts/drawing110/index.html`.
Autorun entry: append `?autorun=1`.
The separate `interactive.html` entry renders the actual drawing workspace with
synthetic PNG selection, a paused import switch, status counters and theme toggle
for preview, reorder, cancellation and batch interaction acceptance.

With that server already running, launch the isolated native entry:

```powershell
npm.cmd run tauri dev -- --config scripts/drawing110/native-probe.config.json --no-watch
```

If a user-owned debug executable is already open, preserve it and set
`$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.drawing110.local/native-target'`
in this shell before launching. This builds a separate executable.

The identifier is `io.github.ayaseminami.ayasestudio.drawing110`. The entry never
mounts the ordinary App, reads user settings/credentials, or calls providers.
Every run uses a fresh named Dexie database. Reports are posted only to the
localhost Vite evidence endpoint and stored in `.drawing110.local/native-report.json`
or `.drawing110.local/browser-report.json`. Synthetic originals/results are
cleaned after each successful arm; interrupted processes may leave synthetic
resources in this identifier's private directory.

Native raw imports now publish an origin-scoped typed receipt before the original.
Startup inventory lists only this Webview origin's receipts for the fixed
AyaseStudio database contract; bare legacy originals and other origins are never
included. The harness uses isolated databases sequentially and cleans each arm
before the next. Native receipt scope adds no frontend path or request argument.

```powershell
npx.cmd tsc -p scripts/drawing110/tsconfig.json --noEmit
```

Both arms use the same fixture bytes: a noisy 4096-square PNG, three noisy
2048-square PNGs, and three successive 2048-square selections whose final image
alone is submitted. Each arm sends Gemini batch 2 then OpenAI batch 1 through
the actual controller/adapters with injected fake fetch. Hashes, MIME, dimensions,
PNG signatures, original alpha fixture and import counts are checked.

The baseline reconstructs the prechange selection pipeline from HEAD, including
arrayBuffer, Base64, native import, digest dedup, private Dexie draft save and
native thumbnail display. It is not an old executable comparison; dispatch in
both arms uses the current controller. Browser results use native mocks and must
not be reported as Rust/IPC measurements. See the report's limitations for timer
boundaries, IPC body accounting and cache/order effects. Fixture generation and
expected hashing are excluded; request integrity validation is recorded separately.
