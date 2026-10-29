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
    console.log(`LinkedIn complete-profile merge patch applied: ${relativePath}`);
  } else {
    console.log(`LinkedIn complete-profile merge already applied: ${relativePath}`);
  }
}

update('server/linkedinProfileBootstrap.ts', (source) => {
  if (!source.includes('function mergeHistoricalItems(')) {
    const anchor = 'function parseArray(value: string | null | undefined): any[] {';
    if (!source.includes(anchor)) throw new Error('LinkedIn complete merge: profile helper anchor missing');
    const helper = `function historicalItemKey(item: any): string {\n  if (item == null) return "";\n  if (typeof item === "string" || typeof item === "number") return String(item).trim().toLowerCase();\n  if (typeof item !== "object") return String(item).trim().toLowerCase();\n  const value = item as Record<string, any>;\n  const identity = [\n    value.id, value.urn, value.url, value.link, value.credentialId, value.licenseNumber,\n    value.patentNumber, value.title, value.name, value.position, value.role, value.degree,\n    value.fieldOfStudy, value.companyName, value.company, value.organization, value.schoolName,\n    value.school, value.issuer, value.publisher, value.date, value.startDate?.text || value.startDate,\n    value.endDate?.text || value.endDate,\n  ].filter((entry) => entry != null && String(entry).trim()).map((entry) => String(entry).trim().toLowerCase());\n  return identity.join("|") || JSON.stringify(value).toLowerCase();\n}\n\nfunction mergeHistoricalItems(previous: any[], next: any[]): any[] {\n  const merged = new Map<string, any>();\n  for (const item of previous || []) {\n    const key = historicalItemKey(item);\n    if (key) merged.set(key, item);\n  }\n  for (const item of next || []) {\n    const key = historicalItemKey(item);\n    if (!key) continue;\n    const old = merged.get(key);\n    // Prefer the richer object when the same historical record is returned again.\n    if (!old || JSON.stringify(item).length >= JSON.stringify(old).length) merged.set(key, item);\n  }\n  return [...merged.values()];\n}\n\n`;
    source = source.replace(anchor, helper + anchor);
  }

  if (!source.includes('const previousProfile = await readStoredProfile(userId);') && !source.includes('const storedProfile = await readStoredProfile(userId);')) {
    source = source.replace(
      '  const now = new Date().toISOString();\n  const about = text(profile.about) || text(profile.summary) || text(profile.description);',
      '  const now = new Date().toISOString();\n  const about = text(profile.about) || text(profile.summary) || text(profile.description);\n  const previousProfile = await readStoredProfile(userId);'
    );
  }

  const mergeAnchor = '  const normalizedLanguages = arrayValue(profile.languages);';
  if (source.includes(mergeAnchor) && !source.includes('const mergedEducation = mergeHistoricalItems(')) {
    source = source.replace(mergeAnchor, `${mergeAnchor}\n\n  // LinkedIn/provider responses can become shallower between refreshes. Never erase previously\n  // imported public history merely because one later response omits it. This applies to every\n  // signed-in member, not only the owner-preview account.\n  const mergedExperience = mergeHistoricalItems(previousProfile?.experience || [], normalizedExperience);\n  const mergedEducation = mergeHistoricalItems(previousProfile?.education || [], normalizedEducation);\n  const mergedPublications = mergeHistoricalItems(previousProfile?.publications || [], normalizedPublications);\n  const mergedPatents = mergeHistoricalItems(previousProfile?.patents || [], normalizedPatents);\n  const mergedCertifications = mergeHistoricalItems(previousProfile?.certifications || [], normalizedCertifications);\n  const mergedProjects = mergeHistoricalItems(previousProfile?.projects || [], normalizedProjects);\n  const mergedSkills = mergeHistoricalItems(previousProfile?.skills || [], normalizedSkills);\n  const mergedHonors = mergeHistoricalItems(previousProfile?.honorsAndAwards || [], normalizedHonors);\n  const mergedLanguages = mergeHistoricalItems(previousProfile?.languages || [], normalizedLanguages);`);
  }

  source = source.replace(
    '  const storedPhoto = ownedProfileAvatar || directPhotoUrl || null;',
    '  // Merge portrait sources instead of clearing a previously good LinkedIn portrait when a\n  // refresh omits the image. Explicit ConferenceGate photo choices are still protected below.\n  const storedPhoto = ownedProfileAvatar || directPhotoUrl || previousProfile?.photoUrl || null;'
  );

  const replacements = [
    ['JSON.stringify(normalizedExperience)', 'JSON.stringify(mergedExperience)'],
    ['JSON.stringify(normalizedEducation)', 'JSON.stringify(mergedEducation)'],
    ['JSON.stringify(normalizedPublications)', 'JSON.stringify(mergedPublications)'],
    ['JSON.stringify(normalizedPatents)', 'JSON.stringify(mergedPatents)'],
    ['JSON.stringify(normalizedCertifications)', 'JSON.stringify(mergedCertifications)'],
    ['JSON.stringify(normalizedProjects)', 'JSON.stringify(mergedProjects)'],
    ['JSON.stringify(normalizedSkills)', 'JSON.stringify(mergedSkills)'],
    ['JSON.stringify(normalizedHonors)', 'JSON.stringify(mergedHonors)'],
    ['JSON.stringify(normalizedLanguages)', 'JSON.stringify(mergedLanguages)'],
    ['  const avatarCandidate = ownedProfileAvatar || directPhotoUrl || null;', '  const avatarCandidate = ownedProfileAvatar || directPhotoUrl || previousProfile?.photoUrl || null;'],
  ];
  for (const [before, after] of replacements) source = source.replace(before, after);

  if (!source.includes('const mergedEducation = mergeHistoricalItems(')) throw new Error('LinkedIn complete merge: profile arrays are not additive');
  if (!source.includes('previousProfile?.photoUrl || null')) throw new Error('LinkedIn complete merge: previous portrait fallback missing');
  return source;
});

update('server/linkedinConferenceActivityBootstrap.ts', (source) => {
  source = source.replace(
    '    conferenceActivity: parseArray(row.conference_activity),\n    callsForPapers: parseArray(row.calls_for_papers),',
    '    conferenceActivity: parseArray(row.conference_activity),\n    callsForPapers: parseArray(row.calls_for_papers),\n    rawPosts: parseArray(row.raw_posts),'
  );

  source = source.replace(
    '    } else if (!repostOrQuote && /\\b(i\\s+(?:attended|participated|joined|was at)|great to be at|back from)\\b/i.test(content)) {',
    '    } else if (!repostOrQuote && /\\b(i\\s+(?:attended|participated(?:\\s+(?:in|at))?|joined|was at|took part in)|great to be at|back from|pleased to participate(?:\\s+(?:in|at))?|honou?red to participate(?:\\s+(?:in|at))?)\\b/i.test(content)) {'
  );

  source = source.replace(
    '    conferenceActivity: dedupe(conferenceActivity).slice(0, 1000),\n    callsForPapers: dedupe(callsForPapers).slice(0, 500),',
    '    conferenceActivity: dedupe(conferenceActivity),\n    callsForPapers: dedupe(callsForPapers),'
  );

  if (!source.includes('function stableLinkedInPostKey(')) {
    const anchor = 'async function readStored(userId: string) {';
    if (!source.includes(anchor)) throw new Error('LinkedIn complete merge: conference helper anchor missing');
    const helper = `function stableLinkedInPostKey(item: any): string {\n  if (!item || typeof item !== "object") return String(item ?? "").trim().toLowerCase();\n  const url = postUrl(item);\n  const id = clean(item.id || item.postId || item.urn || "");\n  const body = postPrimaryText(item).slice(0, 240).toLowerCase();\n  return (url || id || body).toLowerCase();\n}\n\nfunction mergeRawLinkedInPosts(previous: any[], next: any[]): any[] {\n  const merged = new Map<string, any>();\n  for (const item of [...(previous || []), ...(next || [])]) {\n    const key = stableLinkedInPostKey(item);\n    if (key) merged.set(key, item);\n  }\n  return [...merged.values()];\n}\n\n`;
    source = source.replace(anchor, helper + anchor);
  }

  source = source.replace(
    '  const conferenceActivity = mergeEvidence(existing?.conferenceActivity || [], classified.conferenceActivity).slice(0, 1000);\n  const callsForPapers = mergeEvidence(existing?.callsForPapers || [], classified.callsForPapers).slice(0, 500);\n  const now = new Date().toISOString();',
    '  const conferenceActivity = mergeEvidence(existing?.conferenceActivity || [], classified.conferenceActivity);\n  const callsForPapers = mergeEvidence(existing?.callsForPapers || [], classified.callsForPapers);\n  const rawPosts = mergeRawLinkedInPosts(existing?.rawPosts || [], posts);\n  const now = new Date().toISOString();'
  );
  source = source.replace('      JSON.stringify(posts),\n      SOURCE_ACTOR,', '      JSON.stringify(rawPosts),\n      SOURCE_ACTOR,');

  if (!(source.includes('rawPosts: parseArray(row.raw_posts)') || source.includes('rawPosts: row ? parseArray(row.raw_posts) : []'))) throw new Error('LinkedIn complete merge: stored raw posts are not readable');
  if (!source.includes('const rawPosts = mergeRawLinkedInPosts(')) throw new Error('LinkedIn complete merge: raw post history is not additive');
  if (source.includes('mergeEvidence(existing?.conferenceActivity || [], classified.conferenceActivity).slice(')) throw new Error('LinkedIn complete merge: merged conference evidence remains capped');
  return source;
});
