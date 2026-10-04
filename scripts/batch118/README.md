# #118 isolated batch management acceptance

From the repository root:

```powershell
npm.cmd run dev -- scripts/batch118 --config scripts/batch118/vite.config.ts
```

Open `http://127.0.0.1:1519/` in the Codex in-app browser. Vite 8 uses a
positional root argument; it has no `--root` flag.

Switch between 聊天验收 and 连接验收, toggle light/dark theme and generation
protection, and check narrow layouts. Actual production navigation, workspace,
repository and connection settings components are used. The fixture seeds the
default assistant, a reading assistant with three conversations, an empty
assistant, two nonempty providers and an empty provider. Messages and models
are synthetic. `window.batch118Snapshot` exposes only this page's synthetic
workspace/settings, selected conversation ID and generating IDs.

Every page load creates a unique `Batch118Synthetic-<uuid>` Dexie database.
Only this page's exact database name is closed/deleted on pagehide; no existing
database is enumerated for deletion. Avatar repositories are in memory. Themes
do not use localStorage. Native calls and external/provider fetches are blocked.
Pagehide cleanup is best-effort; refresh always starts from fresh synthetic data.
The generating toggle marks the currently selected conversation and forces a
rerender; provider/connection deletion uses atomic pure bulk helpers and one
state update after object-reference validation. Reload resets all fixture data.

Watching/HMR is disabled. Restart the server after source changes before
acceptance. This fixture provides browser acceptance only.
