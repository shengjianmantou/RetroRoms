export type ReleaseLanguage = "en" | "zh" | "ja" | "ko" | "fr" | "de" | "es" | "it" | "other";

export interface ParsedReleaseMetadata {
  originalName: string;
  title: string;
  languages: ReleaseLanguage[];
  regions: string[];
  revision?: string;
  disc?: number;
  tags: string[];
}

const LANGUAGE_ALIASES: Record<string, ReleaseLanguage> = {
  en: "en", eng: "en", english: "en", usa: "en", eur: "en", world: "en",
  zh: "zh", chn: "zh", chinese: "zh", china: "zh", hongkong: "zh", taiwan: "zh",
  ja: "ja", jpn: "ja", japanese: "ja", japan: "ja",
  ko: "ko", kor: "ko", korean: "ko", korea: "ko",
  fr: "fr", fra: "fr", french: "fr", france: "fr",
  de: "de", ger: "de", deu: "de", german: "de", germany: "de",
  es: "es", spa: "es", spanish: "es", spain: "es",
  it: "it", ita: "it", italian: "it", italy: "it",
};

const REGION_ALIASES: Record<string, string> = {
  usa: "USA", us: "USA", eur: "Europe", europe: "Europe", pal: "Europe",
  jpn: "Japan", japan: "Japan", jp: "Japan", chn: "China", china: "China",
  tw: "Taiwan", taiwan: "Taiwan", kor: "Korea", korea: "Korea",
  world: "World", aus: "Australia", australia: "Australia",
};

function cleanToken(token: string): string {
  return token.toLowerCase().replaceAll(" ", "").replaceAll("-", "").replaceAll("_", "");
}

function stripExtension(name: string): string {
  return name.replace(/\.(?:zip|7z|rar|tar|tgz|gz|nes|sfc|smc|gb|gbc|gba|nds|3ds|n64|z64|v64|iso|bin|cue|chd|rvz|cso|pbp)$/i, "");
}

export function parseReleaseFilename(name: string): ParsedReleaseMetadata {
  const originalName = name;
  let value = stripExtension(name.split("::").at(-1) ?? name).replaceAll("_", " ").trim();
  const tags: string[] = [];
  const languages: ReleaseLanguage[] = [];
  const regions: string[] = [];
  let revision: string | undefined;
  let disc: number | undefined;

  value = value.replace(/[\[\](){}]/g, (character) => character === "[" || character === "(" || character === "{" ? "\u0000" : "\u0001");
  const tokens = [...value.matchAll(/\u0000([^\u0000\u0001]+)\u0001/g)].map((match) => match[1].trim());
  for (const token of tokens) {
    const normalized = cleanToken(token);
    const language = LANGUAGE_ALIASES[normalized];
    if (language && !languages.includes(language)) languages.push(language);
    const region = REGION_ALIASES[normalized];
    if (region && !regions.includes(region)) regions.push(region);
    const revisionMatch = token.match(/rev(?:ision)?\s*([0-9a-z.-]+)/i);
    if (revisionMatch) revision = revisionMatch[1];
    const discMatch = token.match(/(?:disc|disk|cd)\s*([0-9]+)/i);
    if (discMatch) disc = Number(discMatch[1]);
    if (!language && !region && !revisionMatch && !discMatch) tags.push(token);
  }
  value = value
    .replace(/\u0000[^\u0000\u0001]+\u0001/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s*$/, "")
    .trim();
  return { originalName, title: value, languages, regions, revision, disc, tags };
}

export interface EditionCandidate {
  id: string;
  metadata: ParsedReleaseMetadata;
  verified: boolean;
}

export interface PreferenceResult {
  selected: EditionCandidate;
  rejected: EditionCandidate[];
}

export function choosePreferredEdition(
  candidates: EditionCandidate[],
  languagePreference: ReleaseLanguage[] = ["en", "zh", "ja"],
): PreferenceResult | undefined {
  if (candidates.length === 0) return undefined;
  const rank = (candidate: EditionCandidate): number => {
    const languageRank = candidate.metadata.languages.reduce((best, language) => {
      const index = languagePreference.indexOf(language);
      return index >= 0 ? Math.min(best, index) : best;
    }, languagePreference.length + 1);
    return (candidate.verified ? 0 : 100_000) + languageRank * 10 + (candidate.metadata.regions.includes("USA") ? 0 : 1);
  };
  const sorted = [...candidates].sort((left, right) => rank(left) - rank(right) || left.metadata.title.localeCompare(right.metadata.title));
  return { selected: sorted[0], rejected: sorted.slice(1) };
}
