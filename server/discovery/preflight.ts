// "Can this machine actually reach the open web?"
//
// This exists because of a specific, expensive confusion. A sandboxed or firewalled network
// refuses a host with a 403 that looks exactly like a conference site refusing a crawler, and a
// discovery run in that environment produces a page of plausible-looking site errors that are
// really one infrastructure problem. Ten minutes of reading logs later you conclude the sites are
// hostile, when in fact no request ever left the building.
//
// So: before a run, ask a handful of real domains one cheap, polite question each (their
// robots.txt — the one file every crawler is supposed to read first) and classify what comes
// back. The distinction it draws is the whole point:
//
//   reachable          — the request left this machine and the site answered
//   egress_blocked     — this machine's own network refused; nothing to do with the site
//   dns_failure        — the name does not resolve from here
//   origin_refused     — the site itself said no (anti-bot, geoblock, 403/429)
//   robots_disallowed  — the site answered, and asked crawlers not to come in
//   timeout            — no answer in time
//
// It makes no attempt to get past anything. A site that says no is reported as saying no.

import dns from "dns";
import { discoveryFetch, DISCOVERY_USER_AGENT } from "./httpClient";
import { checkAllProviders, type ProviderCheck } from "./providerHealth";
import { isPathAllowed, parseRobotsTxt } from "./robots";
import { listDomains } from "./sourceRegistry";

export type PreflightVerdict =
  | "reachable"
  | "egress_blocked"
  | "dns_failure"
  | "origin_refused"
  | "robots_disallowed"
  | "timeout"
  | "error";

export interface PreflightProbe {
  domain: string;
  url: string;
  verdict: PreflightVerdict;
  httpStatus: number | null;
  elapsedMs: number;
  detail: string;
  /** Present when the site answered: what its robots.txt actually permits us. */
  robots?: {
    hasRobotsTxt: boolean;
    crawlingAllowed: boolean;
    crawlDelayMs: number | null;
    declaredSitemaps: number;
  };
}

export interface PreflightReport {
  ranAt: string;
  userAgent: string;
  /** The environment's own proxy configuration, and whether this runtime will actually use it. */
  proxy: {
    httpsProxyConfigured: boolean;
    nodeWillUseProxy: boolean;
    note: string | null;
  };
  probes: PreflightProbe[];
  /** Brave, Serper, Jina, Turso and Gemini: reachable, or exactly why not. Never a credential. */
  providers: ProviderCheck[];
  counts: Record<PreflightVerdict, number>;
  /** The one-line answer: can a discovery run do useful work from this machine? */
  outboundHttps: "working" | "partial" | "blocked";
  verdictSummary: string;
  recommendation: string;
}

/** Well-known, publicly crawlable conference-hosting organisations across several regions.
 *  Only their robots.txt is requested, once each. */
export const DEFAULT_PREFLIGHT_DOMAINS = [
  "acm.org",
  "asme.org",
  "egu.eu",
  "esmo.org",
  "springer.com",
  "kaust.edu.sa",
  "nus.edu.sg",
  "csiro.au",
  "uct.ac.za",
  "usp.br",
];

async function resolves(host: string): Promise<boolean> {
  try {
    await dns.promises.lookup(host);
    return true;
  } catch {
    return false;
  }
}

async function probe(domain: string, scheme: "http" | "https"): Promise<PreflightProbe> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const url = `${scheme}://${host}/robots.txt`;
  const startedAt = Date.now();

  if (!(await resolves(host.split(":")[0]))) {
    return {
      domain,
      url,
      verdict: "dns_failure",
      httpStatus: null,
      elapsedMs: Date.now() - startedAt,
      detail: "the hostname does not resolve from this machine (no DNS, or a blocked resolver)",
    };
  }

  const result = await discoveryFetch(url, { accept: "text/plain,*/*;q=0.8" });

  if (result.blockedByLocalPolicy) {
    return {
      domain,
      url,
      verdict: "egress_blocked",
      httpStatus: result.status,
      elapsedMs: result.elapsedMs,
      detail: "this machine's own network refused the connection — the site was never contacted",
    };
  }
  if (result.error === "timeout") {
    return { domain, url, verdict: "timeout", httpStatus: null, elapsedMs: result.elapsedMs, detail: "no response in time" };
  }
  if (result.status === 0) {
    return {
      domain,
      url,
      verdict: "error",
      httpStatus: null,
      elapsedMs: result.elapsedMs,
      // A proxy that rejects CONNECT cannot send an HTTP response, so the failure arrives as a
      // bare transport error. Named here so it is not mistaken for the site being down.
      detail: `no HTTP response: ${result.error ?? "unknown"} (a proxy refusing CONNECT looks like this)`,
    };
  }
  if (result.status === 403 || result.status === 401 || result.status === 429) {
    return {
      domain,
      url,
      verdict: "origin_refused",
      httpStatus: result.status,
      elapsedMs: result.elapsedMs,
      detail:
        result.status === 429
          ? "the site answered and asked us to slow down"
          : "the site itself refused the request (anti-bot, geoblock, or user-agent policy)",
    };
  }

  // 404 is a perfectly good answer: the request got out, and the site simply has no robots.txt.
  if (!result.ok && result.status !== 404) {
    return {
      domain,
      url,
      verdict: "origin_refused",
      httpStatus: result.status,
      elapsedMs: result.elapsedMs,
      detail: `the site answered with HTTP ${result.status}`,
    };
  }

  const policy = result.status === 404 || !result.body.trim() ? null : parseRobotsTxt(result.body);
  const crawlingAllowed = policy ? !policy.blanketDisallow && isPathAllowed(policy, `${scheme}://${host}/events`) : true;

  return {
    domain,
    url,
    verdict: crawlingAllowed ? "reachable" : "robots_disallowed",
    httpStatus: result.status,
    elapsedMs: result.elapsedMs,
    detail: crawlingAllowed
      ? policy
        ? `reached the site; robots.txt allows this crawler${policy.crawlDelayMs ? `, asking for ${policy.crawlDelayMs / 1000}s between requests` : ""}`
        : "reached the site; it publishes no robots.txt, so no restrictions are stated"
      : "reached the site; its robots.txt asks this crawler to stay out, so it will be skipped",
    robots: {
      hasRobotsTxt: !!policy,
      crawlingAllowed,
      crawlDelayMs: policy?.crawlDelayMs ?? null,
      declaredSitemaps: policy?.sitemaps.length ?? 0,
    },
  };
}

export interface PreflightOptions {
  domains?: string[];
  /** Skip the provider checks. Each one spends a single unit of that provider's quota. */
  skipProviders?: boolean;
  /** Use the registry's enabled domains instead of the built-in list. */
  fromRegistry?: boolean;
  scheme?: "http" | "https";
}

export async function runPreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
  let domains = options.domains?.length ? options.domains : DEFAULT_PREFLIGHT_DOMAINS;
  if (options.fromRegistry && !options.domains?.length) {
    const rows = await listDomains({ enabledOnly: true });
    if (rows.length > 0) domains = rows.map((row) => row.domain);
  }
  domains = domains.slice(0, 25);

  const probes: PreflightProbe[] = [];
  for (const domain of domains) {
    probes.push(await probe(domain, options.scheme || "https"));
  }

  const providers = options.skipProviders ? [] : await checkAllProviders();

  const counts = probes.reduce(
    (acc, item) => {
      acc[item.verdict] += 1;
      return acc;
    },
    {
      reachable: 0, egress_blocked: 0, dns_failure: 0,
      origin_refused: 0, robots_disallowed: 0, timeout: 0, error: 0,
    } as Record<PreflightVerdict, number>
  );

  // A site answering "no" still proves the network works, so it counts towards reachability.
  const gotOut = counts.reachable + counts.robots_disallowed + counts.origin_refused;
  const outboundHttps: PreflightReport["outboundHttps"] =
    gotOut === 0 ? "blocked" : gotOut === probes.length ? "working" : "partial";

  const httpsProxyConfigured = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
  const nodeWillUseProxy = process.env.NODE_USE_ENV_PROXY === "1";

  return {
    ranAt: new Date().toISOString(),
    userAgent: DISCOVERY_USER_AGENT,
    proxy: {
      httpsProxyConfigured,
      nodeWillUseProxy,
      note:
        httpsProxyConfigured && !nodeWillUseProxy
          ? "HTTPS_PROXY is set, but Node's built-in fetch ignores it unless NODE_USE_ENV_PROXY=1 (Node >= 22.21). These probes therefore went direct; if your network requires the proxy they will fail even though the proxy would have worked."
          : null,
    },
    probes,
    providers,
    counts,
    outboundHttps,
    verdictSummary:
      outboundHttps === "working"
        ? `Outbound HTTPS works: all ${probes.length} domains were contacted. ${counts.reachable} are crawlable, ${counts.robots_disallowed} ask crawlers to stay out, ${counts.origin_refused} refused the request themselves.`
        : outboundHttps === "blocked"
          ? `Outbound HTTPS is blocked: not one of the ${probes.length} domains could be contacted from this machine. No discovery run can do useful work here.`
          : `Outbound HTTPS is partly available: ${gotOut} of ${probes.length} domains were contacted, ${counts.egress_blocked + counts.dns_failure + counts.timeout + counts.error} could not be.`,
    recommendation:
      outboundHttps === "blocked"
        ? counts.egress_blocked > 0
          ? "This machine's network is refusing outbound requests by host allowlist. Add the conference domains to the environment's egress rules, or run the discovery worker somewhere outbound HTTPS is permitted. Nothing in the engine needs changing."
          : counts.dns_failure === probes.length
            ? "No DNS resolution from this machine. Check the resolver configuration or the container's network."
            : "No HTTP response reached this machine. If a proxy is configured, check it allows CONNECT to these hosts; a proxy that rejects CONNECT produces exactly this pattern."
        : outboundHttps === "partial"
          ? "Some hosts are reachable and some are not. Check the unreachable ones against the environment's egress rules before reading their failures as the sites' own."
          : "Outbound HTTPS is working. A Phase 1 discovery run can proceed against these domains.",
  };
}

export function formatPreflightReport(report: PreflightReport): string {
  const lines: string[] = [];
  const icon: Record<PreflightVerdict, string> = {
    reachable: "ok  ", egress_blocked: "BLOCK", dns_failure: "DNS ",
    origin_refused: "site", robots_disallowed: "robot", timeout: "slow", error: "err ",
  };

  lines.push("CONFERENCE GATE — DISCOVERY PREFLIGHT");
  lines.push(`Ran ${report.ranAt}`);
  lines.push(`User-Agent: ${report.userAgent}`);
  if (report.proxy.note) {
    lines.push("");
    lines.push(`NOTE: ${report.proxy.note}`);
  }
  lines.push("");
  for (const item of report.probes) {
    lines.push(
      `  ${icon[item.verdict]}  ${item.domain.padEnd(20)} ${String(item.httpStatus ?? "—").padStart(4)}  ${String(item.elapsedMs).padStart(6)}ms  ${item.detail}`
    );
  }
  if (report.providers.length > 0) {
    lines.push("");
    lines.push("Providers");
    for (const check of report.providers) {
      lines.push(
        `  ${check.status.padEnd(22)} ${check.provider.padEnd(20)} ${
          check.credentialConfigured ? "key set   " : "no key    "
        } ${String(check.elapsedMs).padStart(6)}ms  ${check.detail}`
      );
    }
  }
  lines.push("");
  lines.push(`Outbound HTTPS: ${report.outboundHttps.toUpperCase()}`);
  lines.push(report.verdictSummary);
  lines.push("");
  lines.push(`Recommendation: ${report.recommendation}`);
  return lines.join("\n");
}
