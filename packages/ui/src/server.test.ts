import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestLibrary } from "../../ingest/src/ingest.ts";
import { createUiServer } from "./server.ts";

test("serves catalog observations and export previews", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-ui-"));
  const source = join(root, "source"); const processed = join(root, "processed");
  await mkdir(source); await writeFile(join(source, "Super Metroid (USA) [En].sfc"), "rom");
  const summary = await ingestLibrary({ sourceRoots: [source], processedRoot: processed });
  const ui = await createUiServer({ libraryPath: summary.catalogPath, port: 0 });
  const address = ui.server.address(); const port = typeof address === "object" && address ? address.port : 0;
  const observations = await (await fetch(`http://127.0.0.1:${port}/api/observations`)).json() as { observations: Array<{ id: string; title: string }> };
  assert.equal(observations.observations[0].title, "Super Metroid");
  const preview = await (await fetch(`http://127.0.0.1:${port}/api/export-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [observations.observations[0].id], policy: "compressed" }) })).json() as { plan: Array<{ outputFormat: string }> };
  assert.equal(preview.plan[0].outputFormat, "zip");
  await ui.close();
});

