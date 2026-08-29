import { gunzipSync, inflateRawSync } from "node:zlib";
import { basename } from "node:path";
import type {
  ContainerFormat,
  RecognizedUnsupportedFormat,
  ScanLimits,
  ScanWarning,
} from "./types.ts";

export interface ArchiveMember {
  name: string;
  data: Buffer;
  compressedSize: number;
}

export class ArchiveInspectionError extends Error {
  readonly code: ScanWarning["code"];

  constructor(code: ScanWarning["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function detectContainer(
  data: Uint8Array,
  name: string,
): ContainerFormat | RecognizedUnsupportedFormat | undefined {
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && [0x03, 0x05, 0x07].includes(data[2]) && [0x04, 0x06, 0x08].includes(data[3])) return "zip";
  if (data.length >= 6 && Buffer.from(data.subarray(0, 6)).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return "7z";
  if (data.length >= 7 && Buffer.from(data.subarray(0, 7)).equals(Buffer.from("Rar!\x1a\x07", "binary"))) return "rar";
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) return "gzip";
  if (data.length >= 512 && Buffer.from(data.subarray(257, 262)).toString("ascii") === "ustar") return "tar";

  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".zip")) return "zip";
  if (lowerName.endsWith(".7z")) return "7z";
  if (lowerName.endsWith(".rar")) return "rar";
  if (lowerName.endsWith(".tar")) return "tar";
  if (lowerName.endsWith(".tgz") || lowerName.endsWith(".tar.gz") || lowerName.endsWith(".gz")) return "gzip";
  return undefined;
}

export function isSafeMemberPath(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

function assertMemberLimits(
  name: string,
  compressedSize: number,
  expandedSize: number,
  limits: ScanLimits,
): void {
  if (!isSafeMemberPath(name)) {
    throw new ArchiveInspectionError("unsafe_path", `Archive member has an unsafe path: ${name}`);
  }
  if (expandedSize > limits.maxEntryBytes) {
    throw new ArchiveInspectionError("limit_exceeded", `Archive member exceeds the per-entry limit: ${name}`);
  }
  if (compressedSize > 0 && expandedSize / compressedSize > limits.maxCompressionRatio) {
    throw new ArchiveInspectionError("limit_exceeded", `Archive member exceeds the compression-ratio limit: ${name}`);
  }
}

function findZipEnd(data: Buffer): number {
  const minimum = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= minimum; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new ArchiveInspectionError("invalid_archive", "ZIP end-of-central-directory record was not found");
}

export function readZip(data: Buffer, limits: ScanLimits): ArchiveMember[] {
  const endOffset = findZipEnd(data);
  const entryCount = data.readUInt16LE(endOffset + 10);
  const directoryOffset = data.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new ArchiveInspectionError("unsupported_archive", "ZIP64 support is not implemented yet");
  }
  if (entryCount > limits.maxEntries) {
    throw new ArchiveInspectionError("limit_exceeded", "ZIP contains too many entries");
  }

  const members: ArchiveMember[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new ArchiveInspectionError("invalid_archive", "ZIP central directory is invalid");
    }
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const expandedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString((flags & 0x800) !== 0 ? "utf8" : "latin1");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if ((flags & 1) !== 0) throw new ArchiveInspectionError("encrypted_archive", `Encrypted ZIP member: ${name}`);
    if (method !== 0 && method !== 8) throw new ArchiveInspectionError("unsupported_archive", `Unsupported ZIP compression method ${method}: ${name}`);
    assertMemberLimits(name, compressedSize, expandedSize, limits);
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new ArchiveInspectionError("invalid_archive", `Invalid ZIP local header: ${name}`);
    }
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(contentOffset, contentOffset + compressedSize);
    if (compressed.length !== compressedSize) throw new ArchiveInspectionError("invalid_archive", `Truncated ZIP member: ${name}`);
    const content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    if (content.length !== expandedSize) throw new ArchiveInspectionError("invalid_archive", `ZIP member size mismatch: ${name}`);
    members.push({ name, data: content, compressedSize });
  }
  return members;
}

function tarString(data: Buffer, start: number, length: number): string {
  const end = data.indexOf(0, start);
  return data.subarray(start, end >= start && end < start + length ? end : start + length).toString("utf8");
}

export function readTar(data: Buffer, limits: ScanLimits): ArchiveMember[] {
  const members: ArchiveMember[] = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = tarString(header, 124, 12).trim().replaceAll("\0", "");
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156] || 0x30);
    if (!Number.isSafeInteger(size) || size < 0) throw new ArchiveInspectionError("invalid_archive", `Invalid TAR member size: ${fullName}`);
    const contentOffset = offset + 512;
    const nextOffset = contentOffset + Math.ceil(size / 512) * 512;
    if (nextOffset > data.length) throw new ArchiveInspectionError("invalid_archive", `Truncated TAR member: ${fullName}`);
    if (type === "0" || type === "\0") {
      assertMemberLimits(fullName, size, size, limits);
      members.push({ name: fullName, data: Buffer.from(data.subarray(contentOffset, contentOffset + size)), compressedSize: size });
      if (members.length > limits.maxEntries) throw new ArchiveInspectionError("limit_exceeded", "TAR contains too many entries");
    }
    offset = nextOffset;
  }
  return members;
}

export function readGzip(data: Buffer, name: string, limits: ScanLimits): ArchiveMember[] {
  const expanded = gunzipSync(data, { maxOutputLength: limits.maxEntryBytes });
  assertMemberLimits(name, data.length, expanded.length, limits);
  const lowerName = name.toLowerCase();
  const innerName = lowerName.endsWith(".tgz")
    ? `${name.slice(0, -4)}.tar`
    : lowerName.endsWith(".gz")
      ? name.slice(0, -3)
      : `${basename(name)}.out`;
  return [{ name: innerName, data: expanded, compressedSize: data.length }];
}
