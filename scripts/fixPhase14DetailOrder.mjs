import fs from 'node:fs';

const path = 'src/components/ExternalConferenceDetail.tsx';
let text = fs.readFileSync(path, 'utf8');

const start = text.indexOf('  const detailTabs: Array<{ id: ExternalDetailTab; label: string }> = [');
const endMarker = '  // Same honesty split as incompleteLabel above, but for the body of a section: a spinner is';
const end = text.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('detail helper block not found');
const block = text.slice(start, end);
text = text.slice(0, start) + text.slice(end);

const insertionMarker = "  const upcomingEarlyBirdDeadline =\n    data?.earlyBirdDeadline && !isOlderThanUpcomingCutoff(data.earlyBirdDeadline)\n      ? data.earlyBirdDeadline\n      : null;\n";
if (!text.includes(insertionMarker)) throw new Error('deadline insertion point not found');
text = text.replace(insertionMarker, insertionMarker + '\n' + block);

fs.writeFileSync(path, text);
console.log('Moved Phase 14 detail helpers after derived fee/date declarations');
