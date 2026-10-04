import fs from 'node:fs';

const path = 'src/components/CommunityFeed.tsx';
let text = fs.readFileSync(path, 'utf8');

text = text.replace(
  "'all' | 'cfp' | 'announcement' | 'speaker' | 'sponsorship' | 'review' | 'celebration' | 'saved'",
  "'all' | 'cfp' | 'announcement' | 'achievement' | 'speaker' | 'sponsorship' | 'review' | 'celebration' | 'saved'"
);

text = text.replace(
  "      setNewPostText('');\n      setComposerOpen(false);",
  "      setNewPostText('');\n      setComposerConferenceId('');\n      setComposerOpen(false);"
);

text = text.replace(
  "                      setComposerOpen(false);\n                      setNewPostText('');",
  "                      setComposerOpen(false);\n                      setNewPostText('');\n                      setComposerConferenceId('');"
);

text = text.replace(
  "            ['announcement', 'Announcements'],\n            ['speaker', 'Speakers'],",
  "            ['announcement', 'Announcements'],\n            ['achievement', 'Achievements'],\n            ['speaker', 'Speakers'],"
);

fs.writeFileSync(path, text);
console.log('Phase 15 Community polish applied');
