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
  datesLineFor,
  descriptionWorthShowing,
  hasSomethingToShow,
  isBareListing,
  siteIconUrl,
  conferenceLogoSource,
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

  // A site's icon is the site's mark, so reading a URL alone tells you whose mark it is only where
  // the URL is a site root. Gastech's stated page is an article on a trade magazine: a path deep in
  // a host that carries a thousand other things, and nothing about it says the host is Gastech's.
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

test("a record that survived the official-site screening takes its organiser's mark", () => {
  // `siteIconUrl` above reads a URL and nothing else, so it has only the path to go on. A record
  // has more: `official_site` is set only once the URL passed `usableAsOfficialUrl`, the index-path
  // test and the directory and reference host lists. A deep path on a host that cleared all of that
  // is the organiser's own event page — the Cell Press symposium below is a Cell Press conference —
  // and refusing its mark leaves a real conference blank for no gain.
  withFixtureDataset(() => {
    const own = findLaunchRecordByUrl("https://www.atce.org/")!;
    const symposium: typeof own = {
      ...own, logoUrl: null, sourceType: "official_site",
      officialUrl: "https://cell-press-symposia.com/rnas-2027/index.html",
    };
    assert.equal(conferenceLogoUrl(symposium), "https://cell-press-symposia.com/favicon.ico");

    // A listing is still a listing: the screening that sets `official_site` is what is being
    // trusted, so a record that never passed it falls back to the path test and then the initials.
    const listed: typeof own = {
      ...own, logoUrl: null, sourceType: "directory_listing",
      officialUrl: "https://www.emedevents.com/c/medical-conferences-2027/rnas",
    };
    assert.equal(conferenceLogoUrl(listed), null);
  });
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


test("a description that restates the title is not a description", () => {
  // The card shows the title, the date and the place as data. Under that, a harvested record's
  // "description" is often those same three things in a sentence, and an API record's carries the
  // provider's name in front of it — one says nothing twice, the other shows a reader some plumbing.
  const base: any = {
    title: "Gastech 2026", city: "Bangkok", country: "Thailand", region: null, venue: null,
    organization: null, description: "Gastech 2026, Bangkok, Thailand, September 14-17, 2026",
  };
  assert.equal(descriptionWorthShowing(base), null);
  assert.equal(descriptionWorthShowing({ ...base, description: "Sourced from predicthq.com" }), null);
  assert.equal(descriptionWorthShowing({ ...base, description: "" }), null);

  // One that says what the conference is about earns its line.
  const real = { ...base, title: "20th Vaccine Congress", city: "Seville", country: "Spain",
    description: "International conference focused on vaccines & immunology." };
  assert.equal(descriptionWorthShowing(real), "International conference focused on vaccines & immunology.");

  // And the provider prefix is stripped from one that does say something.
  assert.equal(
    descriptionWorthShowing({ ...base, description: "Sourced from predicthq.com - A gathering of treasury professionals worldwide." }),
    "A gathering of treasury professionals worldwide."
  );
});


test("a conference that stated a month says the month, rather than saying nothing", () => {
  // Every parser worked the month out and every one dropped it, so fourteen conferences whose
  // source said "listed for November 2026" reached the page with no date line at all — the year
  // survived and the month did not, leaving nothing a date could be written from.
  const base: any = { year: 2026, startDate: null, endDate: null, datesText: null, startMonth: 11 };
  assert.equal(datesLineFor(base), "November 2026");

  // A day is still never invented to carry it.
  assert.equal(datesLineFor({ ...base, startMonth: null }), "2026");

  // And the cases that already worked are unchanged.
  assert.equal(datesLineFor({ ...base, startDate: "2027-02-17", endDate: "2027-02-19" }), "2027-02-17 – 2027-02-19");
  assert.equal(datesLineFor({ ...base, startDate: "2027-04-01", endDate: "2027-04-01" }), "2027-04-01");
  assert.equal(datesLineFor({ ...base, datesText: "12-16 September 2026" }), "12-16 September 2026");
  // A month outside the calendar is not a month.
  assert.equal(datesLineFor({ ...base, startMonth: 13 }), "2026");
  assert.equal(datesLineFor({ ...base, startMonth: 0 }), "2026");
});


test("an aggregator's generated entry is a listing, and a real conference in the same state is not", () => {
  // Some aggregators generate an entry for every pairing of a subject and a city: the same
  // "International Conference on Desalination and Renewable Energy" appears in Montreal, Athens,
  // Las Vegas and Honolulu, none with an organiser, a venue, a description or a website, and a
  // search for one finds nothing but more listings of itself.
  const listing: any = {
    title: "ICDRE 2027 International Conference on Desalination and Renewable Energy",
    year: 2027, startDate: "2027-01-09", endDate: null, datePrecision: "day", datesText: null,
    city: "Honolulu", region: null, country: "United States", venue: null, organization: null,
    description: null, officialUrl: null, sourceType: "directory_listing",
    sourceUrl: "https://conferenceindex.org/event/...", details: null,
  };
  assert.equal(isBareListing(listing), true);
  assert.equal(hasSomethingToShow(listing), false, "a generated listing was published as a conference");

  // Any one trace of a real event keeps it. The Ukraine Recovery Conference reached exactly this
  // state — found on Wikipedia, nothing else stored — and is real: one search found urc27.org.
  // That is a correction to make, not a record to drop.
  assert.equal(isBareListing({ ...listing, officialUrl: "https://urc27.org/" }), false);
  assert.equal(isBareListing({ ...listing, organization: "RenewableUK" }), false);
  assert.equal(isBareListing({ ...listing, venue: "P&J Live" }), false);
  assert.equal(
    isBareListing({ ...listing, description: "A conference on rebuilding Ukraine's economy and infrastructure." }),
    false
  );

  // And the test only ever applies to a record found on a directory or an encyclopaedia. A
  // conference read off its own site is never one of these, however little else is known.
  assert.equal(isBareListing({ ...listing, sourceType: "official_site" }), false);
  assert.equal(isBareListing({ ...listing, sourceType: "third_party" }), false);
});

test("a mark derived from a host is labelled as the organiser's, never as the conference's", () => {
  // Not one of the 190 marks in the launch catalogue is a logo a source stated; every one is
  // /favicon.ico on the host of an official URL. So the page must say whose it is, or it makes the
  // same false claim 190 times — and lands fourteen Elsevier congresses on one indistinguishable
  // card. This is the distinction `distanceSource` makes between a published figure and a derived
  // one, applied to the mark.
  withFixtureDataset(() => {
    const own = findLaunchRecordByUrl("https://www.atce.org/")!;

    const derived: typeof own = {
      ...own, logoUrl: null, sourceType: "official_site",
      officialUrl: "https://www.elsevier.com/events/conferences/all/food-chemistry-conference",
    };
    assert.equal(conferenceLogoUrl(derived), "https://www.elsevier.com/favicon.ico");
    assert.equal(conferenceLogoSource(derived), "organiser");

    // A logo a source actually named is the conference's own, and outranks the derivation.
    const stated: typeof own = { ...derived, logoUrl: "https://example.org/food-chem-2027.png" };
    assert.equal(conferenceLogoUrl(stated), "https://example.org/food-chem-2027.png");
    assert.equal(conferenceLogoSource(stated), "stated");

    // No mark at all is its own answer, and must not be reported as either kind.
    const none: typeof own = { ...own, logoUrl: null, officialUrl: null, sourceType: "directory_listing" };
    assert.equal(conferenceLogoUrl(none), null);
    assert.equal(conferenceLogoSource(none), null);
  });
});

test("the search payload carries whose mark it is, so a card can lead with the conference", () => {
  withFixtureDataset(() => {
    const hits = searchLaunchDataset("ATCE", 5);
    const hit = hits.find((row) => row.link.includes("atce.org"));
    assert.ok(hit, "the fixture conference did not come back from search");
    assert.equal(hit.favicon, "https://www.atce.org/favicon.ico");
    assert.equal(hit.logoSource, "organiser");
  });
});
