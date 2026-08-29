import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { ContentHashes } from "./types.ts";

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export function crc32(data: Uint8Array): string {
  let crc = 0xffffffff;
  for (const value of data) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function hashContent(data: Uint8Array): ContentHashes {
  return {
    crc32: crc32(data),
    sha1: createHash("sha1").update(data).digest("hex"),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

export async function hashFile(path: string): Promise<ContentHashes> {
  const sha1 = createHash("sha1");
  const sha256 = createHash("sha256");
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Buffer;
    sha1.update(data);
    sha256.update(data);
    for (const value of data) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return {
    crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0"),
    sha1: sha1.digest("hex"),
    sha256: sha256.digest("hex"),
  };
}

