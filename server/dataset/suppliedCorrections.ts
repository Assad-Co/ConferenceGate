import { parseCsv } from "./sources/curated";
import { mapIndexRow, rowsFromIndexCsv } from "./sources/conferenceIndex";
import type { LaunchConferenceRecord } from "./types";
import type { ParseOptions } from "./parseEvidence";

/** Explicit replacement supply: match existing editions, preserve IDs, never create duplicates. */
export function applySuppliedCorrections(records: LaunchConferenceRecord[], csv: string, options: ParseOptions): number {
  const replacements = rowsFromIndexCsv(parseCsv(csv)).map(row => {
    const sources = row.sourceUrl.split("|").map(url => url.trim()).filter(Boolean);
    const mapped = mapIndexRow({ ...row, sourceUrl: sources[0] || row.officialUrl }, { ...options, sourceName: "verified-2026-09-13" });
    if (!mapped.ok) throw new Error(`Correction refused: ${row.name}`);
    // This supply uses Name — affiliation/role, unlike older Role: Name (Org) lists.
    // Keep narrative committees as supplied prose instead of misclassifying affiliations.
    if (mapped.record.details) {
      mapped.record.details.keynotes.items = row.keynoteSpeakers.split(";").map(value => value.trim()).filter(Boolean).map(value => {
        const [name, ...description] = value.split(/\s+—\s+/);
        return { name: name.trim(), role: description.join(" — ").trim() || null, org: null, title: null, topic: null };
      });
      mapped.record.details.committee.items = [];
      mapped.record.details.sponsors.items = [];
    }
    const matches = records.map((record, index) => ({ record, index })).filter(({ record }) => record.title === row.name && record.year === mapped.record.year);
    if (matches.length !== 1) throw new Error(`Correction must match one existing edition: ${row.name} (${matches.length})`);
    const { record: previous, index } = matches[0];
    return { index, record: { ...previous, ...mapped.record, id: previous.id,
      acronym: previous.acronym, series: previous.series, edition: previous.edition,
      categories: previous.categories, category: previous.category, topics: previous.topics,
      keywords: previous.keywords, format: mapped.record.format ?? previous.format,
      corroboratingSourceUrls: [...new Set(sources.filter(url => url !== mapped.record.sourceUrl))],
    } };
  });
  if (new Set(replacements.map(item => item.index)).size !== replacements.length) throw new Error("Duplicate correction rows");
  for (const item of replacements) records[item.index] = item.record;
  return replacements.length;
}
