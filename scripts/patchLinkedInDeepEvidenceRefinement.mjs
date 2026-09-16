import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-deep-refinement] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
`function explicitRegistrationClaim(value: string): boolean {
  return /\\b(?:i(?:'|’)m\\s+registered|i\\s+(?:registered|have registered)|registered for|my registration (?:is|was) confirmed|registration confirmed for me|see you at)\\b/i.test(value);
}`,
`function explicitRegistrationClaim(value: string): boolean {
  return /\\b(?:i(?:'|’)m\\s+registered|i(?:'|’)ve\\s+registered|i\\s+(?:registered|have registered)(?:\\s+for)?|my registration (?:is|was) confirmed|registration confirmed for me|see you at)\\b/i.test(value);
}`,
  'registration must remain first-person',
);

replaceOnce(
`    conferenceActivity.push({
      id,
      kind,
      label,
      role: memberClaimed ? role : null,
      year,
      sourceUrl,
      evidenceText: label,
      confidence,
      memberClaimed,
      repostOrQuote,
      verified: false,
    });`,
`    const richEvidence = content.length > 900 ? \`${'${content.slice(0, 897)}'}…\` : content;
    conferenceActivity.push({
      id,
      kind,
      label,
      role: memberClaimed ? role : null,
      year,
      sourceUrl,
      evidenceText: richEvidence,
      confidence,
      memberClaimed,
      repostOrQuote,
      verified: false,
    });

    // One LinkedIn post can contain several independent achievements (for example a paper,
    // presenter role and certificate in the same conference post). Preserve each evidence type
    // instead of forcing the entire post into one bucket.
    const addSupplemental = (
      supplementalKind: LinkedInConferenceSignal["kind"],
      present: boolean,
      claimed: boolean,
      supplementalConfidence: number,
    ) => {
      if (!present || supplementalKind === kind) return;
      conferenceActivity.push({
        id: \`${'${id}'}:${'${supplementalKind.toLowerCase()}'}\`,
        kind: supplementalKind,
        label,
        role: null,
        year,
        sourceUrl,
        evidenceText: richEvidence,
        confidence: supplementalConfidence,
        memberClaimed: claimed,
        repostOrQuote,
        verified: false,
      });
    };

    addSupplemental("PAPER_ABSTRACT", hasPaper, !repostOrQuote && selfClaim, !repostOrQuote && selfClaim ? 92 : repostOrQuote ? 55 : 72);
    addSupplemental("REGISTERED_CONFERENCE", registrationClaim && hasEvent, !repostOrQuote && registrationClaim, !repostOrQuote && registrationClaim ? 94 : 65);
    addSupplemental("PATENT", hasPatent, !repostOrQuote && explicitPatentClaim(content), !repostOrQuote && explicitPatentClaim(content) ? 96 : repostOrQuote ? 55 : 76);
    addSupplemental("PUBLICATION", hasPublication, !repostOrQuote && explicitPublicationClaim(content), !repostOrQuote && explicitPublicationClaim(content) ? 95 : repostOrQuote ? 55 : 76);
    addSupplemental("CERTIFICATE", hasCertificate, !repostOrQuote && explicitCertificateClaim(content), !repostOrQuote && explicitCertificateClaim(content) ? 94 : repostOrQuote ? 52 : hasMedia ? 78 : 70);
    addSupplemental("AWARD", hasAward && !hasCertificate, !repostOrQuote && selfClaim, !repostOrQuote && selfClaim ? 91 : repostOrQuote ? 52 : 74);`,
  'multiple achievements per post and richer evidence',
);

fs.writeFileSync(path, source);
console.log('[linkedin-deep-refinement] preserved multiple achievements per LinkedIn post with first-person claim safeguards');
