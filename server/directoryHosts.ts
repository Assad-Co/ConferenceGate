// The hosts Conference Gate treats as listing sites rather than a conference's own website.
//
// Lives in its own module because three things now need the same judgement — Discover's search
// screening, the discovery engine, and the launch dataset builder — and a second copy of this list
// would drift from the first. Importing it must stay free of side effects: the builder runs as a
// plain script and has no database.

const DIRECTORY_DOMAINS = new Set([
  // Seed sources for discovery, and directories for every other purpose: a listing host is never
  // promoted to a conference's authoritative site, whatever it says about itself.
  "conflists.com",
  "iconf.org",
  "10times.com",
  "allevents.in",
  "allconferencealert.com",
  "allconferences.com",
  "conferencealerts.com",
  "conferencealerts.co.in",
  "conferencealert.com",
  "internationalconferencealerts.com",
  "clocate.com",
  "conferenceindex.org",
  "conference-next.com",
  "conference-service.com",
  "dev.events",
  "eventbrite.com",
  "eventbrite.ca",
  "eventsget.com",
  "eventseye.com",
  "meetup.com",
  "conferenceseries.com",
  "myconferencetimes.com",
  "techconferences.co",
  "showsbee.com",
  "waset.org",
  "emedevents.com",
  "neventum.com",
  "sharedaudiences.com",
  "webmobi.com",
  "spaceagenda.com",
  "cmesupermarket.com",
  "medflixs.com",
  "infosec-conferences.com",
  "eventbrowse.com",
]);

/** The listing hosts as a plain list, for callers that must name them to somebody else — Exa's
 *  `excludeDomains`, for one, which keeps a search from spending result slots on pages that could
 *  never be a conference's own website. */
export function directoryDomains(): string[] {
  return [...DIRECTORY_DOMAINS];
}

/** True when the host is a conference directory, calendar or listing aggregator. */
export function isDirectoryHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [...DIRECTORY_DOMAINS].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

/** Reference works — real sources, but encyclopaedic rather than the organiser speaking. */
const REFERENCE_DOMAINS = new Set(["wikipedia.org", "wikidata.org", "dbpedia.org"]);

export function isReferenceHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [...REFERENCE_DOMAINS].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}
