import assert from "node:assert/strict";
import test from "node:test";
import { Catalog, relativePathWithinRoot } from "./catalog.ts";

test("stores source and processed observations under one content identity", () => {
  const catalog = new Catalog(":memory:");
  catalog.initialize("Test Library");
  const source = catalog.addRoot("source", "/source", "Incoming");
  const processed = catalog.addRoot("processed", "/processed", "Processed");
  const scan = catalog.beginScan();
  const hashes = { crc32: "11111111", sha1: "a".repeat(40), sha256: "b".repeat(64) };

  catalog.recordObservation({
    scanRunId: scan,
    rootId: source.id,
    relativePath: "snes/collection.zip",
    virtualPath: "snes/collection.zip::Game.sfc",
    containerChain: ["snes/collection.zip"],
    byteSize: 4,
    ...hashes,
  });
  catalog.recordObservation({
    scanRunId: scan,
    rootId: processed.id,
    relativePath: "roms/snes/Game.zip",
    virtualPath: "roms/snes/Game.zip::Game.sfc",
    containerChain: ["roms/snes/Game.zip"],
    byteSize: 4,
    ...hashes,
  });
  catalog.completeScan(scan);

  assert.deepEqual(catalog.findBySha256(hashes.sha256).map((item) => item.rootKind), ["processed", "source"]);
  catalog.close();
});

test("portable paths must remain relative to their root", () => {
  assert.equal(relativePathWithinRoot("/library", "/library/roms/snes/Game.zip"), "roms/snes/Game.zip");
  assert.throws(() => relativePathWithinRoot("/library", "/other/Game.zip"), /outside the selected root/);
});

test("rejects absolute observation paths", () => {
  const catalog = new Catalog(":memory:");
  catalog.initialize();
  const root = catalog.addRoot("source", "/source", "Source");
  const scan = catalog.beginScan();
  assert.throws(() => catalog.recordObservation({
    scanRunId: scan,
    rootId: root.id,
    relativePath: "/absolute/Game.sfc",
    virtualPath: "Game.sfc",
    containerChain: [],
    byteSize: 1,
    crc32: "00000000",
    sha1: "0".repeat(40),
    sha256: "0".repeat(64),
  }), /safe and relative/);
  catalog.close();
});

test("persists preferred editions and content links across upserts", () => {
  const catalog = new Catalog(":memory:");
  catalog.initialize();
  const english = catalog.upsertEdition({ canonicalTitle: "Puzzle Quest", sortTitle: "Puzzle Quest", systemKey: "snes", region: "USA", languages: ["en"], identitySource: "dat", preferred: true, contentSha256: "a".repeat(64) });
  catalog.upsertEdition({ canonicalTitle: "Puzzle Quest", sortTitle: "Puzzle Quest", systemKey: "snes", region: "China", languages: ["zh"], identitySource: "dat", preferred: false, contentSha256: "b".repeat(64) });
  catalog.upsertEdition({ canonicalTitle: "Puzzle Quest", sortTitle: "Puzzle Quest", systemKey: "snes", region: "China", languages: ["zh"], identitySource: "dat", preferred: true, contentSha256: "b".repeat(64) });
  const editions = catalog.listEditions();
  assert.equal(editions.length, 2);
  assert.equal(editions.find((edition) => edition.id === english.editionId)?.preferred, false);
  assert.equal(editions.find((edition) => edition.languages[0] === "zh")?.preferred, true);
  catalog.close();
});
