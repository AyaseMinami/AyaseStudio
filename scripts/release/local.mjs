import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactNames, artifactUrl, PLATFORM, REPOSITORY, invariant, parseVersion, validatePublicKey, validateSignature, validateManifest, checksumText, hashRecord, verifyArtifacts } from "./contracts.mjs";

export async function readVersion(root = ".") {
  const json = async name => JSON.parse(await readFile(path.join(root, name), "utf8"));
  const pkg = await json("package.json"), lock = await json("package-lock.json"), config = await json("src-tauri/tauri.conf.json");
  const toml = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = await readFile(path.join(root, "src-tauri/Cargo.lock"), "utf8");
  const packageBlock = /^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(toml)?.[1];
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(packageBlock ?? "")?.[1];
  const rootLock = cargoLock.split("[[package]]").filter(block => /^\s*name = "ayase-studio"$/m.test(block));
  invariant(rootLock.length === 1, "Expected one root Cargo.lock package");
  const lockedVersion = /^version = "([^"]+)"$/m.exec(rootLock[0])?.[1];
  parseVersion(pkg.version);
  invariant([lock.version, lock.packages?.[""]?.version, config.version, cargoVersion, lockedVersion].every(version => version === pkg.version), "npm, Cargo and Tauri versions must already match");
  invariant(config.productName === "Ayase Studio" && JSON.stringify(config.bundle?.targets) === '["nsis"]', "Release supports Ayase Studio NSIS only");
  return { version: pkg.version, config };
}
export async function writeBuildConfig(output, publicKey) {
  const key = validatePublicKey(publicKey);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: key } } }, null, 2) + "\n");
}
export async function loadArtifacts(directory, version) {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(directory);
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(directory, name))])));
}
export function verifyNativeSignature(directory, names, publicKey, version, root = ".", run = spawnSync) {
  parseVersion(version);
  const result = run("cargo", ["run", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--features", "release-tools", "--bin", "verify-updater-signature", "--", validatePublicKey(publicKey), path.resolve(directory, names.installer), path.resolve(directory, names.signature), version], { cwd: root, stdio: "inherit" });
  invariant(!result.error && result.status === 0, "Native updater signature verification failed");
}
export function verifyInstallerVersion(directory, names, version, run = spawnSync) {
  parseVersion(version);
  const script = fileURLToPath(new URL("./verify-product-version.ps1", import.meta.url));
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, "-Installer", path.resolve(directory, names.installer), "-Version", version], { stdio: "inherit" });
  invariant(!result.error && result.status === 0, "Built/downloaded installer ProductVersion mismatch");
}
export async function prepareArtifacts({ root = ".", directory, publicKey, sourceSha, notes, now = new Date() }) {
  const { version, config } = await readVersion(root);
  invariant(/^[a-f0-9]{40}$/.test(sourceSha), "Invalid build source SHA");
  const key = validatePublicKey(publicKey), names = artifactNames(version);
  const source = path.join(root, "src-tauri/target/release/bundle/nsis", `${config.productName}_${version}_x64-setup.exe`);
  await mkdir(directory, { recursive: true });
  await copyFile(source, path.join(directory, names.installer));
  await copyFile(`${source}.sig`, path.join(directory, names.signature));
  const signature = validateSignature(await readFile(`${source}.sig`, "utf8"));
  invariant(typeof notes === "string" && notes.trim().length > 0, "Candidate release notes are required");
  const manifest = validateManifest({ version, notes, pub_date: now.toISOString(), platforms: { [PLATFORM]: { signature, url: artifactUrl(version) } } });
  await writeFile(path.join(directory, names.manifest), JSON.stringify(manifest, null, 2) + "\n");
  const files = {};
  for (const name of [names.installer, names.signature, names.manifest]) files[name] = await readFile(path.join(directory, name));
  files[names.sums] = Buffer.from(checksumText(files, names));
  await writeFile(path.join(directory, names.sums), files[names.sums]);
  const provenance = { schema: 1, repository: REPOSITORY, version, tag: `v${version}`, platform: PLATFORM, sourceSha, publicKey: key, artifacts: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hashRecord(bytes)])) };
  files[names.provenance] = Buffer.from(JSON.stringify(provenance, null, 2) + "\n");
  await writeFile(path.join(directory, names.provenance), files[names.provenance]);
  verifyArtifacts(await loadArtifacts(directory, version), { version, publicKey: key, sourceSha });
  verifyInstallerVersion(directory, names, version);
  verifyNativeSignature(directory, names, key, version, root);
  return version;
}
