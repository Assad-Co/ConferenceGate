import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileFile = path.join(root, 'src/components/UserProfileView.tsx');
let profile = fs.readFileSync(profileFile, 'utf8');

const oldLinkedInAction = "{ key: 'linkedin', done: Boolean(userProfile.linkedinUrl), label: 'Import LinkedIn', action: () => setIsEditProfileOpen(true) },";
const newLinkedInAction = "{ key: 'linkedin', done: Boolean(userProfile.linkedinUrl && linkedInProfilePhotoUrl), label: 'Import LinkedIn', action: () => setActiveTab('linkedin') },";
if (!profile.includes(newLinkedInAction)) {
  if (!profile.includes(oldLinkedInAction)) throw new Error('Profile LinkedIn completion action target missing.');
  profile = profile.replace(oldLinkedInAction, newLinkedInAction);
}
fs.writeFileSync(profileFile, profile);

// Current reviewer workload is operational state, not a profile preference. Keep the
// maximum-load value for matching/assignment limits, but do not present a live x/y
// workload counter in the Professional Matching Profile.
const modalFile = path.join(root, 'src/components/ProfessionalPreferencesModal.tsx');
let modal = fs.readFileSync(modalFile, 'utf8');
modal = modal.replace(/\n\s*<div[^>]*>\s*Current load:\s*\{[^}]+\}\s*\/\s*\{[^}]+\}\s*<\/div>/gi, '');
modal = modal.replace(/\n\s*<p[^>]*>\s*Current load:\s*\{[^}]+\}\s*\/\s*\{[^}]+\}\s*<\/p>/gi, '');
fs.writeFileSync(modalFile, modal);

console.log('Professional controls clarity patch applied.');
