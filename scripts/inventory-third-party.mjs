// Documentation inventory only: no installs, network calls or release-gate changes.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = file => createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--offline", "--format-version", "1",
  "--manifest-path", resolve(root, "src-tauri/Cargo.toml")], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
const cell = value => String(value ?? "待核实").replaceAll("|", "\\|").replaceAll("\n", " ");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function evidence(directory) {
  if (!existsSync(directory)) return "未安装；仅锁文件声明";
  const files = readdirSync(directory).filter(name => /^(licen[cs]e|notice|copying|copyright)([.\-_]|$)/i.test(name)).sort(compare);
  return files.length ? files.join(", ") : "无顶层许可文件；需查上游/嵌套目录";
}
const npm = Object.entries(lock.packages).filter(([path]) => path).sort(([a], [b]) => compare(a, b));
const cargo = metadata.packages.filter(p => p.source).sort((a, b) => compare(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
const lines = [
  "# 第三方依赖锁定清单", "",
  "由 `node scripts/inventory-third-party.mjs` 生成；使用本机已安装依赖与离线 Cargo metadata，不安装、不联网。", "",
  "本表记录原始许可证声明与本机证据文件名，不把 OR 改成 AND，不替项目选择许可分支，也不代替许可证全文/NOTICE 随包分发。",
  "npm 包括开发、可选及跨平台锁定项；Rust 包括 metadata 返回的全部目标/构建/开发依赖，均是保守清单，不是 Windows EXE 的实际链接清单。",
  "缺少本机许可文件与嵌套依赖需按 [许可说明](THIRD-PARTY-LICENSES.md) 继续核实；源码下载位置不等于品牌素材授权。", "",
  `- package-lock.json SHA-256: \`${hash("package-lock.json")}\``,
  `- src-tauri/Cargo.lock SHA-256: \`${hash("src-tauri/Cargo.lock")}\``,
  `- npm: ${npm.length} 个锁定位置；其中 ${npm.filter(([, p]) => !p.dev).length} 个非 dev 项。`,
  `- Rust: ${cargo.length} 个外部包。`, "",
  "## npm", "", "| 包 / 锁定位置 | 版本 | 范围 | 原始声明 | 本机顶层证据 |",
  "| --- | --- | --- | --- | --- |",
];
for (const [path, item] of npm) {
  const name = path.split("node_modules/").at(-1);
  const direct = Object.hasOwn(manifest.dependencies ?? {}, name) || Object.hasOwn(manifest.devDependencies ?? {}, name);
  const scope = `${direct && path === `node_modules/${name}` ? "直接" : "传递"} / ${item.dev ? "开发" : "非 dev"}${item.optional ? " / 可选" : ""}`;
  lines.push(`| [${cell(path)}](https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${item.version}) | ${cell(item.version)} | ${scope} | ${cell(item.license)} | ${cell(evidence(resolve(root, path)))} |`);
}
lines.push("", "## Rust", "", "| 包 | 版本 | 原始声明 | 本机顶层证据 |", "| --- | --- | --- | --- |");
for (const item of cargo) {
  lines.push(`| [${cell(item.name)}](https://crates.io/crates/${encodeURIComponent(item.name)}/${item.version}) | ${cell(item.version)} | ${cell(item.license)} | ${cell(evidence(dirname(item.manifest_path)))}${item.license_file ? `; license_file: ${cell(item.license_file)}` : ""} |`);
}
lines.push("");
const output = resolve(root, "docs/THIRD-PARTY-DEPENDENCIES.md");
writeFileSync(output, lines.join("\n"));
console.log(`Wrote ${npm.length} npm and ${cargo.length} Rust entries to docs/THIRD-PARTY-DEPENDENCIES.md`);
