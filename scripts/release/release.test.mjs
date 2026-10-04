import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactNames, artifactUrl, PLATFORM, REPOSITORY, parseVersion, compareVersions, validatePublicKey, validateSignature, validateManifest, sha256, hashRecord, checksumText, verifyArtifacts, channelChanges, assertDispatch } from "./contracts.mjs";
import { readVersion, writeBuildConfig, verifyInstallerVersion, verifyNativeSignature } from "./local.mjs";
import { GitHub, assertUnusedTag, inspectRelease, publishVerifiedRelease, readChannels, advanceChannels } from "./github.mjs";

const sourceSha = "a".repeat(40), mainSha = "b".repeat(40);
const publicKey = makeKey(1);
function makeKey(value) {
  const packet = Buffer.alloc(42, value); packet.write("Ed");
  return Buffer.from(`untrusted comment: test key\n${packet.toString("base64")}\n`).toString("base64");
}
function makeSignature(value = 1) {
  const packet = Buffer.alloc(74, value); packet.write("ED");
  return Buffer.from(`untrusted comment: test signature\n${packet.toString("base64")}\ntrusted comment: timestamp:1\n${Buffer.alloc(64, value).toString("base64")}\n`).toString("base64");
}
function manifest(version = "1.2.3-beta.1") {
  return { version, notes: "Synthetic release fixture", pub_date: "2026-10-04T00:00:00.000Z", platforms: { [PLATFORM]: { signature: makeSignature(), url: artifactUrl(version) } } };
}
function artifacts(version = "1.2.3-beta.1") {
  const names = artifactNames(version);
  const files = { [names.installer]: Buffer.from("synthetic installer"), [names.signature]: Buffer.from(makeSignature() + "\n"), [names.manifest]: Buffer.from(JSON.stringify(manifest(version))) };
  files[names.sums] = Buffer.from(checksumText(files, names));
  files[names.provenance] = Buffer.from(JSON.stringify({ schema: 1, repository: REPOSITORY, version, tag: `v${version}`, sourceSha, platform: PLATFORM, publicKey, artifacts: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hashRecord(bytes)])) }));
  return files;
}

test("strict release semver and numeric ordering", () => {
  for (const value of ["0.1.0", "0.1.0-beta.0", "1.2.3-beta.10"]) assert.doesNotThrow(() => parseVersion(value));
  for (const value of ["v1.2.3", "01.2.3", "1.2.3-beta.01", "1.2.3-alpha.1", "1.2.3-rc.1", "1.2.3+build", "1.2", "1.2.3-beta", "1.2.3\n"]) assert.throws(() => parseVersion(value));
  assert.equal(compareVersions("1.2.3-beta.10", "1.2.3-beta.2"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3-beta.999"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.4-beta.1"), -1);
  assert.equal(compareVersions("999999999999999999999.0.0", "999999999999999999998.0.0"), 1);
});
test("key/signature syntax requires real Tauri envelope shape", () => {
  assert.equal(validatePublicKey(publicKey), publicKey);
  assert.equal(validateSignature(makeSignature()), makeSignature());
  for (const value of [undefined, "", "placeholder", Buffer.from("untrusted comment: x\nZm9v\n").toString("base64")]) assert.throws(() => validatePublicKey(value));
  assert.throws(() => validateSignature(publicKey));
});
test("actual installer ProductVersion must match declared release", () => {
  const names = artifactNames("1.2.3-beta.1");
  const run = (command, args) => {
    assert.equal(command, "powershell.exe");
    assert.equal(args[2], "-File");
    assert.ok(args[3].endsWith("verify-product-version.ps1"));
    assert.equal(args[5], path.resolve("candidate", names.installer));
    assert.equal(args[7], "1.2.3-beta.1");
    return { status: 0 };
  };
  assert.doesNotThrow(() => verifyInstallerVersion("candidate", names, "1.2.3-beta.1", run));
  assert.throws(() => verifyInstallerVersion("candidate", names, "1.2.3-beta.1", () => ({ status: 1 })), /ProductVersion/);
  assert.throws(() => verifyInstallerVersion("candidate", names, "1.2.3-beta.1", () => ({ error: new Error("Unavailable"), status: null })), /ProductVersion/);
});
test("native verifier receives the intended version as a separate argument", () => {
  const version = "1.2.3-beta.1", names = artifactNames(version);
  let calls = 0;
  const run = (command, args, options) => {
    calls++;
    assert.equal(command, "cargo");
    assert.deepEqual(args.slice(args.indexOf("--") + 1), [publicKey, path.resolve("candidate", names.installer), path.resolve("candidate", names.signature), version]);
    assert.ok(args.includes("--locked"));
    assert.equal(args[args.indexOf("--features") + 1], "release-tools");
    assert.equal(options.cwd, "source-root");
    assert.equal(options.shell, undefined);
    return { status: 0 };
  };
  assert.doesNotThrow(() => verifyNativeSignature("candidate", names, publicKey, version, "source-root", run));
  assert.equal(calls, 1);
  assert.throws(() => verifyNativeSignature("candidate", names, publicKey, undefined, "source-root", run), /Version/);
  assert.equal(calls, 1);
  assert.throws(() => verifyNativeSignature("candidate", names, publicKey, version, ".", () => ({ status: 1 })), /signature verification failed/);
});
test("manifest URL pins repository, exact version tag and installer", () => {
  const value = manifest();
  assert.doesNotThrow(() => validateManifest(value));
  for (const url of [value.platforms[PLATFORM].url.replace("https:", "http:"), value.platforms[PLATFORM].url.replace("v1.2.3-beta.1", "latest"), value.platforms[PLATFORM].url + "?mirror=1", value.platforms[PLATFORM].url.replace("AyaseMinami", "other")]) {
    assert.throws(() => validateManifest({ ...value, platforms: { [PLATFORM]: { ...value.platforms[PLATFORM], url } } }));
  }
  assert.throws(() => validateManifest({ ...value, version: "1.2.3" }, value.version));
  assert.throws(() => validateManifest({ ...value, platforms: { ...value.platforms, "linux-x86_64": value.platforms[PLATFORM] } }));
  assert.throws(() => validateManifest(value, value.version, makeSignature(2)));
});
test("candidate checks all inventory, byte hashes, size, key and source identity", () => {
  const files = artifacts(), names = artifactNames("1.2.3-beta.1");
  const options = { version: "1.2.3-beta.1", publicKey, sourceSha };
  assert.equal(verifyArtifacts(files, options).provenance.sourceSha, sourceSha);
  const missing = { ...files }; delete missing[names.signature];
  assert.throws(() => verifyArtifacts(missing, options), /inventory/);
  assert.throws(() => verifyArtifacts({ ...files, "archive.exe": Buffer.from("duplicate") }, options), /inventory/);
  assert.throws(() => verifyArtifacts({ ...files, [names.installer]: Buffer.from("tampered") }, options), /SHA256SUMS/);
  assert.throws(() => verifyArtifacts(files, { ...options, publicKey: makeKey(2) }), /signing key/);
  assert.throws(() => verifyArtifacts(files, { ...options, sourceSha: mainSha }), /source SHA mismatch/);
  const provenance = JSON.parse(files[names.provenance]); provenance.artifacts[names.installer].size++;
  assert.throws(() => verifyArtifacts({ ...files, [names.provenance]: Buffer.from(JSON.stringify(provenance)) }, options), /hash\/size/);
  assert.throws(() => verifyArtifacts(files, { ...options, publicKey: "" }), /public key/);
});
test("channel advancement is monotonic and stable never rolls back upcoming beta", () => {
  assert.deepEqual(Object.keys(channelChanges({}, manifest())), ["beta.json"]);
  assert.deepEqual(Object.keys(channelChanges({}, manifest("1.2.3"))), ["stable.json", "beta.json"]);
  const current = { "stable.json": manifest("1.2.2"), "beta.json": manifest("1.3.0-beta.2") };
  assert.deepEqual(Object.keys(channelChanges(current, manifest("1.2.3"))), ["stable.json"]);
  assert.deepEqual(channelChanges({ "beta.json": manifest("1.2.3-beta.10") }, manifest("1.2.3-beta.2")), {});
  assert.deepEqual(channelChanges({ "beta.json": manifest() }, manifest()), {});
  assert.throws(() => channelChanges({ "beta.json": { ...manifest(), notes: "changed" } }, manifest()), /Same-version/);
  assert.throws(() => channelChanges({ "stable.json": manifest() }, manifest("1.2.3")), /prerelease/);
});
test("manual main dispatch and explicit native acceptance are enforced", () => {
  const env = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: REPOSITORY, GITHUB_SHA: sourceSha };
  assert.doesNotThrow(() => assertDispatch(env));
  for (const changes of [{ GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/dev" }, { GITHUB_REPOSITORY: "fork/repo" }, { GITHUB_SHA: "HEAD" }]) assert.throws(() => assertDispatch({ ...env, ...changes }));
  assert.throws(() => assertDispatch(env, true), /acceptance/);
  assert.doesNotThrow(() => assertDispatch({ ...env, NATIVE_ACCEPTANCE: "true" }, true));
});
test("aligned npm/Cargo/Tauri versions and signed override leave sources untouched", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ayase-release-"));
  try {
    await mkdir(path.join(root, "src-tauri"));
    const version = "1.2.3-beta.1";
    const json = async (file, value) => writeFile(path.join(root, file), JSON.stringify(value));
    await json("package.json", { version });
    await json("package-lock.json", { version, packages: { "": { version } } });
    await json("src-tauri/tauri.conf.json", { version, productName: "Ayase Studio", bundle: { targets: ["nsis"] } });
    await writeFile(path.join(root, "src-tauri/Cargo.toml"), `[package]\nname = "ayase-studio"\nversion = "${version}"\n\n[lib]\nname = "app"\n`);
    await writeFile(path.join(root, "src-tauri/Cargo.lock"), `version = 4\n\n[[package]]\nname = "ayase-studio"\nversion = "${version}"\n`);
    assert.equal((await readVersion(root)).version, version);
    const original = await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8");
    const override = path.join(root, "temp/config.json");
    await writeBuildConfig(override, publicKey);
    assert.deepEqual(JSON.parse(await readFile(override, "utf8")), { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: publicKey } } });
    assert.equal(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"), original);
    for (const file of ["package-lock.json", "src-tauri/tauri.conf.json"]) {
      const before = await readFile(path.join(root, file), "utf8");
      const value = JSON.parse(before); value.version = "1.2.4";
      await json(file, value); await assert.rejects(readVersion(root), /versions must already match/); await writeFile(path.join(root, file), before);
    }
    await writeFile(path.join(root, "src-tauri/Cargo.lock"), '[[package]]\nname = "ayase-studio"\nversion = "1.2.4"\n');
    await assert.rejects(readVersion(root), /versions must already match/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function releaseApi({ draft = false, tagSha = sourceSha, assets = artifacts() } = {}) {
  const names = Object.keys(assets), calls = [];
  const release = { id: 1, tag_name: "v1.2.3-beta.1", draft, prerelease: true };
  return { calls, release, async call(route, options = {}) {
    calls.push({ route, ...options });
    if (route === "releases/tags/v1.2.3-beta.1") return release;
    if (route === "releases/1/assets?per_page=100") return names.map((name, index) => ({ id: index + 10, name, state: "uploaded", size: assets[name].length, digest: `sha256:${sha256(assets[name])}` }));
    if (route.startsWith("releases/assets/")) return assets[names[Number(route.split("/").at(-1)) - 10]];
    if (route.startsWith("git/ref/tags/")) return { object: { type: "commit", sha: tagSha } };
    if (route === "releases/1" && options.method === "PATCH") return { ...release, draft: false };
    throw new Error(`Unexpected API call ${route}`);
  } };
}
test("published retry verifies existing inventory and avoids publication mutation", async () => {
  const api = releaseApi();
  let checkedAncestry = false;
  const inspected = await inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, (source, main) => { assert.equal(source, sourceSha); assert.equal(main, mainSha); checkedAncestry = true; });
  assert.ok(checkedAncestry);
  await publishVerifiedRelease(api, inspected);
  assert.equal(api.calls.some(call => call.method), false);
  assert.equal(api.calls.some(call => call.route.startsWith("releases?")), false);
  await assert.rejects(inspectRelease(releaseApi({ tagSha: mainSha }), "v1.2.3-beta.1", publicKey, mainSha, () => {}), /Tag commit/);
  await assert.rejects(inspectRelease(releaseApi(), "v1.2.3-beta.1", makeKey(2), mainSha, () => {}), /signing key/);
  const missing = artifacts(); delete missing["latest.json"];
  await assert.rejects(inspectRelease(releaseApi({ assets: missing }), "v1.2.3-beta.1", publicKey, mainSha, () => {}), /inventory/);
});
test("draft publication only toggles visibility after candidate verification", async () => {
  const api = releaseApi({ draft: true });
  const inspected = await inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, () => {});
  assert.equal((await publishVerifiedRelease(api, inspected)).draft, false);
  assert.deepEqual(api.calls.filter(call => call.method).map(call => call.body), [{ draft: false, prerelease: true, make_latest: "false" }]);
});

function draftLookupApi(pages, canonicalChanges = {}) {
  const api = releaseApi({ draft: true });
  const original = api.call.bind(api);
  api.call = async (route, options = {}) => {
    if (route === "releases/tags/v1.2.3-beta.1" || route.startsWith("releases?per_page=100&page=") || route === "releases/1" && !options.method) {
      api.calls.push({ route, ...options });
      if (route.startsWith("releases/tags/")) return null;
      if (route === "releases/1") return { ...api.release, ...canonicalChanges };
      return pages[Number(route.split("page=").at(-1)) - 1] ?? [];
    }
    return original(route, options);
  };
  return api;
}

test("draft tag 404 resolves the exact release through authenticated paginated listing", async () => {
  const unrelated = Array.from({ length: 100 }, (_, index) => ({ id: index + 2, tag_name: `v9.0.${index}`, draft: true }));
  const api = draftLookupApi([unrelated, [{ id: 1, tag_name: "v1.2.3-beta.1", draft: true }]]);
  const inspected = await inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, () => {});
  assert.equal(inspected.release.id, 1);
  assert.equal(inspected.release.draft, true);
  assert.equal(api.calls[0].allow404, true);
  assert.ok(api.calls.some(call => call.route === "releases?per_page=100&page=2"));
  assert.ok(api.calls.some(call => call.route === "releases/1"));
  assert.equal(api.calls.some(call => call.method), false);
});

test("draft lookup rejects missing, ambiguous and changed tag identities before mutations", async () => {
  const match = { id: 1, tag_name: "v1.2.3-beta.1", draft: true };
  for (const api of [draftLookupApi([[]]), draftLookupApi([[match, { ...match, id: 2 }]]), draftLookupApi([[match]], { tag_name: "v9.0.0" })]) {
    await assert.rejects(inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, () => {}));
    assert.equal(api.calls.some(call => call.method), false);
  }
});

test("draft lookup rejects malformed lists and invalid IDs", async () => {
  for (const pages of [[{}], [[{ id: "1", tag_name: "v1.2.3-beta.1" }]], [[{ id: 0, tag_name: "v1.2.3-beta.1" }]]]) {
    const api = draftLookupApi(pages);
    await assert.rejects(inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, () => {}));
    assert.equal(api.calls.some(call => call.method), false);
  }
});

test("non-404 API failure never falls back to draft lookup", async () => {
  let requests = 0;
  const api = new GitHub("synthetic-token", async () => { requests++; return new Response("unavailable", { status: 503 }); });
  await assert.rejects(inspectRelease(api, "v1.2.3-beta.1", publicKey, mainSha, () => {}), /failed \(503\)/);
  assert.equal(requests, 1);
});
test("stable publication is GitHub latest and Beta publication is never latest", async () => {
  const api = stablePublicationApi();
  await publishVerifiedRelease(api, { release: { draft: true, id: 1 }, provenance: { version: "1.2.3" } });
  assert.deepEqual(api.calls.filter(call => call.method).map(call => call.body), [{ draft: false, prerelease: false, make_latest: "true" }]);
  assert.equal(api.calls[0].route, "releases/latest");
  assert.equal(api.calls[0].allow404, true);
  assert.ok(api.calls.some(call => call.route === "git/ref/heads/updates"));
});
test("stable draft rejects equal or newer GitHub Latest before any mutation", async () => {
  for (const version of ["1.2.3", "1.2.4"]) {
    const api = stablePublicationApi({ latest: { tag_name: `v${version}`, draft: false, prerelease: false } });
    await assert.rejects(publishVerifiedRelease(api, { release: { draft: true, id: 1 }, provenance: { version: "1.2.3" } }), /newer than GitHub Latest/);
    assert.equal(api.calls.some(call => call.method), false);
  }
});
test("stable draft rejects equal or newer stable channel before any mutation", async () => {
  for (const version of ["1.2.3", "1.2.4"]) {
    const api = stablePublicationApi({ latest: { tag_name: "v1.2.2", draft: false, prerelease: false }, current: { "stable.json": manifest(version) } });
    await assert.rejects(publishVerifiedRelease(api, { release: { draft: true, id: 1 }, provenance: { version: "1.2.3" } }), /newer than the stable channel/);
    assert.equal(api.calls.some(call => call.method), false);
  }
});
test("stable draft newer than Latest and stable channel publishes successfully", async () => {
  const api = stablePublicationApi({ latest: { tag_name: "v1.2.1", draft: false, prerelease: false }, current: { "stable.json": manifest("1.2.2"), "beta.json": manifest("1.3.0-beta.1") } });
  const published = await publishVerifiedRelease(api, { release: { draft: true, id: 1 }, provenance: { version: "1.2.3" } });
  assert.equal(published.draft, false);
  const mutations = api.calls.filter(call => call.method);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].route, "releases/1");
  assert.deepEqual(mutations[0].body, { draft: false, prerelease: false, make_latest: "true" });
  assert.equal(api.calls.at(-1), mutations[0]);
});
test("unexpected GitHub Latest metadata fails closed without mutation", async () => {
  const latest = { tag_name: "v1.2.2", draft: false, prerelease: false };
  for (const changes of [{ tag_name: "1.2.2" }, { tag_name: "v01.2.2" }, { tag_name: "v1.2.2-beta.1" }, { tag_name: "v1.2.2+build" }, { draft: true }, { prerelease: true }, { draft: undefined }]) {
    const api = stablePublicationApi({ latest: { ...latest, ...changes } });
    await assert.rejects(publishVerifiedRelease(api, { release: { draft: true, id: 1 }, provenance: { version: "1.2.3" } }));
    assert.equal(api.calls.some(call => call.method), false);
  }
});
test("published stable retry returns without reading or changing GitHub Latest", async () => {
  const release = { draft: false, id: 1 };
  const api = { call: async () => { throw new Error("Published retry must not call publication APIs"); } };
  assert.equal(await publishVerifiedRelease(api, { release, provenance: { version: "1.2.3" } }), release);
});
test("candidate preflight refuses existing tags/releases", async () => {
  await assert.rejects(assertUnusedTag(releaseApi(), "1.2.3-beta.1"), /already exists/);
  await assert.rejects(assertUnusedTag({ call: async route => route.startsWith("git/") ? { object: {} } : route.startsWith("releases?") ? [] : null }, "1.2.3-beta.1"), /Tag already exists/);
  await assert.doesNotReject(assertUnusedTag({ call: async route => route.startsWith("releases?") ? [] : null }, "1.2.3-beta.1"));
});
test("candidate preflight rejects a hidden draft even without a Git tag", async () => {
  const api = draftLookupApi([[{ id: 1, tag_name: "v1.2.3-beta.1", draft: true }]]);
  const call = api.call.bind(api);
  api.call = (route, options) => route.startsWith("git/ref/tags/") ? Promise.resolve(null) : call(route, options);
  await assert.rejects(assertUnusedTag(api, "1.2.3-beta.1"), /Release already exists/);
  assert.equal(api.calls.some(call => call.method), false);
});
function channelsApi({ current = {}, race = false, unexpected = false } = {}) {
  let sha = Object.keys(current).length ? sourceSha : null, newTree;
  const calls = [];
  const api = { calls, async call(route, options = {}) {
    calls.push({ route, ...options });
    if (route === "git/ref/heads/updates") {
      if (race && calls.filter(call => call.route === route).length === 2) sha = mainSha;
      return sha ? { object: { type: "commit", sha } } : null;
    }
    if (route.startsWith("git/commits/")) return { tree: { sha: "tree" } };
    if (route === "git/trees/tree") return { truncated: false, tree: unexpected ? [{ type: "tree", mode: "040000", path: "src" }] : Object.keys(current).map(name => ({ path: name, mode: "100644", type: "blob", sha: name })) };
    if (route.startsWith("git/blobs/")) return { encoding: "base64", content: Buffer.from(JSON.stringify(current[route.slice(10)])).toString("base64") };
    if (route === "git/trees" && options.method === "POST") { newTree = options.body.tree; return { sha: "new-tree" }; }
    if (route === "git/commits" && options.method === "POST") return { sha: "c".repeat(40) };
    if ((route === "git/refs/heads/updates" && options.method === "PATCH") || (route === "git/refs" && options.method === "POST")) {
      sha = options.body.sha; current = Object.fromEntries(newTree.map(entry => [entry.path, JSON.parse(entry.content)])); return {};
    }
    throw new Error(`Unexpected channels API call ${route}`);
  } };
  return api;
}
function stablePublicationApi({ latest = null, current = {} } = {}) {
  const api = channelsApi({ current });
  const callChannels = api.call.bind(api);
  api.call = async (route, options = {}) => {
    if (route === "releases/latest") { api.calls.push({ route, ...options }); return latest; }
    if (route === "releases/1" && options.method === "PATCH") { api.calls.push({ route, ...options }); return { draft: false, id: 1 }; }
    return callChannels(route, options);
  };
  return api;
}
test("data-only updates branch bootstraps as orphan and reads back channel", async () => {
  const api = channelsApi();
  assert.deepEqual(await advanceChannels(api, manifest(), { draft: false, tag_name: "v1.2.3-beta.1" }), ["beta.json"]);
  assert.deepEqual(api.calls.find(call => call.route === "git/commits").body.parents, []);
  assert.ok(api.calls.some(call => call.route === "git/refs" && call.body.ref === "refs/heads/updates"));
});
test("channels reject unpublished release and unexpected branch data before writes", async () => {
  const api = channelsApi();
  await assert.rejects(advanceChannels(api, manifest(), { draft: true, tag_name: "v1.2.3-beta.1" }), /unpublished/);
  assert.deepEqual(api.calls, []);
  await assert.rejects(readChannels(channelsApi({ current: { "beta.json": manifest() }, unexpected: true })), /DATA ONLY/);
});
test("existing channel update uses parent SHA and non-force compare-and-swap", async () => {
  const api = channelsApi({ current: { "beta.json": manifest("1.2.3-beta.0") } });
  await advanceChannels(api, manifest(), { draft: false, tag_name: "v1.2.3-beta.1" });
  assert.deepEqual(api.calls.find(call => call.route === "git/commits").body.parents, [sourceSha]);
  assert.equal(api.calls.find(call => call.route === "git/refs/heads/updates").body.force, false);
  const raced = channelsApi({ current: { "beta.json": manifest("1.2.3-beta.0") }, race: true });
  await assert.rejects(advanceChannels(raced, manifest(), { draft: false, tag_name: "v1.2.3-beta.1" }), /concurrently/);
  assert.equal(raced.calls.some(call => call.route === "git/refs/heads/updates"), false);
});
test("API requires token and never includes error response contents", async () => {
  assert.throws(() => new GitHub(""), /token/);
  const api = new GitHub("synthetic", async () => new Response("sensitive diagnostic", { status: 403 }));
  await assert.rejects(api.call("releases"), error => /403/.test(error.message) && !error.message.includes("sensitive"));
});
