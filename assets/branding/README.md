# Ayase Studio icon

Hand-built SVG reconstruction of the folded-ribbon A concept selected on
2026-09-21. The white silhouette and diagonal cyan-blue-violet background are
editable geometry; no generated bitmap, external font, filter or image is embedded.

- `ayase-icon.svg`: 1024-unit master, transparent outside the rounded tile.
- `preview/`: SVG-rendered PNGs at 16, 24, 32, 48, 64, 128, 256, 512 and 1024 px.
- `ayase-icon.ico`: seven embedded sizes from 16 through 256 px for Windows.
- `size-review.png`: light/dark contact sheet; labeled sizes shown at native pixels.
  The unlabeled large image at the right of each row is an overview.

The tile occupies `(64, 64)` through `(960, 960)` with a 160-unit corner radius.
The gradient runs from top left to bottom right through `#38C7EF`, `#4779F0`
at 50%, and `#793CD6`. The mark uses two white paths; the main path has an
even-odd counter. The 64-unit transparent margin is intentional.

Regenerate from the repository root with `python assets/branding/export.py`.
This requires Pillow and the repository's installed npm/Tauri CLI. It does not
install dependencies or contact a generation service.

The export script also refreshes the existing desktop assets in `src-tauri/icons`.
Tauri's existing bundle configuration consumes these files, including `icon.ico`
for Windows executables/installers and `icon.icns` for macOS. The navigation brand
and browser favicon use the SVG master directly. Native taskbar/installer
appearance has not been verified. Small sizes retain the same silhouette;
the narrow fold loses detail at 16 px and may need a dedicated optical variant
after an actual taskbar check.

The reconstruction is visually matched, not a pixel-exact tracing. This directory
does not assert trademark clearance or add a separate asset license.
