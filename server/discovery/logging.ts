// Structured logging for discovery runs.
//
// Two consumers, one call site: a line on stdout for whoever is watching the process, and a
// counted event on the run so `/api/admin/discovery/status` and the quality report can answer
// "how many URLs were rejected by robots.txt" without anyone having to grep logs.
//
// Nothing here ever logs a secret: values are whitelisted per event rather than spread from an
// arbitrary object, and the one free-form field (`detail`) is passed through a redactor.

export type DiscoveryEventName =
  | "run_started"
  | "run_finished"
  | "domain_started"
  | "domain_finished"
  | "domain_skipped"
  | "robots_fetched"
  | "robots_disallowed"
  | "sitemap_fetched"
  | "sitemap_missing"
  | "urls_discovered"
  | "url_skipped"
  | "url_unchanged"
  | "page_fetched"
  | "page_failed"
  | "page_timeout"
  | "extraction_structured"
  | "extraction_html"
  | "extraction_ai"
  | "extraction_empty"
  | "event_detected"
  | "event_rejected"
  | "event_created"
  | "event_updated"
  | "event_unchanged"
  | "duplicate_detected"
  | "review_queued"
  | "error";

export interface DiscoveryLogEntry {
  ts: string;
  runId: string;
  event: DiscoveryEventName;
  domain?: string;
  url?: string;
  detail?: string;
  count?: number;
  confidence?: number;
  method?: string;
}

const SECRET_RE = /\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*\S+/gi;

function redact(value: string): string {
  return value.replace(SECRET_RE, (match) => `${match.split(/[:=]/)[0]}=[redacted]`);
}

export class RunLogger {
  readonly entries: DiscoveryLogEntry[] = [];
  readonly counts = new Map<DiscoveryEventName, number>();
  private readonly maxEntries: number;

  constructor(
    readonly runId: string,
    options: { quiet?: boolean; maxEntries?: number } = {}
  ) {
    this.quiet = options.quiet ?? false;
    this.maxEntries = options.maxEntries ?? 5000;
  }

  private quiet: boolean;

  log(event: DiscoveryEventName, fields: Omit<DiscoveryLogEntry, "ts" | "runId" | "event"> = {}): void {
    const entry: DiscoveryLogEntry = {
      ts: new Date().toISOString(),
      runId: this.runId,
      event,
      ...fields,
      detail: fields.detail ? redact(String(fields.detail)).slice(0, 500) : undefined,
    };
    this.counts.set(event, (this.counts.get(event) || 0) + (fields.count ?? 1));
    // Bounded so a million-URL run cannot grow the log array without limit; the counters, which
    // are what the metrics actually read, keep counting regardless.
    if (this.entries.length < this.maxEntries) this.entries.push(entry);
    if (!this.quiet) {
      const parts = [`[discovery:${this.runId}]`, event];
      if (entry.domain) parts.push(entry.domain);
      if (entry.url) parts.push(entry.url);
      if (entry.count !== undefined) parts.push(`n=${entry.count}`);
      if (entry.method) parts.push(`method=${entry.method}`);
      if (entry.confidence !== undefined) parts.push(`conf=${entry.confidence.toFixed(2)}`);
      if (entry.detail) parts.push(`— ${entry.detail}`);
      console.log(parts.join(" "));
    }
  }

  count(event: DiscoveryEventName): number {
    return this.counts.get(event) || 0;
  }

  summary(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
