import { mkdtemp, open, opendir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveInspectionError, detectContainer, readGzip, readTar, readZip } from "./archive.ts";
import { BsdtarArchiveTool, type ArchiveTool } from "./externalArchive.ts";
import { hashContent, hashFile } from "./hash.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type ContainerFormat,
  type DiscoveredContent,
  type ScanLimits,
  type ScanResult,
} from "./types.ts";

interface ScanState {
  result: ScanResult;
  expandedBytes: number;
}

export interface ScannerOptions {
  archiveTool?: ArchiveTool;
}

function mergeLimits(overrides?: Partial<ScanLimits>): ScanLimits {
  return { ...DEFAULT_SCAN_LIMITS, ...overrides };
}

async function enumerateFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}

async function readHeader(path: string, length = 560): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function addWarning(state: ScanState, sourcePath: string, virtualPath: string, error: unknown): void {
  const known = error instanceof ArchiveInspectionError;
  state.result.warnings.push({
    sourcePath,
    virtualPath,
    code: known ? error.code : "invalid_archive",
    message: error instanceof Error ? error.message : String(error),
  });
}

function registerExpansion(state: ScanState, size: number): void {
  state.expandedBytes += size;
}

function recordBuffer(state: ScanState, sourcePath: string, virtualPath: string, data: Buffer, chain: string[]): void {
  const item: DiscoveredContent = {
    sourcePath,
    virtualPath,
    containerChain: chain,
    size: data.length,
    hashes: hashContent(data),
  };
  state.result.content.push(item);
}

async function recordFile(
  state: ScanState,
  physicalPath: string,
  sourcePath: string,
  virtualPath: string,
  chain: string[],
  size: number,
): Promise<void> {
  registerExpansion(state, size);
  state.result.content.push({
    sourcePath,
    virtualPath,
    containerChain: chain,
    size,
    hashes: await hashFile(physicalPath),
  });
}

function manualMembers(container: ContainerFormat, data: Buffer, virtualPath: string, limits: ScanLimits) {
  return container === "zip"
    ? readZip(data, limits)
    : container === "tar"
      ? readTar(data, limits)
      : readGzip(data, virtualPath, limits);
}

async function inspectMaterializedArchive(
  sourcePath: string,
  virtualPath: string,
  data: Buffer,
  chain: string[],
  depth: number,
  limits: ScanLimits,
  state: ScanState,
  archiveTool: ArchiveTool,
): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "retroroms-archive-"));
  const temporaryArchive = join(temporaryRoot, "nested.archive");
  try {
    await writeFile(temporaryArchive, data, { flag: "wx", mode: 0o600 });
    await inspectArchivePath(sourcePath, virtualPath, temporaryArchive, chain, depth, limits, state, archiveTool, data.length);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function inspectBuffer(
  sourcePath: string,
  virtualPath: string,
  data: Buffer,
  chain: string[],
  depth: number,
  limits: ScanLimits,
  state: ScanState,
  archiveTool: ArchiveTool,
): Promise<void> {
  registerExpansion(state, data.length);
  const container = detectContainer(data, virtualPath);
  if (!container) {
    recordBuffer(state, sourcePath, virtualPath, data, chain);
    return;
  }
  if (depth >= limits.maxDepth) {
    addWarning(state, sourcePath, virtualPath, new ArchiveInspectionError("limit_exceeded", `Maximum archive depth ${limits.maxDepth} reached`));
    return;
  }
  if (container === "7z" || container === "rar") {
    try {
      await inspectMaterializedArchive(sourcePath, virtualPath, data, chain, depth, limits, state, archiveTool);
    } catch (error) {
      const unavailable = error instanceof Error && "code" in error && error.code === "ENOENT";
      addWarning(
        state,
        sourcePath,
        virtualPath,
        unavailable
          ? new ArchiveInspectionError("unsupported_archive", `${container.toUpperCase()} requires the bundled archive helper`)
          : error,
      );
    }
    return;
  }
  try {
    for (const member of manualMembers(container, data, virtualPath, limits)) {
      await inspectBuffer(
        sourcePath,
        `${virtualPath}::${member.name}`,
        member.data,
        [...chain, virtualPath],
        depth + 1,
        limits,
        state,
        archiveTool,
      );
    }
  } catch (error) {
    addWarning(state, sourcePath, virtualPath, error);
  }
}

async function inspectArchivePath(
  sourcePath: string,
  virtualPath: string,
  archivePath: string,
  chain: string[],
  depth: number,
  limits: ScanLimits,
  state: ScanState,
  archiveTool: ArchiveTool,
  compressedSize: number,
): Promise<void> {
  const contentStart = state.result.content.length;
  const expandedStart = state.expandedBytes;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "retroroms-members-"));
  try {
    const members = await archiveTool.list(archivePath, limits);
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const extractedPath = join(temporaryRoot, `${index}.member`);
      const extractedSize = await archiveTool.extractToFile(archivePath, member, extractedPath, limits);
      if (state.expandedBytes + extractedSize - expandedStart > limits.maxExpandedBytes) {
        throw new ArchiveInspectionError("limit_exceeded", `Archive exceeds the ${limits.maxExpandedBytes} expanded-byte limit`);
      }
      if (compressedSize > 0 && state.expandedBytes + extractedSize - expandedStart > compressedSize * limits.maxCompressionRatio) {
        throw new ArchiveInspectionError("limit_exceeded", `Archive exceeds the ${limits.maxCompressionRatio}:1 expansion ratio limit`);
      }
      await inspectExtractedFile(
        extractedPath,
        sourcePath,
        `${virtualPath}::${member}`,
        [...chain, virtualPath],
        depth + 1,
        limits,
        state,
        archiveTool,
      );
      const expandedForArchive = state.expandedBytes - expandedStart;
      if (expandedForArchive > limits.maxExpandedBytes) {
        throw new ArchiveInspectionError("limit_exceeded", `Archive exceeds the ${limits.maxExpandedBytes} expanded-byte limit`);
      }
      if (compressedSize > 0 && expandedForArchive > compressedSize * limits.maxCompressionRatio) {
        throw new ArchiveInspectionError("limit_exceeded", `Archive exceeds the ${limits.maxCompressionRatio}:1 expansion ratio limit`);
      }
    }
  } catch (error) {
    state.result.content.splice(contentStart);
    state.expandedBytes = expandedStart;
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function inspectExtractedFile(
  physicalPath: string,
  sourcePath: string,
  virtualPath: string,
  chain: string[],
  depth: number,
  limits: ScanLimits,
  state: ScanState,
  archiveTool: ArchiveTool,
): Promise<void> {
  const fileStat = await stat(physicalPath);
  const container = detectContainer(await readHeader(physicalPath), virtualPath);
  if (!container) {
    await recordFile(state, physicalPath, sourcePath, virtualPath, chain, fileStat.size);
    return;
  }
  registerExpansion(state, fileStat.size);
  if (depth >= limits.maxDepth) {
    addWarning(state, sourcePath, virtualPath, new ArchiveInspectionError("limit_exceeded", `Maximum archive depth ${limits.maxDepth} reached`));
    return;
  }
  await inspectArchivePath(sourcePath, virtualPath, physicalPath, chain, depth, limits, state, archiveTool, fileStat.size);
}

async function inspectRootFile(
  sourcePath: string,
  virtualPath: string,
  limits: ScanLimits,
  state: ScanState,
  archiveTool: ArchiveTool,
): Promise<void> {
  const fileStat = await stat(sourcePath);
  const container = detectContainer(await readHeader(sourcePath), virtualPath);
  if (!container) {
    if (fileStat.size > limits.maxEntryBytes) {
      addWarning(state, sourcePath, virtualPath, new ArchiveInspectionError("limit_exceeded", `File exceeds the ${limits.maxEntryBytes} byte limit`));
      return;
    }
    await recordFile(state, sourcePath, sourcePath, virtualPath, [], fileStat.size);
    return;
  }

  try {
    await inspectArchivePath(sourcePath, virtualPath, sourcePath, [], 0, limits, state, archiveTool, fileStat.size);
  } catch (error) {
    const unavailable = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (unavailable && container !== "7z" && container !== "rar" && fileStat.size <= limits.maxEntryBytes) {
      await inspectBuffer(sourcePath, virtualPath, await readFile(sourcePath), [], 0, limits, state, archiveTool);
      return;
    }
    addWarning(
      state,
      sourcePath,
      virtualPath,
      unavailable
        ? new ArchiveInspectionError("unsupported_archive", `${container.toUpperCase()} requires the bundled archive helper`)
        : error,
    );
  }
}

export async function scanSourceRoots(
  roots: string[],
  overrides?: Partial<ScanLimits>,
  options: ScannerOptions = {},
): Promise<ScanResult> {
  const limits = mergeLimits(overrides);
  const archiveTool = options.archiveTool ?? new BsdtarArchiveTool();
  const state: ScanState = { result: { content: [], warnings: [] }, expandedBytes: 0 };
  const distinctRoots = [...new Set(roots.map((root) => resolve(root)))];

  for (const requestedRoot of distinctRoots) {
    const root = await realpath(requestedRoot);
    if (!(await stat(root)).isDirectory()) throw new Error(`Source root is not a directory: ${requestedRoot}`);
    for (const path of await enumerateFiles(root)) {
      const resolvedPath = await realpath(path);
      const relativePath = relative(root, resolvedPath);
      if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        state.result.warnings.push({ sourcePath: path, virtualPath: path, code: "unsafe_path", message: "Resolved file escapes the selected source root" });
        continue;
      }
      await inspectRootFile(resolvedPath, relativePath, limits, state, archiveTool);
    }
  }
  return state.result;
}
