import { braveSearch, isBraveConfigured, type LiveSearchResult } from "./braveSearch";
import { isSerperConfigured, serperSearch } from "./serperSearch";
import { jinaReadPage } from "./jinaReader";

export type RoleEvidenceConfidence = "verified" | "strong" | "possible" | "member_claimed";

export interface DeepProfessionalRoleEvidence {
  kind: "conference_role";
  title: string;
  organization?: string | null;
  conferenceTitle?: string | null;
  role?: string | null;
  year?: number | null;
  sourceUrl?: string | null;
  sourceType: string;
  confidence: RoleEvidenceConfidence;
  confidenceScore: number;
  evidenceReason: string;
  fingerprint?: string;
  payload?: any;
}

export interface ProfessionalRoleIdentity {
  userId: string;
  fullName: string;
  organization?: string | null;
  title?: string | null;
  email?: string | null;
}

const ROLE_QUERY_RESULT_LIMIT = 10;
const MAX_ROLE_PAGES_TO_READ = 24;
const MAX_CONTEXT_LENGTH = 1100;
const MAX_PAGE_TEXT = 180_000;

const ROLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bkeynote\s+(?:speaker|address|presentation)\b/i, label: "Keynote Speaker" },
  { pattern: /\bplenary\s+(?:speaker|lecture|presentation)\b/i, label: "Plenary Speaker" },
  { pattern: /\binvited\s+(?:speaker|lecture|presentation|talk)\b/i, label: "Invited Speaker" },
  { pattern: /\bguest\s+speaker\b/i, label: "Guest Speaker" },
  { pattern: /\b(?:session|technical session)\s+co[- ]?chair\b/i, label: "Session Co-Chair" },
  { pattern: /\bsession\s+chair(?:person)?\b/i, label: "Session Chair" },
  { pattern: /\btrack\s+chair\b/i, label: "Track Chair" },
  { pattern: /\bprogram(?:me)?\s+chair\b/i, label: "Program Chair" },
  { pattern: /\bconference\s+(?:co[- ]?)?chair\b/i, label: "Conference Chair" },
  { pattern: /\bsymposium\s+(?:co[- ]?)?chair\b/i, label: "Symposium Chair" },
  { pattern: /\bpanel\s+(?:co[- ]?)?chair\b/i, label: "Panel Chair" },
  { pattern: /\b(?:session\s+)?conven(?:e|o)r\b/i, label: "Session Convener" },
  { pattern: /\btechnical\s+(?:program(?:me)?\s+)?committee(?:\s+member)?\b/i, label: "Technical Committee Member" },
  { pattern: /\bscientific\s+committee(?:\s+member)?\b/i, label: "Scientific Committee Member" },
  { pattern: /\bprogram(?:me)?\s+committee(?:\s+member)?\b/i, label: "Program Committee Member" },
  { pattern: /\borganizing\s+committee(?:\s+member)?\b/i, label: "Organizing Committee Member" },
  { pattern: /\bsteering\s+committee(?:\s+member)?\b/i, label: "Steering Committee Member" },
  { pattern: /\badvisory\s+(?:board|committee)(?:\s+member)?\b/i, label: "Advisory Board Member" },
  { pattern: /\bmoderator\b/i, label: "Moderator" },
  { pattern: /\bpanelist\b/i, label: "Panelist" },
  { pattern: /\bworkshop\s+(?:instructor|leader|facilitator|trainer)\b/i, label: "Workshop Instructor" },
  { pattern: /\b(?:short\s+course|course|tutorial)\s+(?:instructor|leader|facilitator|trainer)\b/i, label: "Course Instructor" },
  { pattern: /\boral\s+presenter\b/i, label: "Oral Presenter" },
  { pattern: /\binvited\s+presenter\b/i, label: "Invited Presenter" },
  { pattern: /\b(?:conference|symposium|workshop|forum)\s+speaker\b/i, label: "Speaker" },
  { pattern: /\bspeaker\b/i, label: "Speaker" },
  { pattern: /\bpresenter\b/i, label: "Presenter" },
];

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonical(value: unknown): string {
  return normalize(value)
    .replace(/\b(the|a|an|of|and|for|in|on|to|with|at|by)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function host(url: unknown): string {
  try { return new URL(clean(url)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function isLowTrustHost(value: string): boolean {
  return /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|researchgate\.net|academia\.edu|zoominfo\.)$/i.test(value);
}

function looksAuthoritativeHost(value: string): boolean {
  if (!value || isLowTrustHost(value)) return false;
  return /\.(edu|ac\.[a-z]{2}|gov|gov\.[a-z]{2})$/i.test(value)
    || /(aapg|eage|spe\.org|seg\.org|ieee|acm\.org|agu\.org|geolsoc|geologicalsociety|onepetro|sciencedirect|springer|wiley|elsevier)/i.test(value);
}

function organizationMatches(organization: string | null | undefined, body: string): boolean {
  const org = normalize(organization);
  if (!org || org.length < 3) return false;
  const text = normalize(body);
  if (text.includes(org)) return true;
  const tokens = org.split(" ").filter((part) => part.length >= 4);
  if (!tokens.length) return false;
  return tokens.filter((part) => text.includes(part)).length >= Math.min(2, tokens.length);
}

function yearNumber(value: unknown): number | null {
  const years = clean(value).match(/\b(?:19|20)\d{2}\b/g) || [];
  if (!years.length) return null;
  const numbers = years.map(Number).filter((year) => year >= 1990 && year <= new Date().getFullYear() + 3);
  return numbers.length ? Math.max(...numbers) : null;
}

function roleFromText(text: string): string | null {
  for (const candidate of ROLE_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return null;
}

function nameVariants(fullName: string): string[] {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  const variants = new Set<string>();
  if (parts.length) variants.add(parts.join(" "));
  if (parts.length >= 2) variants.add(`${parts[0]} ${parts[parts.length - 1]}`);
  if (parts.length >= 3) variants.add(`${parts[0]} ${parts[1]} ${parts[parts.length - 1]}`);
  return [...variants].filter((value) => value.length >= 5);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextsAroundName(fullName: string, text: string): string[] {
  const body = text.slice(0, MAX_PAGE_TEXT);
  const contexts: string[] = [];
  for (const variant of nameVariants(fullName)) {
    const tokens = variant.split(/\s+/).map(escapeRegex);
    const pattern = new RegExp(tokens.join("[\\s,.;:()\\-–—]+").replace(/\\s\+/g, "\\s+"), "gi");
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = pattern.exec(body)) && guard < 8) {
      guard += 1;
      const start = Math.max(0, match.index - Math.floor(MAX_CONTEXT_LENGTH / 2));
      const end = Math.min(body.length, match.index + match[0].length + Math.floor(MAX_CONTEXT_LENGTH / 2));
      contexts.push(clean(body.slice(start, end)));
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    }
  }
  return [...new Set(contexts)].slice(0, 12);
}

function isRoleSpecificPage(result: LiveSearchResult, url: string): boolean {
  const text = `${clean(result.title)} ${url}`.toLowerCase();
  return /speaker|committee|program|programme|agenda|schedule|session|chair|panel|moderator|workshop|faculty|board|presenter/.test(text);
}

function sourceTypeFor(result: LiveSearchResult, url: string, role: string, authoritative: boolean): string {
  const text = `${clean(result.title)} ${url}`.toLowerCase();
  if (/\.pdf(?:$|[?#])/.test(url.toLowerCase()) || /\bpdf\b/.test(text)) return "conference_program_pdf";
  if (/committee|board/.test(text) || /committee/i.test(role)) return authoritative ? "official_committee_page" : "committee_page";
  if (/speaker|faculty|presenter/.test(text) || /speaker|presenter/i.test(role)) return authoritative ? "official_speaker_page" : "speaker_page";
  if (/program|programme|agenda|schedule|session/.test(text)) return authoritative ? "official_program_page" : "conference_program_page";
  return authoritative ? "official_role_page" : "public_role_page";
}

function conferenceTitleFrom(result: LiveSearchResult): string {
  let title = clean(result.title);
  title = title
    .replace(/\s*[|–—-]\s*(?:speakers?|committee|program(?:me)?|agenda|schedule|session|faculty|moderators?|panelists?).*$/i, "")
    .replace(/\s*\|\s*home\s*$/i, "")
    .trim();
  return title || clean(result.title);
}

async function publicSearch(query: string): Promise<LiveSearchResult[]> {
  if (isBraveConfigured()) {
    try { return await braveSearch(query, ROLE_QUERY_RESULT_LIMIT, "low"); } catch { /* fall through */ }
  }
  if (isSerperConfigured()) {
    try { return await serperSearch(query, ROLE_QUERY_RESULT_LIMIT); } catch { /* bounded public research is best effort */ }
  }
  return [];
}

function roleQueries(identity: ProfessionalRoleIdentity): string[] {
  const exact = `"${clean(identity.fullName).replace(/"/g, "")}"`;
  const org = identity.organization ? ` "${clean(identity.organization).replace(/"/g, "")}"` : "";
  return [
    `${exact}${org} "technical committee" OR "program committee" OR "scientific committee"`,
    `${exact}${org} "organizing committee" OR "steering committee" OR "advisory board"`,
    `${exact}${org} "session chair" OR "track chair" OR "program chair" OR moderator OR panelist`,
    `${exact}${org} "keynote speaker" OR "plenary speaker" OR "invited speaker" OR presenter`,
    `${exact}${org} "workshop instructor" OR "course instructor" OR facilitator OR trainer`,
    `${exact}${org} conference program agenda schedule filetype:pdf`,
    `${exact}${org} conference congress symposium workshop speaker committee program`,
    `${exact}${org} session program proceedings speaker chair`,
    `${exact} site:aapg.org speaker committee chair program`,
    `${exact} site:eage.org speaker committee chair program`,
    `${exact} site:spe.org speaker committee chair program`,
    `${exact} site:seg.org speaker committee chair program`,
  ];
}

function candidatePriority(result: LiveSearchResult): number {
  const url = clean(result.link);
  const h = host(url);
  const text = `${clean(result.title)} ${clean(result.snippet)} ${url}`;
  let score = 0;
  if (looksAuthoritativeHost(h)) score += 8;
  if (isRoleSpecificPage(result, url)) score += 6;
  if (/\.pdf(?:$|[?#])/i.test(url)) score += 5;
  if (roleFromText(text)) score += 4;
  if (/conference|congress|symposium|workshop|meeting|summit|forum/i.test(text)) score += 2;
  return score;
}

async function mapLimited<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return out;
}

function evidenceFromText(
  identity: ProfessionalRoleIdentity,
  result: LiveSearchResult,
  pageText: string,
): DeepProfessionalRoleEvidence[] {
  const sourceUrl = clean(result.link);
  const sourceHost = host(sourceUrl);
  if (!sourceUrl || !sourceHost || isLowTrustHost(sourceHost)) return [];

  const contexts = contextsAroundName(identity.fullName, pageText);
  if (!contexts.length) return [];

  const authoritative = looksAuthoritativeHost(sourceHost);
  const rolePage = isRoleSpecificPage(result, sourceUrl);
  const conferenceTitle = conferenceTitleFrom(result);
  const out: DeepProfessionalRoleEvidence[] = [];
  const seen = new Set<string>();

  for (const context of contexts) {
    const role = roleFromText(context);
    if (!role) continue;
    const organizationMatched = organizationMatches(identity.organization, context)
      || organizationMatches(identity.organization, pageText.slice(0, MAX_PAGE_TEXT));
    const year = yearNumber(context) || yearNumber(`${result.title} ${result.snippet}`);
    const sourceType = sourceTypeFor(result, sourceUrl, role, authoritative);
    const key = `${canonical(conferenceTitle)}|${normalize(role)}|${year || ""}|${sourceHost}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let confidence: RoleEvidenceConfidence = "possible";
    let confidenceScore = 68;
    let evidenceReason = "Exact-name role context found on a public page; retained as possible until stronger identity evidence is available.";

    if (organizationMatched && (authoritative || rolePage)) {
      confidence = "verified";
      confidenceScore = authoritative ? 96 : 93;
      evidenceReason = authoritative
        ? "Official/authoritative conference evidence places the member's exact name beside this role and matches the stored organization."
        : "A role-specific conference page places the member's exact name beside this role and matches the stored organization.";
    } else if (authoritative || rolePage) {
      confidence = "strong";
      confidenceScore = authoritative ? 89 : 86;
      evidenceReason = authoritative
        ? "Authoritative conference evidence places the member's exact name beside this role; organization corroboration is still missing."
        : "A role-specific conference page places the member's exact name beside this role; organization corroboration is still missing.";
    } else if (organizationMatched) {
      confidence = "strong";
      confidenceScore = 84;
      evidenceReason = "Public conference evidence places the member's exact name beside this role and matches the stored organization.";
    }

    out.push({
      kind: "conference_role",
      title: `${conferenceTitle || clean(result.title)} — ${role}`,
      organization: organizationMatched ? identity.organization || null : null,
      conferenceTitle: conferenceTitle || clean(result.title) || null,
      role,
      year,
      sourceUrl,
      sourceType,
      confidence,
      confidenceScore,
      evidenceReason,
      fingerprint: ["conference_role", canonical(conferenceTitle || result.title), normalize(role), year || ""].join("|").slice(0, 500),
      payload: {
        host: sourceHost,
        snippet: clean(result.snippet),
        evidenceContext: context.slice(0, 900),
        organizationMatched,
        authoritative,
        roleSpecificPage: rolePage,
        deepRoleResearch: true,
      },
    });
  }
  return out;
}

export async function deepProfessionalRoleEvidence(identity: ProfessionalRoleIdentity): Promise<DeepProfessionalRoleEvidence[]> {
  if (!clean(identity.fullName) || (!isBraveConfigured() && !isSerperConfigured())) return [];

  const groups = await Promise.all(roleQueries(identity).map((query) => publicSearch(query)));
  const unique = new Map<string, LiveSearchResult>();
  for (const result of groups.flat()) {
    const url = clean(result.link);
    const sourceHost = host(url);
    if (!url || !sourceHost || isLowTrustHost(sourceHost)) continue;
    if (!unique.has(url)) unique.set(url, result);
  }

  const candidates = [...unique.values()]
    .sort((a, b) => candidatePriority(b) - candidatePriority(a))
    .slice(0, MAX_ROLE_PAGES_TO_READ);

  const nested = await mapLimited(candidates, 4, async (result) => {
    const searchText = `${clean(result.title)} ${clean(result.snippet)}`;
    const searchEvidence = evidenceFromText(identity, result, searchText);

    // A full rendered/clean page is substantially stronger than a search snippet and also exposes
    // committee lists, agenda tables and program PDFs that search snippets commonly omit.
    const page = await jinaReadPage(clean(result.link)).catch(() => null);
    if (!page) return searchEvidence;
    const pageEvidence = evidenceFromText(identity, result, page);
    return pageEvidence.length ? pageEvidence : searchEvidence;
  });

  const best = new Map<string, DeepProfessionalRoleEvidence>();
  for (const item of nested.flat()) {
    const key = item.fingerprint || `${canonical(item.conferenceTitle)}|${normalize(item.role)}|${item.year || ""}`;
    const current = best.get(key);
    if (!current || item.confidenceScore > current.confidenceScore) best.set(key, item);
  }
  return [...best.values()]
    .sort((a, b) => b.confidenceScore - a.confidenceScore || (b.year || 0) - (a.year || 0))
    .slice(0, 80);
}
