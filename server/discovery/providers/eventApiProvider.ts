// Conferences from a structured events API, resolved to their own websites.
//
// Search discovery finds a conference when somebody thought to query for it, and sitemaps find one
// when its organiser publishes a sitemap this engine already knows to read. Neither is good at
// breadth: a catalogue built from them is whatever ranks well in English, which is overwhelmingly
// North America and Western Europe. A structured events API answers a different question — what is
// scheduled, in this country, in this window — and answers it the same way for Nairobi as for
// Boston. That is the one thing that makes worldwide coverage a query rather than a hope.
//
// PredictHQ supplies the event; it does not supply the event's website, which is what the reading
// cascade actually needs. Exa resolves that, under the same strict test the dataset builder uses:
// a candidate page must NAME the conference in its URL, title or host, and must not sit in a
// country that contradicts where the event is held. A conference whose site cannot be resolved is
// dropped rather than pointed at a listing — a directory page filed as an official site is exactly
// the contamination the rest of this engine spends its effort refusing.
//
// Off by default, like every other provider that spends money. Both APIs bill per call, and the
// house rule is that a run is free unless it was asked to be otherwise.

import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import { isExaConfigured, resolveOfficialUrl } from "../../dataset/sources/exa";
import {
  fetchPredictHqConferences,
  isPredictHqConfigured,
  looksLikeConference,
  worthResolving,
  type PredictHqEvent,
} from "../../dataset/sources/predicthq";

/**
 * Countries asked for by name, rather than taking whatever ranks highest globally.
 *
 * PredictHQ sorts by rank, and rank tracks attention, so an unrestricted request returns a US
 * catalogue with a European tail. Asking country by country is the whole mechanism by which the
 * rest of the world appears at all; the list leads with the regions the existing catalogue is
 * thinnest in rather than the ones it already covers well.
 */
const SWEEP_COUNTRIES = [
  // Africa and South America — three and five records respectively in the launch catalogue.
  "ZA", "NG", "KE", "EG", "MA", "GH", "BR", "AR", "CL", "CO", "PE",
  // Middle East.
  "AE", "SA", "QA", "KW", "BH", "OM", "JO", "TR",
  // Asia-Pacific.
  "IN", "CN", "JP", "KR", "SG", "MY", "ID", "TH", "VN", "PH", "AU", "NZ",
  // Europe and North America, last: already the best-covered and so the least urgent.
  "GB", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI", "PL", "PT", "CH", "AT", "BE",
  "IE", "CZ", "GR", "RO", "US", "CA", "MX",
];

/** Events per country per run. Small on purpose: forty-odd countries at a modest depth each is
 *  both wider and cheaper than one deep sweep of whichever country ranks highest. */
const DEFAULT_PER_COUNTRY = 8;

/** Where a country sits in the sweep, so a capped run spends its budget on the thin regions. */
function rotatedCountries(startIndex: number): string[] {
  const at = ((startIndex % SWEEP_COUNTRIES.length) + SWEEP_COUNTRIES.length) % SWEEP_COUNTRIES.length;
  return [...SWEEP_COUNTRIES.slice(at), ...SWEEP_COUNTRIES.slice(0, at)];
}

/**
 * Which slice of the country list this run works.
 *
 * A fixed order means the countries at the front are swept three times a day and the ones at the
 * back never. Rotating by the day of the year walks the whole list instead, so every country is
 * reached on a predictable cycle without any run being large.
 */
export function sweepStartIndex(now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start) / 86_400_000);
  return day * 4;
}

export interface EventApiProviderOptions {
  /** Test seam. Both clients already accept one; this carries it through the provider so the
   *  sweep can be exercised against fixtures without a network or anybody's quota. */
  fetchImpl?: typeof fetch;
}

export class EventApiProvider implements DiscoveryProvider {
  constructor(private readonly options: EventApiProviderOptions = {}) {}

  readonly name = "predicthq";
  readonly kind = "api" as const;
  // Exa documents ten requests a second; this stays an order of magnitude under it, because the
  // engine is sharing that budget with whatever else is running.
  readonly rateLimit = { requestsPerMinute: 60, maxConcurrent: 2 };
  // A structured event record with a resolved, name-matched website is a strong lead — stronger
  // than a scholarly series homepage, weaker than the organiser's own sitemap entry.
  readonly baseConfidence = 0.55;

  isEnabled(): boolean {
    return process.env.DISCOVERY_PREDICTHQ === "1" && isPredictHqConfigured() && isExaConfigured();
  }

  unavailableReason(): string | null {
    if (this.isEnabled()) return null;
    if (process.env.DISCOVERY_PREDICTHQ !== "1") {
      return "Set DISCOVERY_PREDICTHQ=1 to sweep a structured events API country by country. Both it and the URL resolver bill per call, so this stays off unless asked for.";
    }
    if (!isPredictHqConfigured()) return "PREDICTHQ_ACCESS_TOKEN is not set.";
    return "EXA_API_KEY is not set, and without it a PredictHQ event has no website to offer — the event carries no URL of its own.";
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    if (!this.isEnabled()) return [];
    const limit = Math.max(1, context.maxCandidates);
    const perCountry = Number(process.env.DISCOVERY_PREDICTHQ_PER_COUNTRY || DEFAULT_PER_COUNTRY);
    const countryBudget = Math.max(1, Math.min(perCountry, 50));
    // How many countries this run can afford at all, given the ceiling it was handed.
    const countries = rotatedCountries(sweepStartIndex())
      .slice(0, Math.max(1, Math.ceil(limit / countryBudget)));

    const years = context.targetYears.length ? context.targetYears : [new Date().getUTCFullYear()];
    const activeFrom = new Date().toISOString().slice(0, 10);
    const activeTo = `${Math.max(...years)}-12-31`;

    const candidates: DiscoveryCandidate[] = [];
    const seenUrls = new Set<string>();

    for (const country of countries) {
      if (candidates.length >= limit) break;
      if (context.signal?.aborted) break;

      let events: PredictHqEvent[];
      try {
        events = await fetchPredictHqConferences({
          activeFrom,
          activeTo,
          countries: [country],
          maxEvents: countryBudget,
          fetchImpl: this.options.fetchImpl,
          // Size is what separates a conference from a breakfast meeting; the category alone does
          // not. A live run at a lower floor returned a psychic medium evening and a church service.
          minAttendance: 500,
        });
      } catch {
        // One country's failure — a rate limit, a spent quota — never fails the run or the sweep.
        // The countries after it are still worth asking for.
        continue;
      }

      for (const event of events) {
        if (candidates.length >= limit) break;
        if (!event.title || !worthResolving(event)) continue;

        const year = Number((event.start_local || event.start || "").slice(0, 4));
        if (!Number.isFinite(year) || !years.includes(year)) continue;

        let resolved: Awaited<ReturnType<typeof resolveOfficialUrl>>;
        try {
          resolved = await resolveOfficialUrl({
            title: event.title,
            year,
            city: event.geo?.address?.locality ?? null,
            country: event.country ?? null,
            countryCode: event.country ?? null,
            fetchImpl: this.options.fetchImpl,
          });
        } catch {
          continue;
        }
        // No resolvable site means no candidate. The alternative — offering the event without a
        // page, or offering a listing that merely mentions it — is how a directory ends up stored
        // as a conference, which this catalogue already has too many of.
        if (!resolved) continue;

        // The gate runs against the resolved URL as well as the title, so a "conference" whose
        // site turns out to be a course page or a PDF is refused on the evidence of both.
        if (!looksLikeConference(event, { resolvedUrl: resolved.url })) continue;

        const key = resolved.url.toLowerCase();
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);

        candidates.push({
          url: resolved.url,
          sourceDomain: resolved.host,
          provider: this.name,
          // Attendance is significance, not correctness. It orders which leads are read first and
          // is never stored as a fact about the conference.
          priority: (event.phq_attendance || 0) >= 5000 ? 0.7 : 0.55,
          reason: `PredictHQ conference in ${country} for ${year}, site resolved on ${resolved.matchedOn}`,
          hints: {
            title: event.title,
            snippet: event.description ?? null,
            organizationDomain: resolved.host,
            discoveryProviders: [this.name],
            discoveryQuery: `${event.title} ${year}`,
          },
        });
      }
    }

    return candidates;
  }
}
