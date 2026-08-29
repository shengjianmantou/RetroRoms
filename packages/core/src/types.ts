export type ContainerFormat = "zip" | "tar" | "gzip";
export type RecognizedUnsupportedFormat = "7z" | "rar";

export interface ScanLimits {
  maxDepth: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
}

export interface ContentHashes {
  crc32: string;
  sha1: string;
  sha256: string;
}

export interface DiscoveredContent {
  sourcePath: string;
  virtualPath: string;
  containerChain: string[];
  size: number;
  hashes: ContentHashes;
}

export interface ScanWarning {
  sourcePath: string;
  virtualPath: string;
  code:
    | "encrypted_archive"
    | "invalid_archive"
    | "limit_exceeded"
    | "unsafe_path"
    | "unsupported_archive";
  message: string;
}

export interface ScanResult {
  content: DiscoveredContent[];
  warnings: ScanWarning[];
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxDepth: 4,
  maxEntries: 100_000,
  maxEntryBytes: 8 * 1024 * 1024 * 1024,
  maxExpandedBytes: 32 * 1024 * 1024 * 1024,
  maxCompressionRatio: 250,
};

