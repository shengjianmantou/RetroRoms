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
let library = process.argv[2];
if (!library) {
  const source = await chooseDirectory("Choose the ROM source folder (it will remain read-only)");
  const processed = await chooseDirectory("Choose or create the processed RetroRoms library folder");
  const summary = await ingestLibrary({ sourceRoots: [source], processedRoot: processed });
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
