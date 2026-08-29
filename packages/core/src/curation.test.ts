import assert from "node:assert/strict";
import test from "node:test";
import { curateObservations } from "./curation.ts";
import { DatIndex } from "./dat.ts";

test("deduplicates editions while retaining every candidate", () => {
  const dat = new DatIndex();
  dat.add([
    { title: "Puzzle Quest (USA) [En]", systemKey: "snes", languages: ["en"], romName: "en.sfc", hashes: { sha1: "a".repeat(40) }, sourceDat: "snes.dat" },
    { title: "Puzzle Quest (China) [Zh]", systemKey: "snes", languages: ["zh"], romName: "zh.sfc", hashes: { sha1: "b".repeat(40) }, sourceDat: "snes.dat" },
  ]);
  const groups = curateObservations([
    { id: "english", systemKey: "snes", filename: "Puzzle Quest (USA).sfc", hashes: { crc32: "1", sha1: "a".repeat(40), sha256: "1".repeat(64) } },
    { id: "chinese", systemKey: "snes", filename: "Puzzle Quest (China).sfc", hashes: { crc32: "2", sha1: "b".repeat(40), sha256: "2".repeat(64) } },
  ], dat);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].selectedObservationId, "english");
  assert.equal(groups[0].candidates.length, 2);
});

test("does not merge numbered sequels into one edition group", () => {
  const groups = curateObservations([
    { id: "one", systemKey: "nes", filename: "Adventure 1.nes", hashes: { crc32: "1", sha1: "1".repeat(40), sha256: "1".repeat(64) } },
    { id: "two", systemKey: "nes", filename: "Adventure 2.nes", hashes: { crc32: "2", sha1: "2".repeat(40), sha256: "2".repeat(64) } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].seriesKey, groups[1].seriesKey);
});

