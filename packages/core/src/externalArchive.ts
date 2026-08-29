import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import type { ScanLimits } from "./types.ts";
import { ArchiveInspectionError, isSafeMemberPath } from "./archive.ts";

export interface ArchiveTool {
  list(archivePath: string, limits: ScanLimits): Promise<string[]>;
  extractToFile(archivePath: string, member: string, destination: string, limits: ScanLimits): Promise<number>;
}

interface CaptureOptions {
  maxBytes: number;
  timeoutMs: number;
}

function capture(command: string, args: string[], options: CaptureOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new ArchiveInspectionError("limit_exceeded", `Archive command exceeded ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxBytes) {
        child.kill("SIGKILL");
        finish(new ArchiveInspectionError("limit_exceeded", `Archive command output exceeded ${options.maxBytes} bytes`));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((total, item) => total + item.length, 0) < 64 * 1024) errors.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(new ArchiveInspectionError("invalid_archive", `Archive command failed (${code})${detail ? `: ${detail}` : ""}`));
        return;
      }
      finish(undefined, Buffer.concat(output));
    });
  });
}

async function captureToFile(command: string, args: string[], destination: string, options: CaptureOptions): Promise<number> {
  const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const handle = await open(destination, "wx", 0o600);
  const errors: Buffer[] = [];
  let errorBytes = 0;
  let outputBytes = 0;
  let timedOut = false;
  const completion = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (errorBytes >= 64 * 1024) return;
    errors.push(chunk);
    errorBytes += chunk.length;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs);
  try {
    for await (const chunk of child.stdout) {
      const data = chunk as Buffer;
      outputBytes += data.length;
      if (outputBytes > options.maxBytes) {
        child.kill("SIGKILL");
        throw new ArchiveInspectionError("limit_exceeded", `Archive member exceeded ${options.maxBytes} bytes`);
      }
      await handle.write(data);
    }
    const code = await completion;
    if (timedOut) {
      throw new ArchiveInspectionError("limit_exceeded", `Archive command exceeded ${options.timeoutMs} ms`);
    }
    if (code !== 0) {
      const detail = Buffer.concat(errors).toString("utf8").trim();
      throw new ArchiveInspectionError("invalid_archive", `Archive command failed (${code})${detail ? `: ${detail}` : ""}`);
    }
    return outputBytes;
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
}

export class BsdtarArchiveTool implements ArchiveTool {
  readonly executable: string;

  constructor(executable = process.env.RETROROMS_ARCHIVE_TOOL || "bsdtar") {
    this.executable = executable;
  }

  async list(archivePath: string, limits: ScanLimits): Promise<string[]> {
    const output = await capture(this.executable, ["-tf", archivePath], {
      maxBytes: limits.maxArchiveListingBytes,
      timeoutMs: limits.archiveCommandTimeoutMs,
    });
    const members = output.toString("utf8").split("\n").filter(Boolean);
    if (members.length > limits.maxEntries) {
      throw new ArchiveInspectionError("limit_exceeded", `Archive contains more than ${limits.maxEntries} entries`);
    }
    for (const member of members) {
      if (member.includes("\r") || !isSafeMemberPath(member)) {
        throw new ArchiveInspectionError("unsafe_path", `Archive member has an unsafe path: ${member}`);
      }
    }
    return members.filter((member) => !member.endsWith("/"));
  }

  extractToFile(archivePath: string, member: string, destination: string, limits: ScanLimits): Promise<number> {
    if (!isSafeMemberPath(member)) {
      throw new ArchiveInspectionError("unsafe_path", `Archive member has an unsafe path: ${member}`);
    }
    return captureToFile(this.executable, ["-xOf", archivePath, "--", member], destination, {
      maxBytes: limits.maxEntryBytes,
      timeoutMs: limits.archiveCommandTimeoutMs,
    });
  }
}
