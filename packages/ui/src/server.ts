import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";
import { Catalog } from "@retroroms/catalog";
import { createExportPlan, normalizeSeriesKey, parseReleaseFilename, type ExportCandidate } from "@retroroms/core";

export interface UiServerOptions {
  libraryPath: string;
  port?: number;
}

function json(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function observations(catalog: Catalog) {
  return catalog.listObservations().map((item) => {
    const release = parseReleaseFilename(item.virtualPath);
    const system = item.relativePath.split("/")[0] || "unknown";
    return {
      ...item,
      title: release.title || basename(item.relativePath),
      languages: release.languages,
      regions: release.regions,
      revision: release.revision ?? null,
      disc: release.disc ?? null,
      system,
      seriesKey: normalizeSeriesKey(release.title || basename(item.relativePath)),
      artwork: null,
    };
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
    if (request.method === "POST" && url.pathname === "/api/export-preview") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) { json(response, { error: "request too large" }, 413); return; }
      }
      try {
        const payload = JSON.parse(body) as { ids?: string[]; policy?: "auto" | "compressed" | "uncompressed" | "preserve" };
        const selected = new Set(payload.ids ?? []);
        const candidates: ExportCandidate[] = observations(catalog)
          .filter((item) => selected.has(item.id))
          .map((item) => ({ id: item.id, systemKey: item.system, title: item.title, sourceVirtualPath: item.virtualPath, sourceSha256: item.sha256 }));
        const systems = [...new Set(candidates.map((candidate) => candidate.systemKey))].map((systemKey) => ({ systemKey, outputPolicy: payload.policy ?? "auto" as const }));
        json(response, { plan: createExportPlan(candidates, systems) });
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
