export interface SeriesMember {
  id: string;
  title: string;
  systemKey: string;
}

export interface SeriesGroup {
  key: string;
  label: string;
  members: SeriesMember[];
}

const ROMAN_NUMERAL = /^(.*?)[ .:-]+(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
const ARABIC_NUMBER = /^(.*?)[ .:-]+(?:[0-9]{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)$/i;

export function normalizeSeriesKey(title: string): string {
  const cleaned = title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  const match = cleaned.match(ROMAN_NUMERAL) ?? cleaned.match(ARABIC_NUMBER);
  const base = match?.[1]?.trim() || cleaned;
  return base || "unknown";
}

export function groupBySeries(members: SeriesMember[]): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>();
  for (const member of members) {
    const key = normalizeSeriesKey(member.title);
    const group = groups.get(key) ?? { key, label: member.title, members: [] };
    group.members.push(member);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, members: [...group.members].sort((a, b) => a.title.localeCompare(b.title) || a.systemKey.localeCompare(b.systemKey)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

