import fs from 'node:fs';

// Final role reconciliation. This deliberately does not depend on the earlier classifier's
// memberClaim/repost decisions. It re-reads every stored public post, requires the post author to
// match the linked member, requires explicit first-person participation wording, and then extracts
// every specific conference role from the evidence. This is the last authority used by the profile.

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // Force one clean history pass after this reconciliation release.
  source = source.replaceAll('harvestapi/linkedin-profile-posts:all-v3', 'harvestapi/linkedin-profile-posts:all-v4');

  // Keep the complete returned history in raw_posts. Do not discard a useful role post just because
  // an older classifier failed to mark it relevant.
  source = source.replaceAll('JSON.stringify(relevantRawLinkedInPosts),', 'JSON.stringify(posts),');

  if (!source.includes('function deriveFinalConferenceRoles(')) {
    const anchor = 'async function readStored(userId: string) {';
    if (!source.includes(anchor)) throw new Error('[linkedin-role-final-v4] readStored anchor not found');

    const helper = `function deriveFinalConferenceRoles(posts: any[], requestedUrl: string): LinkedInConferenceSignal[] {
  const rolePatterns: Array<[RegExp, string]> = [
    [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, "Technical Program Committee Co-Chair"],
    [/\\bscientific program(?:me)? committee co[- ]?chair\\b/i, "Scientific Program Committee Co-Chair"],
    [/\\bprogram(?:me)? committee co[- ]?chair\\b/i, "Program Committee Co-Chair"],
    [/\\btechnical program(?:me)? committee chair\\b/i, "Technical Program Committee Chair"],
    [/\\bscientific program(?:me)? committee chair\\b/i, "Scientific Program Committee Chair"],
    [/\\bprogram(?:me)? committee chair\\b/i, "Program Committee Chair"],
    [/\\bsession co[- ]?chair\\b/i, "Session Co-Chair"],
    [/\\bsession chair\\b/i, "Session Chair"],
    [/\\btrack co[- ]?chair\\b/i, "Track Co-Chair"],
    [/\\btrack chair\\b/i, "Track Chair"],
    [/\\bcore presenter\\b/i, "Core Presenter"],
    [/\\boral presenter\\b/i, "Oral Presenter"],
    [/\\btechnical presenter\\b/i, "Technical Presenter"],
    [/\\bposter presenter\\b|\\bposter presentation\\b/i, "Poster Presenter"],
    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],
    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],
    [/\\b(?:invited|distinguished|guest) speaker\\b/i, "Invited Speaker"],
    [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel participant\\b|\\bpanel speaker\\b/i, "Panelist"],
    [/\\bmoderator\\b|\\bmoderating\\b/i, "Moderator"],
    [/\\bworkshop (?:presenter|leader|chair|instructor|facilitator|trainer)\\b|\\bdelivered (?:a |the )?workshop\\b/i, "Workshop Presenter"],
    [/\\b(?:technical|scientific|program|programme|organizing|organising|steering|advisory) committee member\\b|\\bcommittee member\\b/i, "Committee Member"],
    [/\\b(?:abstract|paper|technical|scientific|conference) reviewer\\b/i, "Reviewer"],
  ];

  const explicitParticipation = (value: string) => /\\b(?:honou?red to take part|honou?red to participate|proud to contribute(?: as)?|pleased to contribute(?: as)?|delighted to contribute(?: as)?|served as|serving as|participated as|joined as|contributed as|i\\s+(?:presented|spoke|chaired|moderated|served|participated|joined|contributed)|my\\s+(?:presentation|poster|paper|session|role)|pleased to|delighted to|excited to|thrilled to|privileged to)\\b/i.test(value);

  const yearFromPost = (post: Record<string, any>, text: string): number | null => {
    const fromText = extractYear(text);
    if (fromText) return fromText;
    const raw = clean(post.postedAt || post.publishedAt || post.createdAt || post.date || post.timestamp || post.postedOn || "");
    const match = raw.match(/\\b(20\\d{2})\\b/);
    return match ? Number(match[1]) : null;
  };

  const output: LinkedInConferenceSignal[] = [];
  posts.forEach((raw, index) => {
    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};
    if (!targetAuthorMatches(post, requestedUrl)) return;

    const content = postText(post);
    if (!content || !explicitParticipation(content)) return;

    let found = rolePatterns.filter(([pattern]) => pattern.test(content)).map(([, role]) => role);
    found = [...new Set(found)];
    if (!found.length) return;

    const sourceUrl = postUrl(post);
    const id = postId(post, index);
    const label = sentenceWithEvent(content);
    const year = yearFromPost(post, content);
    const evidenceText = content.length > 1400 ? content.slice(0, 1397) + "…" : content;

    found.forEach((role, roleIndex) => {
      output.push({
        id: id + ":final-role:" + roleIndex,
        kind: "CONFERENCE_ROLE",
        label,
        conferenceName: typeof extractConferenceName === "function" ? extractConferenceName(content) : label,
        role,
        year,
        sourceUrl,
        evidenceText,
        confidence: 99,
        memberClaimed: true,
        repostOrQuote: false,
        verified: false,
      });
    });
  });

  return output;
}

`;
    source = source.replace(anchor, helper + anchor);
  }

  if (!source.includes('[linkedin-role-final-v4] reconciled')) {
    const returnAnchor = `  return {\n    linkedinUrl: row.linkedin_url,\n    conferenceActivity,`;
    if (!source.includes(returnAnchor)) throw new Error('[linkedin-role-final-v4] final readStored return anchor not found');

    const reconciliation = `  const finalDerivedRoles = deriveFinalConferenceRoles(storedRawPosts, row.linkedin_url);\n  if (finalDerivedRoles.length > 0) {\n    const sourceKey = (item: any) => String(item?.sourceUrl || item?.id || item?.label || '').split(':final-role:')[0];\n    const derivedBySource = new Map<string, Set<string>>();\n    for (const item of finalDerivedRoles) {\n      const key = sourceKey(item);\n      if (!derivedBySource.has(key)) derivedBySource.set(key, new Set<string>());\n      derivedBySource.get(key)!.add(String(item.role || '').toLowerCase());\n    }\n\n    // Remove only generic legacy duplicates from the same post when a specific v4 role exists.\n    conferenceActivity = conferenceActivity.filter((item: any) => {\n      if (item?.kind !== \"CONFERENCE_ROLE\") return true;\n      const generic = /^(presenter|speaker|chair|co-chair)$/i.test(String(item?.role || ''));\n      if (!generic) return true;\n      return !derivedBySource.has(sourceKey(item));\n    });\n\n    const seen = new Set(\n      conferenceActivity\n        .filter((item: any) => item?.kind === \"CONFERENCE_ROLE\" && item?.role)\n        .map((item: any) => sourceKey(item) + '|' + String(item.role).toLowerCase()),\n    );\n    for (const item of finalDerivedRoles) {\n      const key = sourceKey(item) + '|' + String(item.role || '').toLowerCase();\n      if (seen.has(key)) continue;\n      seen.add(key);\n      conferenceActivity.push(item);\n    }\n\n    await dbRun(\n      \"UPDATE linkedin_conference_activity SET conference_activity = ? WHERE user_id = ?\",\n      [JSON.stringify(conferenceActivity), userId],\n    );\n    console.log(\`[linkedin-role-final-v4] reconciled posts=\${storedRawPosts.length} derived_roles=\${finalDerivedRoles.length} total_roles=\${conferenceActivity.filter((item: any) => item?.kind === \"CONFERENCE_ROLE\" && item?.memberClaimed).length}\`);\n  }\n\n`;

    source = source.replace(returnAnchor, reconciliation + returnAnchor);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-final-v4] installed final author-matched explicit-role reconciliation');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replaceAll('harvestapi/linkedin-profile-posts:all-v3', 'harvestapi/linkedin-profile-posts:all-v4');
  source = source.replaceAll('FULL_LINKEDIN_HISTORY_SOURCE_V3', 'FULL_LINKEDIN_HISTORY_SOURCE_V4');
  fs.writeFileSync(path, source);
  console.log('[linkedin-role-final-v4] every linked account gets one final all-v4 history refresh');
}
