import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { ingestLibrary } from "@retroroms/ingest";

export interface CliArguments {
  sourceRoots: string[];
  processedRoot: string;
  displayName?: string;
  datFiles: string[];
  datSystems: Record<string, string>;
  languagePreference?: Array<"en" | "zh" | "ja">;
  progressFile?: string;
}

const USAGE = `Usage:
  npm run scan -w @retroroms/cli -- --source <path> [--source <path> ...] --processed <path> [--name <label>] [--dat <file>] [--dat-system <file=system>] [--languages en,zh,ja]

This development command scans sources read-only and creates or updates the portable
catalog under <processed>/.rom-curator. It does not export, move, or delete ROMs.`;

export function parseArguments(argv: string[]): CliArguments {
  const sourceRoots: string[] = [];
  let processedRoot: string | undefined;
  let displayName: string | undefined;
  const datFiles: string[] = [];
  const datSystems: Record<string, string> = {};
  let languagePreference: Array<"en" | "zh" | "ja"> | undefined;
  let progressFile: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") sourceRoots.push(argv[++index] ?? "");
    else if (argument === "--processed") processedRoot = argv[++index];
    else if (argument === "--name") displayName = argv[++index];
    else if (argument === "--dat") datFiles.push(argv[++index] ?? "");
    else if (argument === "--dat-system") {
      const value = argv[++index] ?? "";
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) throw new Error("--dat-system expects <file=system>");
      datSystems[value.slice(0, separator)] = value.slice(separator + 1);
    }
    else if (argument === "--languages") {
      const values = (argv[++index] ?? "").split(",").filter(Boolean);
      if (values.some((value) => !["en", "zh", "ja"].includes(value))) throw new Error("--languages accepts en, zh, and ja");
      languagePreference = values as Array<"en" | "zh" | "ja">;
    }
    else if (argument === "--progress-file") progressFile = argv[++index];
    else if (argument === "--help" || argument === "-h") throw new Error(USAGE);
    else throw new Error(`Unknown argument: ${argument}\n\n${USAGE}`);
  }
  if (sourceRoots.length === 0 || sourceRoots.some((item) => !item) || !processedRoot) {
    throw new Error(USAGE);
  }
  return { sourceRoots, processedRoot, displayName, datFiles, datSystems, languagePreference, ...(progressFile ? { progressFile } : {}) };
}

async function main(): Promise<void> {
  try {
    const request = parseArguments(process.argv.slice(2));
    const summary = await ingestLibrary({ ...request, datFiles: request.datFiles.map((path) => ({ path, systemKey: request.datSystems[path] })), scannerOptions: request.progressFile ? { onProgress: (progress) => writeFileSync(request.progressFile!, JSON.stringify(progress), { mode: 0o600 }) } : undefined });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.warnings.length > 0) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
