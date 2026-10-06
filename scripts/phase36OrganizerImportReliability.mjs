import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function mustReplace(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}

// 1) Make the Organizer Wizard URL entry forgiving and keyboard-operable.
{
  const path = 'src/components/OrganizerDashboard.tsx';
  let text = read(path);

  text = mustReplace(
    text,
    `  const handleOfficialConferenceImport = async () => {\n    const url = officialImportUrl.trim();\n    if (!url || officialImportLoading) return;\n    setOfficialImportLoading(true);`,
    `  const handleOfficialConferenceImport = async () => {\n    const rawUrl = officialImportUrl.trim();\n    if (!rawUrl || officialImportLoading) return;\n    const url = /^https?:\\/\\//i.test(rawUrl) ? rawUrl : \`https://\${rawUrl}\`;\n    setOfficialImportUrl(url);\n    setOfficialImportLoading(true);`,
    'import URL normalization'
  );

  text = mustReplace(
    text,
    `              <input\n                type="url"\n                value={officialImportUrl}\n                onChange={(e) => setOfficialImportUrl(e.target.value)}\n                placeholder="https://official-conference-site.org/2027"\n                className="flex-1 p-3 bg-white border border-blue-200 rounded-xl font-medium"\n              />`,
    `              <input\n                type="text"\n                inputMode="url"\n                autoCapitalize="none"\n                autoCorrect="off"\n                spellCheck={false}\n                value={officialImportUrl}\n                onChange={(e) => setOfficialImportUrl(e.target.value)}\n                onKeyDown={(e) => {\n                  if (e.key === 'Enter') {\n                    e.preventDefault();\n                    void handleOfficialConferenceImport();\n                  }\n                }}\n                placeholder="https://official-conference-site.org/2027"\n                className="flex-1 p-3 bg-white border border-blue-200 rounded-xl font-medium"\n              />`,
    'import URL input'
  );

  write(path, text);
}

// 2) Harden the backend importer. Accept URLs without a scheme, combine complementary
// extraction results, and use the reader/browser fallbacks more aggressively when the first
// response contains only a small subset of conference facts.
{
  const path = 'server/workspaces.ts';
  let text = read(path);

  text = mustReplace(
    text,
    `    let url: URL;\n    try {\n      url = new URL(submitted);\n    } catch {\n      return res.status(400).json({ error: "Provide a valid http(s) conference URL." });\n    }`,
    `    const normalizedSubmitted = /^https?:\\/\\//i.test(submitted) ? submitted : \`https://\${submitted}\`;\n    let url: URL;\n    try {\n      url = new URL(normalizedSubmitted);\n    } catch {\n      return res.status(400).json({ error: "Provide a valid public conference URL." });\n    }`,
    'server URL normalization'
  );

  const scoreAnchor = `function importExtractionScore(raw: RawEventExtraction): number {\n  return [\n    raw.title,\n    raw.startDateText || raw.datesText,\n    raw.city || raw.country || raw.locationText,\n    raw.description,\n    raw.topics?.length ? "topics" : null,\n    raw.imageUrl,\n    raw.formatText,\n    raw.price,\n    raw.organizer,\n  ].filter(Boolean).length;\n}\n`;
  const mergeHelper = `${scoreAnchor}\nfunction mergeImportCandidates(\n  candidates: Array<{ route: string; sourceUrl: string; raw: RawEventExtraction }>\n): { route: string; sourceUrl: string; raw: RawEventExtraction } | null {\n  if (!candidates.length) return null;\n  const ranked = candidates\n    .slice()\n    .sort((a, b) => importExtractionScore(b.raw) - importExtractionScore(a.raw));\n  const merged: any = emptyRawExtraction("derived");\n  const scalarFields = [\n    "title", "startDateText", "endDateText", "datesText", "city", "country", "venue",\n    "locationText", "description", "imageUrl", "formatText", "price", "currency",\n    "organizer", "officialUrl"\n  ];\n\n  const topicSet = new Set<string>();\n  const fieldSet = new Set<string>();\n  let confidence = 0;\n  for (const candidate of ranked) {\n    const raw: any = candidate.raw;\n    for (const field of scalarFields) {\n      if (!merged[field] && raw[field]) merged[field] = raw[field];\n    }\n    for (const topic of Array.isArray(raw.topics) ? raw.topics : []) {\n      const clean = String(topic || '').trim();\n      if (clean) topicSet.add(clean);\n    }\n    for (const field of Array.isArray(raw.filledFields) ? raw.filledFields : []) fieldSet.add(String(field));\n    confidence = Math.max(confidence, Number(raw.confidence || 0));\n  }\n  merged.topics = [...topicSet].slice(0, 20);\n  merged.filledFields = [...fieldSet];\n  merged.confidence = Math.min(0.98, confidence + (ranked.length > 1 ? 0.04 : 0));\n  if (!merged.officialUrl) merged.officialUrl = ranked[0].sourceUrl;\n\n  const routes = [...new Set(ranked.map((candidate) => candidate.route))];\n  return {\n    route: routes.length === 1 ? routes[0] : \`combined:\${routes.join('+')}\`,\n    sourceUrl: ranked[0].sourceUrl,\n    raw: merged as RawEventExtraction,\n  };\n}\n`;
  text = mustReplace(text, scoreAnchor, mergeHelper, 'merge candidate helper');

  text = mustReplace(
    text,
    `    if ((!directBest || importExtractionScore(directBest) < 3) && isJinaConfigured()) {`,
    `    if ((!directBest || importExtractionScore(directBest) < 5) && isJinaConfigured()) {`,
    'reader threshold'
  );

  text = mustReplace(
    text,
    `    if (!bestBeforeBrowser || importExtractionScore(bestBeforeBrowser.raw) < 3) {`,
    `    if (!bestBeforeBrowser || importExtractionScore(bestBeforeBrowser.raw) < 5) {`,
    'browser threshold'
  );

  text = mustReplace(
    text,
    `    const best = candidates\n      .slice()\n      .sort((a, b) => importExtractionScore(b.raw) - importExtractionScore(a.raw))[0];`,
    `    const best = mergeImportCandidates(candidates);`,
    'candidate merge selection'
  );

  text = mustReplace(
    text,
    `    res.json({\n      draft: {`,
    `    await audit(context.workspace.id, req.userId!, "conference_import_prefill", null, {\n      sourceUrl,\n      method: best.route,\n      extractedFields: filled,\n      confidence: raw.confidence,\n    });\n\n    res.json({\n      draft: {`,
    'import audit event'
  );

  write(path, text);
}

console.log('Phase 36 organizer import reliability patches applied.');
