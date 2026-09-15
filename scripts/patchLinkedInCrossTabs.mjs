import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

// Add the cross-tab renderer import after the LinkedIn profile panel import created by
// patchLinkedInProfileUI.mjs. Keep this idempotent so repeated Render builds are safe.
const importLine = "import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';";
if (!source.includes(importLine)) {
  const panelImport = "import { LinkedInProfilePanel } from './LinkedInProfilePanel';";
  const index = source.indexOf(panelImport);
  if (index === -1) {
    throw new Error('[linkedin-cross-tabs] LinkedInProfilePanel import not found');
  }
  source =
    source.slice(0, index + panelImport.length) +
    `\n${importLine}` +
    source.slice(index + panelImport.length);
}

// Render imported LinkedIn evidence before the existing content of each destination tab.
// The previous implementation matched the entire LinkedIn tab block, which was brittle because
// patchLinkedInProfileUI inserts the keynote section immediately after it. Anchor instead on the
// first stable Conferences History content block.
const renderLine = '        <LinkedInImportedTabSections tab={activeTab} />';
if (!source.includes(renderLine)) {
  const anchors = [
    "        {activeTab === 'conferences' && keynoteSpeakerMatches.length > 0 && (",
    "        {activeTab === 'conferences' && (",
  ];
  let index = -1;
  for (const anchor of anchors) {
    index = source.indexOf(anchor);
    if (index !== -1) break;
  }
  if (index === -1) {
    throw new Error('[linkedin-cross-tabs] no Conferences History rendering anchor found');
  }
  source = source.slice(0, index) + `${renderLine}\n\n` + source.slice(index);
}

fs.writeFileSync(path, source);
console.log('[linkedin-cross-tabs] added LinkedIn evidence to matching profile tabs');
