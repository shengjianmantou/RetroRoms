import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, SCHEMA_V1 } from "./schema.ts";

export type RootKind = "source" | "processed";

export interface RootRecord {
  id: string;
  kind: RootKind;
  path: string;
  displayName: string;
}

export interface ObservationInput {
  scanRunId: string;
  rootId: string;
  relativePath: string;
  virtualPath: string;
  containerChain: string[];
  byteSize: number;
  crc32: string;
  sha1: string;
  sha256: string;
}

export interface LibraryInfo {
  libraryUuid: string;
  displayName: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface EditionRecordInput {
  canonicalTitle: string;
  sortTitle: string;
  seriesName?: string;
  systemKey: string;
  region?: string;
  languages: string[];
  revision?: string;
  identitySource: "dat" | "serial" | "hash" | "filename" | "user";
  preferred: boolean;
  contentSha256: string;
}

export interface ExportRecordInput {
  editionId: string;
  processedRootId: string;
  relativePath: string;
  outputPolicy: OutputPolicy;
  packageFormat: string;
  packageSha256: string;
  contentManifest: unknown;
}

export type OutputPolicy = "auto" | "compressed" | "uncompressed" | "preserve";

function now(): string {
  return new Date().toISOString();
}

export function relativePathWithinRoot(root: string, target: string): string {
  const value = relative(resolve(root), resolve(target));
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`Path is outside the selected root: ${target}`);
  }
  return value.split(sep).join("/");
}

export class Catalog {
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  }

  initialize(displayName = "RetroRoms Library"): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(SCHEMA_V1);
      const existing = this.database.prepare("SELECT schema_version FROM library WHERE id = 1").get() as { schema_version: number } | undefined;
      if (!existing) {
        const timestamp = now();
        this.database.prepare(`
          INSERT INTO library (id, library_uuid, display_name, schema_version, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?)
        `).run(randomUUID(), displayName, CURRENT_SCHEMA_VERSION, timestamp, timestamp);
      } else if (existing.schema_version > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Catalog schema ${existing.schema_version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  addRoot(kind: RootKind, path: string, displayName: string): RootRecord {
    const normalizedPath = resolve(path);
    const existing = this.database.prepare("SELECT id, kind, path, display_name FROM roots WHERE kind = ? AND path = ?").get(kind, normalizedPath) as
      | { id: string; kind: RootKind; path: string; display_name: string }
      | undefined;
    if (existing) return { id: existing.id, kind: existing.kind, path: existing.path, displayName: existing.display_name };
    const record = { id: randomUUID(), kind, path: normalizedPath, displayName };
    this.database.prepare("INSERT INTO roots (id, kind, path, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run(
      record.id,
      record.kind,
      record.path,
      record.displayName,
      now(),
    );
    return record;
  }

  beginScan(): string {
    const id = randomUUID();
    this.database.prepare("INSERT INTO scan_runs (id, started_at, status) VALUES (?, ?, 'running')").run(id, now());
    return id;
  }

  recordObservation(input: ObservationInput): string {
    if (isAbsolute(input.relativePath) || input.relativePath.split("/").includes("..")) {
      throw new Error(`Observation path must be safe and relative: ${input.relativePath}`);
    }
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO content_observations (
        id, scan_run_id, root_id, relative_path, virtual_path, container_chain_json,
        byte_size, crc32, sha1, sha256, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, virtual_path, sha256) DO UPDATE SET
        scan_run_id = excluded.scan_run_id,
        relative_path = excluded.relative_path,
        container_chain_json = excluded.container_chain_json,
        byte_size = excluded.byte_size,
        crc32 = excluded.crc32,
        sha1 = excluded.sha1,
        observed_at = excluded.observed_at
    `).run(
      id,
      input.scanRunId,
      input.rootId,
      input.relativePath,
      input.virtualPath,
      JSON.stringify(input.containerChain),
      input.byteSize,
      input.crc32,
      input.sha1,
      input.sha256,
      now(),
    );
    const stored = this.database.prepare("SELECT id FROM content_observations WHERE root_id = ? AND virtual_path = ? AND sha256 = ?").get(
      input.rootId,
      input.virtualPath,
      input.sha256,
    ) as { id: string };
    return stored.id;
  }

  completeScan(scanRunId: string, warningCount = 0): void {
    const result = this.database.prepare(`
      UPDATE scan_runs SET status = 'completed', completed_at = ?, warning_count = ?
      WHERE id = ? AND status = 'running'
    `).run(now(), warningCount, scanRunId);
    if (result.changes !== 1) throw new Error(`Scan is not running: ${scanRunId}`);
  }

  failScan(scanRunId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.database.prepare(`
      UPDATE scan_runs SET status = 'failed', completed_at = ?, error_message = ?
      WHERE id = ? AND status = 'running'
    `).run(now(), message.slice(0, 4_000), scanRunId);
  }

  getLibraryInfo(): LibraryInfo {
    const row = this.database.prepare(`
      SELECT library_uuid, display_name, schema_version, created_at, updated_at FROM library WHERE id = 1
    `).get() as {
      library_uuid: string;
      display_name: string;
      schema_version: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!row) throw new Error("Catalog has not been initialized");
    return {
      libraryUuid: row.library_uuid,
      displayName: row.display_name,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  countObservations(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM content_observations").get() as { count: number };
    return row.count;
  }

  countCrossRootDuplicateGroups(): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT o.sha256 FROM content_observations o
        GROUP BY o.sha256 HAVING COUNT(DISTINCT o.root_id) > 1
      )
    `).get() as { count: number };
    return row.count;
  }

  getStatistics(): { observationCount: number; curatedEditionCount: number; preferredEditionCount: number; verifiedEditionCount: number } {
    const row = this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM content_observations) AS observationCount,
        (SELECT COUNT(*) FROM editions) AS curatedEditionCount,
        (SELECT COUNT(*) FROM editions WHERE preferred = 1) AS preferredEditionCount,
        (SELECT COUNT(*) FROM editions WHERE identity_source = 'dat') AS verifiedEditionCount
    `).get() as { observationCount: number; curatedEditionCount: number; preferredEditionCount: number; verifiedEditionCount: number };
    return row;
  }

  listScanRuns(limit = 25): Array<{ id: string; startedAt: string; completedAt: string | null; status: string; warningCount: number; errorMessage: string | null }> {
    return this.database.prepare(`SELECT id, started_at AS startedAt, completed_at AS completedAt, status, warning_count AS warningCount, error_message AS errorMessage FROM scan_runs ORDER BY started_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 100))) as Array<{ id: string; startedAt: string; completedAt: string | null; status: string; warningCount: number; errorMessage: string | null }>;
  }

  listObservations(limit = 5_000): Array<{
    id: string;
    rootKind: RootKind;
    rootPath: string;
    relativePath: string;
    virtualPath: string;
    byteSize: number;
    crc32: string;
    sha1: string;
    sha256: string;
    containerChain: string[];
  }> {
    const rows = this.database.prepare(`
      SELECT o.id, r.kind AS rootKind, r.path AS rootPath, o.relative_path AS relativePath,
        o.virtual_path AS virtualPath, o.byte_size AS byteSize, o.crc32, o.sha1, o.sha256,
        o.container_chain_json AS containerChainJson
      FROM content_observations o JOIN roots r ON r.id = o.root_id
      ORDER BY o.virtual_path LIMIT ?
    `).all(Math.max(1, Math.min(limit, 50_000))) as Array<{
      id: string;
      rootKind: RootKind;
      rootPath: string;
      relativePath: string;
      virtualPath: string;
      byteSize: number;
      crc32: string;
      sha1: string;
      sha256: string;
      containerChainJson: string;
    }>;
    return rows.map((row) => ({ ...row, containerChain: JSON.parse(row.containerChainJson) as string[] }));
  }

  upsertEdition(input: EditionRecordInput): { gameId: string; editionId: string } {
    const languageJson = JSON.stringify([...input.languages].sort());
    const existingGame = this.database.prepare(`
      SELECT g.id FROM games g JOIN editions e ON e.game_id = g.id
      WHERE g.canonical_title = ? AND e.system_key = ? LIMIT 1
    `).get(input.canonicalTitle, input.systemKey) as { id: string } | undefined;
    const gameId = existingGame?.id ?? randomUUID();
    if (!existingGame) {
      const timestamp = now();
      this.database.prepare(`
        INSERT INTO games (id, canonical_title, sort_title, series_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(gameId, input.canonicalTitle, input.sortTitle, input.seriesName ?? null, timestamp, timestamp);
    } else {
      this.database.prepare("UPDATE games SET sort_title = ?, series_name = ?, updated_at = ? WHERE id = ?")
        .run(input.sortTitle, input.seriesName ?? null, now(), gameId);
    }
    const existingEdition = this.database.prepare(`
      SELECT id FROM editions WHERE game_id = ? AND system_key = ? AND region IS ? AND languages_json = ? AND revision IS ?
    `).get(gameId, input.systemKey, input.region ?? null, languageJson, input.revision ?? null) as { id: string } | undefined;
    const editionId = existingEdition?.id ?? randomUUID();
    if (!existingEdition) {
      this.database.prepare(`
        INSERT INTO editions (id, game_id, system_key, region, languages_json, revision, identity_source, preferred)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(editionId, gameId, input.systemKey, input.region ?? null, languageJson, input.revision ?? null, input.identitySource, input.preferred ? 1 : 0);
    } else {
      // A later non-preferred candidate must not unset the preferred edition
      // selected earlier in the same curation pass.
      this.database.prepare("UPDATE editions SET identity_source = ?, preferred = CASE WHEN ? = 1 THEN 1 ELSE preferred END WHERE id = ?")
        .run(input.identitySource, input.preferred ? 1 : 0, editionId);
    }
    this.database.prepare("INSERT OR IGNORE INTO edition_content (edition_id, sha256, role) VALUES (?, ?, 'rom')").run(editionId, input.contentSha256);
    if (input.preferred) {
      this.database.prepare("UPDATE editions SET preferred = 0 WHERE game_id = ? AND system_key = ? AND id != ?")
        .run(gameId, input.systemKey, editionId);
    }
    return { gameId, editionId };
  }

  listEditions(): Array<{ id: string; gameId: string; title: string; seriesName: string | null; systemKey: string; region: string | null; revision: string | null; languages: string[]; preferred: boolean; identitySource: string; contentSha256: string }> {
    const rows = this.database.prepare(`
      SELECT e.id, e.game_id AS gameId, g.canonical_title AS title, g.series_name AS seriesName,
        e.system_key AS systemKey, e.region, e.revision, e.languages_json AS languagesJson,
        e.preferred, e.identity_source AS identitySource, ec.sha256 AS contentSha256
      FROM editions e JOIN games g ON g.id = e.game_id
      LEFT JOIN edition_content ec ON ec.edition_id = e.id
      ORDER BY g.sort_title, e.system_key
    `).all() as Array<{ id: string; gameId: string; title: string; seriesName: string | null; systemKey: string; region: string | null; revision: string | null; languagesJson: string; preferred: number; identitySource: string; contentSha256: string }>;
    return rows.map((row) => ({ ...row, languages: JSON.parse(row.languagesJson) as string[], preferred: row.preferred === 1 }));
  }

  findEditionByContentSha256(sha256: string): { id: string } | undefined {
    return this.database.prepare("SELECT edition_id AS id FROM edition_content WHERE sha256 = ? LIMIT 1").get(sha256) as { id: string } | undefined;
  }

  findRoot(kind: RootKind, path: string): RootRecord | undefined {
    const row = this.database.prepare("SELECT id, kind, path, display_name FROM roots WHERE kind = ? AND path = ?").get(kind, resolve(path)) as
      | { id: string; kind: RootKind; path: string; display_name: string }
      | undefined;
    return row ? { id: row.id, kind: row.kind, path: row.path, displayName: row.display_name } : undefined;
  }

  recordExport(input: ExportRecordInput): void {
    if (isAbsolute(input.relativePath) || input.relativePath.split("/").includes("..")) throw new Error(`Export path must be safe and relative: ${input.relativePath}`);
    const timestamp = now();
    this.database.prepare(`
      INSERT INTO exports (id, edition_id, processed_root_id, relative_path, output_policy, package_format, package_sha256, content_manifest_json, exported_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(processed_root_id, relative_path) DO UPDATE SET edition_id = excluded.edition_id, output_policy = excluded.output_policy,
        package_format = excluded.package_format, package_sha256 = excluded.package_sha256, content_manifest_json = excluded.content_manifest_json,
        exported_at = excluded.exported_at, verified_at = excluded.verified_at
    `).run(randomUUID(), input.editionId, input.processedRootId, input.relativePath, input.outputPolicy, input.packageFormat, input.packageSha256, JSON.stringify(input.contentManifest), timestamp, timestamp);
  }

  listExports(limit = 5_000): Array<{ relativePath: string; packageFormat: string; packageSha256: string; outputPolicy: OutputPolicy; exportedAt: string; verifiedAt: string }> {
    return this.database.prepare(`SELECT relative_path AS relativePath, package_format AS packageFormat, package_sha256 AS packageSha256, output_policy AS outputPolicy, exported_at AS exportedAt, verified_at AS verifiedAt FROM exports ORDER BY exported_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 50_000))) as Array<{ relativePath: string; packageFormat: string; packageSha256: string; outputPolicy: OutputPolicy; exportedAt: string; verifiedAt: string }>;
  }

  findBySha256(sha256: string): Array<{ rootKind: RootKind; relativePath: string; virtualPath: string }> {
    return this.database.prepare(`
      SELECT r.kind AS rootKind, o.relative_path AS relativePath, o.virtual_path AS virtualPath
      FROM content_observations o JOIN roots r ON r.id = o.root_id
      WHERE o.sha256 = ? ORDER BY r.kind, o.virtual_path
    `).all(sha256) as Array<{ rootKind: RootKind; relativePath: string; virtualPath: string }>;
  }

  close(): void {
    this.database.close();
  }
}
