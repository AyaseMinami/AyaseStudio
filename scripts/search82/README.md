# #82 isolated acceptance

Start `npx.cmd vite --config scripts/search82/vite.config.ts`, then open `http://127.0.0.1:1519/scripts/search82/index.html` in the Codex in-app browser. This mounts actual search settings and both chat selectors under a separate origin. Use synthetic keys only. The HTTP alias returns synthetic results and rejects other destinations; no chat repository is mounted. `window.search82Requests` contains provider names only.

Watching/HMR is disabled. After changing fixture or UI source, restart this server and reload the tab before acceptance. `--force` can refresh dependency optimization when changing aliases.

For native startup smoke, while the fixture server is running use `npm.cmd run tauri dev -- --config scripts/search82/native.config.json --no-watch`. The separate application identifier keeps native app storage apart. Native startup does not establish real API connectivity, billing, window interactions or restart acceptance.
