# #100 isolated supplier UI acceptance

From the repository root:

```powershell
npx.cmd vite --config scripts/providers100/vite.config.ts
```

Open `http://127.0.0.1:1513/scripts/providers100/` in the Codex in-app browser.
The real ConnectionSettings and shared avatar UI use pure settings commands,
synthetic keys and in-memory avatar repositories. No production database,
localStorage setting, native invocation or provider request is used; external
fetch is refused. Reload resets all data. `window.providers100State` exposes
only this synthetic state for scoped verification.

Check wide/narrow light/dark layouts, focused custom-name draft, empty/whitespace
refusal, save/Enter, cancel/Escape, supplier overview, renamed suppliers,
builtin deletion/readdition, stable-ID avatar selection/default reset, local
image import/crop/snapshot, avatar-save failure and generation protection.
Preset connection reset uses a native browser confirmation; accept/cancel it
explicitly. Native OS file dialogs and desktop restart remain separate acceptance.

“透明头像验收” switches to a real-component transparency gallery. Run
“检查透明通道与快照” to encode all 11 builtins as actual PNGs and crop a
synthetic Alpha image; transparent corners and opaque glyph pixels must remain.
Compare builtin and independent assistant snapshots in both themes, and use
the user “重新裁切” entry to check the transparent crop viewport. No saved user
data or configured credentials are read.

Native startup smoke (separate application identifier, same synthetic fixture):

```powershell
npm.cmd run tauri dev -- --config scripts/providers100/native.config.json --no-watch
```

The fixture intentionally disables watching. After source changes, restart this
Vite server before browser reload so acceptance uses the final code.
