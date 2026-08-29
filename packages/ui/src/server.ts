import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { Catalog } from "@retroroms/catalog";
import { BsdtarArchiveTool, createExportPlan, normalizeSeriesKey, parseReleaseFilename, type ExportCandidate, type OutputPolicy, type PackageFormat } from "@retroroms/core";

const execFileAsync = promisify(execFile);

export interface UiServerOptions {
  libraryPath: string;
  port?: number;
}

function json(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function observations(catalog: Catalog) {
  const editionsByHash = new Map(catalog.listEditions().map((edition) => [edition.contentSha256, edition]));
  return catalog.listObservations().map((item) => {
    const release = parseReleaseFilename(item.virtualPath);
    const edition = editionsByHash.get(item.sha256);
    const system = item.relativePath.includes("/") ? item.relativePath.split("/")[0] : "unknown";
    return {
      ...item,
      title: edition?.title || release.title || basename(item.relativePath),
      languages: edition?.languages ?? release.languages,
      regions: edition?.region ? [edition.region] : release.regions,
      revision: edition?.revision ?? release.revision ?? null,
      disc: release.disc ?? null,
      system,
      seriesKey: edition?.seriesName || normalizeSeriesKey(edition?.title || release.title || basename(item.relativePath)),
      preferred: edition?.preferred ?? false,
      identitySource: edition?.identitySource ?? "filename",
      artwork: null,
    };
  });
}

type ProfilePayload = Record<string, { outputPolicy?: OutputPolicy; compressedFormat?: PackageFormat }>;
function profilesFor(candidates: ExportCandidate[], payload: { policy?: OutputPolicy; profiles?: ProfilePayload }) {
  return [...new Set(candidates.map((candidate) => candidate.systemKey))].map((systemKey) => {
    const profile = payload.profiles?.[systemKey];
    return { systemKey, outputPolicy: profile?.outputPolicy ?? payload.policy ?? "auto", compressedFormat: profile?.compressedFormat };
  });
}

export async function createUiServer(options: UiServerOptions) {
  const catalog = new Catalog(resolve(options.libraryPath));
  catalog.initialize();
  const index = await readFile(new URL("./public/index.html", import.meta.url), "utf8");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(index);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/observations") {
      json(response, { observations: observations(catalog) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/exports") {
      json(response, { exports: catalog.listExports() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/stats") {
      json(response, catalog.getStatistics());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/export-preview") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) { json(response, { error: "request too large" }, 413); return; }
      }
      try {
        const payload = JSON.parse(body) as { ids?: string[]; policy?: OutputPolicy; profiles?: ProfilePayload; overwriteConflicts?: boolean };
        const selected = new Set(payload.ids ?? []);
        const candidates: ExportCandidate[] = observations(catalog)
          .filter((item) => selected.has(item.id))
          .map((item) => ({ id: item.id, systemKey: item.system, title: item.title, sourceVirtualPath: item.virtualPath, sourceSha256: item.sha256 }));
        json(response, { plan: createExportPlan(candidates, profilesFor(candidates, payload)) });
      } catch (error) {
        json(response, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/export") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) { json(response, { error: "request too large" }, 413); return; }
      }
      try {
        const payload = JSON.parse(body) as { ids?: string[]; policy?: OutputPolicy; profiles?: ProfilePayload };
        const all = observations(catalog);
        const selected = new Set(payload.ids ?? []);
        const chosen = all.filter((item) => selected.has(item.id));
        const candidates: ExportCandidate[] = chosen.map((item) => ({ id: item.id, systemKey: item.system, title: item.title, sourceVirtualPath: item.virtualPath, sourceSha256: item.sha256 }));
        const plan = createExportPlan(candidates, profilesFor(candidates, payload));
        const processedRoot = dirname(dirname(resolve(options.libraryPath)));
        const results = [];
        for (const item of plan) {
          const source = chosen.find((candidate) => candidate.id === item.candidateId);
          if (!source) continue;
          if (source.virtualPath.includes("::")) {
            results.push({ ...item, status: "skipped", message: "Archive members require extraction/export worker support" });
            continue;
          }
          const sourcePath = resolve(source.rootPath, source.relativePath);
          const destination = resolve(processedRoot, item.destinationRelativePath);
          if (!destination.startsWith(`${processedRoot}/`)) throw new Error("Unsafe export destination");
          try {
            await stat(destination);
            const existingSha256 = createHash("sha256").update(await readFile(destination)).digest("hex");
            if (existingSha256 === source.sha256) {
              results.push({ ...item, status: "skip-existing", message: "Destination already contains the source content" });
              continue;
            }
            if (!payload.overwriteConflicts) {
              results.push({ ...item, status: "conflict", message: "Destination exists with different content; no overwrite" });
              continue;
            }
          } catch { /* create new destination */ }
          await mkdir(dirname(destination), { recursive: true });
          const members = source.virtualPath.split("::").slice(1);
          const temporaryRoot = members.length ? await mkdtemp(join(processedRoot, ".rom-curator-export-")) : undefined;
          const materialized = temporaryRoot ? join(temporaryRoot, "game.rom") : sourcePath;
          try {
            if (members.length > 1) {
              results.push({ ...item, status: "skipped", message: "Nested archive export is not yet supported" });
              continue;
            }
            if (temporaryRoot) await new BsdtarArchiveTool().extractToFile(sourcePath, members[0], materialized, { maxArchiveListingBytes: 4_000_000, maxEntries: 100_000, maxEntryBytes: 2_000_000_000, maxExpandedBytes: 4_000_000_000, maxCompressionRatio: 200, maxDepth: 4, archiveCommandTimeoutMs: 120_000 });
            if (item.outputFormat === "raw") await copyFile(materialized, destination);
            else { await unlink(destination).catch(() => undefined); await execFileAsync("zip", ["-j", "-q", destination, materialized]); }
            const edition = catalog.findEditionByContentSha256(source.sha256);
            const processedRootRecord = catalog.findRoot("processed", processedRoot);
            if (edition && processedRootRecord) {
              const packageSha256 = createHash("sha256").update(await readFile(destination)).digest("hex");
              catalog.recordExport({ editionId: edition.id, processedRootId: processedRootRecord.id, relativePath: item.destinationRelativePath, outputPolicy: payload.profiles?.[source.system]?.outputPolicy ?? payload.policy ?? "auto", packageFormat: item.outputFormat, packageSha256, contentManifest: { sourceSha256: source.sha256, sourceVirtualPath: source.virtualPath } });
            }
            results.push({ ...item, status: "exported" });
          } finally {
            if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
          }
        }
        json(response, { results });
      } catch (error) {
        json(response, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
      return;
    }
    json(response, { error: "not found" }, 404);
  });
  const port = options.port ?? 4177;
  await new Promise<void>((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
  return { server, port, close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const library = process.argv[process.argv.indexOf("--library") + 1];
  if (!library) throw new Error("Usage: npm run serve -w @retroroms/ui -- --library <path-to-catalog.sqlite>");
  const portArgument = process.argv[process.argv.indexOf("--port") + 1];
  const running = await createUiServer({ libraryPath: library, port: portArgument ? Number(portArgument) : undefined });
  console.log(`RetroRoms UI listening on http://127.0.0.1:${running.port}`);
}
