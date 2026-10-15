import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/components/OrganizerDashboard.tsx'), 'utf8');
const must = (ok, label) => { if (!ok) throw new Error(`Organizer Edit Profile audit failed: ${label}`); };

must(dashboard.includes('onClick={onEditOrganizerProfile}'), 'Organizer Edit Profile button remains wired');
must(app.includes("activeRole === 'Organizer' || activeRole === 'Sponsor' || authUser.role === 'organizer' || authUser.role === 'sponsor'"), 'modal mounts in paid-role owner preview');
must(app.includes("variant={activeRole === 'Organizer' ? 'organizer' : activeRole === 'Sponsor' ? 'sponsor' : authUser.role}"), 'modal uses preview role variant');
must(app.includes("activeRole === 'Organizer' || updatedUser.role === 'organizer'"), 'Organizer save updates active preview identity');
must(app.includes("activeRole === 'Sponsor' || updatedUser.role === 'sponsor'"), 'Sponsor save updates active preview identity');
console.log('Organizer Edit Profile owner-preview audit passed.');
