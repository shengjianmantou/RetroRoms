import { mkdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Catalog, relativePathWithinRoot, type EditionRecordInput } from "@retroroms/catalog";
import { curateObservations, DatIndex, scanSourceRoots, type CurationObservation, type ScanLimits, type ScanWarning, type ScannerOptions } from "@retroroms/core";

export interface IngestRequest {
  sourceRoots: string[];
  processedRoot: string;
  displayName?: string;
  limits?: Partial<ScanLimits>;
  scannerOptions?: ScannerOptions;
  datFiles?: Array<{ path: string; systemKey?: string }>;
  languagePreference?: Array<"en" | "zh" | "ja" | "ko" | "fr" | "de" | "es" | "it" | "other">;
}

export interface PortableManifest {
  format: "retroroms-portable-library";
  manifestVersion: 1;
  libraryUuid: string;
  displayName: string;
  catalogPath: ".rom-curator/catalog.sqlite";
  romsPath: "roms";
  updatedAt: string;
}

export interface IngestSummary {
  catalogPath: string;
  manifestPath: string;
  sourceRootCount: number;
  scannedContentCount: number;
  catalogObservationCount: number;
  crossRootDuplicateGroups: number;
  curatedGroupCount: number;
  verifiedCandidateCount: number;
  preferredVerifiedGroupCount: number;
  warnings: ScanWarning[];
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeManifest(path: string, manifest: PortableManifest): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function ingestLibrary(request: IngestRequest): Promise<IngestSummary> {
  if (request.sourceRoots.length === 0) throw new Error("At least one source root is required");
  const processedRoot = join(request.processedRoot);
  await mkdir(join(processedRoot, ".rom-curator"), { recursive: true });
  await mkdir(join(processedRoot, "roms"), { recursive: true });
  const resolvedProcessedRoot = await realpath(processedRoot);
  const resolvedSources = await Promise.all(request.sourceRoots.map((root) => realpath(root)));
  if (new Set(resolvedSources).size !== resolvedSources.length) throw new Error("Duplicate source roots resolve to the same location");
  for (const source of resolvedSources) {
    if (source === resolvedProcessedRoot) throw new Error("A source root cannot also be the processed-library root");
  }

  const catalogPath = join(resolvedProcessedRoot, ".rom-curator", "catalog.sqlite");
  const manifestPath = join(resolvedProcessedRoot, ".rom-curator", "manifest.json");
  const catalog = new Catalog(catalogPath);
  const warnings: ScanWarning[] = [];
  let scannedContentCount = 0;
  let curatedGroupCount = 0;
  let verifiedCandidateCount = 0;
  let preferredVerifiedGroupCount = 0;
  const curationObservations: CurationObservation[] = [];
  const observationHashes = new Map<string, string>();
  let scanRunId: string | undefined;
  try {
    catalog.initialize(request.displayName ?? basename(resolvedProcessedRoot));
    const datIndex = new DatIndex();
    for (const datFile of request.datFiles ?? []) await datIndex.addXmlFile(datFile.path, datFile.systemKey);
    const processedRootRecord = catalog.addRoot("processed", resolvedProcessedRoot, "Processed library");
    scanRunId = catalog.beginScan();

    for (const sourceRoot of resolvedSources) {
      const rootRecord = catalog.addRoot("source", sourceRoot, basename(sourceRoot));
      const result = await scanSourceRoots([sourceRoot], request.limits, request.scannerOptions);
      warnings.push(...result.warnings);
      scannedContentCount += result.content.length;
      for (const content of result.content) {
        const observationId = `${rootRecord.id}:${content.virtualPath}`;
        catalog.recordObservation({
          scanRunId,
          rootId: rootRecord.id,
          relativePath: relativePathWithinRoot(sourceRoot, content.sourcePath),
          virtualPath: content.virtualPath,
          containerChain: content.containerChain,
          byteSize: content.size,
          ...content.hashes,
        });
        curationObservations.push({ id: observationId, systemKey: content.virtualPath.includes("/") ? content.virtualPath.split("/")[0] : "unknown", filename: basename(content.virtualPath.split("::").at(-1) ?? content.virtualPath), hashes: content.hashes });
        observationHashes.set(observationId, content.hashes.sha256);
      }
    }

    const processedRoms = join(resolvedProcessedRoot, "roms");
    if (await directoryExists(processedRoms)) {
      const result = await scanSourceRoots([processedRoms], request.limits, request.scannerOptions);
      warnings.push(...result.warnings);
      scannedContentCount += result.content.length;
      for (const content of result.content) {
        const observationId = `${processedRootRecord.id}:${content.virtualPath}`;
        const pathWithinRoms = relativePathWithinRoot(processedRoms, content.sourcePath);
        catalog.recordObservation({
          scanRunId,
          rootId: processedRootRecord.id,
          relativePath: `roms/${pathWithinRoms}`,
          virtualPath: `roms/${content.virtualPath}`,
          containerChain: content.containerChain.map((item) => `roms/${item}`),
          byteSize: content.size,
          ...content.hashes,
        });
        curationObservations.push({ id: observationId, systemKey: content.virtualPath.includes("/") ? content.virtualPath.split("/")[0] : "unknown", filename: basename(content.virtualPath.split("::").at(-1) ?? content.virtualPath), hashes: content.hashes });
        observationHashes.set(observationId, content.hashes.sha256);
      }
    }

    const curatedGroups = curateObservations(curationObservations, datIndex, request.languagePreference);
    verifiedCandidateCount = curatedGroups.reduce((total, group) => total + group.candidates.filter((candidate) => candidate.verified).length, 0);
    preferredVerifiedGroupCount = curatedGroups.filter((group) => group.candidates.find((candidate) => candidate.observationId === group.selectedObservationId)?.verified).length;
    for (const group of curatedGroups) {
      for (const candidate of group.candidates) {
        const contentSha256 = observationHashes.get(candidate.observationId);
        if (!contentSha256) continue;
        const input: EditionRecordInput = {
          canonicalTitle: group.canonicalTitle,
          sortTitle: group.canonicalTitle.toLocaleLowerCase(),
          seriesName: group.seriesKey,
          systemKey: group.systemKey,
          region: candidate.metadata.regions[0],
          languages: candidate.metadata.languages,
          revision: candidate.metadata.revision,
          identitySource: candidate.verified ? "dat" : "filename",
          preferred: candidate.observationId === group.selectedObservationId,
          contentSha256,
        };
        catalog.upsertEdition(input);
      }
    }
    curatedGroupCount = curatedGroups.length;
    catalog.recordScanWarnings(scanRunId, warnings);
    catalog.completeScan(scanRunId, warnings.length);
    const library = catalog.getLibraryInfo();
    await writeManifest(manifestPath, {
      format: "retroroms-portable-library",
      manifestVersion: 1,
      libraryUuid: library.libraryUuid,
      displayName: library.displayName,
      catalogPath: ".rom-curator/catalog.sqlite",
      romsPath: "roms",
      updatedAt: new Date().toISOString(),
    });
    return {
      catalogPath,
      manifestPath,
      sourceRootCount: resolvedSources.length,
      scannedContentCount,
      catalogObservationCount: catalog.countObservations(),
      crossRootDuplicateGroups: catalog.countCrossRootDuplicateGroups(),
      curatedGroupCount,
      verifiedCandidateCount,
      preferredVerifiedGroupCount,
      warnings,
    };
  } catch (error) {
    if (scanRunId) catalog.failScan(scanRunId, error);
    throw error;
  } finally {
    catalog.close();
  }
}
