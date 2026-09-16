import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [before, after, label] of transforms) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) throw new Error(`[linkedin-deep-evidence] ${path}: anchor not found (${label})`);
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  fs.writeFileSync(path, source);
  console.log(`[linkedin-deep-evidence] patched ${path}`);
}

patchFile('server/linkedinConferenceActivityBootstrap.ts', [
  [
    'const MAX_POSTS = 100;',
    'const MAX_POSTS = 400;',
    'scan deeper LinkedIn history',
  ],
  [
`    | "CONFERENCE_ROLE"
    | "PAPER_ABSTRACT"
    | "CONFERENCE_MENTION";`,
`    | "CONFERENCE_ROLE"
    | "PAPER_ABSTRACT"
    | "CONFERENCE_MENTION"
    | "REGISTERED_CONFERENCE"
    | "PUBLICATION"
    | "PATENT"
    | "CERTIFICATE"
    | "AWARD";`,
    'expanded signal kinds',
  ],
  [
`function postText(post: Record<string, any>): string {
  return clean(post.content || post.text || post.commentary || post.description || post.title || "");
}`,
`function postPrimaryText(post: Record<string, any>): string {
  return clean(post.content || post.text || post.commentary || post.description || post.title || "");
}

function collectEvidenceStrings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 5 || out.length >= 80 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceStrings(item, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (out.length >= 80) break;
    const normalizedKey = key.toLowerCase();
    if (typeof child === "string") {
      // HarvestAPI media payloads vary by post type. These are descriptive fields only;
      // URL/id fields are deliberately excluded so they cannot create keyword false positives.
      if (/alt|caption|description|title|headline|text|name|ocr|transcript|accessibility/.test(normalizedKey) &&
          !/url|uri|id|urn/.test(normalizedKey)) {
        const candidate = clean(child);
        if (candidate && candidate.length <= 1200) out.push(candidate);
      }
    } else if (child && (Array.isArray(child) || typeof child === "object")) {
      collectEvidenceStrings(child, depth + 1, out);
    }
  }
  return out;
}

function postMediaEvidence(post: Record<string, any>): string {
  const roots = [
    post.media,
    post.images,
    post.image,
    post.attachments,
    post.document,
    post.article,
    post.carousel,
    post.contentEntities,
  ];
  const strings: string[] = [];
  for (const root of roots) collectEvidenceStrings(root, 0, strings);
  return [...new Set(strings)].join(" | ");
}

function postText(post: Record<string, any>): string {
  const primary = postPrimaryText(post);
  const media = postMediaEvidence(post);
  return clean([primary, media].filter(Boolean).join(" | "));
}

function postHasMedia(post: Record<string, any>): boolean {
  return Boolean(
    post.media || post.images || post.image || post.attachments || post.document || post.article || post.carousel
  );
}`,
    'media and image metadata evidence',
  ],
  [
`function sentenceWithEvent(value: string): string {`,
`function hasEventSignal(value: string): boolean {
  return /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\\b/i.test(value) ||
    /#[A-Za-z][A-Za-z0-9_-]{2,40}20\\d{2}\\b/.test(value) ||
    /\\b[A-Z]{3,}[A-Z0-9_-]{0,24}20\\d{2}\\b/.test(value);
}

function hasPaperSignal(value: string): boolean {
  return /\\b(abstract|paper|poster|oral presentation|technical presentation|presentation|manuscript|journal article|proceedings paper)\\b/i.test(value);
}

function hasCertificateSignal(value: string): boolean {
  return /\\b(certificate(?: of (?:attendance|achievement|completion|appreciation|participation))?|certification|credential|course completion|training completion)\\b/i.test(value);
}

function hasPatentSignal(value: string): boolean {
  return /\\b(patent(?:ed| granted| application| filing)?|inventor|invention disclosure|US\\d{7,}|US20\\d{2}\\d{6,})\\b/i.test(value);
}

function hasPublicationSignal(value: string): boolean {
  return /\\b(published|publication|journal article|peer[- ]reviewed article|doi\\b|accepted for publication|in press)\\b/i.test(value);
}

function hasAwardSignal(value: string): boolean {
  return /\\b(award(?:ed)?|honou?r|recognition|achievement award|best paper|best poster|distinguished)\\b/i.test(value);
}

function explicitRegistrationClaim(value: string): boolean {
  return /\\b(?:i(?:'|’)m\\s+registered|i\\s+(?:registered|have registered)|registered for|my registration (?:is|was) confirmed|registration confirmed for me|see you at)\\b/i.test(value);
}

function explicitCertificateClaim(value: string): boolean {
  return /\\b(?:i\\s+(?:received|earned|completed|was awarded)|i(?:'|’)m (?:proud|pleased|honou?red) to receive|my certificate|my certification|certificate awarded to me)\\b/i.test(value);
}

function explicitPatentClaim(value: string): boolean {
  return /\\b(?:my patent|our patent|i am (?:an )?inventor|i(?:'|’)m (?:an )?inventor|patent (?:was )?granted to|pleased to announce (?:our|my) patent)\\b/i.test(value);
}

function explicitPublicationClaim(value: string): boolean {
  return /\\b(?:my paper|our paper|my article|our article|i published|we published|pleased to announce (?:our|my) (?:paper|article)|our work (?:was|has been) published)\\b/i.test(value);
}

function sentenceWithEvent(value: string): string {`,
    'deep evidence helpers',
  ],
  [
`    const content = postText(post);
    if (!content) return;`,
`    const primaryContent = postPrimaryText(post);
    const content = postText(post);
    if (!content) return;
    const hasMedia = postHasMedia(post);`,
    'retain primary and media state',
  ],
  [
`    const hasEvent = /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\\b/i.test(content);
    const hasPaper = /\\b(abstract|paper|poster|oral presentation|technical presentation|presentation)\\b/i.test(content);`,
`    const hasEvent = hasEventSignal(content);
    const hasPaper = hasPaperSignal(content);
    const hasCertificate = hasCertificateSignal(content);
    const hasPatent = hasPatentSignal(content);
    const hasPublication = hasPublicationSignal(content);
    const hasAward = hasAwardSignal(content);`,
    'expanded evidence categories',
  ],
  [
`    const registration = /\\b(registration (?:is )?open|register now|early[- ]bird registration|conference registration)\\b/i.test(content);`,
`    const registrationOpen = /\\b(registration (?:is )?open|register now|early[- ]bird registration|conference registration|registration deadline)\\b/i.test(content);
    const registrationClaim = explicitRegistrationClaim(content);
    const registration = registrationOpen || registrationClaim;`,
    'personal registration detection',
  ],
  [
`    const label = sentenceWithEvent(content);`,
`    // Prefer what the member actually wrote for the visible label; fall back to media metadata
    // for image/document-only posts such as event badges, posters and certificates.
    const label = sentenceWithEvent(primaryContent || content);`,
    'human-readable label',
  ],
  [
`    if (!hasEvent && !hasPaper && !role) return;`,
`    if (!hasEvent && !hasPaper && !role && !hasCertificate && !hasPatent && !hasPublication && !hasAward && !registrationClaim) return;`,
    'keep achievements and registrations',
  ],
  [
`    if (!repostOrQuote && selfClaim && role) {
      kind = "CONFERENCE_ROLE";
      confidence = 95;
      memberClaimed = true;
    } else if (!repostOrQuote && selfClaim && hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = 92;
      memberClaimed = true;
    } else if (!repostOrQuote && explicitFutureParticipationClaim(content) && (hasEvent || !!role)) {`,
`    if (!repostOrQuote && selfClaim && role) {
      kind = "CONFERENCE_ROLE";
      confidence = 95;
      memberClaimed = true;
    } else if (!repostOrQuote && registrationClaim && hasEvent) {
      kind = "REGISTERED_CONFERENCE";
      confidence = 94;
      memberClaimed = true;
    } else if (!repostOrQuote && hasCertificate && explicitCertificateClaim(content)) {
      kind = "CERTIFICATE";
      confidence = 94;
      memberClaimed = true;
    } else if (!repostOrQuote && hasPatent && explicitPatentClaim(content)) {
      kind = "PATENT";
      confidence = 96;
      memberClaimed = true;
    } else if (!repostOrQuote && hasPublication && explicitPublicationClaim(content)) {
      kind = "PUBLICATION";
      confidence = 95;
      memberClaimed = true;
    } else if (!repostOrQuote && selfClaim && hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = 92;
      memberClaimed = true;
    } else if (!repostOrQuote && explicitFutureParticipationClaim(content) && (hasEvent || !!role)) {`,
    'achievement priority',
  ],
  [
`    } else if (hasEvent) {
      kind = "CONFERENCE_MENTION";
      confidence = repostOrQuote ? 60 : 70;
    } else if (hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = repostOrQuote ? 55 : 70;
    }`,
`    } else if (hasEvent) {
      kind = "CONFERENCE_MENTION";
      // A self-authored image/carousel plus an event-style hashtag (e.g. #EAGEGET2024) is useful
      // historical evidence, but it remains a signal rather than proof of attendance.
      confidence = repostOrQuote ? 60 : hasMedia ? 78 : 70;
    } else if (hasPatent) {
      kind = "PATENT";
      confidence = repostOrQuote ? 55 : 76;
    } else if (hasCertificate) {
      kind = "CERTIFICATE";
      confidence = repostOrQuote ? 52 : hasMedia ? 78 : 70;
    } else if (hasAward) {
      kind = "AWARD";
      confidence = repostOrQuote ? 52 : 74;
    } else if (hasPublication) {
      kind = "PUBLICATION";
      confidence = repostOrQuote ? 55 : 76;
    } else if (hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = repostOrQuote ? 55 : 70;
    }`,
    'non-claim evidence categories',
  ],
  [
`      evidenceText: label,`,
`      evidenceText: content.length > 900 ? `${content.slice(0, 897)}…` : content,`,
    'retain richer evidence text',
  ],
  [
`    conferenceActivity: dedupe(conferenceActivity).slice(0, 100),
    callsForPapers: dedupe(callsForPapers).slice(0, 100),`,
`    conferenceActivity: dedupe(conferenceActivity).slice(0, 400),
    callsForPapers: dedupe(callsForPapers).slice(0, 250),`,
    'retain deeper result set',
  ],
  [
`  const timeout = setTimeout(() => controller.abort(), 180_000);`,
`  const timeout = setTimeout(() => controller.abort(), 300_000);`,
    'longer deep scan timeout',
  ],
  [
`    endpoint.searchParams.set("maxTotalChargeUsd", "0.30");`,
`    endpoint.searchParams.set("maxTotalChargeUsd", "1.20");`,
    'bounded deeper post scan budget',
  ],
]);

patchFile('src/api/linkedinConferenceActivity.ts', [
  [
`  kind: 'PAST_CONFERENCE' | 'UPCOMING_CONFERENCE' | 'CONFERENCE_ROLE' | 'PAPER_ABSTRACT' | 'CONFERENCE_MENTION';`,
`  kind:
    | 'PAST_CONFERENCE'
    | 'UPCOMING_CONFERENCE'
    | 'CONFERENCE_ROLE'
    | 'PAPER_ABSTRACT'
    | 'CONFERENCE_MENTION'
    | 'REGISTERED_CONFERENCE'
    | 'PUBLICATION'
    | 'PATENT'
    | 'CERTIFICATE'
    | 'AWARD';`,
    'client signal kinds',
  ],
]);

patchFile('src/components/LinkedInProfilePanel.tsx', [
  [
`  CONFERENCE_MENTION: 'Conference mention',
};`,
`  CONFERENCE_MENTION: 'Conference mention',
  REGISTERED_CONFERENCE: 'Registered conference',
  PUBLICATION: 'Publication',
  PATENT: 'Patent',
  CERTIFICATE: 'Certificate',
  AWARD: 'Award / recognition',
};`,
    'kind labels',
  ],
  [
`      {(profile?.experience.length || 0) > 0 && (`,
`      {((profile?.certifications.length || 0) > 0 || (profile?.honorsAndAwards.length || 0) > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-3"><Award className="w-4 h-4 text-amber-600" /><h3 className="text-sm font-extrabold text-slate-900">Certificates, credentials & honors</h3></div>
          <div className="space-y-2">
            {(profile?.certifications || []).map((item: any, index: number) => (
              <div key={`cert-${index}`} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-800">{text(item?.name) || text(item?.title) || text(item?.credentialName) || 'LinkedIn certificate / credential'}</div>
                <div className="text-[11px] text-slate-500 mt-1">{[text(item?.authority) || text(item?.issuer) || text(item?.organization), text(item?.date) || text(item?.issuedAt)].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
            {(profile?.honorsAndAwards || []).map((item: any, index: number) => (
              <div key={`honor-${index}`} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <div className="text-sm font-semibold text-slate-800">{text(item?.title) || text(item?.name) || 'LinkedIn honor / award'}</div>
                <div className="text-[11px] text-slate-500 mt-1">{[text(item?.issuer) || text(item?.organization), text(item?.date)].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(profile?.experience.length || 0) > 0 && (`,
    'certificates and honors panel',
  ],
]);

patchFile('src/components/LinkedInImportedTabSections.tsx', [
  [
`  const conferenceSignals = useMemo(
    () => allSignals.filter((s) => ['PAST_CONFERENCE', 'UPCOMING_CONFERENCE', 'CONFERENCE_ROLE', 'CONFERENCE_MENTION'].includes(s.kind)),
    [allSignals],
  );
  const paperSignals = useMemo(() => allSignals.filter((s) => s.kind === 'PAPER_ABSTRACT'), [allSignals]);`,
`  const conferenceSignals = useMemo(
    () => allSignals.filter((s) => ['PAST_CONFERENCE', 'UPCOMING_CONFERENCE', 'CONFERENCE_ROLE', 'CONFERENCE_MENTION', 'REGISTERED_CONFERENCE'].includes(s.kind)),
    [allSignals],
  );
  const paperSignals = useMemo(
    () => allSignals.filter((s) => ['PAPER_ABSTRACT', 'PUBLICATION', 'PATENT'].includes(s.kind)),
    [allSignals],
  );`,
    'expanded conference and paper signals',
  ],
  [
`  const badgeEvidence = useMemo(
    () => allSignals.filter((s) => s.memberClaimed && s.confidence >= 90 && ['PAST_CONFERENCE', 'CONFERENCE_ROLE', 'PAPER_ABSTRACT'].includes(s.kind)),
    [allSignals],
  );`,
`  const badgeEvidence = useMemo(
    () => allSignals.filter((s) =>
      ['CERTIFICATE', 'AWARD'].includes(s.kind) ||
      (s.memberClaimed && s.confidence >= 90 && ['PAST_CONFERENCE', 'CONFERENCE_ROLE', 'PAPER_ABSTRACT', 'REGISTERED_CONFERENCE', 'PATENT', 'PUBLICATION'].includes(s.kind))
    ),
    [allSignals],
  );
  const profileCommitteeEvidence = useMemo(
    () => (profile?.experience || []).filter((item: any) => /committee|chair|co-chair|advisory board|steering board|technical board/i.test(JSON.stringify(item))),
    [profile],
  );
  const profileReviewEvidence = useMemo(
    () => (profile?.experience || []).filter((item: any) => /reviewer|peer review|editorial board|technical review/i.test(JSON.stringify(item))),
    [profile],
  );`,
    'profile-derived role evidence',
  ],
  [
`  if (tab === 'papers') {
    const publications = profile?.publications || [];
    const calls = activity?.callsForPapers || [];
    if (!publications.length && !paperSignals.length && !calls.length) return null;`,
`  if (tab === 'papers') {
    const publications = profile?.publications || [];
    const patents = profile?.patents || [];
    const calls = activity?.callsForPapers || [];
    if (!publications.length && !patents.length && !paperSignals.length && !calls.length) return null;`,
    'paper tab includes patents',
  ],
  [
`        {paperSignals.length > 0 && <div className="space-y-2">{paperSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>}
        {calls.length > 0 && (`,
`        {patents.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-slate-100">
            <h4 className="text-sm font-bold text-slate-900">Patents imported from LinkedIn</h4>
            {patents.map((patent: any, index: number) => {
              const title = textFrom(patent, ['title', 'name']) || 'LinkedIn patent';
              const number = textFrom(patent, ['patentNumber', 'number', 'applicationNumber']);
              const url = textFrom(patent, ['url', 'link', 'patentUrl']);
              return (
                <div key={`${title}-${index}`} className="p-4 bg-violet-50/40 rounded-2xl border border-violet-100">
                  <h4 className="font-bold text-xs text-slate-900">{title}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">{[number, yearFrom(patent)].filter(Boolean).join(' • ')}</p>
                  {sourceLink(url || profile?.linkedinUrl, url ? 'Patent source' : 'LinkedIn profile')}
                </div>
              );
            })}
          </div>
        )}
        {paperSignals.length > 0 && <div className="space-y-2">{paperSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>}
        {calls.length > 0 && (`,
    'render patents in papers tab',
  ],
  [
`  if (tab === 'committee' && committeeSignals.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Committee & Chair Evidence</h3>
        <div className="space-y-2">{committeeSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }`,
`  if (tab === 'committee' && (committeeSignals.length > 0 || profileCommitteeEvidence.length > 0)) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Committee & Chair Evidence</h3>
        <div className="space-y-2">{committeeSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
        {profileCommitteeEvidence.map((item: any, index: number) => (
          <div key={`profile-committee-${index}`} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <h4 className="font-bold text-xs text-slate-900">{textFrom(item, ['position', 'title', 'role']) || 'Committee / chair role'}</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{[textFrom(item, ['companyName', 'company', 'organization']), yearFrom(item)].filter(Boolean).join(' • ')}</p>
            {sourceLink(profile?.linkedinUrl, 'LinkedIn profile evidence')}
          </div>
        ))}
      </section>
    );
  }`,
    'committee profile evidence',
  ],
  [
`  if (tab === 'reviews' && reviewSignals.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Reviewer Evidence</h3>
        <div className="space-y-2">{reviewSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }`,
`  if (tab === 'reviews' && (reviewSignals.length > 0 || profileReviewEvidence.length > 0)) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Reviewer Evidence</h3>
        <div className="space-y-2">{reviewSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
        {profileReviewEvidence.map((item: any, index: number) => (
          <div key={`profile-review-${index}`} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <h4 className="font-bold text-xs text-slate-900">{textFrom(item, ['position', 'title', 'role']) || 'Reviewer role'}</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{[textFrom(item, ['companyName', 'company', 'organization']), yearFrom(item)].filter(Boolean).join(' • ')}</p>
            {sourceLink(profile?.linkedinUrl, 'LinkedIn profile evidence')}
          </div>
        ))}
      </section>
    );
  }`,
    'review profile evidence',
  ],
  [
`  if (tab === 'badges' && badgeEvidence.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> LinkedIn Evidence Awaiting Badge Verification</h3>
          <p className="text-[11px] text-slate-500 mt-1">Strong member claims are surfaced here as verification candidates, but LinkedIn alone does not create a ConferenceGate verified badge.</p>
        </div>
        <div className="space-y-2">{badgeEvidence.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }`,
`  if (tab === 'badges' && (badgeEvidence.length > 0 || (profile?.certifications.length || 0) > 0 || (profile?.honorsAndAwards.length || 0) > 0)) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> LinkedIn Evidence Awaiting Badge Verification</h3>
          <p className="text-[11px] text-slate-500 mt-1">Certificates, honors and strong member claims are brought across as evidence candidates. LinkedIn alone does not create a ConferenceGate verified badge.</p>
        </div>
        <div className="space-y-2">{badgeEvidence.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
        {(profile?.certifications || []).map((item: any, index: number) => (
          <div key={`cert-${index}`} className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200">
            <h4 className="font-bold text-xs text-slate-900">{textFrom(item, ['name', 'title', 'credentialName']) || 'LinkedIn certificate / credential'}</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{[textFrom(item, ['authority', 'issuer', 'organization']), yearFrom(item)].filter(Boolean).join(' • ')}</p>
            {sourceLink(profile?.linkedinUrl, 'LinkedIn profile evidence')}
          </div>
        ))}
        {(profile?.honorsAndAwards || []).map((item: any, index: number) => (
          <div key={`honor-${index}`} className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200">
            <h4 className="font-bold text-xs text-slate-900">{textFrom(item, ['title', 'name']) || 'LinkedIn honor / award'}</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{[textFrom(item, ['issuer', 'organization']), yearFrom(item)].filter(Boolean).join(' • ')}</p>
            {sourceLink(profile?.linkedinUrl, 'LinkedIn profile evidence')}
          </div>
        ))}
      </section>
    );
  }`,
    'certificates and honors in badge tab',
  ],
]);

console.log('[linkedin-deep-evidence] scans up to 400 posts and imports image metadata, registrations, certificates, awards, patents, publications and profile role evidence');
