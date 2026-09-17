import fs from 'node:fs';

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
  if (!source.includes(before)) {
    throw new Error('[linkedin-role-tab-display] committee signal filter anchor not found');
  }
  source = source.replace(before, after);
}

source = source.replace(
  'LinkedIn Committee & Chair Evidence',
  'LinkedIn Conference Roles & Leadership Evidence',
);

fs.writeFileSync(path, source);
console.log('[linkedin-role-tab-display] all strong LinkedIn conference roles now appear in the leadership tab');
