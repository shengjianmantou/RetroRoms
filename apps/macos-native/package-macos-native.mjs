import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputFlag = process.argv.indexOf("--output");
const output = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : join(root, "dist", "RetroRoms Native.app"));
const developerDirectory = process.env.DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer";
await execFileAsync("swift", ["build", "--package-path", "apps/macos-native"], { cwd: root, env: { ...process.env, DEVELOPER_DIR: developerDirectory } });
const contents = join(output, "Contents"); const resources = join(contents, "Resources"); const macos = join(contents, "MacOS");
await rm(output, { recursive: true, force: true }); await mkdir(resources, { recursive: true }); await mkdir(macos, { recursive: true });
await cp(join(root, "apps/macos-native/.build/arm64-apple-macosx/debug/RetroRomsNative"), join(macos, "RetroRomsNative"));
for (const item of ["apps", "packages", "package.json", "package-lock.json"]) await cp(join(root, item), join(resources, item), { recursive: true });
const workspaceModules = join(resources, "node_modules", "@retroroms");
await mkdir(workspaceModules, { recursive: true });
for (const name of ["catalog", "core", "ingest", "ui"]) {
  await symlink(`../../packages/${name}`, join(workspaceModules, name));
}
await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>RetroRoms Native</string><key>CFBundleDisplayName</key><string>RetroRoms Native</string><key>CFBundleIdentifier</key><string>local.retroroms.native</string><key>CFBundleExecutable</key><string>RetroRomsNative</string><key>LSMinimumSystemVersion</key><string>13.0</string></dict></plist>
`);
console.log(`Created native macOS app at ${output}`);
