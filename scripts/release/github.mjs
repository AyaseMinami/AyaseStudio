import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPOSITORY, artifactNames, parseVersion, compareVersions, invariant, verifyInventory, verifyArtifacts, sha256, channelChanges, validateManifest } from "./contracts.mjs";

export class GitHub {
  constructor(token, request = fetch) {
    invariant(token, "GitHub token is required");
    this.token = token;
    this.request = request;
  }
  async call(route, { method = "GET", body, binary = false, allow404 = false } = {}) {
    const url = `https://api.github.com/repos/${REPOSITORY}/${route}`;
    const response = await this.request(url, { method, headers: { Authorization: `Bearer ${this.token}`, Accept: binary ? "application/octet-stream" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 404 && allow404) return null;
    invariant(response.ok, `GitHub ${method} ${route} failed (${response.status})`);
    if (response.status === 204) return null;
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  async upload(release, name, bytes) {
    const url = `${release.upload_url.split("{")[0]}?name=${encodeURIComponent(name)}`;
    invariant(url.startsWith(`https://uploads.github.com/repos/${REPOSITORY}/releases/`), "Unexpected asset upload URL");
    const response = await this.request(url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/octet-stream", "X-GitHub-Api-Version": "2022-11-28" }, body: bytes });
    invariant(response.ok, `Asset upload failed for ${name} (${response.status}); retain candidate artifacts for recovery`);
    return response.json();
  }
}
export async function assertUnusedTag(api, version) {
  parseVersion(version);
  const tag = `v${version}`;
  invariant(!(await releaseByTag(api, tag)), "Release already exists; use publish workflow to recover channels, do not rebuild");
  invariant(!(await api.call(`git/ref/tags/${tag}`, { allow404: true })), "Tag already exists; do not rebuild or overwrite its assets");
}
export async function tagSource(api, tag) {
  let ref = (await api.call(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; ref.type === "tag" && depth < 8; depth++) ref = (await api.call(`git/tags/${ref.sha}`)).object;
  invariant(ref.type === "commit" && /^[a-f0-9]{40}$/.test(ref.sha), "Tag must resolve to a source commit");
  return ref.sha;
}
export function assertMainAncestry(sourceSha, mainSha, root = ".") {
  invariant(/^[a-f0-9]{40}$/.test(sourceSha) && /^[a-f0-9]{40}$/.test(mainSha), "Invalid ancestry commit");
  const result = spawnSync("git", ["merge-base", "--is-ancestor", sourceSha, mainSha], { cwd: root });
  invariant(!result.error && result.status === 0, "Candidate source is not in dispatched main ancestry");
}
export async function readReleaseArtifacts(api, release, version) {
  const names = artifactNames(version);
  const assets = await api.call(`releases/${release.id}/assets?per_page=100`);
  verifyInventory(names, assets.map(asset => asset.name));
  const files = {};
  for (const asset of assets) {
    invariant(asset.state === "uploaded" && Number.isSafeInteger(asset.size) && asset.size > 0, `Incomplete release asset: ${asset.name}`);
    const bytes = await api.call(`releases/assets/${asset.id}`, { binary: true });
    invariant(bytes.length === asset.size, `Downloaded size mismatch: ${asset.name}`);
    if (asset.digest) invariant(asset.digest === `sha256:${sha256(bytes)}`, `GitHub asset digest mismatch: ${asset.name}`);
    files[asset.name] = bytes;
  }
  return files;
}
export async function saveArtifacts(directory, files) {
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(directory, name), bytes);
}
export async function createDraft(api, files, { version, publicKey, sourceSha }) {
  const verified = verifyArtifacts(files, { version, publicKey, sourceSha });
  await assertUnusedTag(api, version);
  const tag = `v${version}`;
  await api.call("git/refs", { method: "POST", body: { ref: `refs/tags/${tag}`, sha: sourceSha } });
  const release = await api.call("releases", { method: "POST", body: { tag_name: tag, target_commitish: sourceSha, name: `Ayase Studio ${tag}`, body: verified.manifest.notes, draft: true, prerelease: parseVersion(version).beta !== null, make_latest: "false" } });
  for (const [name, bytes] of Object.entries(files)) await api.upload(release, name, bytes);
  const downloaded = await readReleaseArtifacts(api, release, version);
  verifyArtifacts(downloaded, { version, publicKey, sourceSha });
  invariant(await tagSource(api, tag) === sourceSha, "Created tag does not match candidate source");
  return release;
}
async function releaseByTag(api, tag) {
  const tagged = await api.call(`releases/tags/${encodeURIComponent(tag)}`, { allow404: true });
  if (tagged) return tagged;
  // Drafts can be absent from the by-tag endpoint even with write access.
  // Resolve their exact tag through the authenticated listing, then read by ID.
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await api.call(`releases?per_page=100&page=${page}`);
    invariant(Array.isArray(releases), "Invalid release listing");
    matches.push(...releases.filter(release => release?.tag_name === tag));
    invariant(matches.length <= 1, "Ambiguous release tag; refusing publication");
    if (releases.length < 100) break;
  }
  if (matches.length === 0) return null;
  invariant(Number.isSafeInteger(matches[0].id) && matches[0].id > 0, "Invalid release ID");
  return api.call(`releases/${matches[0].id}`);
}

export async function inspectRelease(api, tag, publicKey, mainSha, ancestry = assertMainAncestry) {
  invariant(typeof tag === "string" && tag.startsWith("v"), "Tag must start with v");
  const version = tag.slice(1);
  parseVersion(version);
  const release = await releaseByTag(api, tag);
  invariant(release, "Release not found for exact tag");
  invariant(release.tag_name === tag && typeof release.draft === "boolean" && release.prerelease === (parseVersion(version).beta !== null), "Release tag/channel mismatch");
  const files = await readReleaseArtifacts(api, release, version);
  const verified = verifyArtifacts(files, { version, publicKey });
  invariant(await tagSource(api, tag) === verified.provenance.sourceSha, "Tag commit differs from provenance source");
  ancestry(verified.provenance.sourceSha, mainSha);
  return { release, files, ...verified };
}
export async function publishVerifiedRelease(api, inspected) {
  const { release, provenance } = inspected;
  if (!release.draft) return release; // Published recovery: immutable assets, only channel repair.
  const beta = parseVersion(provenance.version).beta !== null;
  if (!beta) {
    const latest = await api.call("releases/latest", { allow404: true });
    if (latest !== null) {
      invariant(typeof latest.tag_name === "string" && latest.tag_name.startsWith("v") && latest.draft === false && latest.prerelease === false, "GitHub Latest must be a published stable v-version");
      const latestVersion = latest.tag_name.slice(1);
      invariant(parseVersion(latestVersion).beta === null, "GitHub Latest must use a strict stable version");
      invariant(compareVersions(provenance.version, latestVersion) > 0, "Stable candidate must be newer than GitHub Latest");
    }
    const { current } = await readChannels(api);
    const stable = current["stable.json"];
    if (stable) invariant(compareVersions(provenance.version, stable.version) > 0, "Stable candidate must be newer than the stable channel");
  }
  return api.call(`releases/${release.id}`, { method: "PATCH", body: { draft: false, prerelease: beta, make_latest: beta ? "false" : "true" } });
}
export async function readChannels(api) {
  const ref = await api.call("git/ref/heads/updates", { allow404: true });
  if (!ref) return { sha: null, current: {} };
  invariant(ref.object.type === "commit", "Updates branch must reference a commit");
  const commit = await api.call(`git/commits/${ref.object.sha}`);
  const tree = await api.call(`git/trees/${commit.tree.sha}`);
  invariant(!tree.truncated && tree.tree.every(entry => entry.type === "blob" && entry.mode === "100644" && ["beta.json", "stable.json"].includes(entry.path)), "Updates branch is DATA ONLY; unexpected files or modes");
  const current = {};
  for (const entry of tree.tree) {
    const blob = await api.call(`git/blobs/${entry.sha}`);
    invariant(blob.encoding === "base64", "Unexpected Git blob encoding");
    current[entry.path] = validateManifest(JSON.parse(Buffer.from(blob.content.replace(/\s/g, ""), "base64").toString("utf8")));
    if (entry.path === "stable.json") invariant(parseVersion(current[entry.path].version).beta === null, "Stable channel contains prerelease");
  }
  return { sha: ref.object.sha, current };
}
export async function advanceChannels(api, candidate, release) {
  invariant(release.draft === false && release.tag_name === `v${candidate.version}`, "Cannot advertise an unpublished release");
  const { sha, current } = await readChannels(api);
  const changes = channelChanges(current, candidate);
  if (Object.keys(changes).length === 0) return [];
  const next = { ...current, ...changes };
  const tree = await api.call("git/trees", { method: "POST", body: { tree: Object.entries(next).map(([name, manifest]) => ({ path: name, mode: "100644", type: "blob", content: JSON.stringify(manifest, null, 2) + "\n" })) } });
  const commit = await api.call("git/commits", { method: "POST", body: { message: `Publish update channels for v${candidate.version}`, tree: tree.sha, parents: sha ? [sha] : [] } });
  const latest = await api.call("git/ref/heads/updates", { allow404: true });
  invariant((latest?.object.sha ?? null) === sha, "Updates branch changed concurrently; rerun publish for verified recovery");
  if (sha) await api.call("git/refs/heads/updates", { method: "PATCH", body: { sha: commit.sha, force: false } });
  else await api.call("git/refs", { method: "POST", body: { ref: "refs/heads/updates", sha: commit.sha } });
  const confirmed = await readChannels(api);
  invariant(confirmed.sha === commit.sha, "Updates branch did not retain the new commit");
  for (const [name, manifest] of Object.entries(changes)) invariant(JSON.stringify(confirmed.current[name]) === JSON.stringify(manifest), `Channel readback mismatch: ${name}`);
  return Object.keys(changes);
}
