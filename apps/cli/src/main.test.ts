import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "./main.ts";

test("parses multiple source roots and one processed library", () => {
  assert.deepEqual(
    parseArguments(["--source", "/one", "--source", "/two", "--processed", "/library", "--name", "My ROMs"]),
    { sourceRoots: ["/one", "/two"], processedRoot: "/library", displayName: "My ROMs" },
  );
});

test("requires source and processed locations", () => {
  assert.throws(() => parseArguments(["--source", "/one"]), /Usage:/);
  assert.throws(() => parseArguments(["--processed", "/library"]), /Usage:/);
});

