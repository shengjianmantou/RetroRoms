import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { isSafeMemberPath, readTar } from "./archive.ts";
import type { ArchiveTool } from "./externalArchive.ts";
import { crc32 } from "./hash.ts";
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

function makeStoredZip(entries: Array<[string, Buffer]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, content] of entries) {
    const encodedName = Buffer.from(name, "utf8");
    const checksum = Number.parseInt(crc32(content), 16);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(encodedName.length, 26);
    localParts.push(local, encodedName, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(encodedName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, encodedName);
    localOffset += local.length + encodedName.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
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
    "snes/collection.tar.gz::A.sfc",
    "snes/collection.tar.gz::B.sfc",
  ]);
  assert.notEqual(result.content[0].hashes.sha256, result.content[1].hashes.sha256);
});

test("scans a ZIP nested inside another ZIP", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  const inner = makeStoredZip([["Chrono Trigger (USA).sfc", Buffer.from("chrono-trigger")]]);
  const outer = makeStoredZip([["favorites.zip", inner]]);
  await writeFile(join(root, "collection.zip"), outer);

  const result = await scanSourceRoots([root]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].virtualPath, "collection.zip::favorites.zip::Chrono Trigger (USA).sfc");
  assert.equal(result.content[0].containerChain.length, 2);
});

test("reports unsafe paths without writing extracted data", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  await writeFile(join(root, "unsafe.zip"), makeStoredZip([["../escape.sfc", Buffer.from("unsafe")]]));

  const result = await scanSourceRoots([root]);
  assert.equal(result.content.length, 0);
  assert.equal(result.warnings[0].code, "unsafe_path");
});

test("uses the archive helper for a recognized 7z container", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  await writeFile(join(root, "collection.7z"), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
  const tool: ArchiveTool = {
    async list() {
      return ["Game Boy/Game.gb"];
    },
    async extractToFile(_archivePath, _member, destination) {
      const data = Buffer.from("game-boy-rom");
      await writeFile(destination, data);
      return data.length;
    },
  };

  const result = await scanSourceRoots([root], undefined, { archiveTool: tool });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.content[0].virtualPath, "collection.7z::Game Boy/Game.gb");
  assert.equal(result.content[0].containerChain[0], "collection.7z");
});

test("rolls back an archive that exceeds its expanded-byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  await writeFile(join(root, "collection.zip"), makeStoredZip([
    ["A.sfc", Buffer.from("game-a")],
    ["B.sfc", Buffer.from("game-b")],
  ]));

  const result = await scanSourceRoots([root], { maxExpandedBytes: 8, maxCompressionRatio: 10_000 });
  assert.equal(result.content.length, 0);
  assert.equal(result.warnings[0].code, "limit_exceeded");
});

test("streams an ordinary file into stable content hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "retroroms-test-"));
  const data = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  await writeFile(join(root, "Large Game.iso"), data);

  const result = await scanSourceRoots([root]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.content[0].size, data.length);
  assert.equal(result.content[0].hashes.crc32, crc32(data));
});
