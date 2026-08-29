import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestLibrary } from "./ingest.ts";

test("ingests sources and an existing processed library into a portable catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-ingest-"));
  const source = join(root, "incoming");
  const processed = join(root, "processed");
  await mkdir(join(source, "snes"), { recursive: true });
  await mkdir(join(processed, "roms", "snes"), { recursive: true });
  const duplicate = Buffer.from("same-rom-content");
  await writeFile(join(source, "snes", "Game.sfc"), duplicate);
  await writeFile(join(processed, "roms", "snes", "Game.sfc"), duplicate);

  const summary = await ingestLibrary({ sourceRoots: [source], processedRoot: processed, displayName: "Portable Test" });
  assert.equal(summary.sourceRootCount, 1);
  assert.equal(summary.scannedContentCount, 2);
  assert.equal(summary.catalogObservationCount, 2);
  assert.equal(summary.crossRootDuplicateGroups, 1);
  assert.equal(summary.warnings.length, 0);

  const manifest = JSON.parse(await readFile(summary.manifestPath, "utf8"));
  assert.equal(manifest.format, "retroroms-portable-library");
  assert.equal(manifest.displayName, "Portable Test");
  assert.equal(manifest.catalogPath, ".rom-curator/catalog.sqlite");
});

test("rejects using the processed library as a source root", async () => {
  const processed = await mkdtemp(join(tmpdir(), "retroroms-ingest-"));
  await assert.rejects(
    ingestLibrary({ sourceRoots: [processed], processedRoot: processed }),
    /cannot also be the processed-library root/,
  );
});
