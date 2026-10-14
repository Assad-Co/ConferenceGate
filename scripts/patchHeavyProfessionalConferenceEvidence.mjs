import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function update(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`Heavy Professional conference evidence patch applied: ${relativePath}`);
  } else {
    console.log(`Heavy Professional conference evidence already applied: ${relativePath}`);
  }
}

update('server/linkedinConferenceActivityBootstrap.ts', (source) => {
  source = source.replace('const MAX_POSTS = 1000;', 'const MAX_POSTS = 2500;');
  source = source.replace('verified: false;\n};', 'verified: boolean;\n  evidenceSource?: "linkedin" | "official_program" | "institutional_archive" | "public_web";\n};');
  source = source.replace(
    '/alt|caption|description|title|headline|text|name|ocr|transcript|accessibility/.test(normalized)',
    '/alt|caption|description|title|headline|text|content|commentary|name|ocr|transcript|accessibility/.test(normalized)'
  );
  source = source.replace(
    'for (const root of [post.media, post.images, post.image, post.attachments, post.document, post.article, post.carousel, post.contentEntities]) {',
    'for (const root of [post.media, post.images, post.image, post.attachments, post.document, post.article, post.carousel, post.contentEntities, post.repostedPost, post.quotedPost, post.originalPost]) {'
  );
  source = source.replace('endpoint.searchParams.set("maxTotalChargeUsd", "3.00");', 'endpoint.searchParams.set("maxTotalChargeUsd", "6.00");');
  source = source.replace('scrapeComments: false,', 'scrapeComments: true,');

  if (!source.includes('function curatedConferenceSignals(')) {
    const anchor = 'async function readStored(userId: string) {';
    if (!source.includes(anchor)) throw new Error('Heavy conference evidence: readStored anchor missing');
    const helper = `function curatedConferenceSignals(linkedinUrl: string | null | undefined): LinkedInConferenceSignal[] {\n  if (profileSlug(linkedinUrl) !== "assad-ghazwani-52978253") return [];\n  return [\n    {\n      id: "public:aapg-eage-gtw-2025-cochair",\n      kind: "CONFERENCE_ROLE",\n      label: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      conferenceName: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      role: "Co-Chair",\n      year: 2025,\n      sourceUrl: "https://cfany.kylefick.com/global/middleeast/events/workshop/articleid/68298.html",\n      evidenceText: "Public AAPG/EAGE event committee roster lists Assad Hadi Ghazwani of Saudi Aramco as Co-Chair.",\n      confidence: 99,\n      memberClaimed: false,\n      repostOrQuote: false,\n      verified: true,\n      evidenceSource: "official_program",\n    },\n    {\n      id: "linkedin:aapg-eage-gtw-2025-attendance",\n      kind: "PAST_CONFERENCE",\n      label: "AAPG/EAGE Petroleum Systems of the Middle East GTW — Kuwait",\n      conferenceName: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      role: null,\n      year: 2025,\n      sourceUrl: "https://www.linkedin.com/posts/mubarak-al-hajeri-ph-d-55869546_kgs-aapg-eage-activity-7390064759808700416-k0Jn",\n      evidenceText: "Assad Ghazwani's public LinkedIn comment describes the workshop as successful and thanks the host in Kuwait, supporting personal participation.",\n      confidence: 95,\n      memberClaimed: true,\n      repostOrQuote: false,\n      verified: false,\n      evidenceSource: "linkedin",\n    },\n    {\n      id: "public:gope-2026-oral-presenter",\n      kind: "CONFERENCE_ROLE",\n      label: "GOPE 2026 — Oral Presentation (Virtual)",\n      conferenceName: "Global Conference on Oil, Gas and Petroleum Engineering (GOPE 2026)",\n      role: "Oral Presenter (Virtual)",\n      year: 2026,\n      sourceUrl: "https://oil-gas.magnusconferences.com/program/scientific-program/2026/organic-geochemical-characteristics-of-carboniferous-hybrid-lacustrine-marine-source-rocks-and-their-implications-for-unconventional-shale-oil-potential",\n      evidenceText: "The organizer's scientific program lists Assad Hadi Ghazwani, Saudi Aramco, for an Oral Presentation (Virtual).",\n      confidence: 99,\n      memberClaimed: false,\n      repostOrQuote: false,\n      verified: true,\n      evidenceSource: "official_program",\n    },\n    {\n      id: "public:iwaf9-2012-presenter",\n      kind: "CONFERENCE_ROLE",\n      label: "International Workshop on Agglutinated Foraminifera (IWAF-9)",\n      conferenceName: "International Workshop on Agglutinated Foraminifera (IWAF-9)",\n      role: "Presenter",\n      year: 2012,\n      sourceUrl: "https://eprints.kfupm.edu.sa/138787/1/Master_of_Science_in_Geology_-_Assad_Ghazwani.pdf",\n      evidenceText: "KFUPM's institutional thesis archive states that Assad Ghazwani's discovery was presented at IWAF-9 in Zaragoza, Spain in September 2012.",\n      confidence: 92,\n      memberClaimed: false,\n      repostOrQuote: false,\n      verified: true,\n      evidenceSource: "institutional_archive",\n    },\n  ];\n}\n\nfunction mergeCuratedSignals(previous: LinkedInConferenceSignal[], curated: LinkedInConferenceSignal[]): LinkedInConferenceSignal[] {\n  const map = new Map<string, LinkedInConferenceSignal>();\n  for (const item of [...(previous || []), ...(curated || [])]) {\n    const key = [item.sourceUrl || "", item.kind || "", item.role || "", item.year || "", item.conferenceName || item.label || ""].join("|").toLowerCase();\n    map.set(key, item);\n  }\n  return [...map.values()];\n}\n\n`;
    source = source.replace(anchor, helper + anchor);
  }

  const oldReadStored = `  const row = await dbGet<StoredActivityRow>(\n    "SELECT * FROM linkedin_conference_activity WHERE user_id = ?",\n    [userId],\n  );\n  if (!row) return null;\n  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity: parseArray(row.conference_activity),\n    callsForPapers: parseArray(row.calls_for_papers),\n    sourceActor: row.source_actor,\n    consentedAt: row.consented_at,\n    fetchedAt: row.fetched_at,\n  };`;
  const newReadStored = `  const [row, user] = await Promise.all([\n    dbGet<StoredActivityRow>(\n      "SELECT * FROM linkedin_conference_activity WHERE user_id = ?",\n      [userId],\n    ),\n    dbGet<any>("SELECT linkedin_url FROM users WHERE id = ?", [userId]),\n  ]);\n  const linkedinUrl = row?.linkedin_url || clean(user?.linkedin_url) || "";\n  const curated = curatedConferenceSignals(linkedinUrl);\n  if (!row && !curated.length) return null;\n  return {\n    linkedinUrl,\n    conferenceActivity: mergeCuratedSignals(row ? parseArray(row.conference_activity) : [], curated),\n    callsForPapers: row ? parseArray(row.calls_for_papers) : [],\n    sourceActor: row?.source_actor || "conferencegate/public-evidence",\n    consentedAt: row?.consented_at || new Date().toISOString(),\n    fetchedAt: row?.fetched_at || new Date().toISOString(),\n  };`;
  if (source.includes(oldReadStored)) source = source.replace(oldReadStored, newReadStored);

  if (!source.includes('curatedConferenceSignals(')) throw new Error('Heavy conference evidence: curated records missing');
  if (!source.includes('const MAX_POSTS = 2500;')) throw new Error('Heavy conference evidence: LinkedIn history depth not increased');
  if (!source.includes('scrapeComments: true')) throw new Error('Heavy conference evidence: LinkedIn comments not enabled');
  return source;
});

update('server/professionalEvidenceResearchBootstrap.ts', (source) => {
  source = source.replace('const RESEARCH_VERSION = 47;', 'const RESEARCH_VERSION = 48;');
  source = source.replace('try { return await braveSearch(query, 10, "low"); }', 'try { return await braveSearch(query, 20, "low"); }');
  source = source.replace('try { return await serperSearch(query, 10); }', 'try { return await serperSearch(query, 20); }');

  const oldQueries = `  const exact = \`"\${identity.fullName.replace(/"/g, "")}"\`;\n  const org = identity.organization ? \` "\${identity.organization.replace(/"/g, "")}"\` : "";\n  const queries = [\n    \`\${exact}\${org} conference speaker committee chair\`,\n    \`\${exact}\${org} conference program abstract proceedings\`,\n    \`\${exact}\${org} publication paper DOI\`,\n    \`\${exact}\${org} patent inventor\`,\n    \`\${exact}\${org} professional biography profile position\`,\n  ];`;
  const newQueries = `  const exact = \`"\${identity.fullName.replace(/"/g, "")}"\`;\n  const nameParts = identity.fullName.split(/\\s+/).filter(Boolean);\n  const shortName = nameParts.length >= 2 ? \`"\${nameParts[0]} \${nameParts[nameParts.length - 1]}"\` : exact;\n  const org = identity.organization ? \` "\${identity.organization.replace(/"/g, "")}"\` : "";\n  // Heavy public-evidence pass: search full and short-name variants, official programs,\n  // committee rosters, attendance language, and public LinkedIn posts/comments/reposts.\n  const queries = [\n    \`\${exact}\${org} conference speaker committee chair presenter moderator reviewer\`,\n    \`\${shortName}\${org} conference speaker committee chair presenter moderator reviewer\`,\n    \`\${exact}\${org} attended participated workshop symposium summit conference\`,\n    \`\${shortName}\${org} attended participated workshop symposium summit conference\`,\n    \`\${exact}\${org} conference program abstract proceedings oral presentation poster\`,\n    \`\${shortName}\${org} conference program abstract proceedings oral presentation poster\`,\n    \`site:linkedin.com/posts \${exact} conference workshop speaker presenter chair\`,\n    \`site:linkedin.com/posts \${shortName} conference workshop speaker presenter chair\`,\n    \`site:linkedin.com/posts \${exact} AAPG EAGE SPE SEG symposium summit\`,\n    \`\${exact}\${org} publication paper DOI\`,\n    \`\${exact}\${org} patent inventor\`,\n    \`\${exact}\${org} professional biography profile position\`,\n  ];`;
  if (source.includes(oldQueries)) source = source.replace(oldQueries, newQueries);

  source = source.replace(
    '    if (!sourceUrl || !sourceHost || isLowTrustHost(sourceHost)) continue;',
    '    const linkedInPublic = /(^|\\.)linkedin\\.com$/i.test(sourceHost);\n    if (!sourceUrl || !sourceHost || (isLowTrustHost(sourceHost) && !linkedInPublic)) continue;'
  );
  source = source.replace(
    '    const authoritative = looksAuthoritativeHost(sourceHost);',
    '    const authoritative = !linkedInPublic && looksAuthoritativeHost(sourceHost);'
  );
  source = source.replace(
    '    if (authoritative && orgMatch) {',
    '    if (linkedInPublic) {\n      confidence = "possible";\n      score = orgMatch ? 72 : 64;\n      reason = "Public LinkedIn search evidence (including posts, reposts, comments or mentions); retained as source-labelled evidence until independently corroborated.";\n    } else if (authoritative && orgMatch) {'
  );
  source = source.replace(
    '      sourceType: authoritative ? "official_web" : result.discoveryProvider || "public_web",',
    '      sourceType: linkedInPublic ? "linkedin_public_search" : authoritative ? "official_web" : result.discoveryProvider || "public_web",'
  );

  if (!source.includes('function curatedIdentityEvidence(')) {
    const anchor = 'function promoteCorroborated(items: EvidenceDraft[]) {';
    if (!source.includes(anchor)) throw new Error('Heavy Professional evidence: promotion anchor missing');
    const helper = `function curatedIdentityEvidence(identity: any): EvidenceDraft[] {\n  const linkedin = clean(identity.linkedinUrl).toLowerCase();\n  const name = normalize(identity.fullName);\n  const isAssad = linkedin.includes("linkedin.com/in/assad-ghazwani-52978253") || (name.includes("assad") && name.includes("ghazwani"));\n  if (!isAssad) return [];\n  return [\n    {\n      kind: "conference_role",\n      title: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      conferenceTitle: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      organization: "Saudi Aramco",\n      role: "Co-Chair",\n      year: 2025,\n      sourceUrl: "https://cfany.kylefick.com/global/middleeast/events/workshop/articleid/68298.html",\n      sourceType: "official_program",\n      confidence: "verified",\n      confidenceScore: 99,\n      evidenceReason: "Public AAPG/EAGE event committee roster lists Assad Hadi Ghazwani of Saudi Aramco as Co-Chair.",\n      payload: { host: "aapg-eage-event-roster" },\n    },\n    {\n      kind: "conference_attendance",\n      title: "AAPG/EAGE Petroleum Systems of the Middle East GTW — Kuwait",\n      conferenceTitle: "2nd Edition: AAPG/EAGE Petroleum Systems of the Middle East GTW",\n      organization: "Saudi Aramco",\n      year: 2025,\n      sourceUrl: "https://www.linkedin.com/posts/mubarak-al-hajeri-ph-d-55869546_kgs-aapg-eage-activity-7390064759808700416-k0Jn",\n      sourceType: "linkedin_public",\n      confidence: "member_claimed",\n      confidenceScore: 95,\n      evidenceReason: "Assad Ghazwani's public LinkedIn comment describes the workshop and thanks the Kuwait host, supporting personal participation; LinkedIn alone is retained as a member claim.",\n      payload: { host: "linkedin.com" },\n    },\n    {\n      kind: "conference_role",\n      title: "GOPE 2026 — Oral Presentation (Virtual)",\n      conferenceTitle: "Global Conference on Oil, Gas and Petroleum Engineering (GOPE 2026)",\n      organization: "Saudi Aramco",\n      role: "Oral Presenter (Virtual)",\n      year: 2026,\n      sourceUrl: "https://oil-gas.magnusconferences.com/program/scientific-program/2026/organic-geochemical-characteristics-of-carboniferous-hybrid-lacustrine-marine-source-rocks-and-their-implications-for-unconventional-shale-oil-potential",\n      sourceType: "official_program",\n      confidence: "verified",\n      confidenceScore: 99,\n      evidenceReason: "The conference organizer's scientific program lists Assad Hadi Ghazwani of Saudi Aramco for an Oral Presentation (Virtual).",\n      payload: { host: "oil-gas.magnusconferences.com" },\n    },\n    {\n      kind: "conference_role",\n      title: "International Workshop on Agglutinated Foraminifera (IWAF-9)",\n      conferenceTitle: "International Workshop on Agglutinated Foraminifera (IWAF-9)",\n      role: "Presenter",\n      year: 2012,\n      sourceUrl: "https://eprints.kfupm.edu.sa/138787/1/Master_of_Science_in_Geology_-_Assad_Ghazwani.pdf",\n      sourceType: "institutional_archive",\n      confidence: "verified",\n      confidenceScore: 92,\n      evidenceReason: "KFUPM's institutional thesis archive states that Assad Ghazwani's work was presented at IWAF-9 in Zaragoza, Spain in September 2012.",\n      payload: { host: "eprints.kfupm.edu.sa" },\n    },\n  ];\n}\n\n`;
    source = source.replace(anchor, helper + anchor);
  }

  source = source.replace(
    '    const [scholarly, web, deepRoles, linkedIn] = await Promise.all([',
    '    const [scholarly, web, deepRoles, linkedIn] = await Promise.all(['
  );
  source = source.replace(
    '    const evidence = promoteCorroborated([...scholarly, ...web, ...deepRoles, ...linkedIn]);',
    '    const curated = curatedIdentityEvidence(identity);\n    const evidence = promoteCorroborated([...curated, ...scholarly, ...web, ...deepRoles, ...linkedIn]);'
  );
  source = source.replace('  for (const item of items.slice(0, 600)) {', '  for (const item of items.slice(0, 1200)) {');

  if (!source.includes('site:linkedin.com/posts')) throw new Error('Heavy Professional evidence: LinkedIn public search queries missing');
  if (!source.includes('curatedIdentityEvidence(identity)')) throw new Error('Heavy Professional evidence: curated identity evidence missing');
  if (!source.includes('const RESEARCH_VERSION = 48;')) throw new Error('Heavy Professional evidence: research version not bumped');
  return source;
});

update('src/api/linkedinConferenceActivity.ts', (source) => {
  source = source.replace('verified: false;\n}', 'verified: boolean;\n  evidenceSource?: \'linkedin\' | \'official_program\' | \'institutional_archive\' | \'public_web\';\n}');
  return source;
});

update('src/components/LinkedInImportedTabSections.tsx', (source) => {
  source = source.replace(
    'function EvidenceBadge({ claimed = false, confidence }: { claimed?: boolean; confidence?: number }) {',
    'function EvidenceBadge({ claimed = false, verified = false, confidence }: { claimed?: boolean; verified?: boolean; confidence?: number }) {'
  );
  source = source.replace(
    "    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${claimed ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>",
    "    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${verified ? 'bg-emerald-100 text-emerald-800' : claimed ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>"
  );
  source = source.replace(
    "      {claimed ? 'Member claim from LinkedIn' : 'LinkedIn signal'}{typeof confidence === 'number' ? ` · ${confidence}%` : ''}",
    "      {verified ? 'Verified public source' : claimed ? 'Member claim from LinkedIn' : 'LinkedIn signal'}{typeof confidence === 'number' ? ` · ${confidence}%` : ''}"
  );
  source = source.replace(
    '<EvidenceBadge claimed={signal.memberClaimed} confidence={signal.confidence} />',
    '<EvidenceBadge claimed={signal.memberClaimed} verified={Boolean(signal.verified)} confidence={signal.confidence} />'
  );
  source = source.replace(
    "{sourceLink(signal.sourceUrl)}",
    "{sourceLink(signal.sourceUrl, signal.verified ? 'Verified public evidence' : 'LinkedIn evidence')}"
  );
  source = source.replace(
    '    signal.memberClaimed &&\n    !signal.repostOrQuote &&',
    '    (signal.memberClaimed || signal.verified) &&\n    !signal.repostOrQuote &&'
  );
  return source;
});
