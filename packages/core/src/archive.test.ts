import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { isSafeMemberPath, readTar } from "./archive.ts";
import { scanSourceRoots } from "./scanner.ts";
import { DEFAULT_SCAN_LIMITS } from "./types.ts";

function tarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, 6, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function makeTar(entries: Array<[string, Buffer]>): Buffer {
  return Buffer.concat([...entries.map(([name, content]) => tarEntry(name, content)), Buffer.alloc(1024)]);
}

test("rejects unsafe archive member paths", () => {
  assert.equal(isSafeMemberPath("games/title.sfc"), true);
  assert.equal(isSafeMemberPath("../escape.sfc"), false);
  assert.equal(isSafeMemberPath("/absolute.sfc"), false);
  assert.equal(isSafeMemberPath("C:/escape.sfc"), false);
});

test("reads individual members from a multi-game TAR", () => {
  const archive = makeTar([
    ["A.sfc", Buffer.from("game-a")],
    ["B.sfc", Buffer.from("game-b")],
  ]);
  const members = readTar(archive, DEFAULT_SCAN_LIMITS);
  assert.deepEqual(members.map((member) => member.name), ["A.sfc", "B.sfc"]);
});

test("scans nested gzip and TAR containers into independent content", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  await mkdir(join(root, "snes"));
  const archive = makeTar([
    ["A.sfc", Buffer.from("game-a")],
    ["B.sfc", Buffer.from("game-b")],
  ]);
  await writeFile(join(root, "snes", "collection.tar.gz"), gzipSync(archive));

  const result = await scanSourceRoots([root]);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.content.map((item) => item.virtualPath), [
    "snes/collection.tar.gz::snes/collection.tar::A.sfc",
    "snes/collection.tar.gz::snes/collection.tar::B.sfc",
  ]);
  assert.notEqual(result.content[0].hashes.sha256, result.content[1].hashes.sha256);
});

