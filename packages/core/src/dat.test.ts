import assert from "node:assert/strict";
import test from "node:test";
import { DatIndex, parseDatXml } from "./dat.ts";

const XML = `<?xml version="1.0"?><datafile><header><name>Super Nintendo No-Intro</name></header><game name="Super Metroid (USA) [En]"><rom name="Super Metroid (USA).sfc" size="4" crc="9b8d39e4" md5="0123456789abcdef0123456789abcdef" sha1="${"a".repeat(40)}"/></game></datafile>`;

test("parses No-Intro-style game and ROM records", () => {
  const records = parseDatXml(XML, "snes.dat");
  assert.equal(records.length, 1);
  assert.equal(records[0].systemKey, "snes");
  assert.equal(records[0].title, "Super Metroid (USA) [En]");
  assert.equal(records[0].hashes.crc32, "9b8d39e4");
  assert.deepEqual(records[0].languages, ["en"]);
});

test("indexes hashes and returns the strongest available match", () => {
  const index = new DatIndex();
  index.add(parseDatXml(XML, "snes.dat"));
  const matches = index.identify({ crc32: "9b8d39e4", sha1: "a".repeat(40), sha256: "b".repeat(64) });
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.matchedBy), ["sha1", "crc32"]);
});

