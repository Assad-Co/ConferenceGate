// Puts people back where they belong.
//
// A published conference showed 88 "Sponsors & Exhibitors": `icon-feature-item-2.svg`, `Network`,
// `Honored`, `Simon-Rebora.jpg`, `Michelle Bridenbaker`. Those are a UI icon, two words of page
// furniture, and three speakers — read as sponsors because the extractor that wrote that row saw a
// photograph beside a name and concluded it was a logo beside a company.
//
// The discovery engine's own reader cannot make this mistake: `deepSections.ts` requires evidence
// that a sponsor is an organisation. But two extractors write to `extracted_conferences`, and the
// older one has no such rule. Its rows are what a reader is looking at.
//
// This repairs them in place, and only in the direction the evidence supports:
//
//   * a name ending in .jpg/.png/.svg is a file, and the filename is stripped before anything else
//     is decided — `Simon-Rebora.jpg` is a person once you take the extension off, not a company;
//   * an entry naming an organisation stays a sponsor, always;
//   * an entry shaped like a person moves to the speakers list, which is where the page had them;
//   * page furniture — a bare `Network`, an icon file with no human name in it — is dropped,
//     because it was never anybody.
//
// Nothing is invented and nothing is promoted: a person moved here arrives with no role, no
// affiliation and no title, because the sponsor entry never carried any.

const IMAGE_EXTENSION = /\.(?:jpe?g|png|svg|webp|gif|avif)$/i;

/** Words that make an entry an organisation rather than a person, however it is capitalised. */
const ORGANISATION_MARKER =
  /\b(?:inc|llc|ltd|plc|gmbh|s\.?a\.?|b\.?v\.?|ag|co|corp|corporation|company|group|holdings|partners|ventures|labs?|laboratories|technologies|technology|systems|solutions|services|pharma|pharmaceuticals?|biosciences?|sciences?|medical|health(?:care)?|university|universität|institute|institut|college|school|academy|society|association|federation|council|foundation|trust|centre|center|hospital|clinic|ministry|agency|authority|bank|media|press|publishing|publishers?|consulting|consultancy|industries|international|global|worldwide)\b/i;

/** Page furniture that is neither a person nor an organisation. */
const FURNITURE = /^(?:network|honored|honoured|featured|sponsors?|exhibitors?|partners?|supporters?|logo|icon|image|photo|banner|slider|item|feature|more|view all|read more|learn more)$/i;

/** An icon or layout asset rather than anybody's photograph. */
const ASSET_NAME = /^(?:icon|img|image|logo|banner|slider|feature|item|placeholder|default|bg|background)[-_ ]/i;

/** A filename is a file, not a name: `Simon-Rebora.jpg` is a person once the extension is gone. */
export function nameFromEntry(raw: string): string {
  const withoutExtension = String(raw || "").trim().replace(IMAGE_EXTENSION, "");
  return withoutExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function looksLikeOrganisation(name: string): boolean {
  const value = nameFromEntry(name);
  if (!value) return false;
  if (ORGANISATION_MARKER.test(value)) return true;
  // An acronym on its own — IEEE, NASA, CERN — is an organisation; nobody is named in capitals.
  return /^[A-Z0-9&.-]{2,10}$/.test(value.trim());
}

/**
 * A personal name, and only on evidence — never on shape alone.
 *
 * The first version of this asked whether a name looked like two capitalised words with no company
 * suffix. "Siemens Healthineers" is two capitalised words with no company suffix. So is "Blue
 * Ocean". Shape cannot separate a person from a company, and getting it wrong that way is the
 * worse error: leaving a person among the sponsors misfiles a fact, while moving a real sponsor
 * into the speakers list invents a speaker who never spoke.
 *
 * So the evidence has to come from outside the words. A headshot is stored under a filename that
 * separates the person's names — `Simon-Rebora.jpg`, `Keith-Berelowitz` — while a company's logo is
 * one token or says logo. That convention is the signal; a plain two-word entry with no such
 * evidence stays exactly where it is.
 */
export function looksLikePerson(name: string): boolean {
  const raw = String(name || "").trim();
  // The evidence: a filename that separates two or more name-shaped words.
  if (!/[-_]/.test(raw.replace(IMAGE_EXTENSION, ""))) return false;
  if (/\blogos?\b/i.test(raw)) return false;
  const value = nameFromEntry(raw);
  if (!value || looksLikeOrganisation(value)) return false;
  if (/\d/.test(value)) return false;
  const words = value.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^(?:[A-Z][a-zA-Z'’.]*|van|von|de|del|della|di|da|bin|bint|al|el|le|la)$/.test(word));
}

export function isFurniture(name: string): boolean {
  const raw = String(name || "").trim();
  if (ASSET_NAME.test(raw)) return true;
  const value = nameFromEntry(raw);
  return !value || FURNITURE.test(value);
}

export interface SponsorLike { name?: string | null; [key: string]: unknown }
export interface SpeakerLike { name: string; [key: string]: unknown }

export interface SponsorRepair {
  sponsors: SponsorLike[];
  speakers: SpeakerLike[];
  movedToSpeakers: number;
  droppedFurniture: number;
  changed: boolean;
}

/**
 * Splits a contaminated sponsor list into the sponsors that are organisations and the people who
 * were never sponsors, merging the latter into the speakers already stored.
 */
export function repairSponsorList(
  sponsors: unknown,
  speakers: unknown
): SponsorRepair {
  const sponsorList: SponsorLike[] = Array.isArray(sponsors) ? (sponsors as SponsorLike[]) : [];
  const speakerList: SpeakerLike[] = Array.isArray(speakers) ? (speakers as SpeakerLike[]) : [];
  const seenSpeakers = new Set(speakerList.map((s) => nameFromEntry(String(s?.name || "")).toLowerCase()));

  const keptSponsors: SponsorLike[] = [];
  const addedSpeakers: SpeakerLike[] = [];
  let droppedFurniture = 0;

  for (const entry of sponsorList) {
    const raw = String(entry?.name || "");
    if (isFurniture(raw)) { droppedFurniture += 1; continue; }
    if (looksLikeOrganisation(raw)) {
      // Renamed only when the stored name was actually a filename; otherwise left byte for byte,
      // so a clean list comes back unchanged and is never rewritten for no reason.
      keptSponsors.push(IMAGE_EXTENSION.test(raw) ? { ...entry, name: nameFromEntry(raw) } : entry);
      continue;
    }
    if (looksLikePerson(raw)) {
      const name = nameFromEntry(raw);
      const key = name.toLowerCase();
      if (!seenSpeakers.has(key)) {
        seenSpeakers.add(key);
        // No role, title or affiliation: the sponsor entry never stated any, and this must not
        // invent what the page did not say. The photograph, which the page did state, is kept.
        addedSpeakers.push({
          name,
          title: null,
          org: null,
          role: null,
          imageUrl: (entry as any)?.logoUrl ?? (entry as any)?.imageUrl ?? null,
          source_url: (entry as any)?.source_url ?? null,
        });
      }
      continue;
    }
    // Anything unrecognised stays exactly where it was.
    keptSponsors.push(entry);
  }

  const changed =
    droppedFurniture > 0 ||
    addedSpeakers.length > 0 ||
    keptSponsors.length !== sponsorList.length ||
    keptSponsors.some((kept, index) => kept.name !== sponsorList[index]?.name);

  return {
    sponsors: keptSponsors,
    speakers: [...speakerList, ...addedSpeakers],
    movedToSpeakers: addedSpeakers.length,
    droppedFurniture,
    changed,
  };
}

export interface SponsorRepairResult {
  examined: number;
  repaired: number;
  movedToSpeakers: number;
  droppedFurniture: number;
  dryRun: boolean;
}

/** Applies the repair to every stored conference whose sponsor list holds people or furniture. */
export async function repairPublishedSponsors(
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<SponsorRepairResult> {
  const { dbAll, dbRun } = await import("../db");
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
  const result: SponsorRepairResult = {
    examined: 0, repaired: 0, movedToSpeakers: 0, droppedFurniture: 0, dryRun: !!options.dryRun,
  };

  const rows = await dbAll<Record<string, any>>(
    `SELECT source_url, sponsors_exhibitors, keynote_speakers FROM extracted_conferences
      WHERE sponsors_exhibitors IS NOT NULL AND sponsors_exhibitors NOT IN ('','[]','{}')
      LIMIT ?`,
    [limit]
  );

  for (const row of rows) {
    result.examined += 1;
    let sponsors: unknown;
    let speakers: unknown;
    try {
      sponsors = JSON.parse(String(row.sponsors_exhibitors || "[]"));
      speakers = JSON.parse(String(row.keynote_speakers || "[]"));
    } catch {
      // Unparseable stored JSON is left exactly as it is rather than replaced with a guess.
      continue;
    }
    const repair = repairSponsorList(sponsors, speakers);
    if (!repair.changed) continue;

    result.repaired += 1;
    result.movedToSpeakers += repair.movedToSpeakers;
    result.droppedFurniture += repair.droppedFurniture;
    if (options.dryRun) continue;
    await dbRun(
      `UPDATE extracted_conferences SET sponsors_exhibitors=?, keynote_speakers=?, updated_at=datetime('now')
        WHERE source_url=?`,
      [JSON.stringify(repair.sponsors), JSON.stringify(repair.speakers), row.source_url]
    );
  }
  return result;
}
