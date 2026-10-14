import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`LinkedIn full career history patch applied: ${relativePath}`);
  } else {
    console.log(`LinkedIn full career history already applied: ${relativePath}`);
  }
}

patchFile('src/components/LinkedInProfilePanel.tsx', (source) => {
  // Remove the obsolete date filter helper. A member's full provider-returned career history
  // should be visible regardless of age.
  source = source.replace(
    /function experienceWithinSevenYears\(item: any\): boolean \{[\s\S]*?\n\}\n\nfunction educationTitle/,
    'function educationTitle'
  );

  // An older compatibility patch created two career sections and capped each at 50 records.
  // Keep one clear section and render every stored provider-returned position.
  source = source.replace('Complete LinkedIn Position History', 'LinkedIn Experience — Full Career History');
  source = source.replace(
    'All positions returned by the consent-based LinkedIn import are retained; ConferenceGate no longer hides roles older than seven years.',
    'All positions returned by the consent-based LinkedIn import are retained and displayed with no year or item-count cutoff.'
  );
  source = source.replaceAll(
    'profile!.experience.slice(0, 50).map((item, index) => (',
    'profile!.experience.map((item, index) => ('
  );
  source = source.replace(
    'profile!.experience.filter(experienceWithinSevenYears).slice(0, 20).map((item, index) => (',
    'profile!.experience.map((item, index) => ('
  );

  // Remove the second legacy Experience block left behind by the earlier deep-profile patch.
  const duplicateExperienceSection = /\n\s*\{\(profile\?\.experience\.length \|\| 0\) > 0 && \(\n\s*<section>\n[\s\S]*?Professional Positions — Full Imported History[\s\S]*?\n\s*<\/section>\n\s*\)\}\n(?=\n\s*\{\(profile\?\.education\.length)/;
  source = source.replace(duplicateExperienceSection, '\n');

  if (source.includes('experienceWithinSevenYears')) {
    throw new Error('LinkedIn full career history patch failed: seven-year filter still exists');
  }
  if (source.includes('profile!.experience.slice(0,') || source.includes('profile!.experience.filter(')) {
    throw new Error('LinkedIn full career history patch failed: experience display is still capped or filtered');
  }
  if (source.includes('Professional Positions — Full Imported History')) {
    throw new Error('LinkedIn full career history patch failed: duplicate legacy Experience section remains');
  }
  if (!source.includes('LinkedIn Experience — Full Career History')) {
    throw new Error('LinkedIn full career history patch failed: canonical career-history section is missing');
  }
  return source;
});

patchFile('server/linkedinProfileBootstrap.ts', (source) => {
  const helperAnchor = `function jsonArray(value: unknown): string {\n  return JSON.stringify(arrayValue(value));\n}\n`;
  if (!source.includes('function mergeCareerPositions(')) {
    if (!source.includes(helperAnchor)) throw new Error('LinkedIn full career history patch failed: backend helper anchor missing');
    source = source.replace(helperAnchor, `${helperAnchor}\nfunction careerPositionKey(item: any): string {\n  if (!item || typeof item !== "object") return String(item ?? "").trim().toLowerCase();\n  const title = text(item.position) || text(item.title) || text(item.role) || "";\n  const company = text(item.companyName) || text(item.company) || text(item.organization) || "";\n  const start = text(item?.startDate?.text) || text(item?.startDate) || text(item?.dateRange?.start) || "";\n  const end = text(item?.endDate?.text) || text(item?.endDate) || text(item?.dateRange?.end) || text(item?.period) || "";\n  return [title, company, start, end].join("|").trim().toLowerCase();\n}\n\nfunction mergeCareerPositions(profile: Record<string, any>): any[] {\n  const groups = [\n    arrayValue(profile.experience),\n    arrayValue(profile.positions),\n    arrayValue(profile.currentPosition),\n    arrayValue(profile.currentPositions),\n    arrayValue(profile.pastPositions),\n  ];\n  const merged: any[] = [];\n  const seen = new Set<string>();\n  for (const group of groups) {\n    for (const item of group) {\n      const key = careerPositionKey(item);\n      if (!key || seen.has(key)) continue;\n      seen.add(key);\n      merged.push(item);\n    }\n  }\n  return merged;\n}\n`);
  }

  source = source.replace(
`  const experience = arrayValue(profile.experience).length\n    ? arrayValue(profile.experience)\n    : arrayValue(profile.positions).length\n      ? arrayValue(profile.positions)\n      : [...arrayValue(profile.currentPositions), ...arrayValue(profile.pastPositions)];`,
`  const experience = mergeCareerPositions(profile);`
  );

  source = source.replace(
`  const normalizedExperience = arrayValue(profile.experience).length\n    ? arrayValue(profile.experience)\n    : arrayValue(profile.positions).length\n      ? arrayValue(profile.positions)\n      : [...arrayValue(profile.currentPositions), ...arrayValue(profile.pastPositions)];`,
`  const normalizedExperience = mergeCareerPositions(profile);`
  );

  if (!source.includes('const normalizedExperience = mergeCareerPositions(profile);')) {
    throw new Error('LinkedIn full career history patch failed: refresh normalization not upgraded');
  }
  if (!source.includes('const experience = mergeCareerPositions(profile);')) {
    throw new Error('LinkedIn full career history patch failed: current-career normalization not upgraded');
  }
  return source;
});

// The older deep-Professional patch runs before this one. Make it aware of the canonical
// full-career state so a second Vite/build pass does not try to recreate its old 50-item sections.
patchFile('scripts/patchLinkedInDeepProfessional.mjs', (source) => {
  const marker = 'full-career-state-idempotency';
  if (source.includes(marker)) return source;
  const before = `  for (const { before, after } of replacements) {\n    if (source.includes(after)) continue;`;
  const after = `  for (const { before, after } of replacements) {\n    // full-career-state-idempotency: the later full-career patch intentionally replaces\n    // the two legacy capped Experience blocks created here. Treat that canonical state as applied.\n    if (\n      pathname === 'src/components/LinkedInProfilePanel.tsx' &&\n      source.includes('LinkedIn Experience — Full Career History') &&\n      (before.trim() === '<ProfessionalDeepResearchPanel />' || before.includes('Experience — Past 7 Years'))\n    ) continue;\n    if (source.includes(after)) continue;`;
  if (!source.includes(before)) throw new Error('LinkedIn full career history patch failed: deep-profile idempotency anchor missing');
  return source.replace(before, after);
});
