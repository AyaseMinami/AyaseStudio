# Windows release and updater runbook

This pipeline builds Windows x64 NSIS only. It creates a signed draft candidate from an explicitly dispatched `main` commit, then publishes those same bytes after human native acceptance. No automatic version bump, tag-triggered release, installer rebuild during publication, MSI, automatic mirror upload or Windows Authenticode signing is included. About also offers the maintained Baidu download link with its extraction code; maintainers upload accepted installers to that mirror separately.

The workflow files and scripts alone do not configure GitHub variables/secrets, enable Actions permissions, create a candidate, initialize the `updates` branch or establish native acceptance. Those external setup and execution steps remain pending until an authorized maintainer performs them.

## One-time repository setup

1. Enable GitHub Actions and permit the release workflows' `contents: write` token. Review repository rules so Actions can create version tags and the data-only `updates` branch. CI uses only `contents: read` and exposes no release secrets to pull requests.
2. Generate an updater signing key using the [official Tauri signing instructions](https://v2.tauri.app/plugin/updater/#signing-updates), for example `npm.cmd run tauri -- signer generate -w <private-backup-path>`. Keep an independent secure backup. Never commit the private key, paste it into logs, or rotate it without planning how existing clients will trust the new key.
3. Set repository variable `TAURI_UPDATER_PUBLIC_KEY` to the complete Tauri public-key base64 string. Set repository secret `TAURI_SIGNING_PRIVATE_KEY` to the private-key contents, and secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to its password (an empty value is valid for an unencrypted key). The public key is safe to distribute; private-key material is available only to candidate preflight/build steps.
4. Merge the reviewed pipeline and app updater integration to `main`. The local base Tauri config keeps an empty public key; candidate builds merge a JSON override under the runner's temporary directory containing that public key and `bundle.createUpdaterArtifacts: true`. Production update endpoints are selected by the native app from its compiled semver.

The two fixed endpoints are:

- Beta: `https://raw.githubusercontent.com/AyaseMinami/AyaseStudio/updates/beta.json`
- Stable: `https://raw.githubusercontent.com/AyaseMinami/AyaseStudio/updates/stable.json`

`updates` is an orphan Git branch containing only `beta.json` and/or `stable.json`. The publish script initializes it through the GitHub Git API, validates every existing tree entry, and advances it with a parent SHA and `force: false`. Both release workflows share the `ayase-release` concurrency group with cancellation disabled. An outside writer changing the branch causes a failure; rerun publication to reconcile the verified candidate. Do not put application source or documentation on this branch. A channel that has never received a release can be absent.

## Build a candidate

1. Prepare a version change on `dev`, review it and merge it to `main`. All five version sources must already match: `package.json`, root records in `package-lock.json`, `src-tauri/Cargo.toml`, the root package in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Accepted versions are strict `X.Y.Z-beta.N` or `X.Y.Z`; leading zeros, Alpha/RC and build metadata are rejected. Use a new version whose tag and Release do not exist.
2. Dispatch **Build release candidate** from `main` and fill in the release notes. The text is saved identically in `latest.json` and the draft Release body; later editing the draft body alone does not change the candidate's updater notes. It checks the selected ref, x64 runner, versions and signing configuration, installs locked npm dependencies, runs release-script tests, `npm.cmd run check`, locked Cargo test/check and the signature-helper tests. It then runs the signed NSIS build once with Cargo `--locked` and executes [installer-policy tests](../src-tauri/windows/README.md) after NSIS has populated its compiler cache. The actual installer ProductVersion must match the declared version.
3. The script copies only the standard `Ayase Studio_<version>_x64-setup.exe` and its `.sig`; upload names replace the product-name space with a dot. It never selects timestamp archive copies. CI calls the Tauri build directly; `npm.cmd run build:windows` remains the local build-and-archive command.
4. Before creating a draft, the pipeline checks the precise asset inventory, updater manifest URL, public key, signature consistency, SHA-256 and sizes. The Rust `verify-updater-signature` helper verifies the installer bytes with the same minisign implementation used by Tauri, then requires its authenticated trusted `file:` comment to name the original `Ayase Studio_<version>_x64-setup.exe` for the intended version. This prevents unsigned manifest/provenance metadata from relabeling an older signed installer. Tauri CLI 2.11.4 signs that original filename before upload normalization; the download name remains `Ayase.Studio_<version>_x64-setup.exe`. The pipeline creates `v<version>` at the recorded source commit and reads back every uploaded asset.

Exactly five assets are uploaded:

| Asset | Purpose |
| --- | --- |
| `Ayase.Studio_<version>_x64-setup.exe` | Canonical NSIS installer |
| `Ayase.Studio_<version>_x64-setup.exe.sig` | Tauri updater signature |
| `latest.json` | Windows x64 manifest with exact tag/asset download URL |
| `SHA256SUMS.txt` | Hashes of installer, signature and manifest |
| `provenance.json` | Source SHA, version/tag, public key, platform and hashes/sizes of the other four files |

The candidate is a draft; Beta candidates use `prerelease: true`. The corresponding workflow artifact preserves the same five files for 30 days. A rerun refuses an existing tag or Release and never replaces assets. If upload partially fails, preserve the workflow artifact and inspect the failed draft/tag; restore only missing files from that exact verified artifact under separate maintainer authorization, or discard the failed unpublished candidate and prepare a new version. Do not rebuild a different installer under the existing tag.

## Native acceptance and publication

Download the exact installer from the authenticated draft or workflow artifact. GitHub draft assets are not anonymously available, so a draft's production manifest URL cannot exercise anonymous update download. The application uses fixed production endpoints and provides no test-channel override. Before publication, test these exact candidate bytes by manual installation/upgrade and the signature helper; do not advertise an unaccepted draft on production channels. A separate native updater test host would be needed to exercise draft bytes through an isolated channel, and is not supplied by this implementation.

Verify fresh install, same-version reinstall, upgrade from an older NSIS version, application startup and retained conversations/settings/attachments/backgrounds. These installer/data-retention checks form the candidate's pre-publication native acceptance. After publication, separately verify real in-app check/download/cancel, confirmation, restart and final version from an older updater-enabled installation; keep this end-to-end result distinct from the pre-publication checklist. Policy tests, successful builds, synthetic browser interaction and signature verification do not establish either native acceptance. Older builds without this updater must manually install the first updater-enabled version; they cannot bootstrap themselves from the new channel.

After acceptance, dispatch **Publish accepted candidate** from `main`, enter its exact `v<version>` tag and select the native-acceptance checkbox. The workflow rejects a false confirmation. It downloads the existing draft assets and checks the complete inventory, hashes/sizes, manifest/version, actual installer ProductVersion, public key, signature and authenticated original filename/version, main ancestry and tag commit against provenance. It publishes the existing draft, downloads and checks the published assets again, and only then updates channels. The candidate installer is never rebuilt.

GitHub can return 404 for a draft at the release-by-tag endpoint even when the authenticated release listing and release-by-ID endpoint can read it. Only after that 404, publication scans the authenticated paginated list for exactly one matching tag and reads its canonical ID; missing/ambiguous tags, malformed IDs/listings and non-404 API failures stop before publication. All existing candidate verification still runs. A publication-script repair can be merged after the candidate source because the candidate must be an ancestor of dispatched `main`; it does not require rebuilding or reaccepting unchanged installer bytes.

Candidate preflight and draft creation reuse this lookup to reject an existing same-tag draft even if its Git tag is absent; an actually unused version requires both no Release and no Git tag.

The native signature helper is spawned asynchronously and awaited before artifact upload or publication. Initial Cargo compilation may take several minutes; Node must keep servicing HTTP socket/timeout events during that wait. A launch failure, nonzero exit or signal still stops publication. This does not rebuild the accepted NSIS installer or add automatic retries to GitHub mutations.

- A Beta release can advance only `beta.json`.
- Before publishing a stable draft, the workflow reads GitHub Latest and `stable.json`. The candidate must be strictly newer than each existing stable version; equal or older candidates are rejected before any remote mutation. An absent GitHub Latest (404) is allowed, but unexpected Latest metadata, a non-`v` tag, a prerelease or a non-strict stable version blocks publication. A successful stable publication is marked GitHub Latest and advances `stable.json`, and also `beta.json` if newer than its current version. A newer upcoming Beta is retained. Beta publication is never marked GitHub Latest and does not need this stable-version gate.
- A channel never moves to an older semver. Equal versions must contain the same manifest.

If publication succeeded but the channel write failed, rerun **Publish accepted candidate** for the same tag and confirmation. An already published Release is verified and retained; publication returns without reading or changing GitHub Latest, and the script repairs only eligible channels. No published asset is overwritten. Raw GitHub content may be cached; verify the branch files, published asset URLs and eventual anonymous channel response after the workflow completes.

Updater signatures authenticate update bytes. They do not add [Windows Authenticode signing](https://v2.tauri.app/distribute/sign/windows/) or SmartScreen reputation. The manual mirror in About is separate from pipeline assets and updater endpoints. Native installer/upgrade acceptance and real provider acceptance remain separate.

## Local deterministic checks and evidence

```powershell
node --test scripts/release/*.test.mjs
git diff --check
```

The tests use synthetic keys, signatures, installers and mocked GitHub API calls. They cover version alignment, strict semver, exact URLs, malformed/missing key or artifact, metadata/byte mismatches, dispatch/acceptance gates, published recovery, channel ordering, orphan initialization, data-only tree validation and optimistic non-force updates. Cryptographic validation is implemented in the native helper and exercised by its own tests; synthetic Node signature fixtures are not evidence of successful signing.

Actions are pinned to public revisions resolved on 2026-10-04: [checkout v4.2.2](https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683), [setup-node v4.4.0](https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020), [upload-artifact v4.6.2](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02), and [rust-toolchain stable revision](https://github.com/dtolnay/rust-toolchain/tree/89b12181fb390509a0842a86cc55eeb8eb928c1d). Node is `22.22.3` and Rust uses the stable toolchain; dependency locks remain authoritative. Review and update action pins deliberately.
