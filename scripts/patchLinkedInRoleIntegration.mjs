import fs from 'node:fs';

function replaceOnce(source, before, after, label, path) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-role-integration] ${path}: anchor not found (${label})`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

// ---------------------------------------------------------------------------
// 1) SERVER: scan deeper history and preserve EVERY explicit conference role
//    mentioned in a member's own public LinkedIn post. One post can therefore
//    produce Core Presenter + Oral Presenter + Session Chair + Committee Co-Chair.
// ---------------------------------------------------------------------------
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replace('const MAX_POSTS = 400;', 'const MAX_POSTS = 1000;');
  source = source.replace(
    '    conferenceActivity: dedupe(conferenceActivity).slice(0, 400),',
    '    conferenceActivity: dedupe(conferenceActivity).slice(0, 1000),',
  );
  source = source.replace(
    '    callsForPapers: dedupe(callsForPapers).slice(0, 250),',
    '    callsForPapers: dedupe(callsForPapers).slice(0, 500),',
  );
  source = source.replace(
    '    endpoint.searchParams.set("maxTotalChargeUsd", "1.20");',
    '    endpoint.searchParams.set("maxTotalChargeUsd", "2.50");',
  );

  // Optional structured conference name used by the UI. Existing stored rows remain compatible.
  const typeAnchor = '  label: string;\n  role: string | null;';
  const typeAfter = '  label: string;\n  conferenceName?: string | null;\n  role: string | null;';
  if (!source.includes(typeAfter)) {
    if (!source.includes(typeAnchor)) throw new Error('[linkedin-role-integration] server signal type anchor not found');
    source = source.replace(typeAnchor, typeAfter);
  }

  const roleStart = source.indexOf('function detectRole(value: string): string | null {');
  const roleEnd = source.indexOf('\nfunction explicitSelfClaim', roleStart);
  if (roleStart === -1 || roleEnd === -1) {
    throw new Error('[linkedin-role-integration] detectRole function not found');
  }

  const richerRoleDetector = `function detectRoles(value: string): string[] {
  // Most-specific first. A single post can contain several of these roles and every one is kept.
  const roles: Array<[RegExp, string]> = [
    [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, "Technical Program Committee Co-Chair"],
    [/\\bscientific program(?:me)? committee co[- ]?chair\\b/i, "Scientific Program Committee Co-Chair"],
    [/\\bprogram(?:me)? committee co[- ]?chair\\b/i, "Program Committee Co-Chair"],
    [/\\btechnical committee co[- ]?chair\\b/i, "Technical Committee Co-Chair"],
    [/\\bscientific committee co[- ]?chair\\b/i, "Scientific Committee Co-Chair"],
    [/\\borganizing committee co[- ]?chair\\b|\\borganising committee co[- ]?chair\\b/i, "Organizing Committee Co-Chair"],
    [/\\btechnical program(?:me)? committee chair\\b/i, "Technical Program Committee Chair"],
    [/\\bscientific program(?:me)? committee chair\\b/i, "Scientific Program Committee Chair"],
    [/\\bprogram(?:me)? committee chair\\b/i, "Program Committee Chair"],
    [/\\btechnical committee chair\\b/i, "Technical Committee Chair"],
    [/\\bscientific committee chair\\b/i, "Scientific Committee Chair"],
    [/\\bsession co[- ]?chair\\b/i, "Session Co-Chair"],
    [/\\bsession chair\\b/i, "Session Chair"],
    [/\\btrack co[- ]?chair\\b/i, "Track Co-Chair"],
    [/\\btrack chair\\b/i, "Track Chair"],
    [/\\bcore presenter\\b/i, "Core Presenter"],
    [/\\boral presenter\\b|\\boral presentation presenter\\b/i, "Oral Presenter"],
    [/\\btechnical presenter\\b/i, "Technical Presenter"],
    [/\\bposter presenter\\b|\\bposter presentation\\b|\\bmy poster\\b/i, "Poster Presenter"],
    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],
    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],
    [/\\b(?:invited|distinguished|guest) speaker\\b/i, "Invited Speaker"],
    [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel speaker\\b|\\bpanel participant\\b/i, "Panelist"],
    [/\\bmoderator\\b|\\bmoderating\\b/i, "Moderator"],
    [/\\bworkshop (?:presenter|leader|chair|instructor|facilitator|trainer)\\b/i, "Workshop Presenter"],
    [/\\bworkshop delivered\\b|\\bdelivered (?:a |the )?workshop\\b/i, "Workshop Presenter"],
    [/\\b(?:technical|scientific|program|programme|organizing|organising|steering|advisory) committee member\\b/i, "Committee Member"],
    [/\\bcommittee member\\b/i, "Committee Member"],
    [/\\b(?:abstract|paper|technical|scientific|conference) reviewer\\b/i, "Reviewer"],
    [/\\b(?:session|track|program|programme|scientific|technical) chair\\b/i, "Chair"],
    [/\\bco[- ]?chair\\b/i, "Co-Chair"],
    [/\\b(?:oral|technical|session|invited)?\\s*presenter\\b|\\bpresenting\\b/i, "Presenter"],
    [/\\bspeaker\\b|\\bspeaking\\b/i, "Speaker"],
  ];
  const found: string[] = [];
  for (const [re, label] of roles) {
    if (re.test(value) && !found.includes(label)) found.push(label);
  }
  return found;
}

function detectRole(value: string): string | null {
  return detectRoles(value)[0] || null;
}
`;
  source = source.slice(0, roleStart) + richerRoleDetector + source.slice(roleEnd + 1);

  // Add a conservative conference-name extractor. It only runs on a sentence already identified
  // as conference evidence; if it cannot confidently shorten it, the original evidence label wins.
  const classifyAnchor = 'function classifyPosts(posts: any[], requestedUrl: string) {';
  if (!source.includes('function extractConferenceName(value: string): string | null {')) {
    const helper = `function extractConferenceName(value: string): string | null {
  const eventSentence = value
    .split(/(?<=[.!?])\\s+|\\n+/)
    .map((part) => clean(part))
    .find((part) => hasEventSignal(part) || /\\b(?:session|committee|presenter|speaker|panelist|chair)\\b/i.test(part));
  if (!eventSentence) return null;

  let candidate = eventSentence
    .replace(/^(?:honou?red|pleased|delighted|excited|thrilled|privileged|grateful|proud|happy|glad)\\s+to\\s+(?:take part|participate|join|attend|contribute|present|speak)\\s+(?:in|at|to)\\s+(?:the\\s+)?/i, '')
    .replace(/^i\\s+(?:attended|participated in|joined|spoke at|presented at|chaired at)\\s+(?:the\\s+)?/i, '')
    .replace(/^(?:at|in|for|during)\\s+(?:the\\s+)?/i, '')
    .trim();

  candidate = candidate
    .replace(/\\s+(?:in|at)\\s+[A-Z][A-Za-z .'-]{1,45}$/i, '')
    .replace(/[,;:]?\\s+(?:taking place|happening|held|scheduled)\\b.*$/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  if (candidate.length < 5 || candidate.length > 180) return null;
  return candidate;
}

`;
    const idx = source.indexOf(classifyAnchor);
    if (idx === -1) throw new Error('[linkedin-role-integration] classifyPosts anchor not found');
    source = source.slice(0, idx) + helper + source.slice(idx);
  }

  source = replaceOnce(
    source,
    '    const role = detectRole(content);',
    '    const roles = detectRoles(content);\n    const role = roles[0] || null;',
    'multi-role detection',
    path,
  );

  const labelAnchor = '    const label = sentenceWithEvent(primaryContent || content);';
  if (source.includes(labelAnchor) && !source.includes('    const conferenceName = extractConferenceName(primaryContent || content);')) {
    source = source.replace(
      labelAnchor,
      labelAnchor + '\n    const conferenceName = extractConferenceName(primaryContent || content);',
    );
  }

  // DeepEvidenceRefinement already allows several evidence kinds from one post. Add the missing
  // many-role behavior immediately after its final supplemental achievement line.
  const supplementalAnchor = '    addSupplemental("AWARD", hasAward && !hasCertificate, !repostOrQuote && selfClaim, !repostOrQuote && selfClaim ? 91 : repostOrQuote ? 52 : 74);';
  if (!source.includes('const strongRoleClaim = !repostOrQuote')) {
    const roleBlock = `

    // Preserve every explicit role from the member's own post instead of collapsing the post to
    // the first keyword. This is what turns e.g. Core Presenter + Oral Presenter + Session Chair +
    // Technical Program Committee Co-Chair into four distinct ConferenceGate role records.
    const strongRoleClaim = !repostOrQuote && roles.length > 0 && (selfClaim || explicitParticipationClaim(content));
    if (strongRoleClaim) {
      roles.forEach((detectedRole, roleIndex) => {
        if (detectedRole === role) return; // the primary CONFERENCE_ROLE already carries this one
        conferenceActivity.push({
          id: id + ":role:" + roleIndex,
          kind: "CONFERENCE_ROLE",
          label,
          conferenceName,
          role: detectedRole,
          year,
          sourceUrl,
          evidenceText: richEvidence,
          confidence: 95,
          memberClaimed: true,
          repostOrQuote: false,
          verified: false,
        });
      });
    }`;
    if (!source.includes(supplementalAnchor)) {
      throw new Error('[linkedin-role-integration] supplemental evidence anchor not found');
    }
    source = source.replace(supplementalAnchor, supplementalAnchor + roleBlock);
  }

  // Attach a structured conference name to every signal, including signals produced by older
  // classification branches and supplemental evidence.
  const dedupeAnchor = '  const dedupe = <T extends { id: string }>(items: T[]) => {';
  if (!source.includes('signal.conferenceName = signal.conferenceName ||')) {
    const enrichment = `  for (const signal of conferenceActivity) {
    signal.conferenceName = signal.conferenceName || extractConferenceName(signal.evidenceText || signal.label) || signal.label;
  }

`;
    const idx = source.indexOf(dedupeAnchor);
    if (idx === -1) throw new Error('[linkedin-role-integration] dedupe anchor not found');
    source = source.slice(0, idx) + enrichment + source.slice(idx);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-integration] server scans up to 1000 posts and preserves every explicit conference role');
}

// ---------------------------------------------------------------------------
// 2) CLIENT API: expose the optional structured conference name.
// ---------------------------------------------------------------------------
{
  const path = 'src/api/linkedinConferenceActivity.ts';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = '  label: string;\n  role: string | null;';
  const after = '  label: string;\n  conferenceName?: string | null;\n  role: string | null;';
  if (!source.includes(after)) {
    if (!source.includes(anchor)) throw new Error('[linkedin-role-integration] client signal type anchor not found');
    source = source.replace(anchor, after);
  }
  fs.writeFileSync(path, source);
  console.log('[linkedin-role-integration] client signal type exposes conferenceName');
}

// ---------------------------------------------------------------------------
// 3) PROFILE UI: merge strong LinkedIn member claims into the existing Conference History and
//    Committee & Leadership counters, with the LinkedIn post kept as the evidence source.
// ---------------------------------------------------------------------------
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const importAnchor = "import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';";
  const importAfter = `${importAnchor}\nimport { fetchLinkedInConferenceActivity, type LinkedInConferenceActivity, type LinkedInConferenceSignal } from '../api/linkedinConferenceActivity';`;
  if (!source.includes("fetchLinkedInConferenceActivity, type LinkedInConferenceActivity")) {
    if (!source.includes(importAnchor)) throw new Error('[linkedin-role-integration] cross-tab import anchor not found');
    source = source.replace(importAnchor, importAfter);
  }

  const committeeStateAnchor = '  const [isAddCommitteeOpen, setIsAddCommitteeOpen] = useState(false);';
  if (!source.includes('const [linkedInConferenceActivity, setLinkedInConferenceActivity]')) {
    const stateBlock = `${committeeStateAnchor}

  // Strong first-person claims from the member's own public LinkedIn posts are evidence-backed
  // ConferenceGate records. They are distinct from a ConferenceGate registration, but they should
  // still populate Conference History and leadership-role counters rather than living in a silo.
  const [linkedInConferenceActivity, setLinkedInConferenceActivity] = useState<LinkedInConferenceActivity | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLinkedInConferenceActivity()
      .then((result) => {
        if (!cancelled) setLinkedInConferenceActivity(result.activity);
      })
      .catch(() => {
        if (!cancelled) setLinkedInConferenceActivity(null);
      });
    return () => { cancelled = true; };
  }, [currentUserId]);`;
    if (!source.includes(committeeStateAnchor)) throw new Error('[linkedin-role-integration] committee state anchor not found');
    source = source.replace(committeeStateAnchor, stateBlock);
  }

  // Replace the existing committeeEntries calculation with one that merges LinkedIn evidence.
  const committeeStart = source.indexOf('  const committeeEntries = [');
  const committeeEndNeedle = '\n\n  const conferenceGateIndex = Math.min(';
  const committeeEnd = source.indexOf(committeeEndNeedle, committeeStart);
  if (committeeStart === -1 || committeeEnd === -1) throw new Error('[linkedin-role-integration] committeeEntries block not found');

  if (!source.includes('const strongLinkedInRoleSignals = useMemo')) {
    const mergedBlock = `  const linkedInSignals = linkedInConferenceActivity?.conferenceActivity || [];
  const strongLinkedInRoleSignals = useMemo(
    () => linkedInSignals.filter((signal) =>
      signal.kind === 'CONFERENCE_ROLE' &&
      signal.memberClaimed &&
      !signal.repostOrQuote &&
      signal.confidence >= 90 &&
      Boolean(signal.role)
    ),
    [linkedInSignals],
  );

  const roleEvidenceKey = (signal: LinkedInConferenceSignal) =>
    [signal.sourceUrl || signal.conferenceName || signal.label, signal.year || '', (signal.role || '').toLowerCase()].join('|');

  const uniqueStrongRoleSignals = useMemo(() => {
    const seen = new Set<string>();
    return strongLinkedInRoleSignals.filter((signal) => {
      const key = roleEvidenceKey(signal);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [strongLinkedInRoleSignals]);

  const linkedInLeadershipEntries = useMemo(
    () => uniqueStrongRoleSignals
      .filter((signal) => /committee|session (?:co-)?chair|track (?:co-)?chair|\\bchair\\b/i.test(signal.role || ''))
      .map((signal) => ({
        title: signal.conferenceName || signal.label,
        conferenceName: signal.conferenceName || signal.label,
        year: signal.year || new Date().getUTCFullYear(),
        roleLabel: signal.role || 'Conference Role',
        sourceUrl: signal.sourceUrl,
        evidenceSource: 'linkedin' as const,
      })),
    [uniqueStrongRoleSignals],
  );

  const existingCommitteeEntries = [
    ...userProfile.verifiedAchievements
      .filter((a) => a.badgeType === 'committee' || a.badgeType === 'chair')
      .map((a) => ({
        title: a.title,
        conferenceName: a.conferenceName,
        year: a.year,
        roleLabel: a.badgeType === 'chair' ? 'Session Chair' : 'Committee Member',
        sourceUrl: null as string | null,
        evidenceSource: 'conferencegate' as const,
      })),
    ...userProfile.timeline.flatMap((yr) =>
      yr.items
        .filter((item) => /committee|chair/i.test(item.role))
        .map((item) => ({
          title: item.title,
          conferenceName: item.conference,
          year: yr.year,
          roleLabel: item.role,
          sourceUrl: null as string | null,
          evidenceSource: 'conferencegate' as const,
        }))
    ),
  ];

  const committeeEntries = [...existingCommitteeEntries, ...linkedInLeadershipEntries]
    .filter((entry, idx, arr) => arr.findIndex((other) =>
      other.conferenceName.toLowerCase() === entry.conferenceName.toLowerCase() &&
      other.year === entry.year &&
      other.roleLabel.toLowerCase() === entry.roleLabel.toLowerCase()
    ) === idx)
    .sort((a, b) => b.year - a.year);

  const linkedInCommitteeCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /committee/i.test(signal.role || '')).map(roleEvidenceKey)
  ).size;
  const linkedInSessionChairCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /(?:session|track) (?:co-)?chair|^chair$/i.test(signal.role || '')).map(roleEvidenceKey)
  ).size;
  const linkedInPanelCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /panelist|panel participant|moderator/i.test(signal.role || '')).map(roleEvidenceKey)
  ).size;
  const linkedInWorkshopCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /workshop/i.test(signal.role || '')).map(roleEvidenceKey)
  ).size;
  const linkedInOralPresentationCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /core presenter|oral presenter|technical presenter|^presenter$/i.test(signal.role || '')).map((signal) => signal.sourceUrl || signal.label)
  ).size;
  const linkedInPosterPresentationCount = new Set(
    uniqueStrongRoleSignals.filter((signal) => /poster presenter/i.test(signal.role || '')).map((signal) => signal.sourceUrl || signal.label)
  ).size;

  const committeePositionCount = Math.max(userProfile.contributions.technicalCommittees, linkedInCommitteeCount);
  const sessionChairCount = Math.max(userProfile.contributions.sessionsChaired, linkedInSessionChairCount);
  const panelParticipationCount = Math.max(userProfile.contributions.panelsParticipated, linkedInPanelCount);
  const workshopDeliveredCount = Math.max(userProfile.contributions.workshopsDelivered, linkedInWorkshopCount);
  const oralPresentationCount = Math.max(userProfile.contributions.oralPresentations, linkedInOralPresentationCount);
  const posterPresentationCount = Math.max(userProfile.contributions.posterPresentations, linkedInPosterPresentationCount);

  const linkedInVerifiedConferences = useMemo(() => {
    const strongSignals = linkedInSignals.filter((signal) =>
      signal.memberClaimed && !signal.repostOrQuote && signal.confidence >= 90 &&
      ['PAST_CONFERENCE', 'CONFERENCE_ROLE', 'PAPER_ABSTRACT'].includes(signal.kind)
    );
    const grouped = new Map<string, {
      id: string;
      title: string;
      location: string;
      roleLabel: string;
      organizerName: string;
      eventDate: string;
      defaultRole: ConferenceRole;
      sourceUrl: string | null;
      verificationSource: 'linkedin';
      year: number | null;
    }>();

    for (const signal of strongSignals) {
      const key = signal.sourceUrl || [signal.conferenceName || signal.label, signal.year || ''].join('|');
      const existing = grouped.get(key);
      const role = signal.role || (signal.kind === 'PAPER_ABSTRACT' ? 'Presenter' : 'Attendee');
      if (existing) {
        const roles = new Set(existing.roleLabel.split(' • ').filter(Boolean));
        roles.add(role);
        existing.roleLabel = [...roles].join(' • ');
        continue;
      }
      grouped.set(key, {
        id: 'linkedin-' + Math.abs([...key].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)),
        title: signal.conferenceName || signal.label,
        location: '',
        roleLabel: role,
        organizerName: '',
        eventDate: signal.year ? String(signal.year) : '',
        defaultRole: 'Attendee' as ConferenceRole,
        sourceUrl: signal.sourceUrl,
        verificationSource: 'linkedin',
        year: signal.year,
      });
    }
    return [...grouped.values()];
  }, [linkedInSignals]);

  const verifiedConferenceEntries = [
    ...ATTENDED_CONFERENCES.map((entry) => ({ ...entry, sourceUrl: null as string | null, verificationSource: 'registration' as const, year: null as number | null })),
    ...linkedInVerifiedConferences,
  ].filter((entry, index, array) => array.findIndex((other) =>
    other.title.toLowerCase() === entry.title.toLowerCase() &&
    (other.year || '') === (entry.year || '')
  ) === index);`;

    source = source.slice(0, committeeStart) + mergedBlock + source.slice(committeeEnd);
  }

  // Counters in Committee & Leadership Roles.
  source = source.replace(
    '{userProfile.contributions.technicalCommittees}</div>',
    '{committeePositionCount}</div>',
  );
  source = source.replace(
    '{userProfile.contributions.sessionsChaired}</div>',
    '{sessionChairCount}</div>',
  );
  source = source.replace(
    '{userProfile.contributions.panelsParticipated}</div>',
    '{panelParticipationCount}</div>',
  );
  source = source.replace(
    '{userProfile.contributions.workshopsDelivered}</div>',
    '{workshopDeliveredCount}</div>',
  );

  // Presented-paper counters: first-person LinkedIn presenter evidence can fill an otherwise empty
  // account record, while ConferenceGate-native activity remains authoritative when larger.
  source = source.replace(
    '{userProfile.contributions.oralPresentations + userProfile.contributions.posterPresentations} Papers',
    '{oralPresentationCount + posterPresentationCount} Papers',
  );
  source = source.replace(
    '{userProfile.contributions.oralPresentations}</div>',
    '{oralPresentationCount}</div>',
  );
  source = source.replace(
    '{userProfile.contributions.posterPresentations}</div>',
    '{posterPresentationCount}</div>',
  );

  // Add evidence links to leadership-role rows when the role came from LinkedIn.
  const roleMetaBefore = `<p className="text-[11px] text-slate-500">{entry.conferenceName} • {entry.year}</p>`;
  const roleMetaAfter = `<p className="text-[11px] text-slate-500">{entry.conferenceName} • {entry.year}</p>
                        {entry.sourceUrl && (
                          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:underline mt-1">
                            <ExternalLink className="w-3 h-3" /> LinkedIn evidence
                          </a>
                        )}`;
  if (!source.includes('LinkedIn evidence\n                          </a>')) {
    if (!source.includes(roleMetaBefore)) throw new Error('[linkedin-role-integration] committee row meta anchor not found');
    source = source.replace(roleMetaBefore, roleMetaAfter);
  }

  // Replace registration-only conference history with a merged registration + strong LinkedIn
  // evidence list. LinkedIn entries retain an explicit provenance badge and evidence link.
  source = source.replace('            {ATTENDED_CONFERENCES.length > 0 ? (', '            {verifiedConferenceEntries.length > 0 ? (');
  source = source.replace('                {ATTENDED_CONFERENCES.map((conf) => (', '                {verifiedConferenceEntries.map((conf) => (');

  const confTitleBefore = `<ConferenceLink
                        conferences={conferences}
                        conferenceId={conf.id}
                        conferenceTitle={conf.title}
                        onSelectConference={onSelectConference}
                        className="font-bold text-xs text-slate-900"
                      />`;
  const confTitleAfter = `{conf.verificationSource === 'registration' ? (
                        <ConferenceLink
                          conferences={conferences}
                          conferenceId={conf.id}
                          conferenceTitle={conf.title}
                          onSelectConference={onSelectConference}
                          className="font-bold text-xs text-slate-900"
                        />
                      ) : (
                        <h4 className="font-bold text-xs text-slate-900">{conf.title}</h4>
                      )}`;
  if (!source.includes("conf.verificationSource === 'registration'")) {
    if (!source.includes(confTitleBefore)) throw new Error('[linkedin-role-integration] verified conference title anchor not found');
    source = source.replace(confTitleBefore, confTitleAfter);
  }

  const confMetaBefore = `<p className="text-[11px] text-slate-500">{conf.location} • {conf.roleLabel}</p>`;
  const confMetaAfter = `<p className="text-[11px] text-slate-500">{[conf.location, conf.roleLabel].filter(Boolean).join(' • ')}</p>
                      {conf.sourceUrl && (
                        <a href={conf.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:underline mt-1">
                          <ExternalLink className="w-3 h-3" /> View LinkedIn evidence
                        </a>
                      )}`;
  if (!source.includes('View LinkedIn evidence')) {
    if (!source.includes(confMetaBefore)) throw new Error('[linkedin-role-integration] verified conference meta anchor not found');
    source = source.replace(confMetaBefore, confMetaAfter);
  }

  const feedbackBefore = `<button
                        onClick={() => setFeedbackConference(conf)}
                        className="px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors"
                      >
                        Leave Feedback
                      </button>
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                        Verified Attendance
                      </span>`;
  const feedbackAfter = `{conf.verificationSource === 'registration' && (
                        <button
                          onClick={() => setFeedbackConference(conf)}
                          className="px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors"
                        >
                          Leave Feedback
                        </button>
                      )}
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                        {conf.verificationSource === 'linkedin' ? 'Verified from LinkedIn post' : 'Verified Attendance'}
                      </span>`;
  if (!source.includes("Verified from LinkedIn post")) {
    if (!source.includes(feedbackBefore)) throw new Error('[linkedin-role-integration] verified conference badge anchor not found');
    source = source.replace(feedbackBefore, feedbackAfter);
  }

  source = source.replace(
    'No verified conference attendance on record yet. Once you register for a conference through Conference\n                Gate, it\'ll appear here.',
    'No verified conference attendance evidence on record yet. ConferenceGate registrations and strong first-person public LinkedIn conference claims appear here.',
  );

  fs.writeFileSync(path, source);
  console.log('[linkedin-role-integration] profile merges LinkedIn role evidence into leadership counters and verified conference history');
}
