import { spawn } from "node:child_process";
import { createUiServer } from "../../packages/ui/src/server.ts";

const library = process.argv[2];
if (!library) throw new Error("Usage: RetroRoms <path-to-processed-library>\nThe path should contain .rom-curator/catalog.sqlite.");
const ui = await createUiServer({ libraryPath: library, port: 0 });
const address = ui.server.address();
const port = typeof address === "object" && address ? address.port : 4177;
const url = `http://127.0.0.1:${port}`;
console.log(`RetroRoms UI listening at ${url}`);
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
const openerArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
spawn(opener, openerArgs, { stdio: "ignore", detached: true }).unref();
await new Promise(() => undefined);
