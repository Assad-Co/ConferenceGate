import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.json');
const CSV_FILE = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.csv');

function previousNonSpace(text, index) {
  for (let i = Math.max(0, index - 1); i >= 0; i--) if (!/\s/.test(text[i])) return { ch: text[i], index: i };
  return null;
}
function nextNonSpace(text, index) {
  for (let i = Math.max(0, index); i < text.length; i++) if (!/\s/.test(text[i])) return { ch: text[i], index: i };
  return null;
}
function positionFromMessage(text, message) {
  const direct = /position\s+(\d+)/i.exec(message);
  if (direct) return Number(direct[1]);
  const lc = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (!lc) return null;
  const line = Number(lc[1]);
  const column = Number(lc[2]);
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < Math.max(0, line - 1) && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + Math.max(0, column - 1);
}
function stripAccidentalPrefix(text) {
  let out = text.replace(/^\uFEFF/, '');
  if (/^\s*[\[{]/.test(out)) return { text: out, stripped: 0 };
  const markers = [
    out.indexOf('{\n  "generatedAt"'),
    out.indexOf('{\r\n  "generatedAt"'),
    out.indexOf('{"generatedAt"'),
  ].filter((n) => n >= 0);
  const candidates = [out.indexOf('{'), out.indexOf('[')].filter((n) => n >= 0);
  const start = markers.length ? Math.min(...markers) : candidates.length ? Math.min(...candidates) : -1;
  if (start < 0) return { text: out, stripped: 0 };
  return { text: out.slice(start), stripped: start };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function list(value) {
  return String(value || '').split(';').map((item) => item.trim()).filter(Boolean);
}

function rebuildFromCsv() {
  if (!fs.existsSync(CSV_FILE)) return null;
  const rows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8').replace(/^\uFEFF/, ''));
  if (rows.length < 2) return null;
  const headers = rows[0].map((value) => value.trim());
  const index = new Map(headers.map((name, i) => [name, i]));
  const value = (row, name) => {
    const i = index.get(name);
    if (i === undefined) return null;
    const raw = String(row[i] || '').trim();
    return raw || null;
  };
  const records = [];
  for (const row of rows.slice(1)) {
    const id = value(row, 'id');
    const title = value(row, 'title');
    const sourceUrl = value(row, 'sourceUrl');
    const year = Number(value(row, 'year'));
    const format = value(row, 'format');
    if (!id || !title || !sourceUrl || !Number.isFinite(year)) continue;
    if (!['in-person', 'hybrid', 'online'].includes(format)) continue;
    let sourceHost = '';
    try { sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { continue; }
    const startDate = value(row, 'startDate');
    const endDate = value(row, 'endDate');
    const category = value(row, 'category');
    const description = value(row, 'description');
    const rawSourceType = value(row, 'sourceType');
    const sourceType = ['official_site', 'directory_listing', 'reference', 'third_party', 'event_api'].includes(rawSourceType)
      ? rawSourceType
      : 'third_party';
    records.push({
      id,
      title,
      acronym: value(row, 'acronym'),
      series: value(row, 'series'),
      edition: value(row, 'edition'),
      year,
      startDate,
      endDate,
      datePrecision: value(row, 'datePrecision') === 'month' ? 'month' : 'day',
      startMonth: startDate && /^\d{4}-\d{2}/.test(startDate) ? Number(startDate.slice(5, 7)) : null,
      datesText: null,
      city: value(row, 'city'),
      region: value(row, 'region'),
      country: value(row, 'country'),
      countryCode: value(row, 'countryCode'),
      worldRegion: value(row, 'worldRegion'),
      venue: value(row, 'venue'),
      format,
      organization: value(row, 'organization'),
      category,
      categories: category ? [category] : [],
      topics: list(value(row, 'topics')),
      keywords: list(value(row, 'keywords')),
      description,
      sourceUrl,
      sourceHost,
      sourceType,
      officialUrl: value(row, 'officialUrl'),
      logoUrl: null,
      imageUrl: null,
      evidence: {
        query: 'ConferenceGate canonical launch catalogue',
        resultTitle: title,
        statedText: description || [title, startDate, value(row, 'city'), value(row, 'country')].filter(Boolean).join(' · '),
        retrievedAt: '2026-09-14T00:00:00.000Z',
        method: 'web_search',
      },
      provenance: {},
      corroboratingSourceUrls: list(value(row, 'corroboratingSourceUrls')),
      origin: 'launch_dataset',
      supply: 'web_harvest',
      details: null,
    });
  }
  if (records.length < 253) return null;
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'conferencegate-worldwide-2026-2028.csv',
    repairNote: 'Rebuilt deterministically from the canonical launch CSV after legacy JSON corruption was detected. Verified deep regional/global manifests are merged separately at runtime.',
    records,
  }, null, 2) + '\n';
}

if (!fs.existsSync(FILE)) {
  const rebuilt = rebuildFromCsv();
  if (!rebuilt) throw new Error('[launch-dataset-repair] rich JSON missing and CSV rebuild unavailable');
  fs.writeFileSync(FILE, rebuilt, 'utf8');
  console.log('[launch-dataset-repair] rebuilt missing rich JSON from canonical CSV');
} else {
  const original = fs.readFileSync(FILE, 'utf8');
  const prefix = stripAccidentalPrefix(original);
  let text = prefix.text;
  let repaired = 0;
  let ok = false;

  if (prefix.stripped > 0) {
    repaired += 1;
    console.log(`[launch-dataset-repair] stripped accidental non-JSON prefix bytes=${prefix.stripped}`);
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      JSON.parse(text);
      ok = true;
      break;
    } catch (error) {
      const message = String(error?.message || error);
      const pos = positionFromMessage(text, message);
      if (!Number.isFinite(pos)) break;
      const prev = previousNonSpace(text, pos);
      const next = nextNonSpace(text, pos);
      const commaError = /Expected ','|after array element|after property value|Unexpected non-whitespace character/i.test(message);
      if (commaError && prev && next) {
        const prevCanEndValue = ['}', ']', '"'].includes(prev.ch) || /[0-9el]/i.test(prev.ch);
        const nextCanStartValue = ['{', '[', '"'].includes(next.ch) || /[-0-9tfn]/i.test(next.ch);
        if (prevCanEndValue && nextCanStartValue) {
          text = text.slice(0, next.index) + ',' + text.slice(next.index);
          repaired += 1;
          continue;
        }
      }
      const from = Math.max(0, pos - 12);
      const window = text.slice(from, Math.min(text.length, pos + 12));
      const boundary = commaError ? /([}\]])(\s*)([{\[]|"[A-Za-z_])/m.exec(window) : null;
      if (boundary) {
        const insertAt = from + boundary.index + boundary[1].length + boundary[2].length;
        if (text[insertAt - 1] !== ',') {
          text = text.slice(0, insertAt) + ',' + text.slice(insertAt);
          repaired += 1;
          continue;
        }
      }
      break;
    }
  }

  if (!ok) {
    const rebuilt = rebuildFromCsv();
    if (!rebuilt) throw new Error('[launch-dataset-repair] malformed JSON could not be repaired and canonical CSV rebuild failed');
    text = rebuilt;
    JSON.parse(text);
    ok = true;
    repaired += 1;
    console.warn('[launch-dataset-repair] legacy JSON corruption exceeded safe structural repair; rebuilt valid launch JSON from canonical CSV');
  }

  if (text !== original) fs.writeFileSync(FILE, text, 'utf8');
  console.log(`[launch-dataset-repair] valid=${ok} repairs=${repaired}`);
}
