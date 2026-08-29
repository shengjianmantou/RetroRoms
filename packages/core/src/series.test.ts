import assert from "node:assert/strict";
import test from "node:test";
import { groupBySeries, normalizeSeriesKey } from "./series.ts";

test("normalizes numbered releases into a conservative series key", () => {
  assert.equal(normalizeSeriesKey("Final Fantasy VII"), "final fantasy");
  assert.equal(normalizeSeriesKey("Final Fantasy VIII (USA)"), "final fantasy");
  assert.equal(normalizeSeriesKey("Chrono Trigger"), "chrono trigger");
});

test("groups members across systems without deleting individual titles", () => {
  const groups = groupBySeries([
    { id: "1", title: "Mega Man 2", systemKey: "nes" },
    { id: "2", title: "Mega Man 3", systemKey: "nes" },
    { id: "3", title: "Mega Man X", systemKey: "snes" },
  ]);
  const megaMan = groups.find((group) => group.key === "mega man")!;
  assert.equal(megaMan.members.length, 3);
  assert.deepEqual(megaMan.members.map((member) => member.id), ["1", "2", "3"]);
});
