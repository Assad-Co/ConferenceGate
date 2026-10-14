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
  source = source.replace(
    /function experienceWithinSevenYears\(item: any\): boolean \{[\s\S]*?\n\}\n\nfunction educationTitle/,
    'function educationTitle'
  );

  source = source.replace('Experience — Past 7 Years', 'Experience — Full Career History');
  source = source.replace(
    'profile!.experience.filter(experienceWithinSevenYears).slice(0, 20).map((item, index) => (',
    'profile!.experience.map((item, index) => ('
  );
  source = source.replace(
    'All positions returned by your LinkedIn profile import are shown here, with no seven-year cutoff.',
    'All positions returned by your LinkedIn profile import are shown here with no year or item-count cutoff.'
  );

  if (source.includes('experienceWithinSevenYears')) {
    throw new Error('LinkedIn full career history patch failed: seven-year filter still exists');
  }
  if (source.includes('profile!.experience.filter(') || source.includes('profile!.experience.slice(0, 20)')) {
    throw new Error('LinkedIn full career history patch failed: experience display is still capped');
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
