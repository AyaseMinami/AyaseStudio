# Settings and drawing surface comparison

Run `npx.cmd vite --config scripts/workbench-material/vite.config.ts` and open
<http://127.0.0.1:1536/scripts/workbench-material/index.html> in the in-app browser.
Restart the server and reload after edits; this fixture disables HMR and watching.

It mounts actual `AppShell`, `SettingsWorkspace`, settings pages and
`DrawingWorkspace`, with in-memory appearance, mock connection/file callbacks,
three completed synthetic drawing tasks and a locally drawn PNG preview.
General settings use in-memory preferences so switch clicks and keyboard input
can be checked without changing real window/exit preferences.
The avatar library is isolated in `WorkbenchMaterialSynthetic` by the fixture's
Vite transform. Search settings use only this separate origin. Never enter real
credentials or invoke network-search tests in the fixture. CSP allows only
same-origin connections; provider and file actions are mocks, not acceptance.

The optional illustrated wallpaper comes from the previous imagegen session:
`.chat108.local/anime-opacity/wallpaper.png`. It remains an ignored local asset,
not a shipped background. Put that original there before selecting the wallpaper.
The collapsible comparison controls select the committed starting styles,
stable panels, 7%/15% transparent trials or actual production styles; themes,
background and mask are independent fixture controls. Production is the default.

Check fixture types with `npx.cmd tsc -p scripts/workbench-material/tsconfig.json --noEmit`.
The project source is included to match its Markdown type augmentations.
Browser checks establish frontend layout only, not native window interactions,
image export or actual provider behavior.
