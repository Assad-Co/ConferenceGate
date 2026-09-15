import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-conference-signals] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  `/\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|forum|convention)\\b/i.test(s),`,
  `/\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\\b/i.test(s),`,
  'event sentence vocabulary',
);

replaceOnce(
`  const roles: Array<[RegExp, string]> = [
    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],
    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],
    [/\\binvited speaker\\b/i, "Invited Speaker"],
    [/\\b(?:session|track|program|programme|scientific) chair\\b/i, "Chair"],
    [/\\bmoderator\\b/i, "Moderator"],
    [/\\bpanelist\\b|\\bpanellist\\b/i, "Panelist"],
    [/\\bcommittee member\\b|\\btechnical committee\\b|\\bscientific committee\\b|\\bprogram committee\\b/i, "Committee Member"],
    [/\\b(?:oral )?presenter\\b|\\bpresenting\\b|\\bpresentation\\b/i, "Presenter"],
    [/\\bspeaker\\b|\\bspeaking\\b/i, "Speaker"],
    [/\\bposter\\b/i, "Poster Presenter"],
  ];`,
`  const roles: Array<[RegExp, string]> = [
    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],
    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],
    [/\\b(?:invited|distinguished|guest) speaker\\b/i, "Invited Speaker"],
    [/\\bcore presenter\\b/i, "Core Presenter"],
    [/\\b(?:oral|technical|session|invited)?\\s*presenter\\b|\\bpresenting\\b|\\bpresentation\\b/i, "Presenter"],
    [/\\bposter presenter\\b|\\bposter presentation\\b|\\bmy poster\\b/i, "Poster Presenter"],
    [/\\b(?:co[- ]?)?(?:session|track|program|programme|scientific|technical) chair\\b|\\bco[- ]?chair\\b/i, "Chair"],
    [/\\bmoderator\\b|\\bmoderating\\b/i, "Moderator"],
    [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel speaker\\b/i, "Panelist"],
    [/\\bcommittee member\\b|\\btechnical committee\\b|\\bscientific committee\\b|\\bprogram committee\\b|\\bprogramme committee\\b|\\borganizing committee\\b|\\borganising committee\\b|\\bsteering committee\\b|\\badvisory committee\\b/i, "Committee Member"],
    [/\\b(?:abstract|paper|technical|scientific|conference)?\\s*reviewer\\b/i, "Reviewer"],
    [/\\bworkshop instructor\\b|\\binstructor\\b|\\bfacilitator\\b|\\btrainer\\b/i, "Workshop Facilitator"],
    [/\\bmaster of ceremonies\\b|\\bemcee\\b|\\bevent host\\b/i, "Host"],
    [/\\bspeaker\\b|\\bspeaking\\b/i, "Speaker"],
  ];`,
  'expanded conference role vocabulary',
);

replaceOnce(
`function explicitSelfClaim(value: string): boolean {
  return /\\b(i\\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|moderated|served|joined)|i['’]m|i['’]ll|my\\s+(?:talk|presentation|poster|paper|abstract|session)|honou?red to|pleased to|delighted to|excited to)\\b/i.test(
    value,
  );
}`,
`function explicitSelfClaim(value: string): boolean {
  return /\\b(i\\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|moderated|served|joined|contributed|represented|took part|take part)|i['’]m|i['’]ll|my\\s+(?:talk|presentation|poster|paper|abstract|session)|honou?red to|pleased to|delighted to|excited to|thrilled to|privileged to|grateful to|proud to|happy to|glad to|looking forward to)\\b/i.test(
    value,
  );
}

function explicitParticipationClaim(value: string): boolean {
  return /\\b(?:i\\s+(?:attended|participated(?: in)?|joined|took part(?: in)?|take part(?: in)?|was at|represented|contributed(?: at| to| as)?)|great to be at|back from|honou?red to (?:attend|participate|take part|join|contribute)|pleased to (?:attend|participate|take part|join|contribute)|delighted to (?:attend|participate|take part|join|contribute)|proud to (?:attend|participate|take part|join|contribute)|privileged to (?:attend|participate|take part|join|contribute))\\b/i.test(value);
}

function explicitFutureParticipationClaim(value: string): boolean {
  return /\\b(?:i\\s+(?:will|shall|am going to)\\s+(?:attend|participate|join|take part)|i['’]ll\\s+(?:attend|participate|join|take part)|looking forward to\\s+(?:attending|participating|joining|taking part)|excited to\\s+(?:attend|join|participate|take part))\\b/i.test(value);
}`,
  'expanded first-person claim detection',
);

replaceOnce(
`    const hasEvent = /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|forum|convention)\\b/i.test(content);
    const hasPaper = /\\b(abstract|paper|poster|oral presentation|presentation)\\b/i.test(content);`,
`    const hasEvent = /\\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\\b/i.test(content);
    const hasPaper = /\\b(abstract|paper|poster|oral presentation|technical presentation|presentation)\\b/i.test(content);`,
  'expanded event vocabulary',
);

replaceOnce(
`    if (!hasEvent && !hasPaper) return;`,
`    // A self-authored conference-role post may name only the event brand/acronym and the role
    // (for example "EAGE/AAPG ... GTW" + "Core Presenter") without ever using the word
    // "conference". Do not discard an explicit role just because the organiser used a branded name.
    if (!hasEvent && !hasPaper && !role) return;`,
  'keep role-only conference signals',
);

replaceOnce(
`    } else if (!repostOrQuote && /\\b(i\\s+(?:attended|participated|joined|was at)|great to be at|back from)\\b/i.test(content)) {
      kind = "PAST_CONFERENCE";
      confidence = 93;
      memberClaimed = true;
    } else if (year && year >= nowYear && hasEvent) {`,
`    } else if (!repostOrQuote && explicitFutureParticipationClaim(content) && (hasEvent || !!role)) {
      kind = "UPCOMING_CONFERENCE";
      confidence = 92;
      memberClaimed = true;
    } else if (!repostOrQuote && explicitParticipationClaim(content) && (hasEvent || !!role)) {
      kind = "PAST_CONFERENCE";
      confidence = 93;
      memberClaimed = true;
    } else if (year && year >= nowYear && hasEvent) {`,
  'attendance and participation claims',
);

fs.writeFileSync(path, source);
console.log('[linkedin-conference-signals] expanded attendance and conference-role post detection');
