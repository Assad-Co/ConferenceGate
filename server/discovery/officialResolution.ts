// Turning a directory listing into the conference's own website.
//
// 27 of the Phase 1.2 benchmark's 51 accepted events came from directories and only 12 from
// official event sites. That is the wrong way round: a directory is a report of what someone else
// said, and Conference Gate's whole premise is that the organiser's own word outranks it.
//
// A directory page is still a good LEAD, though — often a better one than a search engine, since
// listing smaller regional events exhaustively is its entire job. So the directory is read for
// the event, and then read again for the one thing it uniquely provides: a link to where the
// event actually lives.
//
// The rule that must not bend: finding a link on a directory page does NOT make the directory
// official. The directory stays recorded as the directory, the resolved site is recorded
// separately as the official source, and if resolution fails the record keeps a null official URL
// rather than being quietly promoted.

import { attr, byTag, parseHtml, textOf } from "./html";
import { canonicalizeUrl, normalizeTitle } from "./normalize";
import { isDirectoryHost } from "../braveSearch";

/** Hosts that are never a conference's own site, however prominently a directory links them. */
const NEVER_OFFICIAL = [
  "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com", "youtube.com",
  "t.me", "wa.me", "whatsapp.com", "researchgate.net", "academia.edu", "google.com",
  "doodle.com", "eventbrite.com", "zoom.us", "teams.microsoft.com", "paypal.com",
  "doi.org", "orcid.org", "wikipedia.org", "amazon.com", "gravatar.com", "gstatic.com",
  "cloudflare.com", "jquery.com", "bootstrapcdn.com", "fontawesome.com",
];

/** Link text that says, in so many words, "the event is over there". */
const OFFICIAL_LINK_TEXT =
  /\b(?:official\s+(?:web)?site|official\s+page|conference\s+website|event\s+website|visit\s+(?:the\s+)?(?:website|site)|more\s+(?:info|details)\s+(?:at|on)|go\s+to\s+website|homepage|website)\b/i;

export interface OfficialCandidate {
  url: string;
  /** 0–1. How strongly this link looks like the event's own home. */
  score: number;
  reason: string;
}

function hostOf(value: string): string {
  try {
    return new URL(value).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isNeverOfficial(host: string): boolean {
  return NEVER_OFFICIAL.some((banned) => host === banned || host.endsWith(`.${banned}`));
}

/**
 * Finds links on a directory page that plausibly lead to the conference's own site.
 *
 * Scored on three independent signals, because any one alone is wrong often enough to matter:
 * the link's own wording, whether the host echoes the event's name or acronym, and whether the
 * host is a dedicated event domain rather than something that hosts thousands of pages. A link
 * needs real evidence, not merely to be an outbound link on the page.
 */
export function findOfficialCandidates(
  html: string,
  directoryUrl: string,
  event: { title: string | null; acronym: string | null },
  limit = 3
): OfficialCandidate[] {
  const root = parseHtml(html);
  const directoryHost = hostOf(directoryUrl);
  const titleTokens = new Set(
    normalizeTitle(event.title || "")
      .split(" ")
      .filter((token) => token.length >= 4)
  );
  const acronym = (event.acronym || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const byUrl = new Map<string, OfficialCandidate>();

  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, directoryUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "https:" && absolute.protocol !== "http:") continue;

    const host = absolute.host.toLowerCase().replace(/^www\./, "");
    // Off-site, not another directory, not a platform that hosts everything.
    if (!host || host === directoryHost) continue;
    if (isDirectoryHost(host) || isNeverOfficial(host)) continue;

    // Real directories mark this up as a label BESIDE the link, not inside it:
    // "<strong>Official website:</strong> <a href=...>example.org</a>". Reading only the anchor's
    // own text misses every one of those, so the immediate parent's text counts too — bounded,
    // so a whole page's prose cannot leak in and match by accident.
    const parentText = anchor.parent && anchor.parent.type === "element" ? textOf(anchor.parent).slice(0, 200) : "";
    const label = `${textOf(anchor)} ${attr(anchor, "title") || ""} ${attr(anchor, "aria-label") || ""} ${parentText}`.trim();
    let score = 0;
    const reasons: string[] = [];

    if (OFFICIAL_LINK_TEXT.test(label)) {
      score += 0.5;
      reasons.push("the link says it is the official site");
    }

    // The host echoing the event's name is the strongest signal there is: "imog2027.org" for the
    // International Meeting on Organic Geochemistry.
    const hostWords = host.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
    if (acronym.length >= 3 && hostWords.includes(acronym)) {
      score += 0.4;
      reasons.push(`host contains the acronym "${acronym.toUpperCase()}"`);
    }
    const matchedTokens = [...titleTokens].filter((token) => hostWords.includes(token));
    if (matchedTokens.length > 0) {
      score += Math.min(0.35, 0.15 * matchedTokens.length);
      reasons.push(`host echoes the title (${matchedTokens.slice(0, 3).join(", ")})`);
    }

    // A short path on a dedicated-looking domain is a homepage; a deep path on a big site is a
    // page about the event, which is weaker but still better than the directory.
    const depth = absolute.pathname.split("/").filter(Boolean).length;
    if (depth <= 1) {
      score += 0.15;
      reasons.push("links to a site root");
    }
    if (/\b(?:conference|congress|symposium|summit|meeting|expo)\b/i.test(hostWords)) {
      score += 0.1;
      reasons.push("host names an event");
    }

    if (score < 0.35) continue; // an outbound link is not, by itself, evidence of anything

    const canonical = canonicalizeUrl(absolute.href) || absolute.href;
    const existing = byUrl.get(canonical);
    if (!existing || score > existing.score) {
      byUrl.set(canonical, {
        url: absolute.href,
        score: Number(Math.min(1, score).toFixed(3)),
        reason: reasons.join("; "),
      });
    }
  }

  return [...byUrl.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Per-run tally for section 4's reporting. */
export interface DirectoryResolutionStats {
  directoryLeads: number;
  resolutionsAttempted: number;
  resolutionsSuccessful: number;
  validatedAfterResolution: number;
  /** Leads with no plausible official link on the page at all. */
  noCandidateFound: number;
  /** Leads where a candidate was found but could not be read. */
  candidateUnreadable: number;
}

export function newDirectoryResolutionStats(): DirectoryResolutionStats {
  return {
    directoryLeads: 0,
    resolutionsAttempted: 0,
    resolutionsSuccessful: 0,
    validatedAfterResolution: 0,
    noCandidateFound: 0,
    candidateUnreadable: 0,
  };
}

export function resolutionRate(stats: DirectoryResolutionStats): number {
  return stats.resolutionsAttempted > 0
    ? Number((stats.resolutionsSuccessful / stats.resolutionsAttempted).toFixed(3))
    : 0;
}
