# #76 isolated update preview

Run `npm.cmd run dev -- scripts/update76 --config scripts/update76/vite.config.ts`, then open http://127.0.0.1:1521/ in Codex's in-app browser.

Type-check with `npx.cmd tsc --project scripts/update76/tsconfig.json`.

Uses production `AboutSettings`, `UpdateController` and `App.css` with an in-memory synthetic `UpdateRuntime`. There is no database, localStorage, provider request, native runtime, real installer, process exit or restart. Theme and scenario selections are memory-only. External links are aliased to a mock that records their URL below the page and never navigates. The maintained mirror URL/code are shown but intercepted like other external links; copying still uses the production clipboard interaction. External fetch requests are blocked.

The toolbar selects available update, no update, check failure, download failure, signature failure, unknown download size, or unavailable environment. Selecting a scenario or 重置场景 resets the controller and cancels any synthetic transfer. 检查更新 waits 600 ms. 下载更新 advances every 400 ms over 16 steps; download failure occurs at step 4 and signature failure at completion. 取消下载 waits 300 ms before reporting a stopped transfer. 安装并重启 opens a visible mock confirmation: Cancel returns to ready; confirmation records a simulated installation without changing files or restarting.

Startup checking defaults on and uses the real 10-second delay. 常规设置 renders the production switch using an in-memory `GeneralPreferencesStore` (no localStorage). 模拟主界面就绪 gates startup; restarting a scene resets the synthetic process, while moving between 常规设置/About does not. Verify manual checking wins the delay, off suppresses checks, silent check failure, once-only checking and the dismissible production UpdateNotice. 查看更新 opens About without downloading; the drawing-output and avatar native controls remain unavailable in this browser fixture.

Inspect light/dark themes at 1280×800 and 720×620, update notes scrolling and literal HTML-looking text, duplicate-action disabling, cancellation during transfer, known/unknown download size, explicit install confirmation, errors and official/mirror links. The separate toolbar and event log are fixture controls. This establishes browser behavior only; native updater signature validation, networking, installation and lifecycle acceptance remain separate.

For an isolated native startup smoke check with this server already running, use `npm.cmd run tauri -- dev --config scripts/update76/native-probe.config.json --no-watch`. Its separate `updateprobe` identifier loads only `native-probe.html`, reads the local `update_status` command, writes the sanitized result to ignored `.update76.local/native-probe.json` through the loopback fixture server, and destroys its own window. It never opens production UI/storage or checks/downloads/installs an update. This proves host startup and command wiring only.
