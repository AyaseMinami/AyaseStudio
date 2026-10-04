import { createHash } from "node:crypto";

export const REPOSITORY = "AyaseMinami/AyaseStudio";
export const PLATFORM = "windows-x86_64";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;
export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
export function parseVersion(version) {
  invariant(typeof version === "string", "Version must be a string");
  const match = SEMVER.exec(version);
  invariant(match, "Version must be strict X.Y.Z or X.Y.Z-beta.N without build metadata");
  return { core: match.slice(1, 4).map(BigInt), beta: match[4] === undefined ? null : BigInt(match[4]) };
}
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta > b.beta ? 1 : -1;
}
export function decodeBase64(value, label) {
  invariant(typeof value === "string" && value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), `${label} must be base64`);
  const bytes = Buffer.from(value, "base64");
  invariant(bytes.toString("base64") === value, `${label} must use canonical base64`);
  return bytes;
}
export function validatePublicKey(value) {
  const key = value?.trim();
  const lines = decodeBase64(key, "Updater public key").toString("utf8").trim().split(/\r?\n/);
  invariant(lines.length === 2 && lines[0].startsWith("untrusted comment: "), "Invalid minisign public key text");
  const packet = decodeBase64(lines[1], "Minisign public key packet");
  invariant(packet.length === 42 && packet.subarray(0, 2).toString() === "Ed", "Invalid minisign public key packet");
  return key;
}
export function validateSignature(value) {
  const signature = value?.trim();
  const lines = decodeBase64(signature, "Updater signature").toString("utf8").trim().split(/\r?\n/);
  invariant(lines.length === 4 && lines[0].startsWith("untrusted comment: ") && lines[2].startsWith("trusted comment: "), "Invalid minisign signature text");
  const packet = decodeBase64(lines[1], "Minisign signature packet");
  invariant(packet.length === 74 && ["Ed", "ED"].includes(packet.subarray(0, 2).toString()), "Invalid minisign signature packet");
  invariant(decodeBase64(lines[3], "Minisign global signature").length === 64, "Invalid minisign global signature");
  return signature;
}
export function artifactNames(version) {
  parseVersion(version);
  const installer = `Ayase.Studio_${version}_x64-setup.exe`;
  return { installer, signature: `${installer}.sig`, manifest: "latest.json", sums: "SHA256SUMS.txt", provenance: "provenance.json" };
}
export function artifactUrl(version) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${artifactNames(version).installer}`;
}
export function validateManifest(manifest, version = manifest?.version, signature) {
  parseVersion(version);
  invariant(manifest?.version === version, "Manifest version mismatch");
  invariant(typeof manifest.notes === "string", "Manifest notes must be a string");
  invariant(typeof manifest.pub_date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.pub_date) && Number.isFinite(Date.parse(manifest.pub_date)), "Manifest publication date must be UTC ISO");
  invariant(manifest.platforms && Object.keys(manifest.platforms).length === 1 && manifest.platforms[PLATFORM], "Manifest must contain only Windows x64");
  const target = manifest.platforms[PLATFORM];
  invariant(target.url === artifactUrl(version), "Manifest URL must name the exact repository, tag and canonical asset");
  validateSignature(target.signature);
  if (signature !== undefined) invariant(target.signature === signature.trim(), "Manifest signature differs from .sig artifact");
  return manifest;
}
export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function hashRecord(bytes) { return { size: bytes.length, sha256: sha256(bytes) }; }
export function checksumText(files, names) {
  return [names.installer, names.signature, names.manifest].map(name => `${sha256(files[name])}  ${name}\n`).join("");
}
export function verifyInventory(names, actual) {
  const expected = Object.values(names).sort();
  invariant(JSON.stringify([...actual].sort()) === JSON.stringify(expected), `Expected exact asset inventory: ${expected.join(", ")}`);
}
export function verifyArtifacts(files, { version, publicKey, sourceSha }) {
  const names = artifactNames(version);
  verifyInventory(names, Object.keys(files));
  const key = validatePublicKey(publicKey);
  invariant(files[names.installer].length > 0, "Installer is empty");
  const signature = validateSignature(files[names.signature].toString("utf8"));
  const manifest = validateManifest(JSON.parse(files[names.manifest].toString("utf8")), version, signature);
  invariant(files[names.sums].toString("utf8") === checksumText(files, names), "SHA256SUMS mismatch");
  const provenance = JSON.parse(files[names.provenance].toString("utf8"));
  invariant(provenance.schema === 1 && provenance.repository === REPOSITORY && provenance.version === version && provenance.tag === `v${version}` && provenance.platform === PLATFORM, "Provenance identity mismatch");
  invariant(/^[a-f0-9]{40}$/.test(provenance.sourceSha), "Invalid provenance source SHA");
  if (sourceSha !== undefined) invariant(provenance.sourceSha === sourceSha, "Provenance source SHA mismatch");
  invariant(provenance.publicKey === key, "Provenance signing key differs from configured updater key");
  const hashedNames = [names.installer, names.signature, names.manifest, names.sums];
  invariant(provenance.artifacts && JSON.stringify(Object.keys(provenance.artifacts).sort()) === JSON.stringify(hashedNames.sort()), "Provenance hash inventory mismatch");
  for (const name of hashedNames) {
    const actual = hashRecord(files[name]), expected = provenance.artifacts[name];
    invariant(expected.size === actual.size && expected.sha256 === actual.sha256, `Provenance hash/size mismatch: ${name}`);
  }
  return { names, manifest, provenance };
}
export function assertDispatch(env, requireAcceptance = false) {
  invariant(env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_REF === "refs/heads/main", "Releases require manual workflow_dispatch from main");
  invariant(env.GITHUB_REPOSITORY === REPOSITORY, "Unexpected release repository");
  invariant(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""), "Invalid workflow source SHA");
  if (requireAcceptance) invariant(env.NATIVE_ACCEPTANCE === "true", "Native installation and upgrade acceptance must be confirmed");
}
export function channelChanges(current, candidate) {
  validateManifest(candidate);
  const beta = parseVersion(candidate.version).beta !== null;
  const changes = {};
  for (const channel of beta ? ["beta.json"] : ["stable.json", "beta.json"]) {
    const previous = current[channel];
    if (!previous) { changes[channel] = candidate; continue; }
    validateManifest(previous);
    if (channel === "stable.json") invariant(parseVersion(previous.version).beta === null, "Stable channel contains prerelease");
    const order = compareVersions(candidate.version, previous.version);
    if (order > 0) changes[channel] = candidate;
    if (order === 0) invariant(JSON.stringify(candidate) === JSON.stringify(previous), "Same-version channel differs from verified candidate");
  }
  return changes;
}
