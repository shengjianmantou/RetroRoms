import assert from "node:assert/strict";
import test from "node:test";
import { choosePreferredEdition, parseReleaseFilename } from "./metadata.ts";

test("parses language, region, revision, and disc tags from a release name", () => {
  const parsed = parseReleaseFilename("Final Fantasy VII (USA) [En] (Rev 1) (Disc 2).bin");
  assert.equal(parsed.title, "Final Fantasy VII");
  assert.deepEqual(parsed.languages, ["en"]);
  assert.deepEqual(parsed.regions, ["USA"]);
  assert.equal(parsed.revision, "1");
  assert.equal(parsed.disc, 2);
});

test("uses configurable language preference while favoring verified identities", () => {
  const result = choosePreferredEdition([
    { id: "english", verified: false, metadata: parseReleaseFilename("Game (USA) [En].sfc") },
    { id: "chinese", verified: true, metadata: parseReleaseFilename("Game (China) [Zh].sfc") },
    { id: "japanese", verified: true, metadata: parseReleaseFilename("Game (Japan) [Ja].sfc") },
  ], ["en", "zh", "ja"]);
  assert.equal(result?.selected.id, "chinese");
  assert.deepEqual(result?.rejected.map((item) => item.id), ["japanese", "english"]);
});

