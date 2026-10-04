# #119 isolated model-group preview

Run `npm.cmd run dev -- scripts/model-groups119 --config scripts/model-groups119/vite.config.ts`, then open http://127.0.0.1:1520/ in Codex's in-app browser.

Type-check the fixture and its production dependencies with `npx.cmd tsc --project scripts/model-groups119/tsconfig.json`.

Uses the production connection settings and chat picker with synthetic models and empty credentials. Preferences are exclusively namespaced `fixture119:` on this isolated origin; avatar/native/provider boundaries use this fixture's in-memory stubs and external fetch is blocked. No live user database or provider request is used. Refresh retains only the synthetic configuration; 重置演示数据 restores its initial state. Theme, busy and save-failure toggles are preview controls only.

Check automatic grouping, custom creation/rename/delete, single and batch assignment, visible-only selection while searching, connection switching, restore automatic, picker context/search, reload, light/dark and narrow layouts. This is browser acceptance, not native window interaction acceptance.
