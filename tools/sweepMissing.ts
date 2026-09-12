#!/usr/bin/env npx tsx
/**
 * One pass over everything the catalogue still cannot say for itself, so the sites are asked again.
 *
 * The first sweep asked only for sections nobody had ever read. That left two other shapes on
 * screen, and a reader cannot tell them apart from a gap:
 *
 *   - "Speakers could not be retrieved" — the tab admitting nothing was read;
 *   - "individual 2026 speaker names are published through the official conference programme" —
 *     a sentence the site really did write, stored in place of the names, which sends the reader
 *     off to go and look it up themselves. That is the site's answer, not this catalogue's, and
 *     the programme it points at is a page that can be read.
 *
 * So a section is asked again when it was never read, when the organiser had not announced it
 * last time, and when what is stored is prose with no names in it. Prose is kept if the second
 * ask finds nothing better — it is still what the page said — and replaced the moment real
 * entries come back.
 *
 * The programme is mined for speakers, because that is where the sites that "publish names
 * through the programme" publish them: a session billed to a named person names a speaker.
 *
 *   npx tsx tools/sweepMissing.ts [dataset.json] [--concurrency=5] [--limit=N]
 *                                 [--max-firecrawl=400] [--emit]
 *
 * Nothing here decides what a fact is. Sections come through the discovery engine's own
 * `extractDeepSections`, fees through `feePages`, and the logo through the picker lifted verbatim
 * out of `enrich-conference-images.mjs` — the same rules, asked again, of pages that had not
 * answered yet.
 *
 * Reading order is the one the rest of the app uses and for the same reason: the direct fetch is
 * free and answers most sites, and Firecrawl bills per page, so it is reached only for a URL the
 * direct fetch could not read. It is never asked first and never asked twice for the same page.
 *
 * Two files come back, because they land in two places the builder already reads: the details CSV
 * that `data/sources/details/` takes, and the corrections CSV that `resolved-official-urls.csv` is.
 * They are emitted under separate markers so one log can carry both.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDeepSections, findSectionPages, type DeepSectionExtraction } from "../server/discovery/deepSections";
import { feesCell, feesFromPage, findFeePages, type FeeLine } from "../server/discovery/feePages";
import { firecrawlScrape, isFirecrawlConfigured } from "../server/firecrawl";
import { candidateUrlBelongsToEvent, eventIdentityFrom, pageBelongsToEvent,
  type EventIdentity } from "../server/discovery/eventIdentity";
import { isCredibleAffiliation, isCredibleName } from "../server/discovery/entryQuality";

const ARGS = process.argv.slice(2);
const FLAGS = ARGS.filter((a) => a.startsWith("--"));
const DATASET = ARGS.filter((a) => !a.startsWith("--"))[0] ?? "data/conferencegate-worldwide-2026-2028.json";
const CONCURRENCY = Number(FLAGS.find((f) => f.startsWith("--concurrency="))?.split("=")[1] ?? 5);
const LIMIT = Number(FLAGS.find((f) => f.startsWith("--limit="))?.split("=")[1] ?? 0);
const EMIT = FLAGS.includes("--emit");
// Firecrawl bills per page, so a run says up front how much of it it may spend. Nothing here
// raises the cap on its own; a run that hits it says so in the report rather than carrying on.
const MAX_FIRECRAWL = Number(FLAGS.find((f) => f.startsWith("--max-firecrawl="))?.split("=")[1] ?? 400);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// ---- the shipped image picker, verbatim (see enrich-catalogue-logos.mjs for why it is sliced) ----
const source = await readFile(new URL("./enrich-conference-images.mjs", import.meta.url), "utf8");
const from = source.indexOf("const ICON_SERVICE");
const to = source.indexOf("// ---------- run ----------");
if (from < 0 || to < 0) { console.error("could not slice the image picker"); process.exit(1); }
const picker: any = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${source.slice(from, to)}\nexport { isRealImage, getText, kitLinks, pickImages };\n`, "utf8").toString("base64")}`
);

const FIRECRAWL = isFirecrawlConfigured();
const rendered = new Set<string>();
const readStats = { direct: 0, firecrawl: 0, refused: 0, overCap: 0 };

/** The free route. Most conference sites answer it. */
async function directHtml(url: string, ms = 20000): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(String(res.status));
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not html: ${type}`);
  return { html: await res.text(), finalUrl: res.url };
}

/**
 * A page, by whichever route can read it.
 *
 * Firecrawl is reached only once the free fetch has failed on this exact URL, which is the cost
 * decision the app already made and not one to relitigate per tool. A page it has already rendered
 * is not rendered twice, because the second ask bills the same as the first.
 */
async function getHtml(url: string, ms = 20000): Promise<{ html: string; finalUrl: string }> {
  try {
    const direct = await directHtml(url, ms);
    readStats.direct += 1;
    return direct;
  } catch (error) {
    if (!FIRECRAWL || rendered.has(url)) { readStats.refused += 1; throw error; }
    if (readStats.firecrawl >= MAX_FIRECRAWL) { readStats.overCap += 1; throw error; }
    rendered.add(url);
    const scraped = await firecrawlScrape(url);
    if (!scraped?.html) { readStats.refused += 1; throw new Error(`unread after firecrawl: ${(error as Error).message}`); }
    readStats.firecrawl += 1;
    return { html: scraped.html, finalUrl: url };
  }
}

/**
 * A roster, with everything that is not a person taken out of it.
 *
 * The extractors decide where on a page a roster sits; this decides whether what they found is a
 * person. Both are needed — a committee page's list markup is perfect and one of its entries was
 * "Mozilla Firefox" — and a section whose entries all fail is left empty rather than part-filled,
 * because half a roster read as a whole one is the wrong answer stated confidently.
 */
function peopleCell(people: Array<{ name: string; org: string | null; role: string | null }>): string {
  if (!people.length) return "";
  const byRole = new Map<string, string[]>();
  for (const person of people) {
    if (!isCredibleName(person.name)) { stats.junked += 1; continue; }
    const role = (person.role || "").trim() || "—";
    const org = person.org && isCredibleAffiliation(person.org) ? person.org : null;
    const named = org ? `${person.name} (${org})` : person.name;
    if (!byRole.has(role)) byRole.set(role, []);
    if (!byRole.get(role)!.includes(named)) byRole.get(role)!.push(named);
  }
  if (!byRole.size) return "";
  return [...byRole.entries()].map(([role, names]) => (role === "—" ? names.join("; ") : `${role}: ${names.join("; ")}`)).join(". ");
}
/**
 * A sponsor list, which is the one this sweep does not ship.
 *
 * 118 sponsor cells came back from the first run and most of them were the page rather than its
 * sponsors: image filenames off Gastech, a stylesheet sprite off Entrepreneur, "opens in new
 * tab/window" off the Vaccine Congress, and the sponsor pack's own benefits off URTeC. A sponsor
 * is an organisation, which is exactly the shape every one of those strings also has, so the
 * people test cannot sort them and no test here has earned the right to.
 *
 * What a real sponsor needs is evidence it is an organisation — a logo, a link to its own site, an
 * organisation marker — which `deepSections` weighs from the markup around it and this tool cannot
 * see by the time it holds a list of names. So the column is left empty and the sentence a site
 * already wrote about its sponsors is kept, being at least something the site said.
 */
function sponsorsCell(_sponsors: Array<{ name: string; tier: string | null }>): string {
  return "";
}

function programCell(program: DeepSectionExtraction["program"]): string {
  if (!program) return "";
  const sessions = program.sessions.slice(0, 40).map((s) => {
    const when = [s.date, s.time].filter(Boolean).join(" ");
    return `${when ? `${when}: ` : ""}${s.title}${s.speakerName ? ` — ${s.speakerName}` : ""}`;
  });
  const tracks = program.tracks.length ? `Tracks: ${program.tracks.slice(0, 15).join("; ")}.` : "";
  return [tracks, sessions.join(". ")].filter(Boolean).join(" ").trim();
}
const q = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ").trim()}"`;

interface Rec { title: string; officialUrl: string | null; logoUrl: string | null; imageUrl: string | null; details: any; }

const dataset = JSON.parse(await readFile(path.resolve(DATASET), "utf8"));
const all: Rec[] = Array.isArray(dataset.records) ? dataset.records : Object.values(dataset.records ?? dataset);
const SECTIONS = ["program", "keynotes", "committee", "sponsors", "fees"] as const;

/**
 * Why a section is worth asking the site about again.
 *
 * "unread" is the obvious one. "not_announced" is worth a second ask because it was true when it
 * was recorded and a programme published since then is exactly what a reader wants. And "stated"
 * with nothing in its list is the Gastech shape: a sentence about the speakers standing where the
 * speakers should be. All three get the same treatment — ask, and keep whatever is better.
 */
function wantsSection(r: Rec, key: string): boolean {
  const section = r.details?.[key];
  if (!section) return true;
  if (section.availability !== "stated") return true;
  // The programme is a text section; it has said enough once it says anything.
  if (key === "program") return !String(section.text ?? "").trim();
  return !(section.items?.length > 0);
}
const unread = (r: Rec, key: string) => wantsSection(r, key);
const wants = (r: Rec) => SECTIONS.some((k) => wantsSection(r, k)) || !r.logoUrl || !r.imageUrl;
const needing = all.filter((r) => r.officialUrl && /^https?:\/\//i.test(r.officialUrl) && wants(r));
const queue = LIMIT > 0 ? needing.slice(0, LIMIT) : needing;

const detailRows: string[] = [];
const urlRows: string[] = [];
const today = new Date().toISOString().slice(0, 10);
const stats = { considered: queue.length, unreachable: 0, fees: 0, speakers: 0, committee: 0,
  sponsors: 0, program: 0, logo: 0, banner: 0, fromProgramme: 0, notThisEvent: 0, junked: 0 };

async function handle(record: Rec, index: number) {
  const site = record.officialUrl!;
  const identity: EventIdentity | null = eventIdentityFrom({
    title: record.title, acronym: (record as any).acronym ?? null,
    start_year: (record as any).year ?? null, official_url: site,
  });
  try {
    const home = await getHtml(site);
    const found: DeepSectionExtraction = { program: null, speakers: [], committee: [], sponsors: [], community: null };
    const here = extractDeepSections(home.html, home.finalUrl);
    found.speakers.push(...here.speakers); found.committee.push(...here.committee);
    found.sponsors.push(...here.sponsors); found.program = here.program;

    const wantSections = ["program", "keynotes", "committee", "sponsors"].some((k) => unread(record, k));
    if (wantSections) {
      // Two candidates a section rather than one. A site that keeps its speakers at both /speakers
      // and /programme/speakers was previously asked for whichever it linked first, and the names
      // are as often on the second.
      const candidates = findSectionPages(home.html, home.finalUrl,
        { perSection: 2, sections: ["program", "speakers", "committee", "sponsors"] }).slice(0, 8);
      for (const candidate of candidates) {
        // A deep page has to belong to *this* event. Skipping this is what let one neurips.cc
        // roster be filed under eight different NeurIPS workshops: the links are all on the same
        // host, so without the identity test every workshop inherits every other workshop's page.
        if (identity && !candidateUrlBelongsToEvent(identity, candidate.url).ok) { stats.notThisEvent += 1; continue; }
        try {
          const page = await getHtml(candidate.url);
          if (identity && !pageBelongsToEvent(identity, page.finalUrl, page.html).ok) { stats.notThisEvent += 1; continue; }
          const more = extractDeepSections(page.html, page.finalUrl);
          found.speakers.push(...more.speakers); found.committee.push(...more.committee);
          found.sponsors.push(...more.sponsors);
          if (more.program && (more.program.sessions.length || more.program.tracks.length)) found.program = more.program;
        } catch { /* a section page that will not load is a missing section */ }
      }
    }

    // A programme that bills a session to a named person has named a speaker, and that is where
    // the sites which "publish names through the official programme" publish them. The role comes
    // from the session, not invented: this is the programme saying who is speaking in it.
    if (!found.speakers.length && found.program?.sessions.length) {
      const seenName = new Set<string>();
      for (const session of found.program.sessions) {
        const name = (session.speakerName || "").trim();
        if (!name || seenName.has(name.toLowerCase())) continue;
        seenName.add(name.toLowerCase());
        found.speakers.push({ name, org: null, role: null, imageUrl: null, sourceUrl: found.program.source_url } as any);
      }
      if (seenName.size) stats.fromProgramme += 1;
    }

    let fees: FeeLine[] = [];
    if (unread(record, "fees")) {
      fees = feesFromPage(home.html, home.finalUrl);
      for (const feeUrl of findFeePages(home.html, home.finalUrl, 3)) {
        if (fees.length >= 6) break;
        try { const page = await getHtml(feeUrl); fees.push(...feesFromPage(page.html, page.finalUrl)); }
        catch { /* a prices page that will not load is a missing price list */ }
      }
    }

    const speakers = unread(record, "keynotes") ? peopleCell(found.speakers) : "";
    const committee = unread(record, "committee") ? peopleCell(found.committee) : "";
    const sponsors = unread(record, "sponsors") ? sponsorsCell(found.sponsors) : "";
    const program = unread(record, "program") ? programCell(found.program) : "";
    const pricing = feesCell(fees);
    if (speakers || committee || sponsors || program || pricing) {
      if (speakers) stats.speakers += 1;
      if (committee) stats.committee += 1;
      if (sponsors) stats.sponsors += 1;
      if (program) stats.program += 1;
      if (pricing) stats.fees += 1;
      detailRows.push([record.title, "", "", program, speakers, committee, pricing, sponsors, site, ""].map(q).join(","));
    }

    if (!record.logoUrl || !record.imageUrl) {
      const pages = [{ html: home.html, url: home.finalUrl }];
      for (const link of picker.kitLinks(home.html, home.finalUrl)) {
        try { const kit = await picker.getText(link); pages.push({ html: kit.html, url: kit.finalUrl }); } catch { /* kit page optional */ }
      }
      const images = await picker.pickImages(pages);
      const logo = record.logoUrl ? "" : images.logo;
      const banner = record.imageUrl ? "" : images.banner;
      if (logo || banner) {
        if (logo) stats.logo += 1;
        if (banner) stats.banner += 1;
        urlRows.push([record.title, site, today, "page_read", logo, banner].map(q).join(","));
      }
    }
    console.log(`[${index}] ${record.title.slice(0, 44)} fees=${fees.length} spk=${found.speakers.length} cmte=${found.committee.length} spon=${found.sponsors.length}`);
  } catch (error) {
    stats.unreachable += 1;
    console.log(`[${index}] UNREACHABLE ${site} — ${(error as Error).message}`);
  }
}

let cursor = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (cursor < queue.length) {
    const index = cursor; cursor += 1;
    try { await handle(queue[index], index + 1); }
    catch (error) { console.log(`[${index + 1}] ERROR ${queue[index].title} — ${(error as Error).message}`); }
  }
}));

const detailCsv = ['"Conference Name","Dates","Venue","Program/Agenda","Keynote Speakers","Technical/Program Committee","Pricing/Registration","Sponsors/Exhibitors","Website","Regional Safety Note"', ...detailRows].join("\n") + "\n";
const urlCsv = ["conference_name,official_url,resolved_on,method,logo_url,banner_url", ...urlRows].join("\n") + "\n";
await writeFile("/tmp/sweep-details.csv", detailCsv);
await writeFile("/tmp/sweep-urls.csv", urlCsv);

console.log(`\n================ REPORT ================`);
console.log(`records asked            ${stats.considered}`);
console.log(`pages read direct        ${readStats.direct}`);
console.log(`pages read via firecrawl ${readStats.firecrawl}${FIRECRAWL ? "" : "  (no key: route disabled)"}`);
console.log(`pages nothing could read ${readStats.refused}`);
console.log(`pages left at the cap     ${readStats.overCap}${readStats.overCap ? `  (raise --max-firecrawl above ${MAX_FIRECRAWL} to read them)` : ""}`);
console.log(`sites unreachable        ${stats.unreachable}`);
console.log(`pages not this event     ${stats.notThisEvent}`);
console.log(`entries refused as junk  ${stats.junked}`);
console.log(`detail rows written      ${detailRows.length}`);
console.log(`  gained fees            ${stats.fees}`);
console.log(`  gained speakers        ${stats.speakers}`);
console.log(`  gained a committee     ${stats.committee}`);
console.log(`  gained sponsors        ${stats.sponsors}`);
console.log(`  gained a programme     ${stats.program}`);
console.log(`  speakers off the programme ${stats.fromProgramme}`);
console.log(`image rows written       ${urlRows.length}`);
console.log(`  gained a logo          ${stats.logo}`);
console.log(`  gained a banner        ${stats.banner}`);

function emit(marker: string, csv: string) {
  const payload = Buffer.from(csv, "utf8").toString("base64");
  const size = 1200;
  const total = Math.ceil(payload.length / size);
  console.log(`${marker}BEGIN total=${total} chars=${csv.length}`);
  for (let part = 0; part < total; part += 1) {
    console.log(`${marker}PART ${String(part + 1).padStart(4, "0")}/${total} ${payload.slice(part * size, (part + 1) * size)}`);
  }
  console.log(`${marker}END total=${total}`);
}
if (EMIT) { emit("DETAIL", detailCsv); emit("IMAGE", urlCsv); }
