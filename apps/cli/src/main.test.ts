import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "./main.ts";

test("parses multiple source roots and one processed library", () => {
  assert.deepEqual(
    parseArguments(["--source", "/one", "--source", "/two", "--processed", "/library", "--name", "My ROMs"]),
    { sourceRoots: ["/one", "/two"], processedRoot: "/library", displayName: "My ROMs", datFiles: [], datSystems: {}, languagePreference: undefined },
  );
});

test("parses DAT and language options", () => {
  assert.deepEqual(parseArguments(["--source", "/one", "--processed", "/library", "--dat", "/set.xml", "--languages", "zh,en"]), {
    sourceRoots: ["/one"], processedRoot: "/library", datFiles: ["/set.xml"], datSystems: {}, languagePreference: ["zh", "en"], displayName: undefined,
  });
});

test("parses DAT system overrides", () => {
  assert.equal(parseArguments(["--source", "/one", "--processed", "/library", "--dat", "/set.xml", "--dat-system", "/set.xml=snes"]).datSystems["/set.xml"], "snes");
});

test("requires source and processed locations", () => {
  assert.throws(() => parseArguments(["--source", "/one"]), /Usage:/);
  assert.throws(() => parseArguments(["--processed", "/library"]), /Usage:/);
});
