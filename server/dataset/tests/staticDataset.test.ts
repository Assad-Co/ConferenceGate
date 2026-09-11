import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchDataset } from "../build";
import type { HarvestEvidence } from "../parseEvidence";
import {
  browseLaunchDataset,
  conferenceLogoUrl,
  hasSomethingToShow,
  siteIconUrl,
  findLaunchRecordByUrl,
  launchRecordToTabbedExtraction,
  loadLaunchDataset,
  resetLaunchDatasetCache,
  searchLaunchDataset,
  LAUNCH_DATASET_FILE,
  LAUNCH_INDEX_FILE,
} from "../staticDataset";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function row(url: string, stated: string, org: string | null = null): HarvestEvidence {
  return { query: "q", title: "t", url, stated, org };
}

const FIXTURE_EVIDENCE: HarvestEvidence[] = [
  row("https://www.atce.org/", "SPE ATCE 2026 Annual Technical Conference and Exhibition, George R. Brown Convention Center, Houston, Texas, USA, October 21-23, 2026", "SPE"),
  row("https://eageannual.org/", "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands, 31 May - 3 June 2027", "EAGE"),
  row("https://www.eag.org/events/goldschmidt/", "Goldschmidt 2027 Conference, Paris, France, July 11-16, 2027", "European Association of Geochemistry"),
  row("https://www.rsaconference.com/", "RSA Conference 2027, San Francisco, California, USA, April 5-8, 2027"),
  row("https://www.wicys.org/event/wicys-2027-annual-conference/", "WiCyS 2027 Annual Conference, Women in Cybersecurity, Aurora, Colorado, USA, March 17-19, 2027", "WiCyS"),
  row("https://onegiantleap.com/", "LEAP 2027 Tech Conference, Riyadh, Saudi Arabia, April 12-15, 2027"),
  row("https://miccai.org/2028", "MICCAI 2028 International Conference on Medical Image Computing, Sao Paulo, Brazil, October 16-20, 2028"),
  // Its source host contains "eage" in the middle of a word, which a substring matcher treated as
  // a hit for the society of that name.
  row("https://www.spaceagenda.com/event/smallsat-2027/", "SmallSat 2027, 41st Annual AIAA/USU Conference on Small Satellites, Logan, Utah, USA, August 15-18, 2027"),
];

/** Writes the fixture dataset where the reader looks, and points the reader at it. */
function withFixtureDataset<T>(run: () => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "launch-dataset-"));
  const result = buildLaunchDataset(FIXTURE_EVIDENCE, OPTIONS);
  fs.writeFileSync(path.join(directory, LAUNCH_DATASET_FILE), JSON.stringify(result.dataset));
  fs.writeFileSync(path.join(directory, LAUNCH_INDEX_FILE), JSON.stringify(result.index));
  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = directory;
  resetLaunchDatasetCache();
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR = previous;
    resetLaunchDatasetCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("the dataset loads from disk and indexes every record by its source URL", () => {
  withFixtureDataset(() => {
    const loaded = loadLaunchDataset();
    assert.equal(loaded.records.length, FIXTURE_EVIDENCE.length);
    assert.ok(findLaunchRecordByUrl("https://www.atce.org/"));
    assert.equal(findLaunchRecordByUrl("https://nothing-here.example/"), null);
  });
});

test("search matches on acronym, organisation, city, country and year", () => {
  withFixtureDataset(() => {
    const titlesFor = (query: string) => searchLaunchDataset(query).map((result) => result.title);
    assert.ok(titlesFor("SPE").some((title) => title.includes("ATCE")));
    assert.ok(titlesFor("EAGE").some((title) => title.includes("EAGE")));
    assert.ok(titlesFor("Goldschmidt").some((title) => title.includes("Goldschmidt")));
    assert.ok(titlesFor("geochemistry").some((title) => title.includes("Goldschmidt")));
    assert.ok(titlesFor("Saudi Arabia").some((title) => title.includes("LEAP")));
    assert.ok(titlesFor("cybersecurity").some((title) => title.includes("WiCyS")));
    assert.ok(titlesFor("2028").some((title) => title.includes("MICCAI")));
    assert.equal(titlesFor("conference in Antarctica about penguins").length, 0);
  });
});

test("a static result never claims prepared tab data it does not have", () => {
  withFixtureDataset(() => {
    for (const result of searchLaunchDataset("conference")) {
      assert.equal(result.prepared, false);
    }
  });
});

test("browsing returns upcoming conferences soonest first and leaves finished ones out", () => {
  withFixtureDataset(() => {
    const now = new Date("2027-01-01T00:00:00Z");
    const results = browseLaunchDataset(60, now);
    const dates = results.map((result) => result.startDate);
    assert.deepEqual([...dates].sort(), dates);
    assert.ok(!results.some((result) => (result.startDate || "") < "2027-01-01"));
  });
});

test("the detail payload fills only verified fields and marks the deep sections unread", () => {
  withFixtureDataset(() => {
    const record = findLaunchRecordByUrl("https://eageannual.org/");
    assert.ok(record);
    const payload = launchRecordToTabbedExtraction(record!) as Record<string, any>;

    assert.equal(payload.extracted, true);
    assert.equal(payload.crawlComplete, true);
    assert.equal(payload.fetchFailed, false);
    // The distinction the detail page renders: nothing was read, so no section may be reported as
    // "the crawl found none".
    assert.equal(payload.sectionsNotRead, true);
    assert.equal(payload.pagesRead, 0);

    assert.equal(payload.overview.conference_name, "88th EAGE Annual Conference & Exhibition 2027");
    assert.equal(payload.overview.city, "Amsterdam");
    assert.equal(payload.overview.country, "Netherlands");
    assert.equal(payload.overview.venue, "RAI Amsterdam");
    assert.equal(payload.overview.start_date, "2027-05-31");
    assert.equal(payload.overview.organizer, "EAGE");
    // The source text is preserved rather than discarded because structured parsing was partial.
    assert.ok(String(payload.overview.description).includes("RAI Amsterdam"));

    assert.deepEqual(payload.keynote_speakers, []);
    assert.deepEqual(payload.technical_committee, []);
    assert.deepEqual(payload.sponsors_exhibitors, []);
    assert.deepEqual(payload.call_for_papers, {});
    assert.equal(payload.extraction_metadata.origin, "launch_dataset");
    assert.ok(payload.extraction_metadata.sections_not_read.includes("keynote_speakers"));
    assert.equal(payload.extraction_metadata.evidence.method, "web_search");
  });
});

test("reading the dataset makes no network request", async () => {
  await withFixtureDataset(async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: unknown[]) => {
      calls += 1;
      throw new Error(`unexpected fetch: ${String(args[0])}`);
    }) as typeof globalThis.fetch;
    try {
      searchLaunchDataset("petroleum");
      browseLaunchDataset(10);
      const record = findLaunchRecordByUrl("https://www.atce.org/");
      launchRecordToTabbedExtraction(record!);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(calls, 0);
  });
});

test("a missing dataset degrades to no records rather than throwing", () => {
  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = path.join(os.tmpdir(), "launch-dataset-does-not-exist");
  resetLaunchDatasetCache();
  try {
    assert.deepEqual(searchLaunchDataset("anything"), []);
    assert.deepEqual(browseLaunchDataset(10), []);
    assert.equal(findLaunchRecordByUrl("https://www.atce.org/"), null);
  } finally {
    if (previous === undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR = previous;
    resetLaunchDatasetCache();
  }
});

test("an acronym matches where a word starts with it, not inside somebody else's hostname", () => {
  // "EAGE" used to return a small-satellite conference, whose only "eage" was the middle of
  // spac-eage-nda.com. A reader searching for a society does not expect that.
  withFixtureDataset(() => {
    const results = searchLaunchDataset("EAGE");
    assert.equal(results.length, 1);
    assert.ok(results[0].title.includes("EAGE"));
  });
});

test("a conference the page can place, from a record that only holds the parts", () => {
  // The detail page renders one location line and one date line under the title. A record with a
  // city, a country and two ISO dates showed neither: nothing joined the place into a line, and a
  // start date parked in datesText preempted the range this composes. Both facts were in the
  // payload; neither reached the screen.
  withFixtureDataset(() => {
    const record = findLaunchRecordByUrl("https://www.atce.org/")!;
    const overview = (launchRecordToTabbedExtraction(record) as any).overview;
    assert.equal(overview.location_text, "George R. Brown Convention Center, Houston, Texas, United States");
    assert.equal(overview.dates_text, "2026-10-21 – 2026-10-23");
  });
});

test("a record with nowhere stated says nothing rather than an empty line", () => {
  const nowhere: any = {
    title: "Unplaced Conference 2027", acronym: null, edition: null, description: null,
    datesText: null, startDate: "2027-04-01", endDate: "2027-04-01",
    city: null, region: null, country: null, worldRegion: null, venue: null,
    format: null, organization: null, topics: [], categories: [], keywords: [],
    officialUrl: null, sourceUrl: "https://example.org/", details: null,
  };
  const overview = (launchRecordToTabbedExtraction(nowhere) as any).overview;
  assert.equal(overview.location_text, null);
  // A one-day conference is one date, not a range repeating itself.
  assert.equal(overview.dates_text, "2027-04-01");
});


test("a conference's logo comes from the conference's own site, never from a listing", () => {
  // Derived rather than read, which is the whole reason it has to be careful about where it points.
  // A record found on emedevents.com has no official site of its own, and serving that directory's
  // icon as the conference's mark would put a brand on the page the conference has nothing to do
  // with — the initials the card already falls back to are a better answer than someone else's logo.
  withFixtureDataset(() => {
    const own = findLaunchRecordByUrl("https://www.atce.org/")!;
    assert.equal(conferenceLogoUrl(own), "https://www.atce.org/favicon.ico");

    const listed = { ...own, officialUrl: null };
    assert.equal(conferenceLogoUrl(listed), null);
  });

  // A site's icon is the site's mark, so it is the conference's only where the site is. Gastech's
  // stated page is an article on a trade magazine and the 20th Vaccine Congress's is on its
  // publisher's site; taking an icon from either puts a brand on the page that has nothing to do
  // with the conference, which is worse than the initials the card falls back to.
  assert.equal(siteIconUrl("https://www.rogtecmagazine.com/events-calendar/"), null);
  assert.equal(siteIconUrl("https://www.elsevier.com/en-gb/events/conferences/all"), null);
  assert.equal(siteIconUrl("https://www.aapg.org/event-details/5th-edition-gtw/"), null);
  assert.equal(siteIconUrl("https://eageannual.org/2027/programme?day=2"), null);

  // A conference that owns its domain keeps its icon, and a bare year segment is still its own
  // site's root rather than a page on somebody else's.
  assert.equal(siteIconUrl("https://eageannual.org/"), "https://eageannual.org/favicon.ico");
  assert.equal(siteIconUrl("https://iceevent.org/2026/"), "https://iceevent.org/favicon.ico");
  assert.equal(siteIconUrl("https://www.blackhat.com/us-26/"), "https://www.blackhat.com/favicon.ico");

  // And nothing is derived from something that is not a site.
  assert.equal(siteIconUrl(null), null);
  assert.equal(siteIconUrl("not a url"), null);
  assert.equal(siteIconUrl("javascript:alert(1)"), null);
});

test("the catalogue hands the page the logo alongside the rest of the record", () => {
  withFixtureDataset(() => {
    const record = findLaunchRecordByUrl("https://www.atce.org/")!;
    const payload = launchRecordToTabbedExtraction(record) as any;
    assert.equal(payload.overview.logo_url, "https://www.atce.org/favicon.ico");
    // The picture is a different thing: it can only come from a page somebody read, and nothing has
    // read this one, so it stays null rather than borrowing the logo and calling it a banner.
    assert.equal(payload.overview.image_url, null);

    const results = searchLaunchDataset("ATCE");
    assert.equal(results[0].favicon, "https://www.atce.org/favicon.ico");
  });
});

test("a conference is worth showing on what it can say, not on which tabs are filled", () => {
  const base: any = {
    title: "Some Conference 2027", acronym: null, edition: null, description: null,
    datesText: null, startDate: "2027-04-01", endDate: "2027-04-03", datePrecision: "day",
    city: "Lisbon", region: null, country: "Portugal", worldRegion: "Europe", venue: null,
    format: null, organization: null, topics: [], categories: [], keywords: [],
    officialUrl: null, sourceUrl: "https://example.org/", details: null,
  };
  // A date, a place and an overview is a page worth opening even with every tab empty.
  assert.equal(hasSomethingToShow({ ...base, description: "An overview." }), true);
  // So is a date, a place and the organiser's own site.
  assert.equal(hasSomethingToShow({ ...base, officialUrl: "https://someconf.example/" }), true);
  // A name and a date, with nowhere and nothing to read, is not.
  assert.equal(hasSomethingToShow(base), false);
  assert.equal(hasSomethingToShow({ ...base, description: "An overview.", city: null, country: null }), false);
  assert.equal(
    hasSomethingToShow({ ...base, description: "An overview.", startDate: null, datePrecision: null }),
    false
  );
  // A month is enough to place it in a catalogue ordered by date.
  assert.equal(
    hasSomethingToShow({ ...base, description: "An overview.", startDate: null, datePrecision: "month" }),
    true
  );
});
