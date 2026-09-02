// robots.txt: read it, obey it, and record what it said.
//
// The rule this file implements is simple and not negotiable: a path the site disallows for our
// user-agent is not fetched, and the domain's row records why. There is no override flag, and
// nothing here tries a different identity when a directive is inconvenient — a site that does not
// want to be crawled is skipped and the reason is logged.
//
// Parsing follows the de-facto standard: group directives by User-agent, the most specific
// matching group wins (an exact agent match over `*`), longest matching Allow/Disallow path wins,
// an empty Disallow means "allow everything", and `$`/`*` in paths are honoured.

import { discoveryFetch, type UrlGuard } from "./httpClient";

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** False when robots.txt itself could not be read; callers decide what to do about it. */
  fetched: boolean;
  /** True when the site explicitly told us to stay out of everything. */
  blanketDisallow: boolean;
  rules: RobotsRule[];
  crawlDelayMs: number | null;
  sitemaps: string[];
  /** Verbatim reason when robots.txt could not be read. */
  error: string | null;
}

export const ALLOW_ALL: RobotsPolicy = {
  fetched: false,
  blanketDisallow: false,
  rules: [],
  crawlDelayMs: null,
  sitemaps: [],
  error: null,
};

/** Our own agent token, matched case-insensitively against User-agent lines. */
export const ROBOTS_AGENT_TOKEN = "conferencegatebot";

export function parseRobotsTxt(text: string, agentToken = ROBOTS_AGENT_TOKEN): RobotsPolicy {
  const lines = text.split(/\r?\n/);
  // Groups keyed by the agent they name. A group is a run of User-agent lines followed by rules.
  const groups = new Map<string, { rules: RobotsRule[]; crawlDelay: number | null }>();
  const sitemaps: string[] = [];

  let currentAgents: string[] = [];
  let expectingAgents = false;

  const groupFor = (agent: string) => {
    let group = groups.get(agent);
    if (!group) {
      group = { rules: [], crawlDelay: null };
      groups.set(agent, group);
    }
    return group;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!expectingAgents) {
        currentAgents = [];
        expectingAgents = true;
      }
      currentAgents.push(value.toLowerCase());
      continue;
    }

    // Sitemap is a site-wide directive: it belongs to no group and applies regardless of agent.
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    expectingAgents = false;
    if (currentAgents.length === 0) continue;

    for (const agent of currentAgents) {
      const group = groupFor(agent);
      if (field === "disallow") {
        group.rules.push({ allow: false, pattern: value });
      } else if (field === "allow") {
        group.rules.push({ allow: true, pattern: value });
      } else if (field === "crawl-delay") {
        const seconds = Number(value.replace(",", "."));
        if (Number.isFinite(seconds) && seconds > 0) group.crawlDelay = seconds * 1000;
      }
    }
  }

  // Most specific group wins: our own token, then any group whose name we contain, then "*".
  const token = agentToken.toLowerCase();
  const chosenKey =
    [...groups.keys()].find((key) => key === token) ??
    [...groups.keys()].find((key) => key !== "*" && key.length > 1 && token.includes(key)) ??
    (groups.has("*") ? "*" : null);

  const chosen = chosenKey ? groups.get(chosenKey)! : { rules: [], crawlDelay: null };
  const blanketDisallow =
    chosen.rules.some((rule) => !rule.allow && rule.pattern === "/") &&
    !chosen.rules.some((rule) => rule.allow && rule.pattern !== "");

  return {
    fetched: true,
    blanketDisallow,
    rules: chosen.rules,
    crawlDelayMs: chosen.crawlDelay,
    sitemaps,
    error: null,
  };
}

/** robots.txt path matching: `*` is any run of characters, `$` anchors the end. */
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false; // "Disallow:" with no value means nothing is disallowed
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return re.test(path);
}

export function isPathAllowed(policy: RobotsPolicy, url: string): boolean {
  if (!policy.fetched) return true; // no robots.txt is not a prohibition
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    return false;
  }

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of policy.rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.replace(/\$$/, "").length;
    // Longest match wins; Allow wins a tie, which is what every major crawler does.
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { rule, length };
    }
  }
  return best ? best.rule.allow : true;
}

export async function fetchRobots(
  origin: string,
  options: { urlGuard?: UrlGuard; timeoutMs?: number } = {}
): Promise<RobotsPolicy> {
  const result = await discoveryFetch(`${origin.replace(/\/$/, "")}/robots.txt`, {
    accept: "text/plain,*/*;q=0.8",
    urlGuard: options.urlGuard,
    timeoutMs: options.timeoutMs,
  });

  if (result.blockedByLocalPolicy) {
    // Not "this site has no robots.txt" — "this machine cannot reach this site". Passed up
    // verbatim so the caller can tell an infrastructure problem from a site's answer.
    return { ...ALLOW_ALL, error: "blocked_by_local_egress_policy" };
  }

  if (!result.ok || !result.body.trim()) {
    // A 404 genuinely means "no restrictions stated"; anything else is an unknown we record but
    // do not treat as permission granted by silence — the caller sees `fetched: false` and the
    // error, and the domain row keeps `robots_allowed` null rather than 1.
    return {
      ...ALLOW_ALL,
      error: result.status === 404 ? null : result.error || `http_${result.status}`,
    };
  }

  // A "robots.txt" that is actually an HTML error page states no rules.
  if (/^\s*<(?:!doctype|html)/i.test(result.body)) {
    return { ...ALLOW_ALL, error: "robots_txt_returned_html" };
  }

  return parseRobotsTxt(result.body);
}
