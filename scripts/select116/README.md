# #116 isolated selector fixture

Run from the repository root:

```powershell
npx.cmd tsc -p scripts/select116/tsconfig.json
npx.cmd vite build --config scripts/select116/vite.config.ts
npx.cmd vite --config scripts/select116/vite.config.ts
```

Open `http://127.0.0.1:1557/scripts/select116/index.html`. Port 1557 is strict; HMR is disabled, so restart the server after source edits.

Toolbar buttons switch between actual production connection settings, network-search settings, background controls, drawing workspace, generation statistics, assistant/conversation configuration panels, and a native HTML dialog containing both selector types. Light/dark and four chat-protocol buttons are available. Model and preset lists contain synthetic long names; all four drawing protocols are present. Select Gemini advanced options using the actual disclosure; select Grok/Seedream versions using their real controls. The statistics tab hosts actual ThinkingToolbarControl inside a glass-enabled `.composer-frame`, with GenerationStats as its sibling, to check popup placement under backdrop-filter. Choose Anthropic to expose the thinking-effort dropdown.

No application entrypoint or stored application preferences are imported. Connection, drawing, preset and chat drafts live in React memory. The Vite fixture plugin substitutes an in-memory search-storage seam and synthetic search runtime, suppresses external link opening, and changes the avatar library database to `Select116Synthetic`. Avatar-library state, if used, belongs only to that synthetic database. Fetch is also blocked at runtime. There are no provider credentials, transports or native invocations. Reload resets in-memory edits. Build/cache artifacts stay inside ignored `.local/`.

This page is a visual acceptance aid. A successful build does not establish browser visual acceptance or native Tauri interaction acceptance. Browser automation should exercise actual dropdown options, search, long-label wrapping, scroll, themes, responsive sizes and dialog layering.

The assistant/conversation scenarios load production `AssistantConfig.css` after `App.css` and use the production identity-row wrapper and field IDs. Early captures omitted that local stylesheet; their panel layout evidence is superseded by the capability-layout follow-up in `docs/ISSUE-116-IMPLEMENTATION.md`.
