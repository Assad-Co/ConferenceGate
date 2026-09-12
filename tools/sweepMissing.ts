#!/usr/bin/env npx tsx
/**
 * One pass over everything the catalogue still does not know, so the sites are asked once.
 *
 * Three gaps were left after the earlier sweeps, and all three want the same page fetched:
 *   - 127 records whose Fees & Pricing tab has never been read at all;
 *   - the sections a site refused or had not published when `readDeepSections` last called;
 *   - 51 records showing their initials because no logo was ever found for them.
 *
 * Fetching each conference's home page once and answering all three off it is the difference
 * between three runs and one — and one run is one cron job to delete afterwards.
 *
 *   npx tsx tools/sweepMissing.ts [dataset.json] [--concurrency=5] [--limit=N] [--emit]
 *
 * Nothing here decides what a fact is. Sections come through the discovery engine's own
 * `extractDeepSections`, fees through `feePages`, and the logo through the picker lifted verbatim
 * out of `enrich-conference-images.mjs` — the same rules, asked again, of pages that had not
 * answered yet.
 *
 * Two files come back, because they land in two places the builder already reads: the details CSV
 * that `data/sources/details/` takes, and the corrections CSV that `resolved-official-urls.csv` is.
 * They are emitted under separate markers so one log can carry both.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDeepSections, findSectionPages, type DeepSectionExtraction } from "../server/discovery/deepSections";
import { feesCell, feesFromPage, findFeePages, type FeeLine } from "../server/discovery/feePages";

const ARGS = process.argv.slice(2);
const FLAGS = ARGS.filter((a) => a.startsWith("--"));
const DATASET = ARGS.filter((a) => !a.startsWith("--"))[0] ?? "data/conferencegate-worldwide-2026-2028.json";
const CONCURRENCY = Number(FLAGS.find((f) => f.startsWith("--concurrency="))?.split("=")[1] ?? 5);
const LIMIT = Number(FLAGS.find((f) => f.startsWith("--limit="))?.split("=")[1] ?? 0);
const EMIT = FLAGS.includes("--emit");
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

async function getHtml(url: string, ms = 20000): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(String(res.status));
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not html: ${type}`);
  return { html: await res.text(), finalUrl: res.url };
}

function peopleCell(people: Array<{ name: string; org: string | null; role: string | null }>): string {
  if (!people.length) return "";
  const byRole = new Map<string, string[]>();
  for (const person of people) {
    const role = (person.role || "").trim() || "—";
    const named = person.org ? `${person.name} (${person.org})` : person.name;
    if (!byRole.has(role)) byRole.set(role, []);
    if (!byRole.get(role)!.includes(named)) byRole.get(role)!.push(named);
  }
  return [...byRole.entries()].map(([role, names]) => (role === "—" ? names.join("; ") : `${role}: ${names.join("; ")}`)).join(". ");
}
function sponsorsCell(sponsors: Array<{ name: string; tier: string | null }>): string {
  if (!sponsors.length) return "";
  const byTier = new Map<string, string[]>();
  for (const sponsor of sponsors) {
    const tier = (sponsor.tier || "").trim() || "—";
    if (!byTier.has(tier)) byTier.set(tier, []);
    if (!byTier.get(tier)!.includes(sponsor.name)) byTier.get(tier)!.push(sponsor.name);
  }
  return [...byTier.entries()].map(([tier, names]) => (tier === "—" ? names.join("; ") : `${tier}: ${names.join("; ")}`)).join(". ");
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
const unread = (r: Rec, key: string) => r.details?.[key]?.availability === "unread";
const wants = (r: Rec) =>
  ["program", "keynotes", "committee", "sponsors", "fees"].some((k) => unread(r, k)) || !r.logoUrl || !r.imageUrl;
const needing = all.filter((r) => r.officialUrl && /^https?:\/\//i.test(r.officialUrl) && wants(r));
const queue = LIMIT > 0 ? needing.slice(0, LIMIT) : needing;

const detailRows: string[] = [];
const urlRows: string[] = [];
const today = new Date().toISOString().slice(0, 10);
const stats = { considered: queue.length, unreachable: 0, fees: 0, speakers: 0, committee: 0, sponsors: 0, program: 0, logo: 0, banner: 0 };

async function handle(record: Rec, index: number) {
  const site = record.officialUrl!;
  try {
    const home = await getHtml(site);
    const found: DeepSectionExtraction = { program: null, speakers: [], committee: [], sponsors: [], community: null };
    const here = extractDeepSections(home.html, home.finalUrl);
    found.speakers.push(...here.speakers); found.committee.push(...here.committee);
    found.sponsors.push(...here.sponsors); found.program = here.program;

    const wantSections = ["program", "keynotes", "committee", "sponsors"].some((k) => unread(record, k));
    if (wantSections) {
      for (const candidate of findSectionPages(home.html, home.finalUrl, { perSection: 1, sections: ["program", "speakers", "committee", "sponsors"] }).slice(0, 4)) {
        try {
          const page = await getHtml(candidate.url);
          const more = extractDeepSections(page.html, page.finalUrl);
          found.speakers.push(...more.speakers); found.committee.push(...more.committee);
          found.sponsors.push(...more.sponsors);
          if (more.program && (more.program.sessions.length || more.program.tracks.length)) found.program = more.program;
        } catch { /* a section page that will not load is a missing section */ }
      }
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
console.log(`sites unreachable        ${stats.unreachable}`);
console.log(`detail rows written      ${detailRows.length}`);
console.log(`  gained fees            ${stats.fees}`);
console.log(`  gained speakers        ${stats.speakers}`);
console.log(`  gained a committee     ${stats.committee}`);
console.log(`  gained sponsors        ${stats.sponsors}`);
console.log(`  gained a programme     ${stats.program}`);
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
