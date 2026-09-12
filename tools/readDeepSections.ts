#!/usr/bin/env npx tsx
/**
 * Read the deep sections the catalogue is still missing, off each conference's own site.
 *
 * 139 of the 265 published records carry at least one section marked `unread` — nobody has ever
 * fetched the page that would answer it — and their tabs say so: "A committee could not be
 * retrieved; this does not mean the conference has none." That sentence is honest, and it is also
 * a gap that can be closed, because 136 of those records name an official site to read.
 *
 *   npx tsx tools/readDeepSections.ts [dataset.json] [out.csv] [--concurrency=4] [--limit=N] [--emit]
 *
 * The reading is not reimplemented. `findSectionPages` and `extractDeepSections` are the discovery
 * engine's own, imported directly — they are pure modules, so importing runs nothing — which means
 * a speaker admitted here had to clear the same vocabulary filters, the same page-furniture rules
 * and the same "a sponsor needs evidence it is an organisation" test that every other speaker in
 * the catalogue cleared. Same domain only, and no model, ever.
 *
 * Output is the shape `data/sources/details/*.csv` already takes, so the builder attaches it with
 * the machinery that is already there. Fees are not read: `DEEP_SECTIONS` has no fees page, and
 * inventing one here would be a second answer to a question this codebase answers elsewhere.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDeepSections, findSectionPages, type DeepSectionExtraction } from "../server/discovery/deepSections";

const ARGS = process.argv.slice(2);
const FLAGS = ARGS.filter((a) => a.startsWith("--"));
const positional = ARGS.filter((a) => !a.startsWith("--"));
const DATASET = positional[0] ?? "data/conferencegate-worldwide-2026-2028.json";
const OUTPUT = positional[1] ?? "deep-sections.csv";
const CONCURRENCY = Number(FLAGS.find((f) => f.startsWith("--concurrency="))?.split("=")[1] ?? 4);
const LIMIT = Number(FLAGS.find((f) => f.startsWith("--limit="))?.split("=")[1] ?? 0);
const EMIT = FLAGS.includes("--emit");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function getHtml(url: string, ms = 20000): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(ms),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(String(res.status));
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not html: ${type}`);
  return { html: await res.text(), finalUrl: res.url };
}

/** People as the detail reader writes them: a role introduces everyone until the full stop. */
function peopleCell(people: Array<{ name: string; org: string | null; role: string | null }>): string {
  if (!people.length) return "";
  const byRole = new Map<string, string[]>();
  for (const person of people) {
    const role = (person.role || "").trim() || "—";
    const named = person.org ? `${person.name} (${person.org})` : person.name;
    if (!byRole.has(role)) byRole.set(role, []);
    if (!byRole.get(role)!.includes(named)) byRole.get(role)!.push(named);
  }
  return [...byRole.entries()]
    .map(([role, names]) => (role === "—" ? names.join("; ") : `${role}: ${names.join("; ")}`))
    .join(". ");
}

function sponsorsCell(sponsors: Array<{ name: string; tier: string | null }>): string {
  if (!sponsors.length) return "";
  const byTier = new Map<string, string[]>();
  for (const sponsor of sponsors) {
    const tier = (sponsor.tier || "").trim() || "—";
    if (!byTier.has(tier)) byTier.set(tier, []);
    if (!byTier.get(tier)!.includes(sponsor.name)) byTier.get(tier)!.push(sponsor.name);
  }
  return [...byTier.entries()]
    .map(([tier, names]) => (tier === "—" ? names.join("; ") : `${tier}: ${names.join("; ")}`))
    .join(". ");
}

function programCell(program: DeepSectionExtraction["program"]): string {
  if (!program) return "";
  const sessions = program.sessions.slice(0, 40).map((session) => {
    const when = [session.date, session.time].filter(Boolean).join(" ");
    const who = session.speakerName ? ` — ${session.speakerName}` : "";
    return `${when ? `${when}: ` : ""}${session.title}${who}`;
  });
  const tracks = program.tracks.length ? `Tracks: ${program.tracks.slice(0, 15).join("; ")}.` : "";
  return [tracks, sessions.join(". ")].filter(Boolean).join(" ").trim();
}

const q = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ").trim()}"`;

interface Record_ {
  title: string; officialUrl: string | null; details: any;
}

const dataset = JSON.parse(await readFile(path.resolve(DATASET), "utf8"));
const all: Record_[] = Array.isArray(dataset.records) ? dataset.records : Object.values(dataset.records ?? dataset);
const unread = (record: Record_, key: string) => record.details?.[key]?.availability === "unread";
const needing = all.filter((record) =>
  record.officialUrl && /^https?:\/\//i.test(record.officialUrl)
  && ["program", "keynotes", "committee", "sponsors"].some((key) => unread(record, key)));
const queue = LIMIT > 0 ? needing.slice(0, LIMIT) : needing;

const rows: string[] = [];
const stats = { considered: queue.length, unreachable: 0, nothing: 0, speakers: 0, committee: 0, sponsors: 0, program: 0 };

async function handle(record: Record_, index: number) {
  const site = record.officialUrl!;
  try {
    const home = await getHtml(site);
    const found: DeepSectionExtraction = { program: null, speakers: [], committee: [], sponsors: [], community: null };
    const pages = findSectionPages(home.html, home.finalUrl, {
      perSection: 1,
      sections: ["program", "speakers", "committee", "sponsors"],
    });
    // The conference's own landing page often carries a section outright, so it is read too.
    for (const { html, url } of [{ html: home.html, url: home.finalUrl }]) {
      const here = extractDeepSections(html, url);
      found.speakers.push(...here.speakers);
      found.committee.push(...here.committee);
      found.sponsors.push(...here.sponsors);
      found.program ??= here.program;
    }
    for (const candidate of pages.slice(0, 5)) {
      try {
        const page = await getHtml(candidate.url);
        const here = extractDeepSections(page.html, page.finalUrl);
        found.speakers.push(...here.speakers);
        found.committee.push(...here.committee);
        found.sponsors.push(...here.sponsors);
        if (here.program && (here.program.sessions.length || here.program.tracks.length)) found.program = here.program;
      } catch { /* a section page that will not load is a missing section, not a failed record */ }
    }

    const speakers = unread(record, "keynotes") ? peopleCell(found.speakers) : "";
    const committee = unread(record, "committee") ? peopleCell(found.committee) : "";
    const sponsors = unread(record, "sponsors") ? sponsorsCell(found.sponsors) : "";
    const program = unread(record, "program") ? programCell(found.program) : "";
    if (!speakers && !committee && !sponsors && !program) {
      stats.nothing += 1;
      console.log(`[${index}] NOTHING  ${record.title.slice(0, 58)}  (${pages.length} section pages)`);
      return;
    }
    if (speakers) stats.speakers += 1;
    if (committee) stats.committee += 1;
    if (sponsors) stats.sponsors += 1;
    if (program) stats.program += 1;
    // name, dates, venue, program, keynoteSpeakers, committee, pricing, sponsors, website, safetyNote
    rows.push([record.title, "", "", program, speakers, committee, "", sponsors, site, ""].map(q).join(","));
    console.log(`[${index}] FOUND    ${record.title.slice(0, 46)}  speakers=${found.speakers.length} committee=${found.committee.length} sponsors=${found.sponsors.length}`);
  } catch (error) {
    stats.unreachable += 1;
    console.log(`[${index}] UNREACHABLE ${site} — ${(error as Error).message}`);
  }
}

let cursor = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (cursor < queue.length) {
    const index = cursor;
    cursor += 1;
    try { await handle(queue[index], index + 1); }
    catch (error) { console.log(`[${index + 1}] ERROR ${queue[index].title} — ${(error as Error).message}`); }
  }
}));

const header = "conference_name,dates,venue,program,keynote_speakers,committee,pricing,sponsors,website,safety_note";
const csv = [header, ...rows].join("\n") + "\n";
await writeFile(OUTPUT, csv);

console.log(`\n================ REPORT ================`);
console.log(`records in dataset          ${all.length}`);
console.log(`with an unread section+site ${stats.considered}`);
console.log(`sites unreachable           ${stats.unreachable}`);
console.log(`read but nothing usable     ${stats.nothing}`);
console.log(`rows written                ${rows.length}`);
console.log(`  gained speakers           ${stats.speakers}`);
console.log(`  gained a committee        ${stats.committee}`);
console.log(`  gained sponsors           ${stats.sponsors}`);
console.log(`  gained a programme        ${stats.program}`);
console.log(`written -> ${OUTPUT}`);

if (EMIT) {
  const payload = Buffer.from(csv, "utf8").toString("base64");
  const size = 1200;
  const total = Math.ceil(payload.length / size);
  console.log(`CSVBEGIN total=${total} chars=${csv.length}`);
  for (let part = 0; part < total; part += 1) {
    console.log(`CSVPART ${String(part + 1).padStart(4, "0")}/${total} ${payload.slice(part * size, (part + 1) * size)}`);
  }
  console.log(`CSVEND total=${total}`);
}
