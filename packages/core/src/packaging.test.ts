import assert from "node:assert/strict";
import test from "node:test";
import { createExportPlan, inferCompressedFormat } from "./packaging.ts";

test("infers the predominant compatible package format", () => {
  assert.equal(inferCompressedFormat([
    { systemKey: "snes", relativePath: "a.zip", packageFormat: "zip" },
    { systemKey: "snes", relativePath: "b.zip", packageFormat: "zip" },
    { systemKey: "snes", relativePath: "c.7z", packageFormat: "7z" },
  ]), "zip");
});

test("creates compression and conflict actions without touching files", () => {
  const candidates = [{
    id: "game-1",
    systemKey: "snes",
    title: "Super Metroid",
    sourceVirtualPath: "collection.zip::Super Metroid.sfc",
    sourceSha256: "a".repeat(64),
    observedRepresentations: [{ systemKey: "snes", relativePath: "old.sfc", packageFormat: "raw" as const }],
  }];
  const plan = createExportPlan(candidates, [{ systemKey: "snes", outputPolicy: "compressed", compressedFormat: "zip" }]);
  assert.deepEqual(plan[0], {
    candidateId: "game-1",
    action: "compress",
    outputFormat: "zip",
    destinationRelativePath: "roms/snes/Super Metroid.zip",
    reason: "System policy is compressed",
  });
  const conflict = createExportPlan(candidates, [{ systemKey: "snes", outputPolicy: "uncompressed" }], new Map([["roms/snes/Super Metroid", "different"]]))[0];
  assert.equal(conflict.action, "conflict");
});
