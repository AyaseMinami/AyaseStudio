import { copyFile, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = path.join(repositoryRoot, "src-tauri", "target", "release", "bundle", "nsis");
const tauriConfig = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const prefix = `${tauriConfig.productName}_${tauriConfig.version}_`;
const installers = (await readdir(bundleDirectory)).filter((name) =>
  name.startsWith(prefix) && name.endsWith("-setup.exe"),
);

if (installers.length !== 1) {
  throw new Error(`Expected one NSIS installer starting with ${prefix}, found ${installers.length}.`);
}

const sourcePath = path.join(bundleDirectory, installers[0]);
const now = new Date();
const pad = (value, width = 2) => String(value).padStart(width, "0");
const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const extension = path.extname(sourcePath);
const stem = path.basename(sourcePath, extension);

for (let duplicate = 1; ; duplicate += 1) {
  const suffix = duplicate === 1 ? timestamp : `${timestamp}-${duplicate}`;
  const archivedPath = path.join(bundleDirectory, `${stem}_${suffix}${extension}`);
  try {
    await copyFile(sourcePath, archivedPath, constants.COPYFILE_EXCL);
    process.stdout.write(`Archived NSIS installer: ${archivedPath}\n`);
    break;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
