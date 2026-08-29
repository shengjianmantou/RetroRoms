import type { ContentHashes } from "./types.ts";
import { DatIndex, type DatMatch } from "./dat.ts";
import { choosePreferredEdition, parseReleaseFilename, type EditionCandidate, type ParsedReleaseMetadata, type ReleaseLanguage } from "./metadata.ts";

export interface CurationObservation {
  id: string;
  systemKey: string;
  filename: string;
  hashes: ContentHashes;
}

export interface CuratedCandidate {
  observationId: string;
  title: string;
  metadata: ParsedReleaseMetadata;
  verified: boolean;
  matchedBy?: DatMatch["matchedBy"];
  sourceDat?: string;
}

export interface CuratedGroup {
  key: string;
  systemKey: string;
  canonicalTitle: string;
  seriesKey: string;
  selectedObservationId: string;
  candidates: CuratedCandidate[];
}

function editionKey(title: string): string {
  return parseReleaseFilename(title)
    .title
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function seriesKey(title: string): string {
  return editionKey(title).replace(/\s+(?:i{1,3}|iv|v|vi{0,3}|ix|x|[0-9]{1,2})$/i, "");
}

function candidatesForObservation(observation: CurationObservation, datIndex: DatIndex): CuratedCandidate[] {
  const matches = datIndex.identify(observation.hashes);
  if (matches.length === 0) {
    const metadata = parseReleaseFilename(observation.filename);
    return [{ observationId: observation.id, title: metadata.title, metadata, verified: false }];
  }
  const unique = new Map<string, DatMatch>();
  for (const match of matches) unique.set(`${match.record.sourceDat}:${match.record.romName}`, match);
  return [...unique.values()].map((match) => ({
    observationId: observation.id,
    title: match.record.title,
    metadata: {
      ...parseReleaseFilename(match.record.title),
      languages: match.record.languages.length ? match.record.languages as ReleaseLanguage[] : parseReleaseFilename(match.record.title).languages,
      revision: match.record.revision ?? parseReleaseFilename(match.record.title).revision,
    },
    verified: true,
    matchedBy: match.matchedBy,
    sourceDat: match.record.sourceDat,
  }));
}

export function curateObservations(
  observations: CurationObservation[],
  datIndex = new DatIndex(),
  languagePreference: ReleaseLanguage[] = ["en", "zh", "ja"],
): CuratedGroup[] {
  const groups = new Map<string, EditionCandidate[]>();
  const details = new Map<string, CuratedCandidate>();
  const systems = new Map<string, string>();
  for (const observation of observations) {
    for (const candidate of candidatesForObservation(observation, datIndex)) {
      const key = `${observation.systemKey}:${editionKey(candidate.title)}`;
      const detailKey = `${observation.id}:${candidate.title}`;
      details.set(detailKey, candidate);
      systems.set(key, observation.systemKey);
      const values = groups.get(key) ?? [];
      values.push({ id: detailKey, metadata: candidate.metadata, verified: candidate.verified });
      groups.set(key, values);
    }
  }
  return [...groups.entries()].map(([key, values]) => {
    const preference = choosePreferredEdition(values, languagePreference)!;
    const candidates = values.map((value) => details.get(value.id)!);
    const selected = details.get(preference.selected.id)!;
    return {
      key,
      systemKey: systems.get(key)!,
      canonicalTitle: selected.title,
      seriesKey: seriesKey(selected.title),
      selectedObservationId: selected.observationId,
      candidates,
    };
  }).sort((left, right) => left.canonicalTitle.localeCompare(right.canonicalTitle));
}

