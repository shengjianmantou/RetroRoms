import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { createUiServer } from "../../packages/ui/src/server.ts";
import { ingestLibrary } from "../../packages/ingest/src/ingest.ts";

const execFileAsync = promisify(execFile);
async function chooseDirectory(prompt) {
  if (process.platform !== "darwin") throw new Error("Choose a processed library folder when launching this MVP on Linux or Windows.");
  const { stdout } = await execFileAsync("osascript", ["-e", `POSIX path of (choose folder with prompt \"${prompt}\")`]);
  return stdout.trim().replace(/\/$/, "");
}
async function shouldAddAnotherSource() {
  const { stdout } = await execFileAsync("osascript", ["-e", 'button returned of (display dialog "Add another ROM source folder?" buttons {"Continue", "Add Another"} default button "Continue")']);
  return stdout.trim() === "Add Another";
}
async function chooseFile(prompt) {
  const { stdout } = await execFileAsync("osascript", ["-e", `POSIX path of (choose file with prompt \"${prompt}\")`]);
  return stdout.trim();
}
async function shouldAddDat() {
  const { stdout } = await execFileAsync("osascript", ["-e", 'button returned of (display dialog "Add a DAT file for verified identification?" buttons {"Skip", "Add DAT"} default button "Skip")']);
  return stdout.trim() === "Add DAT";
}
async function chooseLanguages() {
  const { stdout } = await execFileAsync("osascript", ["-e", 'choose from list {"English", "Chinese", "Japanese"} with prompt "Choose language preference order" with multiple selections allowed']);
  const names = stdout.trim().split(", ").filter(Boolean);
  const codes = { English: "en", Chinese: "zh", Japanese: "ja" };
  return names.map((name) => codes[name]).filter(Boolean);
}
let library = process.argv[2];
if (!library) {
  const sourceRoots = [await chooseDirectory("Choose a ROM source folder (it will remain read-only)")];
  while (await shouldAddAnotherSource()) sourceRoots.push(await chooseDirectory("Choose another ROM source folder (it will remain read-only)"));
  const processed = await chooseDirectory("Choose or create the processed RetroRoms library folder");
  const datFiles = [];
  while (await shouldAddDat()) datFiles.push({ path: await chooseFile("Choose a ROM DAT file") });
  const languagePreference = await chooseLanguages();
  const summary = await ingestLibrary({ sourceRoots, processedRoot: processed, datFiles, languagePreference: languagePreference.length ? languagePreference : undefined });
  library = summary.catalogPath;
}
if (!library.endsWith(".sqlite")) library = join(library, ".rom-curator", "catalog.sqlite");
await stat(library);
const ui = await createUiServer({ libraryPath: library, port: 0 });
const address = ui.server.address();
const port = typeof address === "object" && address ? address.port : 4177;
const url = `http://127.0.0.1:${port}`;
console.log(`RetroRoms UI listening at ${url}`);
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
const openerArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
spawn(opener, openerArgs, { stdio: "ignore", detached: true }).unref();
await new Promise(() => undefined);
