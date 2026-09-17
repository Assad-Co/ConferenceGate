import fs from 'node:fs';

// Keep the LinkedIn evidence tab broad: all strong first-person conference roles appear here.
{
  const path = 'src/components/LinkedInImportedTabSections.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const before = `  const committeeSignals = useMemo(
    () => allSignals.filter((s) => s.kind === 'CONFERENCE_ROLE' && /chair|committee/i.test(s.role || '')),
    [allSignals],
  );`;
  const after = `  const committeeSignals = useMemo(
    () => allSignals.filter((s) =>
      s.kind === 'CONFERENCE_ROLE' &&
      s.memberClaimed &&
      !s.repostOrQuote &&
      s.confidence >= 90
    ),
    [allSignals],
  );`;

  if (!source.includes(after)) {
    if (!source.includes(before)) throw new Error('[linkedin-role-tab-display] committee signal filter anchor not found');
    source = source.replace(before, after);
  }

  source = source.replace('LinkedIn Committee & Chair Evidence', 'LinkedIn Conference Roles & Leadership Evidence');
  fs.writeFileSync(path, source);
}

// FINAL role fallback for the main profile counters.
// Old stored activity can still be tagged as CONFERENCE_MENTION even when its evidence text contains
// explicit member roles. Because these rows came from the member's own public LinkedIn posts, an
// explicit role phrase is sufficient evidence; do not require a narrow intro phrase such as
// "proud to" or "I presented". Reposts/quotes remain excluded.
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const linkedInAnchor = `  const linkedInSignals = linkedInConferenceActivity?.conferenceActivity || [];`;
  if (!source.includes('const evidenceDerivedRoleSignals = useMemo')) {
    const block = `${linkedInAnchor}
  const evidenceDerivedRoleSignals = useMemo(() => {
    const rolePatterns: Array<[RegExp, string]> = [
      [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, 'Technical Program Committee Co-Chair'],
      [/\\bscientific program(?:me)? committee co[- ]?chair\\b/i, 'Scientific Program Committee Co-Chair'],
      [/\\bprogram(?:me)? committee co[- ]?chair\\b/i, 'Program Committee Co-Chair'],
      [/\\btechnical committee co[- ]?chair\\b/i, 'Technical Committee Co-Chair'],
      [/\\bscientific committee co[- ]?chair\\b/i, 'Scientific Committee Co-Chair'],
      [/\\bsession co[- ]?chair\\b/i, 'Session Co-Chair'],
      [/\\bsession chair\\b/i, 'Session Chair'],
      [/\\btrack co[- ]?chair\\b/i, 'Track Co-Chair'],
      [/\\btrack chair\\b/i, 'Track Chair'],
      [/\\bcore presenter\\b/i, 'Core Presenter'],
      [/\\boral presenter\\b|\\boral presentation presenter\\b/i, 'Oral Presenter'],
      [/\\btechnical presenter\\b/i, 'Technical Presenter'],
      [/\\bposter presenter\\b|\\bposter presentation\\b|\\bmy poster\\b/i, 'Poster Presenter'],
      [/\\bkeynote(?: speaker)?\\b/i, 'Keynote Speaker'],
      [/\\bplenary(?: speaker)?\\b/i, 'Plenary Speaker'],
      [/\\bpanelist\\b|\\bpanellist\\b/i, 'Panelist'],
      [/\\bmoderator\\b/i, 'Moderator'],
      [/\\bcommittee member\\b/i, 'Committee Member'],
    ];
    const output: LinkedInConferenceSignal[] = [];
    linkedInSignals.forEach((signal) => {
      if (signal.repostOrQuote) return;
      const evidence = String(signal.evidenceText || signal.label || '');
      if (!evidence.trim()) return;
      rolePatterns.forEach(([pattern, role], index) => {
        if (!pattern.test(evidence)) return;
        output.push({
          ...signal,
          id: signal.id + ':evidence-role:' + index,
          kind: 'CONFERENCE_ROLE',
          role,
          memberClaimed: true,
          repostOrQuote: false,
          confidence: Math.max(95, signal.confidence || 0),
        });
      });
    });
    return output;
  }, [linkedInSignals]);`;
    if (!source.includes(linkedInAnchor)) throw new Error('[linkedin-role-tab-display] linkedInSignals anchor not found');
    source = source.replace(linkedInAnchor, block);
  }

  const strongBefore = `  const strongLinkedInRoleSignals = useMemo(
    () => linkedInSignals.filter((signal) =>`;
  const strongAfter = `  const strongLinkedInRoleSignals = useMemo(
    () => [...linkedInSignals, ...evidenceDerivedRoleSignals].filter((signal) =>`;
  if (!source.includes(strongAfter)) {
    if (!source.includes(strongBefore)) throw new Error('[linkedin-role-tab-display] strong role list anchor not found');
    source = source.replace(strongBefore, strongAfter);
  }

  fs.writeFileSync(path, source);
}

console.log('[linkedin-role-tab-display] explicit role phrases in stored member LinkedIn evidence now feed all role counters and lists');
