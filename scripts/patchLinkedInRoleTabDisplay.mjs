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

// Final fallback for the main profile counters. Some existing records were stored before multi-role
// classification existed, but their evidenceText still contains the member's explicit role wording.
// Derive roles from that stored evidence so the cards update immediately without waiting for a new import.
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const linkedInAnchor = `  const linkedInSignals = linkedInConferenceActivity?.conferenceActivity || [];`;
  if (!source.includes('const evidenceDerivedRoleSignals = useMemo')) {
    const block = `${linkedInAnchor}
  const evidenceDerivedRoleSignals = useMemo(() => {
    const rolePatterns: Array<[RegExp, string]> = [
      [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, 'Technical Program Committee Co-Chair'],
      [/\\bsession chair\\b/i, 'Session Chair'],
      [/\\bcore presenter\\b/i, 'Core Presenter'],
      [/\\boral presenter\\b/i, 'Oral Presenter'],
      [/\\bposter presenter\\b/i, 'Poster Presenter'],
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
      if (!/\\b(honou?red to|proud to|pleased to|delighted to|i\\s+(?:attended|participated|joined|presented|chaired|served|took part)|my\\s+(?:presentation|poster|paper|session))\\b/i.test(evidence)) return;
      rolePatterns.forEach(([pattern, role], index) => {
        if (!pattern.test(evidence)) return;
        output.push({ ...signal, id: signal.id + ':evidence-role:' + index, kind: 'CONFERENCE_ROLE', role, memberClaimed: true, confidence: 95 });
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

console.log('[linkedin-role-tab-display] LinkedIn evidence text now feeds leadership counters and role lists');
