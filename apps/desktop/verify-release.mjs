import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const bundle = process.argv[2];
if (!bundle) throw new Error("Usage: node verify-release.mjs <bundle-directory>");
const manifest = JSON.parse(await readFile(join(bundle, "RELEASE.json"), "utf8"));
const launcher = await readFile(join(bundle, manifest.entryPoint));
const checksum = createHash("sha256").update(launcher).digest("hex");
if (checksum !== manifest.checksums.launcher) throw new Error(`Launcher checksum mismatch: expected ${manifest.checksums.launcher}, got ${checksum}`);
console.log(`Verified ${manifest.product} ${manifest.version} (${manifest.platform})`);
