import crypto from "node:crypto";

type RecordValue = Record<string, any>;
const obj = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const str = (value: unknown): string => {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  const item = obj(value);
  return ["text", "name", "title", "value"].map(key => typeof item[key] === "string" ? item[key].trim() : "").find(Boolean) || "";
};
const items = (value: unknown, depth = 0): any[] => {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap(item => Array.isArray(item) ? items(item, depth + 1) : [item]).slice(0, 5000);
  const record = obj(value);
  for (const key of ["items", "elements", "values", "results"]) if (Array.isArray(record[key])) return items(record[key], depth + 1);
  if (Object.keys(record).some(key => ["title", "name", "position", "role", "companyName", "company", "schoolName", "degree"].includes(key))) return [record];
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
};
const pathValue = (record: RecordValue, path: string): unknown => path.split(".").reduce((value: any, key) => obj(value)[key], record);
function dateValue(value: unknown): unknown {
  if (typeof value === "string") return { text: value };
  const date = obj(value);
  if (!Object.keys(date).length) return value;
  return { ...date, text: str(date.text) || [date.month, date.year].filter(Boolean).join(" ") };
}
function profileUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://www.linkedin.com/in/" + raw.replace(/^@|\/$/g, ""));
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const slug = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1];
    return slug ? "https://www.linkedin.com/in/" + slug : null;
  } catch { return null; }
}
function unwrap(payload: unknown): RecordValue {
  let record = obj(payload);
  for (let depth = 0; depth < 4; depth++) {
    const nested = ["profile", "data", "result"].map(key => obj(record[key])).find(item => Object.keys(item).length && ["experience", "positions", "firstName", "fullName", "name", "headline", "publicIdentifier", "profile"].some(key => key in item));
    if (!nested) break;
    record = nested;
  }
  return record;
}
function normalizeItem(value: any, section: string, parent: RecordValue = {}): any {
  if (typeof value === "string") return section === "skills" || section === "languages" ? value : { title: value };
  const item = obj(value);
  const organization = str(item.companyName) || str(item.company) || str(item.organization) || str(item.institution) || str(parent.companyName) || str(parent.company) || str(parent.organization);
  const title = str(item.position) || str(item.title) || str(item.role) || str(item.name);
  return {
    ...item,
    ...(title ? { title, ...(section === "experience" ? { position: title } : {}) } : {}),
    ...(organization ? { companyName: organization } : {}),
    ...(section === "education" ? { schoolName: str(item.schoolName) || str(item.school) || str(item.institution), degree: str(item.degree) || str(item.degreeName), fieldOfStudy: str(item.fieldOfStudy) || str(item.field) } : {}),
    description: str(item.description) || str(item.summary) || str(item.details),
    startDate: dateValue(item.startDate || item.dateRange?.start || item.timePeriod?.startDate || item.startsAt),
    endDate: item.isCurrent === true || item.current === true ? { text: "Present" } : dateValue(item.endDate || item.dateRange?.end || item.timePeriod?.endDate || item.endsAt),
    ...(section === "publications" ? { publisher: str(item.publisher) || str(item.publication), date: str(item.date) || str(dateValue(item.publishedOn)) || str(dateValue(item.publishedAt)) } : {}),
    ...(section === "certifications" ? { issuer: str(item.issuer) || str(item.authority), credentialId: str(item.credentialId) || str(item.licenseNumber) } : {}),
  };
}
function collectSection(record: RecordValue, paths: string[], section: string): any[] {
  const values: any[] = [];
  for (const path of paths) {
    for (const item of items(pathValue(record, path))) {
      const nested = section === "experience" ? ["positions", "roles", "positionsGrouped", "experiences"].flatMap(key => items(item?.[key])) : [];
      if (nested.length) for (const position of nested) values.push(normalizeItem(position, section, obj(item)));
      else values.push(normalizeItem(item, section));
    }
  }
  return uniqueItems(values);
}
function uniqueItems(values: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of values) {
    if (!item || (typeof item === "object" && !Object.values(item).some(Boolean))) continue;
    const r = obj(item);
    const key = typeof item === "string" ? item.toLowerCase() : [str(r.position || r.title || r.name), str(r.companyName || r.schoolName || r.issuer || r.publisher), str(r.startDate), str(r.endDate), str(r.date), str(r.degree), str(r.fieldOfStudy), str(r.patentNumber || r.credentialId || r.doi)].join("|").toLowerCase();
    if (!key.replace(/\|/g, "")) continue;
    const old = map.get(key);
    map.set(key, old && JSON.stringify(old).length > JSON.stringify(item).length ? old : item);
  }
  return [...map.values()];
}
const SECTIONS: Record<string, string[]> = {
  experience: ["experience", "experiences", "positions", "currentPosition", "currentPositions", "pastPositions", "workExperience", "workHistory"],
  education: ["education", "educations", "schools"],
  publications: ["publications", "accomplishments.publications"],
  patents: ["patents", "accomplishments.patents"],
  certifications: ["certifications", "licensesAndCertifications", "licenses", "accomplishments.certifications"],
  projects: ["projects", "accomplishments.projects"],
  skills: ["skills", "skillDetails"],
  honorsAndAwards: ["honorsAndAwards", "honors", "awards", "accomplishments.honors"],
  languages: ["languages", "accomplishments.languages"],
  volunteering: ["volunteering", "volunteerExperience", "volunteerExperiences", "volunteer", "volunteerWork"],
};
export function normalizeLinkedInProfilePayload(payload: unknown, previous?: unknown, requestedUrl?: string): RecordValue {
  const record = unwrap(payload);
  const sections: RecordValue = {};
  for (const [section, paths] of Object.entries(SECTIONS)) sections[section] = collectSection(record, paths, section);
  const fullName = str(record.fullName) || str(record.name) || [str(record.firstName), str(record.lastName)].filter(Boolean).join(" ");
  const headline = str(record.headline) || str(record.tagline) || str(record.currentTitle);
  const about = str(record.about) || str(record.summary) || str(record.description);
  if (!fullName && !headline && !about && !Object.values(sections).some(value => value.length)) return {};
  const linkedinUrl = profileUrl(record.linkedinUrl || record.profileUrl || record.url) || profileUrl(record.publicIdentifier || record.username) || profileUrl(requestedUrl);
  const old = previous ? normalizeLinkedInProfilePayload(previous) : {};
  const sameProfile = Boolean(linkedinUrl && old.linkedinUrl && linkedinUrl.toLowerCase() === old.linkedinUrl.toLowerCase());
  if (sameProfile) for (const section of Object.keys(SECTIONS)) sections[section] = uniqueItems([...(old[section] || []), ...sections[section]]);
  sections.experience.sort((a: any, b: any) => {
    const score = (item: any) => /present|current/i.test(str(item.endDate)) ? 2 : str(item.endDate) ? 0 : 1;
    return score(b) - score(a) || (Number(str(b.startDate).match(/(?:19|20)\d{2}/)?.[0]) || 0) - (Number(str(a.startDate).match(/(?:19|20)\d{2}/)?.[0]) || 0);
  });
  const location = obj(record.location);
  return {
    ...(sameProfile ? old : {}),
    ...record, ...sections,
    // Canonical aliases keep legacy career mergers from re-adding grouped provider shells.
    positions: sections.experience,
    currentPosition: sections.experience.filter((item: any) => !str(item.endDate) || /present|current/i.test(str(item.endDate))),
    currentPositions: sections.experience.filter((item: any) => !str(item.endDate) || /present|current/i.test(str(item.endDate))),
    pastPositions: sections.experience.filter((item: any) => str(item.endDate) && !/present|current/i.test(str(item.endDate))),
    linkedinUrl,
    publicIdentifier: str(record.publicIdentifier) || linkedinUrl?.split("/in/")[1] || null,
    fullName: fullName || (sameProfile ? old.fullName : null),
    headline: headline || (sameProfile ? old.headline : null),
    about: about || (sameProfile ? old.about : null),
    location: typeof record.location === "string" ? record.location : {
      ...location,
      linkedinText: str(location.linkedinText) || str(location.name) || str(location.full) || str(record.locationName),
      parsed: { ...obj(location.parsed), city: str(location.parsed?.city) || str(location.city) || str(record.city), country: str(location.parsed?.country) || str(location.country) || str(record.country) },
    },
  };
}
const EVENT = /\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|forum|convention|colloquium|webinar|GTW|ATCE|AAPG\s+ACE)\b|#[a-z][a-z0-9_-]*20\d{2}\b/i;
const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/\btechnical program(?:me)? committee co[- ]?chair\b/i, "Technical Program Committee Co-Chair"],
  [/\btechnical program(?:me)? committee chair\b/i, "Technical Program Committee Chair"],
  [/\b(?:scientific|program(?:me)?|organi[sz]ing) committee co[- ]?chair\b/i, "Committee Co-Chair"],
  [/\bscientific committee chair\b/i, "Scientific Committee Chair"],
  [/\bprogram(?:me)? committee chair\b/i, "Program Committee Chair"],
  [/\btrack chair\b/i, "Track Chair"],
  [/\bsession co[- ]?chair\b/i, "Session Co-Chair"],
  [/\bsession chair(?:person)?\b/i, "Session Chair"],
  [/\bconference co[- ]?chair\b/i, "Conference Co-Chair"],
  [/\bconference chair(?:person)?\b/i, "Conference Chair"],
  [/\b(?:technical|scientific|program(?:me)?|organi[sz]ing|steering|advisory)(?:\s+program(?:me)?)? committee(?: member)?\b/i, "Committee Member"],
  [/\b(?:session )?conven(?:e|o)r\b/i, "Session Convener"],
  [/\bkeynote (?:speaker|presenter|lecture|address)\b/i, "Keynote Speaker"],
  [/\bplenary (?:speaker|presenter|lecture)\b/i, "Plenary Speaker"],
  [/\binvited (?:speaker|presenter)\b/i, "Invited Speaker"],
  [/\bcore presenter\b/i, "Core Presenter"],
  [/\boral presenter\b/i, "Oral Presenter"],
  [/\bposter presenter\b/i, "Poster Presenter"],
  [/\b(?:conference )?speaker\b/i, "Speaker"],
  [/\b(?:conference )?presenter\b/i, "Presenter"],
  [/\bmoderator\b/i, "Moderator"],
  [/\bpanell?ist\b/i, "Panelist"],
  [/\b(?:abstract|paper|conference) reviewer\b/i, "Reviewer"],
  [/\breviewer\b/i, "Reviewer"],
  [/\bco[- ]?chair\b/i, "Co-Chair"],
  [/\bchair(?:person)?\b/i, "Chair"],
  [/\borgani[sz]er\b/i, "Organizer"],
  [/\b(?:workshop|short course|tutorial) (?:instructor|facilitator|trainer)\b/i, "Workshop Instructor"],
];
function roleLabels(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, label] of ROLE_PATTERNS) if (pattern.test(text) && !found.includes(label)) found.push(label);
  const has = (pattern: RegExp) => found.some(label => pattern.test(label));
  return found.filter(label => !(label === "Chair" && has(/^(?!Chair$).*Chair$/)) &&
    !(label === "Co-Chair" && has(/^(?!Co-Chair$).*Co-Chair$/)) && !(label === "Speaker" && has(/^(Keynote|Plenary|Invited) Speaker$/)) &&
    !(label === "Presenter" && has(/^(Core|Oral|Poster) Presenter$/)) &&
    !(label === "Committee Member" && has(/Committee (?:Co-)?Chair$/)));
}
function eventTitle(text: string, item: RecordValue): string {
  const explicit = str(item.conferenceName) || str(item.eventName) || str(item.event?.name);
  if (explicit) return explicit;
  const org = str(item.companyName || item.organization);
  if (EVENT.test(org)) return org;
  const quoted = /[“"]([^”"]{4,180})[”"]/.exec(text);
  if (quoted && EVENT.test(quoted[1])) return quoted[1];
  const afterAt = /\b(?:at|for|of)\s+(?:the\s+)?([^.;\n]{4,180})/i.exec(text)?.[1];
  if (afterAt && EVENT.test(afterAt)) return afterAt.trim();
  return text.slice(0, 220);
}
export function extractLinkedInProfileConferenceSignals(payload: unknown, sourceUrl: string) {
  const profile = normalizeLinkedInProfilePayload(payload);
  const signals: any[] = [];
  const candidates = ["experience", "volunteering", "projects", "honorsAndAwards", "publications"].flatMap(section => (profile[section] || []).map((item: any) => ({ section, item: obj(item) })));
  const aboutClauses = str(profile.about).split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  for (const clause of aboutClauses) if (/\b(?:I (?:served|serve|chaired|presented|spoke|was|am)|my (?:role|presentation|talk)|serving as)\b/i.test(clause)) candidates.push({ section: "about", item: { description: clause } });
  for (const { section, item } of candidates) {
    const title = str(item.position || item.title || item.role || item.name);
    const body = [title, str(item.companyName || item.organization), str(item.description)].filter(Boolean).join(" — ");
    if (!EVENT.test(body)) continue;
    const directRoles = section === "publications" ? [] : roleLabels(title);
    const claimedDescription = str(item.description).split(/(?<=[.!?])\s+|\n+/).filter(clause => /\b(?:I (?:served|serve|chaired|was|am|presented|spoke)|my (?:role|presentation|talk)|serving as|served as)\b/i.test(clause)).map(clause => clause.split(/\b(?:with|alongside|featuring|where|while)\b/i)[0]).join(" ");
    const roles = directRoles.length ? directRoles : roleLabels(claimedDescription);
    if (!roles.length) continue;
    if (/\b(?:not|never)\s+(?:a |an |the )?(?:(?:keynote|plenary|invited|session|conference|oral|poster) )?(?:speaker|presenter|chair|reviewer|committee member)\b/i.test(title + " " + claimedDescription)) continue;
    const conferenceName = eventTitle(body, item);
    const match = (body + " " + str(item.startDate) + " " + str(item.date)).match(/\b(?:19|20)\d{2}\b/);
    const year = match ? Number(match[0]) : null;
    for (const role of roles) {
      const key = [sourceUrl.toLowerCase(), conferenceName.toLowerCase(), role.toLowerCase(), year].join("|");
      if (signals.some(signal => signal.fingerprint === key)) continue;
      signals.push({ id: "profile-role:" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 24), fingerprint: key, kind: "CONFERENCE_ROLE", label: conferenceName, conferenceName, role, year, sourceUrl, evidenceText: body.slice(0, 1800), confidence: 90, memberClaimed: true, repostOrQuote: false, verified: false, evidenceSource: "linkedin", profileSection: section });
    }
  }
  return signals;
}
export function mergeProfileRoleSummary(summary: any, signals: any[]): void {
  const roles = Array.isArray(summary.roles) ? [...summary.roles] : [];
  for (const signal of signals || []) {
    if (!signal?.profileSection || !signal.memberClaimed || signal.kind !== "CONFERENCE_ROLE") continue;
    if (roles.some(entry => entry.sourceUrl === signal.sourceUrl && entry.role === signal.role && entry.label === signal.label && entry.year === signal.year)) continue;
    const category = /session|track|convener/i.test(signal.role) ? "sessionChair" : /committee|chair/i.test(signal.role) ? "committee" : /panel|moderator/i.test(signal.role) ? "panel" : /instructor|facilitator/i.test(signal.role) ? "workshop" : "presenter";
    roles.push({ ...signal, category });
  }
  Object.assign(summary, { roles, total: roles.length, presenter: roles.filter(entry => entry.category === "presenter").length, committee: roles.filter(entry => entry.category === "committee").length, sessionChair: roles.filter(entry => entry.category === "sessionChair").length, panel: roles.filter(entry => entry.category === "panel").length, workshop: roles.filter(entry => entry.category === "workshop").length });
}
