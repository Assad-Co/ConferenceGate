import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/LinkedInImportedTabSections.tsx');
let source = fs.readFileSync(file, 'utf8');

if (!source.includes('const importedPaperSignalTitles = useMemo(')) {
  const anchor = `  const importedPublicationTitles = useMemo(\n    () => (profile?.publications || [])\n      .map((pub: any) => textFrom(pub, ['title', 'name', 'publicationTitle']))\n      .map((title) => title.trim())\n      .filter(Boolean),\n    [profile],\n  );`;
  if (!source.includes(anchor)) throw new Error('Papers/abstracts completeness: publication-title anchor missing');
  source = source.replace(anchor, `${anchor}\n  const importedPaperSignalTitles = useMemo(\n    () => paperSignals\n      .map((signal) => String(signal.conferenceName || signal.label || signal.evidenceText || '').trim())\n      .filter(Boolean),\n    [paperSignals],\n  );`);
}

const oldEffect = `  useEffect(() => {\n    if (!onPaperTitlesChange) return;\n    const unique = Array.from(\n      new Map(\n        importedPublicationTitles.map((title) => [\n          title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),\n          title,\n        ]),\n      ).values(),\n    );\n    onPaperTitlesChange(unique);\n  }, [importedPublicationTitles, onPaperTitlesChange]);`;
const newEffect = `  useEffect(() => {\n    if (!onPaperTitlesChange) return;\n    // A Professional's research-output identity must include both structured LinkedIn\n    // publications and paper/abstract claims detected in their own LinkedIn history.\n    // Deduplicate the combined set before it reaches profile counts and external-paper matching.\n    const unique = Array.from(\n      new Map(\n        [...importedPublicationTitles, ...importedPaperSignalTitles].map((title) => [\n          title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),\n          title,\n        ]),\n      ).values(),\n    );\n    onPaperTitlesChange(unique);\n  }, [importedPublicationTitles, importedPaperSignalTitles, onPaperTitlesChange]);`;
if (source.includes(oldEffect)) source = source.replace(oldEffect, newEffect);

if (!source.includes('...importedPaperSignalTitles')) throw new Error('Papers/abstracts completeness: LinkedIn abstract titles are not merged');
if (!source.includes("s.kind === 'PAPER_ABSTRACT'")) throw new Error('Papers/abstracts completeness: PAPER_ABSTRACT evidence missing');

fs.writeFileSync(file, source);
console.log('Papers/abstracts completeness patch applied');
