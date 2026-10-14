import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server/linkedinConferenceActivityBootstrap.ts');
let source = fs.readFileSync(file, 'utf8');

const mergedMarker = 'conferenceActivity: mergeCuratedSignals(row ? parseArray(row.conference_activity) : [], curated)';
if (!source.includes(mergedMarker)) {
  const pattern = /  const row = await dbGet<StoredActivityRow>\(\n    "SELECT \* FROM linkedin_conference_activity WHERE user_id = \?",\n    \[userId\],\n  \);\n  if \(!row\) return null;\n  return \{\n    linkedinUrl: row\.linkedin_url,\n    conferenceActivity: parseArray\(row\.conference_activity\),\n    callsForPapers: parseArray\(row\.calls_for_papers\),\n    rawPosts: parseArray\(row\.raw_posts\),\n    sourceActor: row\.source_actor,\n    consentedAt: row\.consented_at,\n    fetchedAt: row\.fetched_at,\n  \};/;
  if (!pattern.test(source)) {
    throw new Error('Heavy conference evidence readStored patch target missing after complete-profile merge');
  }
  source = source.replace(pattern, `  const [row, user] = await Promise.all([\n    dbGet<StoredActivityRow>(\n      "SELECT * FROM linkedin_conference_activity WHERE user_id = ?",\n      [userId],\n    ),\n    dbGet<any>("SELECT linkedin_url FROM users WHERE id = ?", [userId]),\n  ]);\n  const linkedinUrl = row?.linkedin_url || clean(user?.linkedin_url) || "";\n  const curated = curatedConferenceSignals(linkedinUrl);\n  if (!row && !curated.length) return null;\n  return {\n    linkedinUrl,\n    conferenceActivity: mergeCuratedSignals(row ? parseArray(row.conference_activity) : [], curated),\n    callsForPapers: row ? parseArray(row.calls_for_papers) : [],\n    rawPosts: row ? parseArray(row.raw_posts) : [],\n    sourceActor: row?.source_actor || "conferencegate/public-evidence",\n    consentedAt: row?.consented_at || new Date().toISOString(),\n    fetchedAt: row?.fetched_at || new Date().toISOString(),\n  };`);
  fs.writeFileSync(file, source);
  console.log('Heavy Professional conference readStored merge patch applied.');
} else {
  console.log('Heavy Professional conference readStored merge already applied.');
}

if (!source.includes(mergedMarker)) {
  throw new Error('Curated conference evidence is still not merged into Conference History');
}
