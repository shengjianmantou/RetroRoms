import { pathToFileURL } from "node:url";
import { ingestLibrary } from "@retroroms/ingest";

export interface CliArguments {
  sourceRoots: string[];
  processedRoot: string;
  displayName?: string;
}

const USAGE = `Usage:
  npm run scan -w @retroroms/cli -- --source <path> [--source <path> ...] --processed <path> [--name <label>]

This development command scans sources read-only and creates or updates the portable
catalog under <processed>/.rom-curator. It does not export, move, or delete ROMs.`;

export function parseArguments(argv: string[]): CliArguments {
  const sourceRoots: string[] = [];
  let processedRoot: string | undefined;
  let displayName: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") sourceRoots.push(argv[++index] ?? "");
    else if (argument === "--processed") processedRoot = argv[++index];
    else if (argument === "--name") displayName = argv[++index];
    else if (argument === "--help" || argument === "-h") throw new Error(USAGE);
    else throw new Error(`Unknown argument: ${argument}\n\n${USAGE}`);
  }
  if (sourceRoots.length === 0 || sourceRoots.some((item) => !item) || !processedRoot) {
    throw new Error(USAGE);
  }
  return { sourceRoots, processedRoot, displayName };
}

async function main(): Promise<void> {
  try {
    const request = parseArguments(process.argv.slice(2));
    const summary = await ingestLibrary(request);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.warnings.length > 0) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

