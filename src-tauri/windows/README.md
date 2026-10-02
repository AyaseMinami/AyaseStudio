# Windows installer template

`installer.nsi` is the Tauri NSIS template from the `tauri-cli-v2.11.4` tag:
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi

Used under the MIT license in `LICENSE-TAURI-MIT`.

The only local change is the marked Ayase block after `SemverCompare` in
`PageReinstall`: an existing NSIS installation at the same or an older version
skips the maintenance-choice page with `Abort` and proceeds to installation.
It does not invoke the old uninstaller or change application-data directories.
First installation, downgrade choices, WiX migration, running-process checks,
installation-directory restoration, and the standalone uninstaller remain upstream.

When upgrading the Tauri CLI, compare this template with the matching upstream
version and reapply this small policy change. Do not copy the generated script
from `target`, which contains machine-specific paths and rendered build values.

Run `pwsh -NoProfile -File scripts/test-installer-policy.ps1` from the repository
root after a first NSIS bundle has populated Tauri's compiler/plugin cache.
The harness compiles and executes the actual version comparison and policy block
with nine upgrade/reinstall/downgrade/WiX inputs (including Alpha/Beta transitions), without installing an app or
touching registry or application data. It does not test GUI page navigation.

Validation: compile an NSIS bundle, inspect the generated script, then manually
check fresh install, same-version reinstall, and upgrade from an older NSIS
version. The latter two must skip the maintenance-choice page. Verify retained
chat/settings/attachments/background data separately; compilation is not runtime
installation acceptance.
