import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = fs.readFileSync(path.join(root, 'src/components/UserProfileView.tsx'), 'utf8');

const required = [
  'const hasReviewerHistory =',
  'Current Role',
  'speakerPresenterRoleCount > 0',
  'sessionChairCount > 0',
  'committeePositionCount > 0',
  'workshopDeliveredCount > 0',
  'Use this only for a role that ConferenceGate could not verify from a public source.',
  'Add attendance manually only when ConferenceGate cannot find reliable public evidence.',
];
for (const needle of required) {
  if (!file.includes(needle)) throw new Error(`Professional final declutter missing: ${needle}`);
}

const forbidden = [
  'Committee or chair service has no public database to pull from either',
  "Plain attendance isn't in any public database anywhere",
  'No reviewer badges earned yet — volunteer to review abstracts to start earning them.',
  'No review expertise keywords set yet.',
  'No self-reported committee positions yet.',
];
for (const needle of forbidden) {
  if (file.includes(needle)) throw new Error(`Professional final declutter stale/noisy copy remains: ${needle}`);
}

console.log('Professional final declutter regression audit passed.');
