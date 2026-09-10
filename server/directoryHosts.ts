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
  // Aggregators that supplied most of one curated batch. Without them here, 113 records would have
  // published a listing site — and 46 of those a filtered search page — as the conference's own
  // website, which is the one promotion this list exists to prevent.
  "iconf.com",
  "impactconvene.com",
  "conferencesked.com",
  "worldconferencecalendar.com",
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
  // Added after a live resolver run attached these to real events. Every one of them is an event
  // aggregator that ranks well for an event's own name, which is precisely why the resolver has to
  // know them by name rather than hope they lose on relevance.
  "happeningnext.com",
  "stayhappening.com",
  "eventslist.co.uk",
  "evensi.com",
  "eventil.com",
  "bizzabo.com",
  "conferencemonkey.org",
  "conferenceineurope.net",
  "conferenceineurope.org",
  "conference2go.com",
  "conferencenext.com",
  "expotobi.com",
  "k12conferences.com",
  "papercall.io",
  "sessionize.com",
  "lu.ma",
  "eventpop.me",
  "trade-fairs.org",
  "tradefest.io",
  "visitsaltlake.com",
  // A second live run attached these to real conferences. cantonfair.net is the worst of them: it
  // was given as the website for a three-day event in Helsinki.
  "venunite.com",
  "expohour.com",
  "liners.com",
  "researchbib.com",
  "cantonfair.net",
  "conferencealerts.co.in",
  "sharedaudiences.com",
]);

/** Social networks. A post about a conference is not the conference's website, however well it
 *  matches the name — and a Facebook group or a LinkedIn post is what a search returns when an
 *  event has no site of its own at all. */
const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "pinterest.com",
  "threads.net",
  "medium.com",
  "substack.com",
]);

export function isSocialHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [...SOCIAL_DOMAINS].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

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
// uia.org is the Union of International Associations' yearbook: real, careful, and still
// somebody writing about the conference rather than the organiser speaking.
const REFERENCE_DOMAINS = new Set(["wikipedia.org", "wikidata.org", "dbpedia.org", "uia.org"]);

export function isReferenceHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [...REFERENCE_DOMAINS].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}
