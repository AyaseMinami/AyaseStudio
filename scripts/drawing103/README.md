# #103 isolated acceptance

Run `npx.cmd vite --config scripts/drawing103/vite.config.ts`, then open
`http://127.0.0.1:1532/scripts/drawing103/index.html` in the Codex in-app browser.
The actual drawing UI/controller uses in-memory repositories, synthetic original
PNG bytes and fake fetch responses through real Grok/Seedream adapters. It never
mounts App or reads production data, credentials or providers. Refresh resets it.

The separate `settings.html` entry mounts real connection settings with a synthetic
connection; edits are in memory, and catalog/network callbacks are mocks. It never
saves credentials or fetches provider models.

Select each protocol/profile, add ordered synthetic references, generate and check
the original-byte/order counters, frozen tasks, preview, parameter reuse and
unsupported profile alerts. Theme switching is fixture-only. Export and file
access are mocks; browser success does not establish native save/dialog acceptance.

For startup only, run `npm.cmd run tauri dev -- --config scripts/drawing103/native-probe.config.json --no-watch`.
This uses the separate `io.github.ayaseminami.ayasestudio.drawing103` identifier.
The page retains mocks even inside Tauri; this checks compilation/startup, not live
networking, native saving, export dialogs or desktop window interactions.

Check the fixture with `npx.cmd tsc -p scripts/drawing103/tsconfig.json --noEmit`.
