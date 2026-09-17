import fs from 'node:fs';

// Independent final fallback for conference-role counters.
// This does NOT depend on the legacy conferenceActivity classifier or on any one HarvestAPI field
// name. It reads the full raw LinkedIn post history already stored for the exact public profile,
// recursively extracts human-readable strings from every returned post shape, detects explicit
// first-person conference roles, returns a direct role summary from /api/linkedin-conference/me,
// and merges those roles into the profile's existing role pipeline. This is intentionally the last
// role patch in the build.

// ---------------------------------------------------------------------------
// 1) SERVER: derive role summary directly from raw_posts on every /me read.
// ---------------------------------------------------------------------------
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  if (!source.includes('function deriveDirectRoleSummary(')) {
    const anchor = 'router.get("/me", requireMember, safe(async (req, res) => {';
    if (!source.includes(anchor)) throw new Error('[linkedin-role-direct] server /me route anchor not found');

    const helper = `function collectDirectLinkedInStrings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (value == null || depth > 10 || out.length >= 500) return out;
  if (typeof value === "string") {
    const text = clean(value);
    if (text && text.length >= 4 && text.length <= 8000 && !/^https?:\\/\\//i.test(text)) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDirectLinkedInStrings(item, depth + 1, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(?:url|uri|urn|id|imageUrl|videoUrl|trackingId|entityUrn)$/i.test(key)) continue;
      collectDirectLinkedInStrings(child, depth + 1, out);
      if (out.length >= 500) break;
    }
  }
  return out;
}

function directLinkedInPostText(post: Record<string, any>): string {
  const values = [...new Set(collectDirectLinkedInStrings(post))];
  return clean(values.join(" | "));
}

function deriveDirectRoleSummary(posts: any[]) {
  const rolePatterns: Array<[RegExp, string, string]> = [
    [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, "Technical Program Committee Co-Chair", "committee"],
    [/\\bscientific program(?:me)? committee co[- ]?chair\\b/i, "Scientific Program Committee Co-Chair", "committee"],
    [/\\bprogram(?:me)? committee co[- ]?chair\\b/i, "Program Committee Co-Chair", "committee"],
    [/\\btechnical program(?:me)? committee chair\\b/i, "Technical Program Committee Chair", "committee"],
    [/\\bscientific program(?:me)? committee chair\\b/i, "Scientific Program Committee Chair", "committee"],
    [/\\bprogram(?:me)? committee chair\\b/i, "Program Committee Chair", "committee"],
    [/\\bsession co[- ]?chair\\b/i, "Session Co-Chair", "sessionChair"],
    [/\\bsession chair\\b/i, "Session Chair", "sessionChair"],
    [/\\btrack co[- ]?chair\\b/i, "Track Co-Chair", "sessionChair"],
    [/\\btrack chair\\b/i, "Track Chair", "sessionChair"],
    [/\\bcore presenter\\b/i, "Core Presenter", "presenter"],
    [/\\boral presenter\\b/i, "Oral Presenter", "presenter"],
    [/\\btechnical presenter\\b/i, "Technical Presenter", "presenter"],
    [/\\bposter presenter\\b|\\bposter presentation\\b/i, "Poster Presenter", "presenter"],
    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker", "presenter"],
    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker", "presenter"],
    [/\\b(?:invited|distinguished|guest) speaker\\b/i, "Invited Speaker", "presenter"],
    [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel participant\\b|\\bpanel speaker\\b/i, "Panelist", "panel"],
    [/\\bmoderator\\b|\\bmoderating\\b/i, "Moderator", "panel"],
    [/\\bworkshop (?:presenter|leader|chair|instructor|facilitator|trainer)\\b|\\bdelivered (?:a |the )?workshop\\b/i, "Workshop Presenter", "workshop"],
    [/\\b(?:technical|scientific|program|programme|organizing|organising|steering|advisory) committee member\\b|\\bcommittee member\\b/i, "Committee Member", "committee"],
  ];

  const firstPerson = /\\b(?:honou?red to take part|honou?red to participate|proud to contribute(?: as)?|proud to (?:serve|present|chair|speak)|pleased to contribute(?: as)?|delighted to contribute(?: as)?|served as|serving as|participated as|joined as|contributed as|taking part as|i\\s+(?:presented|spoke|chaired|moderated|served|participated|joined|contributed|present)|my\\s+(?:presentation|poster|paper|session|role)|pleased to (?:present|speak|serve|chair|participate)|delighted to (?:present|speak|serve|chair|participate)|excited to (?:present|speak|serve|chair|participate)|thrilled to (?:present|speak|serve|chair|participate)|privileged to (?:present|speak|serve|chair|participate))\\b/i;

  const entries: any[] = [];
  const seen = new Set<string>();
  let textPosts = 0;
  let firstPersonPosts = 0;
  let rolePhrasePosts = 0;

  posts.forEach((raw, index) => {
    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};
    const type = clean(post.type || post.postType).toLowerCase();
    const explicitRepost = post.isRepost === true || post.repost === true || post.isQuotePost === true || post.quotePost === true || /repost|quote|reshare/.test(type);
    if (explicitRepost) return;

    // HarvestAPI has returned several different post schemas over time. Never assume the body is
    // in content/text/commentary. Recursively inspect all human-readable strings in the one raw post.
    const text = directLinkedInPostText(post);
    if (!text) return;
    textPosts += 1;

    const matchedRoles = rolePatterns.filter(([pattern]) => pattern.test(text));
    if (matchedRoles.length > 0) rolePhrasePosts += 1;
    if (!firstPerson.test(text)) return;
    firstPersonPosts += 1;
    if (!matchedRoles.length) return;

    const sourceUrl = postUrl(post);
    const baseId = postId(post, index);
    const label = sentenceWithEvent(text);
    const yearText = clean(post.postedAt || post.publishedAt || post.createdAt || post.date || post.timestamp || post.postedOn || "");
    const year = extractYear(text) || Number((yearText.match(/\\b(20\\d{2})\\b/) || [])[1] || 0) || null;

    for (const [, role, category] of matchedRoles) {
      const key = (sourceUrl || baseId) + '|' + role.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: baseId + ':direct:' + entries.length,
        role,
        category,
        sourceUrl,
        label,
        year,
        evidenceText: text.length > 1800 ? text.slice(0, 1797) + "…" : text,
      });
    }
  });

  return {
    total: entries.length,
    presenter: entries.filter((entry) => entry.category === "presenter").length,
    committee: entries.filter((entry) => entry.category === "committee").length,
    sessionChair: entries.filter((entry) => entry.category === "sessionChair").length,
    panel: entries.filter((entry) => entry.category === "panel").length,
    workshop: entries.filter((entry) => entry.category === "workshop").length,
    roles: entries,
    debug: { textPosts, firstPersonPosts, rolePhrasePosts },
  };
}

`;
    source = source.replace(anchor, helper + anchor);
  }

  const routeStart = source.indexOf('router.get("/me", requireMember, safe(async (req, res) => {');
  if (routeStart === -1) throw new Error('[linkedin-role-direct] server /me route start not found');
  const routeEnd = source.indexOf('\n}));', routeStart);
  if (routeEnd === -1) throw new Error('[linkedin-role-direct] server /me route end not found');
  const currentRoute = source.slice(routeStart, routeEnd + 5);

  if (!currentRoute.includes('roleSummary')) {
    const replacement = `router.get("/me", requireMember, safe(async (req, res) => {
  const userId = req.linkedinConferenceUserId!;
  const activity = await readStored(userId);
  const { dbGet } = await import("./db");
  const rawRow = await dbGet<{ raw_posts: string }>(
    "SELECT raw_posts FROM linkedin_conference_activity WHERE user_id = ?",
    [userId],
  );
  const rawPosts = parseArray(rawRow?.raw_posts);
  const roleSummary = deriveDirectRoleSummary(rawPosts);
  console.log(\`[linkedin-role-direct] raw_posts=\${rawPosts.length} text_posts=\${roleSummary.debug.textPosts} first_person_posts=\${roleSummary.debug.firstPersonPosts} role_phrase_posts=\${roleSummary.debug.rolePhrasePosts} roles=\${roleSummary.total} presenter=\${roleSummary.presenter} committee=\${roleSummary.committee} session_chair=\${roleSummary.sessionChair}\`);
  res.json({
    activity,
    roleSummary,
    apifyConfigured: Boolean(process.env.APIFY_TOKEN?.trim()),
  });
}));`;
    source = source.slice(0, routeStart) + replacement + source.slice(routeEnd + 5);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-direct] schema-independent recursive raw-post role summary installed');
}

// ---------------------------------------------------------------------------
// 2) CLIENT API: expose the direct role summary returned by /me.
// ---------------------------------------------------------------------------
{
  const path = 'src/api/linkedinConferenceActivity.ts';
  let source = fs.readFileSync(path, 'utf8');

  if (!source.includes('export interface LinkedInDirectRoleSummary')) {
    const anchor = 'export interface LinkedInConferenceImportResult {';
    if (!source.includes(anchor)) throw new Error('[linkedin-role-direct] client import-result anchor not found');
    const types = `export interface LinkedInDirectRoleEntry {
  id: string;
  role: string;
  category: 'presenter' | 'committee' | 'sessionChair' | 'panel' | 'workshop';
  sourceUrl: string | null;
  label: string;
  year: number | null;
  evidenceText: string;
}

export interface LinkedInDirectRoleSummary {
  total: number;
  presenter: number;
  committee: number;
  sessionChair: number;
  panel: number;
  workshop: number;
  roles: LinkedInDirectRoleEntry[];
  debug?: { textPosts: number; firstPersonPosts: number; rolePhrasePosts: number };
}

`;
    source = source.replace(anchor, types + anchor);
  }

  const oldSignature = `export async function fetchLinkedInConferenceActivity(): Promise<{
  activity: LinkedInConferenceActivity | null;
  apifyConfigured: boolean;
}> {`;
  const newSignature = `export async function fetchLinkedInConferenceActivity(): Promise<{
  activity: LinkedInConferenceActivity | null;
  roleSummary?: LinkedInDirectRoleSummary;
  apifyConfigured: boolean;
}> {`;
  if (!source.includes(newSignature)) {
    if (!source.includes(oldSignature)) throw new Error('[linkedin-role-direct] client fetch signature anchor not found');
    source = source.replace(oldSignature, newSignature);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-direct] client API exposes direct role summary');
}

// ---------------------------------------------------------------------------
// 3) PROFILE UI: merge direct raw-post roles into the exact same downstream role list/counters.
// ---------------------------------------------------------------------------
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const stateAnchor = '  const [linkedInConferenceActivity, setLinkedInConferenceActivity] = useState<LinkedInConferenceActivity | null>(null);';
  const stateAfter = `${stateAnchor}
  const [directLinkedInRoleSummary, setDirectLinkedInRoleSummary] = useState({
    total: 0,
    presenter: 0,
    committee: 0,
    sessionChair: 0,
    panel: 0,
    workshop: 0,
    roles: [] as Array<{ id: string; role: string; category: string; sourceUrl: string | null; label: string; year: number | null; evidenceText: string }>,
  });`;
  if (!source.includes('const [directLinkedInRoleSummary')) {
    if (!source.includes(stateAnchor)) throw new Error('[linkedin-role-direct] profile LinkedIn state anchor not found');
    source = source.replace(stateAnchor, stateAfter);
  }

  const fetchBefore = `      .then((result) => {
        if (!cancelled) setLinkedInConferenceActivity(result.activity);
      })`;
  const fetchAfter = `      .then((result) => {
        if (!cancelled) {
          setLinkedInConferenceActivity(result.activity);
          if (result.roleSummary) setDirectLinkedInRoleSummary(result.roleSummary);
        }
      })`;
  if (!source.includes(fetchAfter)) {
    if (!source.includes(fetchBefore)) throw new Error('[linkedin-role-direct] profile initial activity fetch anchor not found');
    source = source.replace(fetchBefore, fetchAfter);
  }

  // When the background all-post scan finishes, immediately re-read /me so counters update without
  // requiring logout or another browser session.
  const eventBefore = `      if (activity) setLinkedInConferenceActivity(activity);`;
  const eventAfter = `      if (activity) setLinkedInConferenceActivity(activity);
      fetchLinkedInConferenceActivity()
        .then((result) => {
          setLinkedInConferenceActivity(result.activity);
          if (result.roleSummary) setDirectLinkedInRoleSummary(result.roleSummary);
        })
        .catch(() => null);`;
  if (!source.includes(eventAfter) && source.includes(eventBefore)) {
    source = source.replace(eventBefore, eventAfter);
  }

  const signalsAnchor = '  const linkedInSignals = linkedInConferenceActivity?.conferenceActivity || [];';
  if (!source.includes('const directLinkedInRoleSignals = useMemo')) {
    const directSignals = `${signalsAnchor}
  const directLinkedInRoleSignals = useMemo<LinkedInConferenceSignal[]>(
    () => directLinkedInRoleSummary.roles.map((entry, index) => ({
      id: entry.id || 'direct-linkedin-role-' + index,
      kind: 'CONFERENCE_ROLE' as const,
      label: entry.label || entry.role,
      conferenceName: entry.label || null,
      role: entry.role,
      year: entry.year,
      sourceUrl: entry.sourceUrl,
      evidenceText: entry.evidenceText,
      confidence: 99,
      memberClaimed: true,
      repostOrQuote: false,
      verified: false as const,
    })),
    [directLinkedInRoleSummary.roles],
  );`;
    if (!source.includes(signalsAnchor)) throw new Error('[linkedin-role-direct] linkedInSignals anchor not found');
    source = source.replace(signalsAnchor, directSignals);
  }

  const mergeCandidates = [
    '() => [...linkedInSignals, ...evidenceDerivedRoleSignals].filter((signal) =>',
    '() => linkedInSignals.filter((signal) =>',
  ];
  if (!source.includes('...directLinkedInRoleSignals].filter((signal) =>')) {
    const found = mergeCandidates.find((candidate) => source.includes(candidate));
    if (!found) throw new Error('[linkedin-role-direct] strong role merge anchor not found');
    const replacement = found.startsWith('() => [...linkedInSignals')
      ? '() => [...linkedInSignals, ...evidenceDerivedRoleSignals, ...directLinkedInRoleSignals].filter((signal) =>'
      : '() => [...linkedInSignals, ...directLinkedInRoleSignals].filter((signal) =>';
    source = source.replace(found, replacement);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-direct] profile merges schema-independent raw-post roles into all counters and lists');
}
