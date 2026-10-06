import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
  console.log(`[phase39] patched ${path}`);
}

function replaceOnce(path, before, after, label) {
  let source = read(path);
  if (source.includes(after)) {
    console.log(`[phase39] already applied: ${label}`);
    return;
  }
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`[phase39] ${path}: expected one anchor for ${label}, found ${count}`);
  source = source.replace(before, after);
  write(path, source);
}

// 1. Remove the redundant empty AI nomination panel. Committee recruitment already happens
// through the Professional Network / invitation workflow, while the real roster remains below.
{
  const path = 'src/components/OrganizerDashboard.tsx';
  let source = read(path);
  const heading = 'AI-Nominated Technical Committee Candidates';
  if (source.includes(heading)) {
    const headingAt = source.indexOf(heading);
    const panelAnchor = '          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">';
    const start = source.lastIndexOf(panelAnchor, headingAt);
    const endMarker = '          {/* Committee Roster */}';
    const end = source.indexOf(endMarker, headingAt);
    if (start < 0 || end < 0 || end <= start) throw new Error('[phase39] could not isolate redundant AI committee panel');
    source = source.slice(0, start) +
      '          {/* Committee candidates are recruited through the Professional Network; the redundant empty AI nomination panel was removed. */}\n\n' +
      source.slice(end);
    write(path, source);
  } else {
    console.log('[phase39] AI committee panel already removed');
  }
}

// 2. Make the digital identity badge use ConferenceGate's light-blue visual language.
{
  const path = 'src/components/DigitalBadgeModal.tsx';
  let source = read(path);
  const replacements = [
    ['p-6 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl border border-slate-800 text-white',
     'p-6 bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 rounded-2xl border border-blue-200 text-slate-900'],
    ['text-blue-400 bg-blue-500/20 px-2.5 py-0.5 rounded-full border border-blue-400/30',
     'text-blue-700 bg-white/80 px-2.5 py-0.5 rounded-full border border-blue-200'],
    ['w-5 h-5 text-emerald-400', 'w-5 h-5 text-emerald-600'],
    ['font-extrabold text-base text-white', 'font-extrabold text-base text-slate-950'],
    ['text-xs text-slate-300', 'text-xs text-slate-600'],
    ['text-[10px] text-blue-300 font-semibold mt-0.5', 'text-[10px] text-blue-700 font-semibold mt-0.5'],
    ['pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400',
     'pt-2 border-t border-blue-200 flex items-center justify-between text-[10px] text-slate-500'],
    ['text-white font-bold">ID:', 'text-slate-900 font-bold">ID:'],
  ];
  for (const [before, after] of replacements) {
    if (source.includes(before)) source = source.replace(before, after);
  }
  write(path, source);
}

// 3. Remove the customer-facing "Not retrieved" state. We keep only facts ConferenceGate can
// state positively: Available and Not announced. Unknown tabs remain clickable without a label.
{
  const path = 'src/components/ExternalConferenceDetail.tsx';
  let source = read(path);
  source = source.replace("    return 'Not retrieved';", "    return '';");
  source = source.replace(
    '              <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-300" />Not retrieved</span>\n',
    ''
  );
  source = source.replace('title={detailTabStateLabel(tab.id)}', 'title={detailTabStateLabel(tab.id) || undefined}');
  write(path, source);
}

// 4. Deepen the member-consented LinkedIn scan to the past seven years. This remains limited to
// the member's own public LinkedIn profile/posts and does not represent unrestricted LinkedIn search.
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = read(path);
  source = source.replace(
    'const MAX_POSTS = 100;',
    'const MAX_POSTS = 400;\nconst LOOKBACK_YEARS = 7;'
  );

  const oldPostText = `function postText(post: Record<string, any>): string {\n  return clean(post.content || post.text || post.commentary || post.description || post.title || "");\n}`;
  const newPostText = `function postPrimaryText(post: Record<string, any>): string {\n  return clean(post.content || post.text || post.commentary || post.description || post.title || "");\n}\n\nfunction collectLinkedInEvidenceText(value: unknown, depth = 0, out: string[] = []): string[] {\n  if (value == null || depth > 5 || out.length >= 80) return out;\n  if (Array.isArray(value)) {\n    for (const item of value) collectLinkedInEvidenceText(item, depth + 1, out);\n    return out;\n  }\n  if (typeof value !== "object") return out;\n  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {\n    if (out.length >= 80) break;\n    const normalized = key.toLowerCase();\n    if (typeof child === "string") {\n      if (/alt|caption|description|title|headline|text|name|ocr|transcript|accessibility/.test(normalized) &&\n          !/url|uri|id|urn/.test(normalized)) {\n        const candidate = clean(child);\n        if (candidate && candidate.length <= 1200) out.push(candidate);\n      }\n    } else if (child && (Array.isArray(child) || typeof child === "object")) {\n      collectLinkedInEvidenceText(child, depth + 1, out);\n    }\n  }\n  return out;\n}\n\nfunction postText(post: Record<string, any>): string {\n  const primary = postPrimaryText(post);\n  const mediaText: string[] = [];\n  for (const root of [post.media, post.images, post.image, post.attachments, post.document, post.article, post.carousel, post.contentEntities]) {\n    collectLinkedInEvidenceText(root, 0, mediaText);\n  }\n  return clean([primary, ...new Set(mediaText)].filter(Boolean).join(" | "));\n}\n\nfunction yearFromPostDateValue(value: unknown, depth = 0): number | null {\n  if (value == null || depth > 3) return null;\n  if (typeof value === "number") {\n    const millis = value > 1_000_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : NaN;\n    if (Number.isFinite(millis)) {\n      const year = new Date(millis).getUTCFullYear();\n      return Number.isFinite(year) ? year : null;\n    }\n    return null;\n  }\n  if (typeof value === "string") {\n    const explicit = /\\b(20\\d{2})\\b/.exec(value);\n    if (explicit) return Number(explicit[1]);\n    const parsed = Date.parse(value);\n    if (!Number.isNaN(parsed)) return new Date(parsed).getUTCFullYear();\n    return null;\n  }\n  if (typeof value === "object") {\n    const record = value as Record<string, unknown>;\n    for (const key of ["date", "text", "timestamp", "time", "value", "startDate", "publishedAt"]) {\n      const year = yearFromPostDateValue(record[key], depth + 1);\n      if (year) return year;\n    }\n  }\n  return null;\n}\n\nfunction postWithinSevenYears(post: Record<string, any>): boolean {\n  const candidates = [\n    post.postedAt, post.postedDate, post.publishedAt, post.createdAt, post.date,\n    post.timestamp, post.postedAtTimestamp, post.createdAtTimestamp, post.time,\n  ];\n  for (const candidate of candidates) {\n    const year = yearFromPostDateValue(candidate);\n    if (year) return year >= new Date().getUTCFullYear() - LOOKBACK_YEARS;\n  }\n  // Some LinkedIn exports omit timestamps. Keep those posts and rely on the event/publication year\n  // when one is present rather than discarding potentially useful member evidence.\n  return true;\n}`;
  if (!source.includes(newPostText)) {
    if (!source.includes(oldPostText)) throw new Error('[phase39] LinkedIn postText anchor missing');
    source = source.replace(oldPostText, newPostText);
  }

  source = source.replace(
    '    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};\n    const content = postText(post);',
    '    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};\n    if (!postWithinSevenYears(post)) return;\n    const content = postText(post);'
  );
  source = source.replace(
    '    const hasEvent = /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|forum|convention)\\b/i.test(content);',
    '    const hasEvent = /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\\b/i.test(content) || /#[A-Za-z][A-Za-z0-9_-]{2,40}20\\d{2}\\b/.test(content);'
  );
  source = source.replace(
    '    const hasPaper = /\\b(abstract|paper|poster|oral presentation|presentation)\\b/i.test(content);',
    '    const hasPaper = /\\b(abstract|paper|poster|oral presentation|technical presentation|presentation|manuscript|journal article|peer[- ]reviewed article|publication|published)\\b/i.test(content);'
  );
  source = source.replace(
    '    const year = extractYear(content);\n    const sourceUrl = postUrl(post);',
    '    const year = extractYear(content);\n    if (year && year < nowYear - LOOKBACK_YEARS) return;\n    const sourceUrl = postUrl(post);'
  );
  source = source.replace(
    '    conferenceActivity: dedupe(conferenceActivity).slice(0, 100),\n    callsForPapers: dedupe(callsForPapers).slice(0, 100),',
    '    conferenceActivity: dedupe(conferenceActivity).slice(0, 400),\n    callsForPapers: dedupe(callsForPapers).slice(0, 250),'
  );
  source = source.replace('setTimeout(() => controller.abort(), 180_000)', 'setTimeout(() => controller.abort(), 300_000)');
  source = source.replace('endpoint.searchParams.set("maxTotalChargeUsd", "0.30");', 'endpoint.searchParams.set("maxTotalChargeUsd", "1.20");');
  write(path, source);
}

// 5. Make the seven-year scope visible in the Professional profile and focus position display on
// current/recent roles while leaving the full imported LinkedIn record stored server-side.
{
  const path = 'src/components/LinkedInProfilePanel.tsx';
  let source = read(path);
  const dateAnchor = `function dateText(item: any): string {\n  const start = text(item?.startDate?.text) || text(item?.startDate) || text(item?.date);\n  const end = text(item?.endDate?.text) || text(item?.endDate);\n  if (start && end) return \`${'${start}'} – ${'${end}'}\`;\n  return start || end;\n}`;
  const dateReplacement = `${dateAnchor}\n\nfunction experienceWithinSevenYears(item: any): boolean {\n  const raw = [\n    text(item?.startDate?.text), text(item?.startDate), text(item?.endDate?.text), text(item?.endDate),\n    text(item?.date), text(item?.duration),\n  ].filter(Boolean).join(' ');\n  if (/present|current|now/i.test(raw)) return true;\n  const years = [...raw.matchAll(/\\b(20\\d{2})\\b/g)].map((match) => Number(match[1]));\n  if (!years.length) return true;\n  return Math.max(...years) >= new Date().getFullYear() - 7;\n}`;
  if (!source.includes('function experienceWithinSevenYears')) {
    if (!source.includes(dateAnchor)) throw new Error('[phase39] LinkedInProfilePanel dateText anchor missing');
    source = source.replace(dateAnchor, dateReplacement);
  }
  source = source.replace(
    'Public LinkedIn data only. ConferenceGate treats explicit first-person posts as member claims and keeps reposts as discovery signals—not proof of attendance, authorship, or a role.',
    "Public LinkedIn data only. ConferenceGate searches the member's public profile plus up to 400 public posts across the past 7 years for conference attendance/roles, positions and paper evidence. Explicit first-person posts remain member claims until independently verified."
  );
  source = source.replace(
    '<div className="flex items-center gap-2 mb-3"><Briefcase className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Experience</h3></div>',
    '<div className="flex items-center gap-2 mb-3"><Briefcase className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Experience — Past 7 Years</h3></div>'
  );
  source = source.replace(
    'profile!.experience.slice(0, 12).map((item, index) => (',
    'profile!.experience.filter(experienceWithinSevenYears).slice(0, 20).map((item, index) => ('
  );
  write(path, source);
}

// 6. Clarify the same evidence scope on the cross-tab LinkedIn sections.
{
  const path = 'src/components/LinkedInImportedTabSections.tsx';
  let source = read(path);
  source = source.replace(
    "Attendance, participation and conference roles found in the member's own public LinkedIn posts. These remain evidence-backed member claims until independently verified.",
    "Attendance, participation and conference roles found by the consent-based scan of the member's own public LinkedIn evidence across the past 7 years. These remain evidence-backed member claims until independently verified."
  );
  source = source.replace(
    'Publications and conference-paper evidence imported from the public LinkedIn profile and its posts.',
    'Publications from the public LinkedIn profile plus paper/abstract evidence found in the member\'s public posts across the past 7 years.'
  );
  write(path, source);
}

console.log('[phase39] all requested fixes applied');
