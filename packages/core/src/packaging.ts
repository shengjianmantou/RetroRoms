export type OutputPolicy = "auto" | "compressed" | "uncompressed" | "preserve";
export type PackageFormat = "zip" | "7z" | "chd" | "rvz" | "cso" | "pbp" | "raw";

export interface SystemPackagingProfile {
  systemKey: string;
  outputPolicy: OutputPolicy;
  compressedFormat?: PackageFormat;
}

export interface ObservedRepresentation {
  systemKey: string;
  relativePath: string;
  packageFormat: PackageFormat;
}

export interface ExportCandidate {
  id: string;
  systemKey: string;
  title: string;
  sourceVirtualPath: string;
  sourceSha256: string;
  observedRepresentations?: ObservedRepresentation[];
  requiredFiles?: string[];
}

export type ExportAction = "copy" | "compress" | "convert" | "skip-existing" | "conflict";

export interface ExportPlanItem {
  candidateId: string;
  action: ExportAction;
  outputFormat: PackageFormat;
  destinationRelativePath: string;
  reason: string;
}

const FORMAT_EXTENSIONS: Record<PackageFormat, string> = {
  zip: ".zip", "7z": ".7z", chd: ".chd", rvz: ".rvz", cso: ".cso", pbp: ".pbp", raw: "",
};

function safeTitle(title: string): string {
  const value = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!value || value === "." || value === "..") throw new Error(`Unsafe or empty game title: ${title}`);
  return value;
}

export function inferCompressedFormat(representations: ObservedRepresentation[]): PackageFormat {
  const counts = new Map<PackageFormat, number>();
  for (const representation of representations) {
    if (representation.packageFormat === "raw") continue;
    counts.set(representation.packageFormat, (counts.get(representation.packageFormat) ?? 0) + 1);
  }
  let selected: PackageFormat = "raw";
  let highest = 0;
  for (const [format, count] of counts) {
    if (count > highest) { selected = format; highest = count; }
  }
  return selected;
}

export function createExportPlan(
  candidates: ExportCandidate[],
  profiles: SystemPackagingProfile[],
  existingSha256ByDestination = new Map<string, string>(),
): ExportPlanItem[] {
  const profileMap = new Map(profiles.map((profile) => [profile.systemKey, profile]));
  return candidates.map((candidate) => {
    const profile = profileMap.get(candidate.systemKey) ?? { systemKey: candidate.systemKey, outputPolicy: "auto" as const };
    const observed = (candidate.observedRepresentations ?? []).filter((item) => item.systemKey === candidate.systemKey);
    const inferred = inferCompressedFormat(observed);
    const outputFormat = profile.outputPolicy === "uncompressed"
      ? "raw"
      : profile.compressedFormat
        ?? (profile.outputPolicy === "compressed" ? (inferred === "raw" ? "zip" : inferred) : inferred);
    const action: ExportAction = outputFormat === "raw" ? "copy" : candidate.observedRepresentations?.some((item) => item.packageFormat === outputFormat) ? "copy" : "compress";
    const destinationRelativePath = `roms/${candidate.systemKey}/${safeTitle(candidate.title)}${FORMAT_EXTENSIONS[outputFormat]}`;
    const existing = existingSha256ByDestination.get(destinationRelativePath);
    return {
      candidateId: candidate.id,
      action: existing === candidate.sourceSha256 ? "skip-existing" : existing ? "conflict" : action,
      outputFormat,
      destinationRelativePath,
      reason: existing === candidate.sourceSha256
        ? "Verified destination already contains this content"
        : existing
          ? "Destination exists with different content; no overwrite"
          : profile.outputPolicy === "auto" && !profile.compressedFormat
            ? `Auto-selected ${outputFormat} from observed ${candidate.systemKey} representations`
            : `System policy is ${profile.outputPolicy}`,
    };
  });
}
