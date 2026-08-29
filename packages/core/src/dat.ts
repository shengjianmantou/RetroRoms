import { readFile } from "node:fs/promises";
import type { ContentHashes } from "./types.ts";

export interface DatRomRecord {
  title: string;
  systemKey: string;
  region?: string;
  languages: string[];
  revision?: string;
  romName: string;
  size?: number;
  hashes: Partial<ContentHashes>;
  sourceDat: string;
}

export interface DatMatch {
  record: DatRomRecord;
  matchedBy: "sha256" | "sha1" | "md5" | "crc32";
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1].toLowerCase()] = unescapeXml(match[2]);
  return result;
}

function inferSystem(xml: string, datName: string): string {
  const header = xml.match(/<(?:header|dat)[^>]*>([\s\S]*?)<\/(?:header|dat)>/i)?.[1] ?? "";
  const value = `${header} ${datName}`.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/super\s*nintendo|snes/, "snes"], [/game\s*boy\s*advance|gba/, "gba"], [/game\s*boy\s*color|gbc/, "gbc"],
    [/game\s*boy|\bgb\b/, "gb"], [/playstation|psx|ps1/, "psx"], [/nintendo\s*64|\bn64\b/, "n64"],
    [/genesis|megadrive|mega\s*drive/, "genesis"], [/arcade|mame|fbneo|fba/, "arcade"], [/nintendo\s*ds|\bnds\b/, "nds"],
  ];
  return mappings.find(([pattern]) => pattern.test(value))?.[1] ?? "unknown";
}

function parseLanguages(title: string): string[] {
  const languages: string[] = [];
  const normalized = title.toLowerCase();
  if (/\b(?:en|eng|english)\b|\(usa\)|\(europe\)/.test(normalized)) languages.push("en");
  if (/\b(?:zh|chn|chinese)\b|\bchina\b|\btaiwan\b/.test(normalized)) languages.push("zh");
  if (/\b(?:ja|jpn|japanese)\b|\bjapan\b/.test(normalized)) languages.push("ja");
  return languages;
}

export function parseDatXml(xml: string, datName = "imported.dat", systemKey = inferSystem(xml, datName)): DatRomRecord[] {
  const records: DatRomRecord[] = [];
  const blockPattern = /<(?:game|machine)\b([^>]*)>([\s\S]*?)<\/(?:game|machine)>/gi;
  for (const block of xml.matchAll(blockPattern)) {
    const gameAttributes = attributes(block[1]);
    const title = gameAttributes.description || gameAttributes.name || "Unknown title";
    const body = block[2];
    for (const rom of body.matchAll(/<rom\b([^>]*?)(?:\/?>)/gi)) {
      const values = attributes(rom[1]);
      const hashes: Partial<ContentHashes> = {};
      if (values.crc) hashes.crc32 = values.crc.toLowerCase().padStart(8, "0");
      if (values.sha1) hashes.sha1 = values.sha1.toLowerCase();
      const record: DatRomRecord = {
        title,
        systemKey,
        region: /\(([^)]+)\)/.exec(title)?.[1],
        languages: parseLanguages(title),
        revision: /\brev(?:ision)?\s*([\w.-]+)/i.exec(title)?.[1],
        romName: values.name || title,
        size: values.size ? Number(values.size) : undefined,
        hashes,
        sourceDat: datName,
      };
      if (values.md5) (record.hashes as Record<string, string>).md5 = values.md5.toLowerCase();
      records.push(record);
    }
  }
  return records;
}

export class DatIndex {
  private readonly byHash = new Map<string, DatRomRecord[]>();

  add(records: DatRomRecord[]): void {
    for (const record of records) {
      for (const [algorithm, value] of Object.entries(record.hashes)) {
        if (!value) continue;
        const key = `${algorithm}:${value.toLowerCase()}`;
        const values = this.byHash.get(key) ?? [];
        values.push(record);
        this.byHash.set(key, values);
      }
    }
  }

  async addXmlFile(path: string, systemKey?: string): Promise<number> {
    const xml = await readFile(path, "utf8");
    const records = parseDatXml(xml, path, systemKey);
    this.add(records);
    return records.length;
  }

  identify(hashes: ContentHashes): DatMatch[] {
    const matches: DatMatch[] = [];
    for (const algorithm of ["sha256", "sha1", "md5", "crc32"] as const) {
      const value = (hashes as unknown as Record<string, string>)[algorithm];
      if (!value) continue;
      for (const record of this.byHash.get(`${algorithm}:${value.toLowerCase()}`) ?? []) matches.push({ record, matchedBy: algorithm });
    }
    return matches;
  }
}
