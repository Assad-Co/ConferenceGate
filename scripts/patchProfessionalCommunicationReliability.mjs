import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileFile = path.join(root, 'src/components/UserProfileView.tsx');
let profileSource = fs.readFileSync(profileFile, 'utf8');

const rawMarker = '/* Professional profile simplified structure */';
const jsxMarker = '{/* Professional profile simplified structure */}';
if (profileSource.includes(rawMarker) && !profileSource.includes(jsxMarker)) {
  profileSource = profileSource.replace(rawMarker, jsxMarker);
  fs.writeFileSync(profileFile, profileSource);
  console.log('Removed visible Professional profile patch marker.');
} else {
  console.log('Professional profile patch marker is already hidden.');
}
