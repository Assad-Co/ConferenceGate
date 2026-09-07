// What Discover actually asks for, and what comes back.
//
// Production reported no results for ordinary searches — Cybersecurity, IEEE, Reykjavik — against
// a database that holds published records matching all of them. Every record here is shaped like a
// real published one, and each carries the specific property that a filter written for Brave's
// output rejects it for.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { dbRun } from "../../db";
import { initDiscoverySchema } from "../schema";
import { searchConferences } from "../../braveSearch";

interface SeedRecord {
  id: string;
  url: string;
  title: string;
  overview: Record<string, unknown>;
  sections?: Record<string, unknown>;
}

const SEEDS: SeedRecord[] = [
  {
    id: "ds-cyber", url: "https://cybersec-summit-2027.example/",
    title: "European Cybersecurity Summit 2027",
    overview: {
      conference_name: "European Cybersecurity Summit 2027", city: "Tallinn", country: "Estonia",
      start_date: "2027-04-12", dates_text: "12–14 April 2027",
      description: "A cybersecurity summit for practitioners in critical infrastructure defence.",
      topics: ["cybersecurity", "network security"],
    },
  },
  {
    id: "ds-ai", url: "https://ai-forum-2027.example/",
    title: "International Forum on Artificial Intelligence 2027",
    overview: {
      conference_name: "International Forum on Artificial Intelligence 2027", city: "Lisbon",
      country: "Portugal", start_date: "2027-06-02", dates_text: "2–5 June 2027",
      // Mentions only a past year: the outdated-text test rejects this even though it is a 2027 event.
      description: "Building on the artificial intelligence programme first held in March 2026.",
      topics: ["artificial intelligence", "machine learning"],
    },
  },
  {
    id: "ds-eng", url: "https://mecheng-congress.example/",
    title: "World Congress on Mechanical Engineering",
    overview: {
      conference_name: "World Congress on Mechanical Engineering", city: "Osaka", country: "Japan",
      start_date: "2027-09-20", dates_text: "20–23 September 2027",
      // Contains the word "conferences": the plural-listing test rejects the whole record for it.
      description: "One of the largest engineering conferences in Asia, with nine parallel tracks.",
      topics: ["mechanical engineering"],
    },
  },
  {
    id: "ds-energy", url: "https://renewables-week.example/",
    // No event word anywhere in the title: the "names an event" test rejects it.
    title: "Renewable Energy Week",
    overview: {
      conference_name: "Renewable Energy Week", city: "Copenhagen", country: "Denmark",
      start_date: "2027-05-04", dates_text: "4–7 May 2027",
      description: "Grid integration, storage and offshore wind.", topics: ["energy"],
    },
  },
  {
    id: "ds-ieee-a", url: "https://ieee.example/icra-2027",
    title: "IEEE International Conference on Robotics and Automation 2027",
    overview: {
      conference_name: "IEEE International Conference on Robotics and Automation 2027",
      acronym: "ICRA", city: "Vienna", country: "Austria", start_date: "2027-05-31",
      description: "IEEE robotics and automation.", topics: ["robotics"],
    },
  },
  {
    id: "ds-ieee-b", url: "https://ieee.example/globecom-2027",
    // Same host as the record above: the one-result-per-host rule drops whichever comes second.
    title: "IEEE Global Communications Conference 2027",
    overview: {
      conference_name: "IEEE Global Communications Conference 2027", acronym: "GLOBECOM",
      city: "Rio de Janeiro", country: "Brazil", start_date: "2027-12-06",
      description: "IEEE communications.", topics: ["communications"],
    },
  },
  {
    id: "ds-reykjavik", url: "https://arctic-geo-2027.example/",
    title: "Arctic Geoscience Symposium 2027",
    overview: {
      conference_name: "Arctic Geoscience Symposium 2027", city: "Reykjavik", country: "Iceland",
      start_date: "2027-08-17", description: "Permafrost and glacial hydrology.",
      topics: ["geoscience"],
    },
  },
  {
    id: "ds-cfp", url: "https://materials-congress-2027.example/",
    title: "Advanced Materials Congress 2027",
    overview: {
      conference_name: "Advanced Materials Congress 2027", city: "Zurich", country: "Switzerland",
      start_date: "2027-03-08", description: "Functional and structural materials.",
      topics: ["materials science"],
    },
    sections: { call_for_papers: { abstract_submission_deadline: "2026-11-30" } },
  },
];

async function seed(): Promise<void> {
  const { initDb } = await import("../../db");
  await initDb();
  await initDiscoverySchema();
  for (const record of SEEDS) {
    await dbRun(`INSERT OR REPLACE INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
       publish_readiness,confidence_score) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [record.id, record.title, record.title.toLowerCase(), "html", record.url,
        new URL(record.url).hostname, record.url, "published", "publish_ready", 0.9]);
    await dbRun(`INSERT OR REPLACE INTO extracted_conferences
      (source_url, overview, call_for_papers, extraction_metadata, updated_at)
      VALUES (?,?,?,?,datetime('now'))`,
      [record.url, JSON.stringify(record.overview),
        JSON.stringify(record.sections?.call_for_papers ?? {}),
        JSON.stringify({ origin: "discovery_engine", status: "success", discovery_event_id: record.id })]);
  }
}

async function cleanup(): Promise<void> {
  for (const record of SEEDS) {
    await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [record.url]);
    await dbRun("DELETE FROM discovery_events WHERE id=?", [record.id]);
  }
}

const titlesFor = async (query: string) =>
  (await searchConferences(query, "high", true)).map((result) => result.title);

test("Discover's reported searches all return their stored published conferences", async () => {
  await seed();
  try {
    for (const [query, expected] of [
      ["Cybersecurity", "European Cybersecurity Summit 2027"],
      ["Artificial Intelligence", "International Forum on Artificial Intelligence 2027"],
      ["Engineering", "World Congress on Mechanical Engineering"],
      ["Energy", "Renewable Energy Week"],
      ["Reykjavik", "Arctic Geoscience Symposium 2027"],
      ["abstract deadline", "Advanced Materials Congress 2027"],
    ] as const) {
      const titles = await titlesFor(query);
      assert.ok(titles.includes(expected), `"${query}" should find ${expected}, got ${JSON.stringify(titles)}`);
    }
    // Two conferences from one organiser must both survive; a search engine's one-per-host rule
    // exists to stop a single site flooding the page, and does not apply to curated records.
    const ieee = await titlesFor("IEEE");
    assert.equal(ieee.length, 2, `IEEE should return both stored conferences, got ${JSON.stringify(ieee)}`);
  } finally {
    await cleanup();
  }
});

test("a filter chip never becomes a word the record has to contain", async () => {
  await seed();
  try {
    // This is exactly what Discover used to send: the typed term plus the date filter rendered as
    // prose. Every meaningful token has to match, so the record had to contain "october" and
    // "2026" — which no 2027 conference does. The stored search must not be asked this.
    const biased = await titlesFor("Cybersecurity worldwide from October 2026");
    assert.equal(biased.length, 0, "the biased form is what produced an empty Discover page");

    const plain = await titlesFor("Cybersecurity");
    assert.equal(plain.length, 1, "the same search without the injected filter words finds the conference");
  } finally {
    await cleanup();
  }
});

test("Discover sends the typed search term to the stored search, unmodified", () => {
  // A source guard: the bias suffix was built from the date, place, format, timing and price
  // chips and appended to the query string. Reintroducing it would empty the page again.
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/DiscoveryEngine.tsx"), "utf8");
  assert.doesNotMatch(source, /biasSuffix/, "filter chips must not be concatenated into the search query");
  assert.doesNotMatch(source, /globalScope/, "'worldwide' must not be appended to a stored-database search");
});

test("the landing page shows stored conferences before anyone types", async () => {
  await seed();
  try {
    const { browseStoredConferences } = await import("../../braveSearch");
    const browse = await browseStoredConferences(60);
    assert.ok(browse.length >= SEEDS.length - 1,
      `browsing must return the catalogue, got ${browse.length}`);

    // Soonest upcoming first, so a visitor sees what is actually next.
    const dated = browse.map((result) => result.startDate).filter(Boolean) as string[];
    assert.deepEqual([...dated], [...dated].sort(), "browse is ordered by soonest start date");

    // The placeholder phrase the page used to send finds nothing, which is why browsing exists.
    const placeholder = await titlesFor(`upcoming academic and technical conferences ${new Date().getFullYear()}`);
    assert.equal(placeholder.length, 0);
  } finally {
    await cleanup();
  }
});

test("browsing runs no provider call and matches no query", async () => {
  await seed();
  try {
    const { browseStoredConferences } = await import("../../braveSearch");
    const first = await browseStoredConferences(5);
    assert.equal(first.length, 5, "the browse limit is respected");
    assert.ok(first.every((result) => result.link.startsWith("https://")));
  } finally {
    await cleanup();
  }
});
