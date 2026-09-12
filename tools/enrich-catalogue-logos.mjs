#!/usr/bin/env node
/**
 * Find a logo and a banner for the catalogue records that still have neither.
 *
 * The AI batch arrived with an image on every row, but it is 98 conferences of 294. The rest came
 * from batches whose compilers never filled a logo column, so their cards show the conference's
 * initials — correct, because this server refuses to put a host's favicon on a conference that
 * only happens to be hosted there, but not what a reader wants to see.
 *
 * What those records do have is an official URL that survived `usableAsOfficialUrl`. This reads
 * that page the way `enrich-conference-images.mjs` reads one, and writes the rows it finds in the
 * shape `data/sources/resolved-official-urls.csv` already takes — a title and a logo is enough for
 * a correction, so nothing here has to restate a conference the catalogue already knows.
 *
 *   node tools/enrich-catalogue-logos.mjs [dataset.json] [out.csv] [--concurrency=5] [--emit]
 *
 * Nothing is guessed: a URL is written only after it answers with an `image/*` content type, which
 * is the same bar the AI batch's images had to clear.
 *
 * The extraction itself is not reimplemented. It is lifted verbatim out of the shipped tool at
 * load time — the pattern the discovery tests use on server.ts, and for the same reason: a
 * hand-copied paraphrase of "what counts as a logo" would drift from what actually ships, and the
 * two would disagree about the same page without anyone noticing.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ARGS = process.argv.slice(2);
const FLAGS = ARGS.filter((a) => a.startsWith("--"));
const positional = ARGS.filter((a) => !a.startsWith("--"));
const DATASET = positional[0] ?? "data/conferencegate-worldwide-2026-2028.json";
const OUTPUT = positional[1] ?? "catalogue-logos.csv";
const CONCURRENCY = Number(FLAGS.find((f) => f.startsWith("--concurrency="))?.split("=")[1] ?? 5);
const LIMIT = Number(FLAGS.find((f) => f.startsWith("--limit="))?.split("=")[1] ?? 0);
const EMIT = FLAGS.includes("--emit");

// ---------- the shipped extraction, verbatim ----------
// Everything from the icon-service guard to the runner is pure declarations, so evaluating it has
// no side effects. Slicing rather than importing is deliberate: importing the tool would run it.
const SOURCE = new URL("./enrich-conference-images.mjs", import.meta.url);
const text = await readFile(SOURCE, "utf8");
const from = text.indexOf("const ICON_SERVICE");
const to = text.indexOf("// ---------- run ----------");
if (from < 0 || to < 0 || to <= from) {
  console.error("could not find the extraction block in enrich-conference-images.mjs — has it been restructured?");
  process.exit(1);
}
const extraction = text.slice(from, to);
const shipped = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${extraction}\nexport { isRealImage, getText, kitLinks, pickImages };\n`,
    "utf8"
  ).toString("base64")}`
);
const { isRealImage, getText, kitLinks, pickImages } = shipped;

// ---------- the records that need one ----------
const dataset = JSON.parse(await readFile(path.resolve(DATASET), "utf8"));
const all = Array.isArray(dataset.records) ? dataset.records : Object.values(dataset.records ?? dataset);
const needing = all.filter((r) => !r.logoUrl && r.officialUrl && /^https?:\/\//i.test(r.officialUrl));
const queue = LIMIT > 0 ? needing.slice(0, LIMIT) : needing;

const today = new Date().toISOString().slice(0, 10);
const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
const found = [];
const stats = { considered: queue.length, unreachable: 0, nothing: 0, logo: 0, banner: 0 };

async function handle(record, index) {
  const site = record.officialUrl;
  try {
    const home = await getText(site);
    const pages = [{ html: home.html, url: home.finalUrl }];
    for (const link of kitLinks(home.html, home.finalUrl)) {
      try { const kit = await getText(link); pages.push({ html: kit.html, url: kit.finalUrl }); }
      catch { /* a kit page that will not load is not a failure */ }
    }
    const picked = await pickImages(pages);
    if (!picked.logo && !picked.banner) {
      stats.nothing += 1;
      console.log(`[${index}] NOTHING  ${record.title.slice(0, 60)}`);
      return;
    }
    if (picked.logo) stats.logo += 1;
    if (picked.banner) stats.banner += 1;
    found.push({ title: record.title, officialUrl: site, logo: picked.logo, banner: picked.banner });
    console.log(`[${index}] FOUND    ${record.title.slice(0, 50)} logo=${picked.logo.slice(0, 60)} banner=${picked.banner.slice(0, 60)}`);
  } catch (error) {
    stats.unreachable += 1;
    console.log(`[${index}] UNREACHABLE ${site} — ${error.message}`);
  }
}

let cursor = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (cursor < queue.length) {
    const index = cursor;
    cursor += 1;
    try { await handle(queue[index], index + 1); }
    catch (error) { console.log(`[${index + 1}] ERROR ${queue[index].title} — ${error.message}`); }
  }
}));

const header = "conference_name,official_url,resolved_on,method,logo_url,banner_url";
// Every field is quoted, the URLs included. A CDN that resizes on the path writes a comma into one
// — https://host/cdn-cgi/image/width=1600,height=0/logo.svg — and an unquoted comma there does not
// corrupt that cell, it shifts every cell after it, so a logo lands in the banner column as a
// fragment that is not a URL at all.
const csv = [header, ...found.map((r) =>
  [r.title, r.officialUrl, today, "page_read", r.logo, r.banner].map(q).join(",")
)].join("\n") + "\n";
await writeFile(OUTPUT, csv);

console.log(`\n================ REPORT ================`);
console.log(`records in dataset        ${all.length}`);
console.log(`already have a logo       ${all.filter((r) => r.logoUrl).length}`);
console.log(`no logo and no site to read ${all.filter((r) => !r.logoUrl && !(r.officialUrl && /^https?:\/\//i.test(r.officialUrl))).length}`);
console.log(`considered (no logo, has a site) ${stats.considered}`);
console.log(`sites unreachable         ${stats.unreachable}`);
console.log(`read but nothing usable   ${stats.nothing}`);
console.log(`rows written              ${found.length}`);
console.log(`  with a logo             ${stats.logo}`);
console.log(`  with a banner           ${stats.banner}`);
console.log(`written -> ${OUTPUT}`);

// Same reason as the sibling tool: the run's filesystem is gone the moment it exits.
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
