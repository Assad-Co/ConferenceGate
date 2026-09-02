// A small, self-contained web, served from localhost, for exercising the whole pipeline.
//
// Eleven independent "sites", each on its own port so each is a genuinely separate domain to the
// engine: a professional society, an engineering society, a scientific organisation, a medical
// society, a publisher, three universities on three continents, a research institute, a
// conference directory, and one site whose robots.txt forbids crawling entirely.
//
// They publish their event data in different ways on purpose — JSON-LD, microdata, RDFa, and
// plain labelled HTML with no structured data at all — because that is the spread a real crawl
// meets, and a pipeline that only works on JSON-LD would look fine on a friendlier fixture.
//
// Everything here is INVENTED. It exists to prove the pipeline's behaviour end to end without
// touching anyone's real website; it is not, and must never be presented as, discovered data.

import http from "http";
import type { AddressInfo } from "net";
import type { SourceType } from "../types";

// A tiny deterministic PRNG, so a rehearsal produces the same web every time.
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface FixtureConference {
  slug: string;
  title: string;
  acronym: string | null;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  countryPhrase: string;
  venue: string;
  organizer: string;
  eventType: string;
  format: "in_person" | "online" | "hybrid";
  topics: string[];
  description: string;
  abstractDeadline: string;
  earlyBirdDeadline: string;
  notificationDate: string;
}

export type Markup = "jsonld" | "microdata" | "rdfa" | "plain";

export interface FixtureSite {
  key: string;
  name: string;
  sourceType: SourceType;
  region: string;
  country: string;
  markup: Markup;
  conferences: FixtureConference[];
  /** Blanket-disallow robots.txt: the engine must skip this site entirely. */
  disallowAll?: boolean;
  /** A path robots.txt forbids; pages under it must never be fetched. */
  disallowPath?: string;
  /** Directory sites list conferences that live on other domains. */
  isDirectory?: boolean;
}

const SUBJECTS: Array<{ topic: string; words: string[]; organizerHint: string }> = [
  { topic: "Artificial Intelligence", words: ["machine learning", "deep learning", "neural networks"], organizerHint: "AI Research Council" },
  { topic: "Cybersecurity", words: ["cryptography", "threat intelligence", "network security"], organizerHint: "Cyber Defence Institute" },
  { topic: "Renewable Energy", words: ["solar", "wind energy", "energy storage"], organizerHint: "Renewable Energy Association" },
  { topic: "Petroleum Engineering", words: ["reservoir", "drilling", "hydrocarbon"], organizerHint: "Petroleum Engineers Society" },
  { topic: "Geosciences", words: ["geophysics", "stratigraphy", "seismology"], organizerHint: "Geoscience Union" },
  { topic: "Medical Oncology", words: ["cancer", "clinical trial", "precision medicine"], organizerHint: "Oncology Society" },
  { topic: "Public Health", words: ["health informatics", "public health", "telemedicine"], organizerHint: "Public Health Federation" },
  { topic: "Robotics", words: ["autonomous systems", "automation", "mechatronics"], organizerHint: "Robotics Institute" },
  { topic: "Materials Science", words: ["polymer", "nanomaterial", "composites"], organizerHint: "Materials Research Society" },
  { topic: "Climate Science", words: ["climate change", "emissions", "carbon capture"], organizerHint: "Climate Research Network" },
  { topic: "Water Engineering", words: ["membrane technology", "water reuse", "hydrology"], organizerHint: "Water Engineering Board" },
  { topic: "Agricultural Science", words: ["agronomy", "crop science", "food security"], organizerHint: "Agricultural Research Council" },
  { topic: "Civil Engineering", words: ["structural engineering", "construction", "built environment"], organizerHint: "Institution of Civil Engineers" },
  { topic: "Finance", words: ["banking", "investment", "risk management"], organizerHint: "Institute of Finance" },
  { topic: "Education Technology", words: ["edtech", "e-learning", "pedagogy"], organizerHint: "Education Futures Trust" },
  { topic: "Telecommunications", words: ["wireless", "5g", "optical network"], organizerHint: "Telecommunications Institute" },
  { topic: "Mining", words: ["mineral processing", "metallurgy", "ore"], organizerHint: "Mining Engineers Association" },
  { topic: "Marine Science", words: ["oceanography", "marine biology", "aquaculture"], organizerHint: "Marine Sciences Council" },
  { topic: "Pharmaceutical Sciences", words: ["drug discovery", "biopharma", "vaccine"], organizerHint: "Pharmaceutical Sciences Academy" },
  { topic: "Transport Logistics", words: ["logistics", "freight", "urban mobility"], organizerHint: "Transport Research Board" },
];

const PLACES: Array<{ city: string; country: string; countryPhrase: string; region: string }> = [
  { city: "Toronto", country: "Canada", countryPhrase: "Canada", region: "North America" },
  { city: "Boston", country: "United States", countryPhrase: "USA", region: "North America" },
  { city: "Mexico City", country: "Mexico", countryPhrase: "Mexico", region: "North America" },
  { city: "São Paulo", country: "Brazil", countryPhrase: "Brazil", region: "South America" },
  { city: "Santiago", country: "Chile", countryPhrase: "Chile", region: "South America" },
  { city: "Bogotá", country: "Colombia", countryPhrase: "Colombia", region: "South America" },
  { city: "Vienna", country: "Austria", countryPhrase: "Austria", region: "Europe" },
  { city: "Lisbon", country: "Portugal", countryPhrase: "Portugal", region: "Europe" },
  { city: "Manchester", country: "United Kingdom", countryPhrase: "UK", region: "Europe" },
  { city: "Kraków", country: "Poland", countryPhrase: "Poland", region: "Europe" },
  { city: "Doha", country: "Qatar", countryPhrase: "Qatar", region: "Middle East" },
  { city: "Dubai", country: "United Arab Emirates", countryPhrase: "UAE", region: "Middle East" },
  { city: "Amman", country: "Jordan", countryPhrase: "Jordan", region: "Middle East" },
  { city: "Nairobi", country: "Kenya", countryPhrase: "Kenya", region: "Africa" },
  { city: "Cape Town", country: "South Africa", countryPhrase: "South Africa", region: "Africa" },
  { city: "Accra", country: "Ghana", countryPhrase: "Ghana", region: "Africa" },
  { city: "Singapore", country: "Singapore", countryPhrase: "Singapore", region: "Asia" },
  { city: "Seoul", country: "South Korea", countryPhrase: "Republic of Korea", region: "Asia" },
  { city: "Bengaluru", country: "India", countryPhrase: "India", region: "Asia" },
  { city: "Melbourne", country: "Australia", countryPhrase: "Australia", region: "Oceania" },
  { city: "Auckland", country: "New Zealand", countryPhrase: "New Zealand", region: "Oceania" },
];

const EVENT_TYPES = ["Conference", "Congress", "Symposium", "Summit", "Workshop", "Forum"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeConference(index: number, random: () => number, siteKey: string): FixtureConference {
  const subject = SUBJECTS[index % SUBJECTS.length];
  const place = PLACES[Math.floor(random() * PLACES.length)];
  const eventType = EVENT_TYPES[Math.floor(random() * EVENT_TYPES.length)];
  // Weighted towards 2027, the priority year, with the rest of 2026 and 2028 also represented.
  const yearRoll = random();
  const year = yearRoll < 0.18 ? 2026 : yearRoll < 0.75 ? 2027 : 2028;
  const month = year === 2026 ? 10 + Math.floor(random() * 3) : 1 + Math.floor(random() * 12);
  const day = 1 + Math.floor(random() * 24);
  const startDate = iso(year, month, day);
  const endDate = shiftDays(startDate, 1 + Math.floor(random() * 3));
  const edition = 3 + Math.floor(random() * 25);
  const acronymSource = subject.topic.split(/\s+/).map((word) => word[0]).join("");
  const acronym = `${acronymSource}${eventType[0]}`.toUpperCase();
  const title = `${edition}th International ${eventType} on ${subject.topic} ${year}`;
  const formatRoll = random();
  const format = formatRoll < 0.72 ? "in_person" : formatRoll < 0.88 ? "hybrid" : "online";

  return {
    slug: `${subject.topic.toLowerCase().replace(/\s+/g, "-")}-${eventType.toLowerCase()}-${year}-${siteKey}${index}`,
    title,
    acronym,
    startDate,
    endDate,
    city: place.city,
    country: place.country,
    countryPhrase: place.countryPhrase,
    venue: `${place.city} Convention Centre`,
    organizer: subject.organizerHint,
    eventType,
    format,
    topics: subject.words,
    description: `The ${edition}th International ${eventType} on ${subject.topic} brings together researchers, engineers and practitioners working on ${subject.words.join(", ")}. The call for papers is open and all submissions are peer reviewed by the scientific committee before publication in the conference proceedings.`,
    abstractDeadline: shiftDays(startDate, -180),
    earlyBirdDeadline: shiftDays(startDate, -90),
    notificationDate: shiftDays(startDate, -120),
  };
}

export function buildFixtureSites(): FixtureSite[] {
  const random = makeRandom(20260902);
  const specs: Array<{ key: string; name: string; sourceType: SourceType; region: string; country: string; markup: Markup; count: number; disallowPath?: string }> = [
    { key: "socai", name: "Institute for Computing Professionals", sourceType: "professional_society", region: "North America", country: "United States", markup: "jsonld", count: 18 },
    { key: "engsoc", name: "Global Society of Mechanical Engineers", sourceType: "engineering_society", region: "Europe", country: "Germany", markup: "microdata", count: 16 },
    { key: "sciorg", name: "International Geosciences Union", sourceType: "scientific_organization", region: "Europe", country: "Austria", markup: "rdfa", count: 15 },
    { key: "medsoc", name: "Continental Society for Medical Research", sourceType: "medical_society", region: "Europe", country: "Switzerland", markup: "jsonld", count: 15, disallowPath: "/members-only/" },
    { key: "pub", name: "Northfield Academic Press", sourceType: "publisher", region: "Europe", country: "Netherlands", markup: "plain", count: 14 },
    { key: "uniME", name: "Gulf University of Science and Technology", sourceType: "university", region: "Middle East", country: "Qatar", markup: "plain", count: 13 },
    { key: "uniAS", name: "Pacific Institute of Technology", sourceType: "university", region: "Asia", country: "Singapore", markup: "jsonld", count: 13 },
    { key: "resOC", name: "Southern Ocean Research Organisation", sourceType: "research_institute", region: "Oceania", country: "Australia", markup: "plain", count: 12 },
    { key: "uniAF", name: "Sub-Saharan University of Applied Sciences", sourceType: "university", region: "Africa", country: "South Africa", markup: "microdata", count: 12 },
  ];

  const sites: FixtureSite[] = specs.map((spec) => ({
    key: spec.key,
    name: spec.name,
    sourceType: spec.sourceType,
    region: spec.region,
    country: spec.country,
    markup: spec.markup,
    disallowPath: spec.disallowPath,
    conferences: Array.from({ length: spec.count }, (_, index) => makeConference(index, random, spec.key)),
  }));

  // A directory that re-lists conferences already published by two of the sites above. The engine
  // should recognise them as the same conferences and attach the directory as an extra source
  // rather than storing them twice.
  const directoryListings = [...sites[0].conferences.slice(0, 6), ...sites[4].conferences.slice(0, 5)];
  sites.push({
    key: "directory",
    name: "WorldConferenceIndex",
    sourceType: "conference_directory",
    region: "Global",
    country: "United States",
    markup: "plain",
    isDirectory: true,
    conferences: directoryListings,
  });

  // A site that asks not to be crawled at all. The engine must skip it and say why.
  sites.push({
    key: "closed",
    name: "Private Members Association",
    sourceType: "professional_association",
    region: "Europe",
    country: "France",
    markup: "plain",
    disallowAll: true,
    conferences: Array.from({ length: 5 }, (_, index) => makeConference(index + 40, random, "closed")),
  });

  return sites;
}

// ---------------------------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------------------------

function longDate(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

function dateRangeText(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy === ey) return `${sd} ${MONTH_NAMES[sm - 1]} – ${ed} ${MONTH_NAMES[em - 1]} ${sy}`;
  return `${longDate(start)} – ${longDate(end)}`;
}

const ATTENDANCE_MODE = {
  in_person: "https://schema.org/OfflineEventAttendanceMode",
  online: "https://schema.org/OnlineEventAttendanceMode",
  hybrid: "https://schema.org/MixedEventAttendanceMode",
} as const;

function chrome(inner: string, title: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/privacy">Privacy policy</a> <a href="/login">Log in</a></nav>
<main>${inner}</main>
<footer><p>This site uses cookies. All rights reserved.</p></footer>
</body></html>`;
}

function importantDatesHtml(conference: FixtureConference): string {
  return `<h2>Important dates</h2>
  <table>
    <tr><th>Abstract submission deadline</th><td>${longDate(conference.abstractDeadline)}</td></tr>
    <tr><th>Notification of acceptance</th><td>${longDate(conference.notificationDate)}</td></tr>
    <tr><th>Early bird registration</th><td>${longDate(conference.earlyBirdDeadline)}</td></tr>
  </table>`;
}

function renderConference(site: FixtureSite, conference: FixtureConference, origin: string): string {
  const url = `${origin}/events/${conference.slug}`;
  const commonBody = `
  <h1>${conference.title}</h1>
  <p>${conference.description}</p>
  ${importantDatesHtml(conference)}
  <p><a href="${origin}/events/${conference.slug}/register">Register now</a> | <a href="${origin}/events/${conference.slug}/cfp">Call for papers</a></p>
  <p><strong>Contact:</strong> Conference Secretariat</p>
  <p><strong>Email:</strong> ${conference.slug.slice(0, 20)}@${site.key}.example.org</p>`;

  if (site.markup === "jsonld") {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "ConferenceEvent",
      name: conference.title,
      description: conference.description,
      startDate: conference.startDate,
      endDate: conference.endDate,
      eventAttendanceMode: ATTENDANCE_MODE[conference.format],
      keywords: conference.topics.join(", "),
      url,
      location: {
        "@type": "Place",
        name: conference.venue,
        address: {
          "@type": "PostalAddress",
          addressLocality: conference.city,
          addressCountry: conference.countryPhrase,
        },
      },
      organizer: { "@type": "Organization", name: conference.organizer, url: origin },
      offers: { "@type": "Offer", url: `${url}/register`, price: "620", priceCurrency: "EUR" },
    };
    return chrome(
      `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${commonBody}`,
      `${conference.title} | ${site.name}`
    );
  }

  if (site.markup === "microdata") {
    return chrome(
      `<div itemscope itemtype="https://schema.org/ConferenceEvent">
         <h1 itemprop="name">${conference.title}</h1>
         <p itemprop="description">${conference.description}</p>
         <time itemprop="startDate" datetime="${conference.startDate}">${longDate(conference.startDate)}</time>
         <time itemprop="endDate" datetime="${conference.endDate}">${longDate(conference.endDate)}</time>
         <meta itemprop="eventAttendanceMode" content="${ATTENDANCE_MODE[conference.format]}">
         <meta itemprop="keywords" content="${conference.topics.join(", ")}">
         <div itemprop="location" itemscope itemtype="https://schema.org/Place">
           <span itemprop="name">${conference.venue}</span>
           <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
             <span itemprop="addressLocality">${conference.city}</span>
             <span itemprop="addressCountry">${conference.countryPhrase}</span>
           </div>
         </div>
         <span itemprop="organizer">${conference.organizer}</span>
       </div>
       ${importantDatesHtml(conference)}
       <p><a href="${url}/register">Register now</a></p>`,
      `${conference.title} | ${site.name}`
    );
  }

  if (site.markup === "rdfa") {
    return chrome(
      `<div typeof="schema:ConferenceEvent" prefix="schema: https://schema.org/">
         <h1 property="schema:name">${conference.title}</h1>
         <p property="schema:description">${conference.description}</p>
         <span property="schema:startDate" content="${conference.startDate}">${longDate(conference.startDate)}</span>
         <span property="schema:endDate" content="${conference.endDate}">${longDate(conference.endDate)}</span>
         <span property="schema:location">${conference.venue}</span>
         <span property="schema:addressLocality">${conference.city}</span>
         <span property="schema:addressCountry">${conference.countryPhrase}</span>
         <span property="schema:organizer">${conference.organizer}</span>
       </div>
       ${importantDatesHtml(conference)}
       <p><a href="${url}/register">Register now</a></p>`,
      `${conference.title} | ${site.name}`
    );
  }

  // Plain HTML: no structured data anywhere, only labelled text — the deterministic path.
  const formatWord = conference.format === "in_person" ? "In-person" : conference.format === "online" ? "Online" : "Hybrid";
  return chrome(
    `<h1>${conference.title}</h1>
     <p><strong>Dates:</strong> ${dateRangeText(conference.startDate, conference.endDate)}</p>
     <p><strong>Venue:</strong> ${conference.venue}</p>
     <p><strong>Location:</strong> ${conference.city}, ${conference.countryPhrase}</p>
     <p><strong>Organised by:</strong> ${conference.organizer}</p>
     <p><strong>Format:</strong> ${formatWord}</p>
     <p><strong>Topics:</strong> ${conference.topics.join(", ")}</p>
     ${commonBody}`,
    `${conference.title} | ${site.name}`
  );
}

/** A directory's page about a conference hosted elsewhere: the official URL points off-site. */
function renderDirectoryEntry(conference: FixtureConference, officialUrl: string, origin: string): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: conference.title,
    description: conference.description,
    startDate: conference.startDate,
    endDate: conference.endDate,
    url: officialUrl,
    location: {
      "@type": "Place",
      name: conference.venue,
      address: { "@type": "PostalAddress", addressLocality: conference.city, addressCountry: conference.countryPhrase },
    },
  };
  return chrome(
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
     <h1>${conference.title}</h1>
     <p>${conference.description}</p>
     <p><strong>Official website:</strong> <a href="${officialUrl}">${officialUrl}</a></p>
     <p><strong>Dates:</strong> ${dateRangeText(conference.startDate, conference.endDate)}</p>
     <p><strong>Location:</strong> ${conference.city}, ${conference.countryPhrase}</p>
     <p>Listed by WorldConferenceIndex. <a href="${origin}/browse">Browse all conferences</a>.</p>`,
    `${conference.title} — WorldConferenceIndex`
  );
}

/** Pages the engine should NOT accept: a roundup, a news post, a concert, and a finished event. */
function noisePages(site: FixtureSite, origin: string): Record<string, string> {
  const sample = site.conferences.slice(0, 3);
  return {
    "/listing/top-conferences-2027": chrome(
      `<h1>Top 20 Conferences to Attend in 2027</h1>
       <p>Browse hundreds of conferences across the world. 20 results found.</p>
       <ul>${sample.map((c) => `<li>${c.title} — ${c.city}</li>`).join("")}</ul>`,
      `Top 20 Conferences to Attend in 2027 | ${site.name}`
    ),
    "/news/annual-report-2026": chrome(
      `<h1>Annual report published</h1><p>Posted on 4 August 2026. Read more about our year in review. Share this article.</p>`,
      `Annual report published | ${site.name}`
    ),
    "/events/summer-nights-live-2027": chrome(
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "MusicEvent",
        name: "Summer Nights Live 2027",
        startDate: "2027-07-18",
        location: { "@type": "Place", name: "Riverside Arena", address: { addressLocality: "Manchester", addressCountry: "GB" } },
      })}</script>
       <h1>Summer Nights Live 2027</h1>
       <p>The full lineup is announced. Tickets on sale now for the biggest live music festival of the summer, with a DJ set until late.</p>`,
      "Summer Nights Live 2027"
    ),
    "/events/coastal-resilience-workshop-2019": chrome(
      `<h1>4th European Workshop on Coastal Resilience</h1>
       <p><strong>Dates:</strong> 3–5 April 2019</p>
       <p><strong>Location:</strong> Rotterdam, Netherlands</p>
       <p>Thank you to everyone for attending. The workshop took place in April 2019 and the proceedings are now published.</p>`,
      "4th European Workshop on Coastal Resilience"
    ),
  };
}

export interface RunningFixtureSite {
  key: string;
  /** "127.0.0.1:PORT" — the registry's domain identifier for this site. */
  domain: string;
  origin: string;
  name: string;
  sourceType: SourceType;
  region: string;
  country: string;
  conferenceCount: number;
  disallowAll: boolean;
}

export interface FixtureWeb {
  sites: RunningFixtureSite[];
  /** Conferences the sites actually publish and that the engine should be able to accept. */
  totalConferencePages: number;
  stop(): Promise<void>;
}

export async function startFixtureWeb(sites = buildFixtureSites()): Promise<FixtureWeb> {
  const servers: http.Server[] = [];
  const running: RunningFixtureSite[] = [];
  // Origins are needed before the pages are rendered (the directory links to them), so every
  // server is bound first and the routing table is built afterwards.
  const originByKey = new Map<string, string>();

  for (const _site of sites) {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
  }

  sites.forEach((site, index) => {
    const port = (servers[index].address() as AddressInfo).port;
    originByKey.set(site.key, `http://127.0.0.1:${port}`);
  });

  sites.forEach((site, index) => {
    const origin = originByKey.get(site.key)!;
    const routes = new Map<string, string>();

    if (site.isDirectory) {
      // The directory's own listing pages plus one page per conference it re-lists. Each names
      // the conference's real home elsewhere, which is what the engine should record as official.
      const sourceOrigins = [originByKey.get("socai")!, originByKey.get("pub")!];
      site.conferences.forEach((conference, i) => {
        const officialOrigin = i < 6 ? sourceOrigins[0] : sourceOrigins[1];
        routes.set(`/listing/${conference.slug}`, renderDirectoryEntry(conference, `${officialOrigin}/events/${conference.slug}`, origin));
      });
      routes.set(
        "/browse",
        chrome(
          `<h1>Conference directory</h1><p>Browse thousands of conferences. ${site.conferences.length} results found.</p>
           <ul>${site.conferences.map((c) => `<li><a href="${origin}/listing/${c.slug}">${c.title}</a></li>`).join("")}</ul>`,
          "Conference directory — WorldConferenceIndex"
        )
      );
    } else {
      for (const conference of site.conferences) {
        routes.set(`/events/${conference.slug}`, renderConference(site, conference, origin));
      }
      // One conference behind a robots-disallowed path, to prove it is never fetched.
      if (site.disallowPath) {
        routes.set(
          `${site.disallowPath}secret-symposium-2027`,
          chrome("<h1>Members Only Symposium 2027</h1><p>This page is disallowed by robots.txt.</p>", "Members Only Symposium 2027")
        );
      }
    }

    for (const [path, html] of Object.entries(noisePages(site, origin))) routes.set(path, html);

    const eventPaths = [...routes.keys()].filter((path) => !path.startsWith("/listing/top-"));
    const sitemapUrls = eventPaths.map((path) => `${origin}${path}`);

    const robotsTxt = site.disallowAll
      ? "User-agent: *\nDisallow: /\n"
      : [
          "User-agent: *",
          site.disallowPath ? `Disallow: ${site.disallowPath}` : "Disallow: /login",
          "Allow: /",
          `Sitemap: ${origin}/sitemap.xml`,
          "",
        ].join("\n");

    const half = Math.ceil(sitemapUrls.length / 2);
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>${origin}/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;
    const urlset = (urls: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc><lastmod>2026-08-15</lastmod></url>`).join("\n")}
</urlset>`;

    servers[index].on("request", (req, res) => {
      const path = (req.url || "/").split("?")[0];
      const send = (body: string, type: string) => {
        // Real sites answer conditional requests; so does this one, so the rehearsal exercises
        // the 304 path rather than only the content-hash comparison behind it.
        const etag = `"${site.key}-${path.length}-${body.length}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag });
          return res.end();
        }
        res.writeHead(200, { "content-type": type, etag });
        res.end(body);
      };
      if (path === "/robots.txt") return send(robotsTxt, "text/plain; charset=utf-8");
      if (path === "/sitemap.xml") return send(sitemapIndex, "application/xml");
      if (path === "/sitemap-1.xml") return send(urlset(sitemapUrls.slice(0, half)), "application/xml");
      if (path === "/sitemap-2.xml") return send(urlset(sitemapUrls.slice(half)), "application/xml");
      const page = routes.get(path);
      if (page) return send(page, "text/html; charset=utf-8");
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body><h1>Not found</h1></body></html>");
    });

    running.push({
      key: site.key,
      domain: `127.0.0.1:${(servers[index].address() as AddressInfo).port}`,
      origin,
      name: site.name,
      sourceType: site.sourceType,
      region: site.region,
      country: site.country,
      conferenceCount: site.conferences.length,
      disallowAll: !!site.disallowAll,
    });
  });

  return {
    sites: running,
    totalConferencePages: sites
      .filter((site) => !site.disallowAll)
      .reduce((sum, site) => sum + site.conferences.length, 0),
    async stop() {
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    },
  };
}
