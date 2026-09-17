import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'scripts', 'importAapgPhase1.mjs');
if (!fs.existsSync(FILE)) {
  console.log('[aapg-card-patch] importer missing; skipping');
  process.exit(0);
}

let src = fs.readFileSync(FILE, 'utf8');
if (src.includes('[AAPG_LEARN_MORE_CARD_V2]')) {
  console.log('[aapg-card-patch] already applied');
  process.exit(0);
}

const helperAnchor = 'function distinctTitleTokens(title) {';
if (!src.includes(helperAnchor)) throw new Error('AAPG card patch: helper anchor not found');

// Keep the injected source free of nested template literals. This patch itself is an ESM file,
// so nested backticks inside a String.raw template would terminate the outer string before the
// patch ever runs on Render.
const helpers = String.raw`
// [AAPG_LEARN_MORE_CARD_V2]
// AAPG cards often keep the event title/date/logo as plain card content and put the actual
// destination only on the orange "LEARN MORE" button. Treat the whole card as the event source:
// the button supplies the canonical detail URL, while the nearest card image supplies the mark.
function cardTitleBeforeDate(lines, dateRaw) {
  const dateIndex = lines.findIndex((line) => line.includes(dateRaw));
  const stop = /^(?:2026|2027|2028|all events|in-person events|virtual events|past events|happening soon)$/i;
  for (let i = (dateIndex >= 0 ? dateIndex - 1 : lines.length - 1); i >= Math.max(0, (dateIndex >= 0 ? dateIndex - 8 : lines.length - 10)); i--) {
    const line = lines[i]?.trim();
    if (!line || line.length < 8 || line.length > 220 || stop.test(line) || isGenericCta(line)) continue;
    if (/^\d{1,2}[–—-]\d{1,2}\s/i.test(line)) continue;
    return line;
  }
  return null;
}

function cardLogoFromFragment(fragment, base, title) {
  const tokens = distinctTitleTokens(title || '');
  let best = null;
  let bestScore = -999;
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(fragment))) {
    const attrs = parseAttrs(m[0]);
    let raw = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || '';
    if (!raw && attrs.srcset) raw = attrs.srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
    const url = absoluteUrl(raw, base);
    if (!url) continue;
    const hay = [attrs.alt || '', attrs.title || '', attrs.class || '', url].join(' ').toLowerCase();
    let score = 0;
    if (/logo|section|region|event|conference|brand/.test(hay)) score += 4;
    if (/aapg|southwest|sws|wtgs/.test(hay)) score += 5;
    for (const token of tokens) if (hay.includes(token)) score += 2;
    if (/speaker|avatar|portrait|sponsor|facebook|linkedin|twitter|youtube|icon-arrow|chevron/.test(hay)) score -= 8;
    score += Math.min(2, m.index / Math.max(1, fragment.length));
    if (score > bestScore) { bestScore = score; best = url; }
  }
  return bestScore >= 2 ? best : null;
}

function discoverLearnMoreCards(html) {
  const out = [];
  const seen = new Set();
  const all = extractAnchors(html, CALENDAR_URL);
  for (const anchor of all) {
    if (!/^learn more$/i.test(anchor.text.trim())) continue;
    const start = Math.max(0, anchor.index - 5000);
    const fragment = html.slice(start, Math.min(html.length, anchor.index + anchor.raw.length + 200));
    const lines = htmlLines(fragment);
    const date = parseDateRange(lines.join(' | '));
    if (!date) continue;
    const title = cardTitleBeforeDate(lines, date.raw);
    if (!title) continue;
    const key = normalizeTitle(title) + '|' + date.start;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url: anchor.href,
      startDate: date.start,
      endDate: date.end,
      dateText: date.raw,
      locationText: locationFromCard(lines, title, date.raw),
      cardLogo: cardLogoFromFragment(fragment, CALENDAR_URL, title),
      learnedFrom: 'learn-more-card',
    });
  }
  return out;
}

function mergeCalendarCandidates(primary, cardCandidates) {
  const map = new Map();
  for (const item of primary) map.set(normalizeTitle(item.title) + '|' + item.startDate, item);
  for (const card of cardCandidates) {
    const key = normalizeTitle(card.title) + '|' + card.startDate;
    const old = map.get(key);
    if (!old) {
      map.set(key, card);
      continue;
    }
    map.set(key, {
      ...old,
      url: card.url || old.url,
      locationText: card.locationText || old.locationText,
      cardLogo: card.cardLogo || old.cardLogo || null,
      learnedFrom: card.learnedFrom,
    });
  }
  return [...map.values()]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .slice(0, MAX_EVENTS);
}

`;
src = src.replace(helperAnchor, helpers + helperAnchor);

const eventsAnchor = 'const events = discoverCalendarEvents(calendar.html);';
if (!src.includes(eventsAnchor)) throw new Error('AAPG card patch: event discovery anchor not found');
src = src.replace(eventsAnchor, "const events = mergeCalendarCandidates(discoverCalendarEvents(calendar.html), discoverLearnMoreCards(calendar.html));");

const logoAnchor = 'logoUrl: eventLogo || favicon || null,';
if (!src.includes(logoAnchor)) throw new Error('AAPG card patch: logo anchor not found');
src = src.replace(logoAnchor, 'logoUrl: event.cardLogo || eventLogo || favicon || null,');

const sourceAnchor = 'logoSource: eventLogo ? "stated" : (favicon ? "organiser" : null),';
if (!src.includes(sourceAnchor)) throw new Error('AAPG card patch: logo source anchor not found');
src = src.replace(sourceAnchor, 'logoSource: event.cardLogo ? "stated" : (eventLogo ? "stated" : (favicon ? "organiser" : null)),');

fs.writeFileSync(FILE, src);
console.log('[aapg-card-patch] Learn More deep-links + card-logo capture enabled');
