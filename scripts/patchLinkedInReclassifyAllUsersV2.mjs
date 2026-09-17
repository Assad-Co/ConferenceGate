import fs from 'node:fs';

// LinkedIn conference-role classifier final refresh.
// 1) Reclassify already-stored evidence posts with CURRENT role rules on every read.
// 2) Bump the complete-history source version to all-v3 so existing linked accounts get one
//    fresh scan after the final role-counter fix. This also repairs accounts whose older raw-post
//    cache was empty or incomplete.

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v1',
    'harvestapi/linkedin-profile-posts:all-v3',
  );
  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v2',
    'harvestapi/linkedin-profile-posts:all-v3',
  );

  const oldImport = '  const { dbGet } = await import("./db");';
  const newImport = '  const { dbGet, dbRun } = await import("./db");';
  if (!source.includes(newImport)) {
    if (!source.includes(oldImport)) {
      throw new Error('[linkedin-role-reclassify-v3] readStored db import anchor not found');
    }
    source = source.replace(oldImport, newImport);
  }

  const oldReturn = `  if (!row) return null;\n  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity: parseArray(row.conference_activity),\n    callsForPapers: parseArray(row.calls_for_papers),\n    sourceActor: row.source_actor,\n    consentedAt: row.consented_at,\n    fetchedAt: row.fetched_at,\n  };`;

  const newReturn = `  if (!row) return null;\n\n  let conferenceActivity = parseArray(row.conference_activity);\n  let callsForPapers = parseArray(row.calls_for_papers);\n  const storedRawPosts = parseArray(row.raw_posts);\n\n  // Re-run CURRENT classification rules against evidence-bearing raw posts already stored in\n  // Turso. This immediately repairs stale CONFERENCE_MENTION rows without another paid scrape.\n  if (storedRawPosts.length > 0) {\n    const reclassified = classifyPosts(storedRawPosts, row.linkedin_url);\n    const beforeActivity = JSON.stringify(conferenceActivity);\n    const beforeCalls = JSON.stringify(callsForPapers);\n    const afterActivity = JSON.stringify(reclassified.conferenceActivity);\n    const afterCalls = JSON.stringify(reclassified.callsForPapers);\n\n    conferenceActivity = reclassified.conferenceActivity;\n    callsForPapers = reclassified.callsForPapers;\n\n    if (beforeActivity !== afterActivity || beforeCalls !== afterCalls) {\n      await dbRun(\n        \"UPDATE linkedin_conference_activity SET conference_activity = ?, calls_for_papers = ? WHERE user_id = ?\",\n        [afterActivity, afterCalls, userId],\n      );\n      const roleCount = conferenceActivity.filter((item: any) => item?.kind === \"CONFERENCE_ROLE\" && item?.memberClaimed).length;\n      console.log(\`[linkedin-role-reclassify-v3] refreshed stored evidence posts=\${storedRawPosts.length} strong_roles=\${roleCount}\`);\n    }\n  }\n\n  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity,\n    callsForPapers,\n    sourceActor: row.source_actor,\n    consentedAt: row.consented_at,\n    fetchedAt: row.fetched_at,\n  };`;

  if (!source.includes('[linkedin-role-reclassify-v3] refreshed stored evidence')) {
    if (source.includes('[linkedin-role-reclassify-v2] refreshed stored evidence')) {
      source = source.replaceAll('[linkedin-role-reclassify-v2]', '[linkedin-role-reclassify-v3]');
    } else if (source.includes(oldReturn)) {
      source = source.replace(oldReturn, newReturn);
    } else {
      throw new Error('[linkedin-role-reclassify-v3] readStored return block not found');
    }
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-reclassify-v3] server reclassifies stored evidence and uses all-v3 history source');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v1',
    'harvestapi/linkedin-profile-posts:all-v3',
  );
  source = source.replaceAll(
    'harvestapi/linkedin-profile-posts:all-v2',
    'harvestapi/linkedin-profile-posts:all-v3',
  );
  source = source.replaceAll('FULL_LINKEDIN_HISTORY_SOURCE_V1', 'FULL_LINKEDIN_HISTORY_SOURCE_V3');
  source = source.replaceAll('FULL_LINKEDIN_HISTORY_SOURCE_V2', 'FULL_LINKEDIN_HISTORY_SOURCE_V3');

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-reclassify-v3] every linked account is forced through one final all-v3 background history scan');
}
