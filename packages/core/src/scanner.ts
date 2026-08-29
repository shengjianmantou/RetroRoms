import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { ArchiveInspectionError, detectContainer, readGzip, readTar, readZip } from "./archive.ts";
import { hashContent } from "./hash.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type DiscoveredContent,
  type ScanLimits,
  type ScanResult,
} from "./types.ts";

interface ScanState {
  result: ScanResult;
  entriesSeen: number;
  expandedBytes: number;
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

function warning(
  state: ScanState,
  sourcePath: string,
  virtualPath: string,
  error: unknown,
): void {
  const known = error instanceof ArchiveInspectionError;
  state.result.warnings.push({
    sourcePath,
    virtualPath,
    code: known ? error.code : "invalid_archive",
    message: error instanceof Error ? error.message : String(error),
  });
}

function inspectContent(
  sourcePath: string,
  virtualPath: string,
  data: Buffer,
  chain: string[],
  depth: number,
  limits: ScanLimits,
  state: ScanState,
): void {
  state.entriesSeen += 1;
  state.expandedBytes += data.length;
  if (state.entriesSeen > limits.maxEntries || state.expandedBytes > limits.maxExpandedBytes) {
    throw new ArchiveInspectionError("limit_exceeded", "Scan expansion limits were exceeded");
  }

  const container = detectContainer(data, virtualPath);
  if (container === "7z" || container === "rar") {
    warning(state, sourcePath, virtualPath, new ArchiveInspectionError("unsupported_archive", `${container.toUpperCase()} handler is recognized but not enabled in this build`));
    return;
  }
  if (!container) {
    const item: DiscoveredContent = {
      sourcePath,
      virtualPath,
      containerChain: chain,
      size: data.length,
      hashes: hashContent(data),
    };
    state.result.content.push(item);
    return;
  }
  if (depth >= limits.maxDepth) {
    warning(state, sourcePath, virtualPath, new ArchiveInspectionError("limit_exceeded", `Maximum archive depth ${limits.maxDepth} reached`));
    return;
  }

  try {
    const members = container === "zip" ? readZip(data, limits) : container === "tar" ? readTar(data, limits) : readGzip(data, virtualPath, limits);
    for (const member of members) {
      inspectContent(
        sourcePath,
        `${virtualPath}::${member.name}`,
        member.data,
        [...chain, virtualPath],
        depth + 1,
        limits,
        state,
      );
    }
  } catch (error) {
    warning(state, sourcePath, virtualPath, error);
  }
}

export async function scanSourceRoots(
  roots: string[],
  overrides?: Partial<ScanLimits>,
): Promise<ScanResult> {
  const limits = mergeLimits(overrides);
  const state: ScanState = { result: { content: [], warnings: [] }, entriesSeen: 0, expandedBytes: 0 };
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
      const data = await readFile(resolvedPath);
      inspectContent(resolvedPath, relativePath, data, [], 0, limits, state);
    }
  }
  return state.result;
}

