import fs from 'node:fs';

const path = new URL('../src/components/OrganizerDashboard.tsx', import.meta.url);
let source = fs.readFileSync(path, 'utf8');
let changed = false;

function replaceOnce(before, after, description) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Image upload UX patch could not find expected source for: ${description}`);
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "import { OrganizerFeedbackPanel } from './OrganizerFeedbackPanel';\n",
  "import { OrganizerFeedbackPanel } from './OrganizerFeedbackPanel';\nimport { ImageUploadDropzone } from './ImageUploadDropzone';\n",
  'ImageUploadDropzone import'
);

replaceOnce(
`  const [committeeDraft, setCommitteeDraft] = useState({
    name: '',
    title: '',
    org: '',
    committeeRole: 'Technical Committee Member',
  });
  const [newConfCommittee, setNewConfCommittee] = useState<
    Array<{ name: string; title: string; org: string; committeeRole: string }>
  >([]);`,
`  const [committeeDraft, setCommitteeDraft] = useState({
    name: '',
    title: '',
    org: '',
    avatar: '',
    committeeRole: 'Technical Committee Member',
  });
  const [newConfCommittee, setNewConfCommittee] = useState<
    Array<{ name: string; title: string; org: string; avatar: string; committeeRole: string }>
  >([]);`,
  'committee avatar state'
);

replaceOnce(
  "    setCommitteeDraft({ name: '', title: '', org: '', committeeRole: 'Technical Committee Member' });",
  "    setCommitteeDraft({ name: '', title: '', org: '', avatar: '', committeeRole: 'Technical Committee Member' });",
  'committee draft reset'
);

replaceOnce(
`        org: member.org,
        // Initials, never a stock portrait: this is a named real person on a real committee.
        avatar: generateInitialsAvatar(member.name),
        committeeRole: member.committeeRole,`,
`        org: member.org,
        avatar: member.avatar || generateInitialsAvatar(member.name),
        committeeRole: member.committeeRole,`,
  'committee avatar persistence'
);

replaceOnce(
`              </div>
              <button
                type="button"
                onClick={handleAddCommitteeMember}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >`,
`              </div>
              <ImageUploadDropzone
                value={committeeDraft.avatar}
                onChange={(avatar) => setCommitteeDraft({ ...committeeDraft, avatar })}
                label="Committee member photo"
                helperText="Choose a headshot or drag & drop it here. No image URL is required."
                variant="portrait"
                className="max-w-xl"
              />
              <button
                type="button"
                onClick={handleAddCommitteeMember}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >`,
  'committee member dropzone'
);

replaceOnce(
`                    >
                      <div>
                        <div className="font-bold text-slate-900">{member.name}</div>`,
`                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={member.avatar || generateInitialsAvatar(member.name)}
                          alt={member.name}
                          className="w-10 h-10 rounded-xl object-cover bg-white border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0">
                        <div className="font-bold text-slate-900">{member.name}</div>`,
  'committee member list photo opening'
);

replaceOnce(
`                          {member.committeeRole}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommitteeMember(idx)}`,
`                          {member.committeeRole}
                        </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommitteeMember(idx)}`,
  'committee member list photo closing'
);

if (changed) {
  fs.writeFileSync(path, source, 'utf8');
  console.log('Applied Conference Gate image upload UX patch.');
} else {
  console.log('Conference Gate image upload UX patch already applied.');
}
