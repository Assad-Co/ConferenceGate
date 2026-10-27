import type {
  LiveSearchResult,
  ExtractedConferenceDetails,
} from "../api/search";
import type { UserProfile, ProfessionalOpportunity } from "../types";
import { regionForCountry } from "../../server/discovery/countries";

export const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function safeLink(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function isoDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === text
    ? text
    : null;
}
export const today = () => new Date().toISOString().slice(0, 10);
export const daysUntil = (date: string, now = today()) =>
  Math.round((Date.parse(date) - Date.parse(now)) / 86400000);
export const conferenceKey = (r: LiveSearchResult) =>
  JSON.stringify([r.link, r.title, r.startDate || ""]);
const concepts = [
  ["artificial intelligence", "ai", "machine learning", "deep learning"],
  ["cybersecurity", "cyber security", "information security"],
  ["oil and gas", "petroleum", "hydrocarbon"],
  ["healthcare", "health care", "medicine", "medical"],
  ["sustainability", "sustainable", "decarbonization", "net zero"],
  ["data science", "data analytics"],
];
function terms(text: string) {
  const n = normalize(text);
  const found = new Set(
    n
      .split(" ")
      .filter(
        (t) =>
          t.length > 2 &&
          ![
            "and",
            "the",
            "for",
            "with",
            "conference",
            "international",
          ].includes(t),
      ),
  );
  for (const [index, group] of concepts.entries())
    if (group.some((s) => ` ${n} `.includes(` ${s} `)))
      found.add(`concept${index}`);
  return found;
}
export function topicMatches(text: string, interests: string[]) {
  const target = terms(text);
  return [...new Set(interests.map((s) => s.trim()).filter(Boolean))].filter(
    (interest) => [...terms(interest)].some((t) => target.has(t)),
  );
}
export function matchesQuery(text: string, query: string) {
  const normalized = normalize(text);
  return (query.match(/-?"[^"]+"|\S+/g) || []).every((token) => {
    const negative = token.startsWith("-"),
      phrase = negative ? token.slice(1) : token;
    const value = phrase.replace(/^"|"$/g, "");
    const match = phrase.startsWith('"')
      ? ` ${normalized} `.includes(` ${normalize(value)} `)
      : topicMatches(normalized, [value]).length > 0;
    return negative ? !match : match;
  });
}
export function matchConference(
  result: LiveSearchResult,
  profile: Pick<
    UserProfile,
    "expertise" | "researchInterests" | "keywords" | "preferredRegions"
  >,
) {
  const subject = [
    result.title,
    result.description,
    result.category,
    ...(result.categories || []),
  ].join(" ");
  const expertise = topicMatches(subject, profile.expertise || []);
  const research = topicMatches(subject, [
    ...(profile.researchInterests || []),
    ...(profile.keywords || []),
  ]);
  const region = (profile.preferredRegions || []).some(
    (r) =>
      normalize(r) === normalize(result.location?.country) ||
      normalize(r) ===
        normalize(regionForCountry(result.location?.country || null)),
  );
  const reasons = [
    ...expertise.map((t) => `Expertise: ${t}`),
    ...research.map((t) => `Interest: ${t}`),
    ...(region ? [`Preferred location: ${result.location?.country}`] : []),
  ];
  const denominator = Math.max(
    1,
    (profile.expertise?.length || 0) +
      (profile.researchInterests?.length || 0) +
      (profile.keywords?.length || 0),
  );
  const topicWeight = profile.preferredRegions?.length ? 90 : 100;
  return {
    score: Math.min(
      100,
      Math.round(
        ((expertise.length + research.length) / denominator) * topicWeight,
      ) + (region ? 10 : 0),
    ),
    reasons,
  };
}
export function cfpIntelligence(
  result: LiveSearchResult,
  detail?: ExtractedConferenceDetails | null,
  now = today(),
) {
  const raw = detail?.cfpDeadline;
  const deadline = isoDate(raw);
  const conflict = (detail?.conflicts || []).some((c) =>
    /cfp|deadline|submission/i.test(c.field),
  );
  const status = String(
    detail?.cfpStatus || result.cfpStatus || "",
  ).toLowerCase();
  const invalid = Boolean(raw && !deadline);
  const afterEvent = Boolean(
    deadline && isoDate(result.startDate) && deadline > result.startDate!,
  );
  const state =
    conflict || invalid || afterEvent
      ? "Needs confirmation"
      : /closed/.test(status)
        ? "Closed"
        : deadline && deadline < now
          ? "Deadline passed"
          : deadline
            ? "Upcoming deadline"
            : result.cfpOpen
              ? "Reported open — deadline unknown"
              : "Not confirmed";
  return {
    state,
    deadline: conflict || afterEvent ? null : deadline,
    raw,
    days: deadline ? daysUntil(deadline, now) : null,
    issues: [
      ...(conflict
        ? ["Conflicting submission information in stored sources"]
        : []),
      ...(invalid
        ? [
            "Deadline is not an unambiguous valid ISO date; confirm on the source",
          ]
        : []),
      ...(afterEvent
        ? ["Submission deadline follows the conference start"]
        : []),
    ],
    requirements: detail?.submissionRequirements || null,
    topics: detail?.cfpTopics || [],
    submissionUrl: safeLink(detail?.submissionUrl),
    templateUrl: safeLink(detail?.submissionTemplateUrl),
    length: detail?.cfpLengthLimit || null,
    review: detail?.cfpReviewProcess || null,
  };
}
export function evidenceAssessment(
  result: Pick<
    LiveSearchResult,
    | "title"
    | "link"
    | "organization"
    | "startDate"
    | "endDate"
    | "location"
    | "description"
  > &
    Partial<LiveSearchResult>,
  detail?: ExtractedConferenceDetails | null,
) {
  const fields = [
    ["Title", !!result.title?.trim()],
    ["Organizer", !!result.organization?.trim()],
    ["Event website", !!safeLink(result.link)],
    ["Start date", !!isoDate(result.startDate)],
    ["Country", !!result.location?.country],
    ["Description", !!result.description?.trim()],
    ["Submission requirements", !!detail?.submissionRequirements],
    ["Named speakers", !!detail?.speakers?.length],
    ["Contact", !!(detail?.contactEmail || detail?.contactPhone)],
    ["Source provenance", !!Object.keys(detail?.provenance || {}).length],
  ] as const;
  const flags: string[] = [];
  const link = safeLink(result.link);
  if (!link) flags.push("Missing or unsafe event link");
  else {
    const url = new URL(link);
    if (url.protocol !== "https:") flags.push("Event link does not use HTTPS");
    if (url.hostname.startsWith("xn--") || url.hostname.includes(".xn--"))
      flags.push(
        "Internationalized hostname: inspect the spelling before sharing information",
      );
  }
  if (!result.organization?.trim())
    flags.push("Organizer identity is not recorded");
  if (result.startDate && !isoDate(result.startDate))
    flags.push("Invalid event start date");
  if (
    isoDate(result.endDate) &&
    isoDate(result.startDate) &&
    result.endDate! < result.startDate!
  )
    flags.push("End date precedes start date");
  if (detail?.sourcedFromOpenWeb || detail?.officialSiteUnreadable)
    flags.push(
      "Some information could not be confirmed from the event website",
    );
  if (detail?.conflicts?.length)
    flags.push(`${detail.conflicts.length} source conflict(s) require review`);
  flags.push(
    ...cfpIntelligence(
      {
        snippet: "",
        displayLink: "",
        thumbnail: null,
        favicon: null,
        ...result,
      },
      detail,
    ).issues,
  );
  return {
    score: Math.round(
      (fields.filter(([, present]) => present).length / fields.length) * 100,
    ),
    fields,
    flags,
    label: "Information readiness",
    independentlyVerified: false as const,
  };
}
export function matchOpportunity(
  o: ProfessionalOpportunity,
  profile: UserProfile,
  now = today(),
) {
  const eligible =
    o.status === "active" &&
    (!o.deadline || Boolean(isoDate(o.deadline) && o.deadline >= now));
  const relevant = topicMatches(
    [o.title, o.description, ...o.expertiseRequired].join(" "),
    [...profile.expertise, ...profile.researchInterests],
  );
  const available =
    o.roleType === "committee"
      ? profile.committeeAvailable
      : o.roleType === "chair"
        ? profile.sessionChairAvailable
        : profile.speakerAvailable;
  return {
    eligible,
    score: Math.min(100, relevant.length * 25 + (available ? 15 : 0)),
    reasons: [
      ...relevant,
      ...(available ? [`Available for ${o.roleType} roles`] : []),
    ],
  };
}
export type PlanStatus =
  | "considering"
  | "preparing"
  | "submitted"
  | "registered"
  | "attended";
export interface Plan {
  id: string;
  result: LiveSearchResult;
  status: PlanStatus;
  deadline: string | null;
  deadlineConfirmed: boolean;
  notes: string;
  tasks: Array<{ id: string; text: string; done: boolean }>;
}
export interface AlertRule {
  id: string;
  name: string;
  query: string;
  country: string;
  from?: string;
  to?: string;
  cfpOnly: boolean;
  enabled: boolean;
  seen: Record<string, string>;
}
export interface AlertItem {
  id: string;
  ruleId: string;
  title: string;
  result: LiveSearchResult;
  read: boolean;
  createdAt: string;
}
export interface IntelligenceState {
  version: 1;
  plans: Plan[];
  rules: AlertRule[];
  alerts: AlertItem[];
}
export const emptyState = (): IntelligenceState => ({
  version: 1,
  plans: [],
  rules: [],
  alerts: [],
});
export function ruleMatches(rule: AlertRule, r: LiveSearchResult) {
  const subject = [
    r.title,
    r.description,
    r.category,
    ...(r.categories || []),
  ].join(" ");
  return (
    matchesQuery(subject, rule.query) &&
    (!rule.country ||
      normalize(rule.country) === normalize(r.location?.country)) &&
    (!(rule.from || rule.to) || !!isoDate(r.startDate)) &&
    (!rule.from || r.startDate! >= rule.from) &&
    (!rule.to || r.startDate! <= rule.to) &&
    (!rule.cfpOnly || r.cfpOpen === true) &&
    (!isoDate(r.endDate || r.startDate) ||
      (r.endDate || r.startDate)! >= today())
  );
}
export const fingerprint = (r: LiveSearchResult) =>
  JSON.stringify([
    r.title,
    r.startDate,
    r.endDate,
    r.cfpOpen,
    r.cfpStatus,
    r.location,
    r.sections,
  ]);
export function evaluateAlerts(
  state: IntelligenceState,
  results: LiveSearchResult[],
  now = new Date().toISOString(),
): IntelligenceState {
  const additions: AlertItem[] = [];
  const rules = state.rules.map((rule) => {
    if (!rule.enabled) return rule;
    const seen = { ...rule.seen };
    for (const result of results.filter((r) => ruleMatches(rule, r))) {
      const key = conferenceKey(result),
        fp = fingerprint(result);
      if (seen[key] !== fp)
        additions.push({
          id: JSON.stringify([rule.id, key, fp]),
          ruleId: rule.id,
          title: `${seen[key] ? "Updated" : "New"} match for ${rule.name}`,
          result,
          read: false,
          createdAt: now,
        });
      seen[key] = fp;
    }
    return { ...rule, seen };
  });
  const previous = new Set(state.alerts.map((a) => a.id));
  return {
    ...state,
    rules,
    alerts: [
      ...additions.filter((a) => !previous.has(a.id)),
      ...state.alerts,
    ].slice(0, 100),
  };
}
export function parseState(raw: string | null): IntelligenceState {
  if (!raw) return emptyState();
  const s = JSON.parse(raw);
  if (
    s?.version !== 1 ||
    !Array.isArray(s.plans) ||
    !Array.isArray(s.rules) ||
    !Array.isArray(s.alerts)
  )
    throw new Error("Unsupported planning data");
  const resultValid = (r: any) =>
    r &&
    typeof r.title === "string" &&
    r.title.length <= 2000 &&
    !!safeLink(r.link);
  const plans = s.plans
    .slice(0, 100)
    .filter(
      (p: any) =>
        typeof p.id === "string" &&
        resultValid(p.result) &&
        [
          "considering",
          "preparing",
          "submitted",
          "registered",
          "attended",
        ].includes(p.status) &&
        Array.isArray(p.tasks) &&
        typeof p.notes === "string",
    )
    .map((p: Plan) => ({
      ...p,
      notes: p.notes.slice(0, 4000),
      deadline: isoDate(p.deadline),
      deadlineConfirmed: p.deadlineConfirmed === true,
      tasks: p.tasks
        .filter((t) => typeof t.id === "string" && typeof t.text === "string")
        .slice(0, 30)
        .map((t) => ({
          ...t,
          text: t.text.slice(0, 200),
          done: t.done === true,
        })),
    }));
  const rules = s.rules
    .slice(0, 20)
    .filter(
      (r: any) =>
        ["id", "name", "query", "country"].every(
          (k) => typeof r[k] === "string",
        ) &&
        r.seen &&
        typeof r.seen === "object" &&
        !Array.isArray(r.seen),
    )
    .map((r: AlertRule) => ({
      ...r,
      enabled: r.enabled === true,
      cfpOnly: r.cfpOnly === true,
      seen: Object.fromEntries(
        Object.entries(r.seen)
          .filter(([, v]) => typeof v === "string")
          .slice(-10000),
      ),
    }));
  const alerts = s.alerts
    .slice(0, 100)
    .filter(
      (a: any) =>
        ["id", "ruleId", "title", "createdAt"].every(
          (k) => typeof a[k] === "string",
        ) && resultValid(a.result),
    )
    .map((a: AlertItem) => ({ ...a, read: a.read === true }));
  return { version: 1, plans, rules, alerts };
}
function icsText(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
export function planCalendar(plan: Plan, now = new Date()) {
  const start = isoDate(plan.result.startDate);
  if (!start) return null;
  const end = isoDate(plan.result.endDate) || start;
  if (end < start) return null;
  const exclusive = new Date(`${end}T00:00:00Z`);
  exclusive.setUTCDate(exclusive.getUTCDate() + 1);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ConferenceGate//Planning//EN",
    "BEGIN:VEVENT",
    `UID:${encodeURIComponent(plan.id)}@conferencegate.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${exclusive.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${icsText(plan.result.title)}`,
    `URL:${safeLink(plan.result.link) || ""}`,
    `DESCRIPTION:${icsText("Personal planning entry. Confirm all details with the organizer.")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return (
    lines
      .map((line) => {
        let chunks: string[] = [],
          chunk = "";
        for (const ch of line) {
          if (new TextEncoder().encode(chunk + ch).length > 73) {
            chunks.push(chunk);
            chunk = " ";
          }
          chunk += ch;
        }
        chunks.push(chunk);
        return chunks.join("\r\n");
      })
      .join("\r\n") + "\r\n"
  );
}
