import fs from 'node:fs';

// LinkedIn conference-role classifier v2.
// Two safeguards make role history reliable for every ConferenceGate member:
// 1) Reclassify already-stored evidence posts with the CURRENT role rules on every read, so
//    classifier improvements immediately fix old records without paying for another scrape.
// 2) Bump the complete-history source version to all-v2, forcing one fresh all-posts scan for
//    every existing linked account after this classifier upgrade. New linked accounts get v2
//    automatically on their first onboarding scan.

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // The preceding all-posts patch installs all-v1. This classifier release must invalidate that
  // cache across every account so old full-history scans are rebuilt with the new multi-role rules.
  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v1',
    'harvestapi/linkedin-profile-posts:all-v2',
  );

  const oldImport = '  const { dbGet } = await import("./db");';
  const newImport = '  const { dbGet, dbRun } = await import("./db");';
  if (!source.includes(newImport)) {
    if (!source.includes(oldImport)) {
      throw new Error('[linkedin-role-reclassify-v2] readStored db import anchor not found');
    }
    source = source.replace(oldImport, newImport);
  }

  const oldReturn = `  if (!row) return null;\n  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity: parseArray(row.conference_activity),\n    callsForPapers: parseArray(row.calls_for_papers),\n    sourceActor: row.source_actor,\n    consentedAt: row.consented_at,\n    fetchedAt: row.fetched_at,\n  };`;

  const newReturn = `  if (!row) return null;\n\n  let conferenceActivity = parseArray(row.conference_activity);\n  let callsForPapers = parseArray(row.calls_for_papers);\n  const storedRawPosts = parseArray(row.raw_posts);\n\n  // Re-run CURRENT classification rules against the evidence-bearing raw posts already stored\n  // in Turso. This repairs stale CONFERENCE_MENTION rows immediately when a later release learns\n  // a more precise role phrase such as Core Presenter, Oral Presenter, Session Chair, or\n  // Technical Program Committee Co-Chair. It costs no additional Apify call.\n  if (storedRawPosts.length > 0) {\n    const reclassified = classifyPosts(storedRawPosts, row.linkedin_url);\n    const beforeActivity = JSON.stringify(conferenceActivity);\n    const beforeCalls = JSON.stringify(callsForPapers);\n    const afterActivity = JSON.stringify(reclassified.conferenceActivity);\n    const afterCalls = JSON.stringify(reclassified.callsForPapers);\n\n    conferenceActivity = reclassified.conferenceActivity;\n    callsForPapers = reclassified.callsForPapers;\n\n    if (beforeActivity !== afterActivity || beforeCalls !== afterCalls) {\n      await dbRun(\n        \"UPDATE linkedin_conference_activity SET conference_activity = ?, calls_for_papers = ? WHERE user_id = ?\",\n        [afterActivity, afterCalls, userId],\n      );\n      const roleCount = conferenceActivity.filter((item: any) => item?.kind === \"CONFERENCE_ROLE\" && item?.memberClaimed).length;\n      console.log(\`[linkedin-role-reclassify-v2] refreshed stored evidence posts=\${storedRawPosts.length} strong_roles=\${roleCount}\`);\n    }\n  }\n\n  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity,\n    callsForPapers,\n    sourceActor: row.source_actor,\n    consentedAt: row.consented_at,\n    fetchedAt: row.fetched_at,\n  };`;

  if (!source.includes('[linkedin-role-reclassify-v2] refreshed stored evidence')) {
    if (!source.includes(oldReturn)) {
      throw new Error('[linkedin-role-reclassify-v2] readStored return block not found');
    }
    source = source.replace(oldReturn, newReturn);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-reclassify-v2] server reclassifies stored evidence and uses all-v2 history source');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v1',
    'harvestapi/linkedin-profile-posts:all-v2',
  );
  source = source.replaceAll('FULL_LINKEDIN_HISTORY_SOURCE_V1', 'FULL_LINKEDIN_HISTORY_SOURCE_V2');

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-reclassify-v2] every linked account is forced through one all-v2 background history scan');
}
