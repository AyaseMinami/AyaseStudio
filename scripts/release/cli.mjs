import { appendFile } from "node:fs/promises";
import path from "node:path";
import { assertDispatch, validatePublicKey, verifyArtifacts, invariant } from "./contracts.mjs";
import { readVersion, writeBuildConfig, prepareArtifacts, loadArtifacts, verifyNativeSignature, verifyInstallerVersion } from "./local.mjs";
import { GitHub, assertUnusedTag, createDraft, inspectRelease, saveArtifacts, publishVerifiedRelease, advanceChannels } from "./github.mjs";

const command = process.argv[2];
assertDispatch(process.env, command === "publish");
const publicKey = validatePublicKey(process.env.TAURI_UPDATER_PUBLIC_KEY);
const api = new GitHub(process.env.GH_TOKEN);
const directory = path.join(process.env.RUNNER_TEMP ?? "release.local", "ayase-candidate");
if (command === "preflight") {
  invariant(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim(), "Updater signing private key secret is required");
  const { version } = await readVersion();
  await assertUnusedTag(api, version);
  const configPath = path.join(process.env.RUNNER_TEMP ?? "release.local", "ayase-updater.config.json");
  await writeBuildConfig(configPath, publicKey);
  invariant(process.env.GITHUB_OUTPUT, "Missing workflow output file");
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nconfig=${configPath}\nartifacts=${directory}\n`);
} else if (command === "prepare") {
  await prepareArtifacts({ directory, publicKey, sourceSha: process.env.GITHUB_SHA, notes: process.env.RELEASE_NOTES });
} else if (command === "draft") {
  const { version } = await readVersion();
  const files = await loadArtifacts(directory, version);
  const verified = verifyArtifacts(files, { version, publicKey, sourceSha: process.env.GITHUB_SHA });
  verifyInstallerVersion(directory, verified.names, version);
  verifyNativeSignature(directory, verified.names, publicKey, version);
  const release = await createDraft(api, files, { version, publicKey, sourceSha: process.env.GITHUB_SHA });
  console.log(`Draft ready: ${release.html_url}`);
} else if (command === "publish") {
  const inspected = await inspectRelease(api, process.env.RELEASE_TAG, publicKey, process.env.GITHUB_SHA);
  await saveArtifacts(directory, inspected.files);
  verifyInstallerVersion(directory, inspected.names, inspected.provenance.version);
  verifyNativeSignature(directory, inspected.names, publicKey, inspected.provenance.version);
  await publishVerifiedRelease(api, inspected);
  // Re-download immutable published assets before advertising either channel.
  const published = await inspectRelease(api, process.env.RELEASE_TAG, publicKey, process.env.GITHUB_SHA);
  invariant(published.release.draft === false, "Release is still a draft");
  for (const [name, bytes] of Object.entries(inspected.files)) invariant(bytes.equals(published.files[name]), `Published asset changed: ${name}`);
  const channels = await advanceChannels(api, published.manifest, published.release);
  console.log(`Published candidate verified; channels advanced: ${channels.join(", ") || "already current/newer"}`);
} else {
  throw new Error("Use preflight, prepare, draft or publish");
}
