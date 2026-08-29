import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const platform = process.argv[2];
if (!["linux", "windows"].includes(platform)) throw new Error("Usage: node package-platform.mjs <linux|windows> --output <directory>");
const output = resolve(process.argv[process.argv.indexOf("--output") + 1] || join(root, "dist", `RetroRoms-${platform}`));
await mkdir(output, { recursive: true });
await cp(join(root, "apps"), join(output, "apps"), { recursive: true });
await cp(join(root, "packages"), join(output, "packages"), { recursive: true });
await cp(join(root, "package.json"), join(output, "package.json"));
await cp(join(root, "package-lock.json"), join(output, "package-lock.json"));
if (platform === "linux") {
  await writeFile(join(output, "RetroRoms.sh"), "#!/bin/sh\nset -eu\nexec node \"$(dirname \"$0\")/apps/desktop/launch.mjs\" \"$@\"\n", { mode: 0o755 });
} else {
  await writeFile(join(output, "RetroRoms.cmd"), "@echo off\r\nnode \"%~dp0apps\\desktop\\launch.mjs\" %*\r\n");
}
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const launcherName = platform === "linux" ? "RetroRoms.sh" : "RetroRoms.cmd";
const launcher = await readFile(join(output, launcherName));
await writeFile(join(output, "RELEASE.json"), `${JSON.stringify({ product: "RetroRoms", version, platform, node: ">=22", entryPoint: launcherName, checksums: { launcher: createHash("sha256").update(launcher).digest("hex") } }, null, 2)}\n`);
console.log(`Created ${platform} bundle at ${output}`);
