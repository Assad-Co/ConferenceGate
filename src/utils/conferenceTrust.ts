/** Evidence-based signals, never independent verification claims. */
export interface ConferenceSignalsInput {
 title?: string | null; link?: string | null; organization?: string | null;
 startDate?: string | null; description?: string | null;
 category?: string | null; categories?: string[] | null;
}
export function conferenceTrustSignals(result: ConferenceSignalsInput) {
 let secureLink = false;
 try { const u = new URL(result.link || ''); secureLink = u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch {}
 const start = result.startDate || '';
 const validDate = /^20\d{2}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(Date.parse(start));
 const fields = [
  [!!result.title?.trim(), 'Title'],
  [!!result.organization?.trim(), 'Organizer'],
  [secureLink, 'HTTPS event link'],
  [validDate, 'Start date'],
  [!!result.description?.trim(), 'Description'],
 ] as const;
 return { score: fields.filter(([present]) => present).length, total: fields.length,
  missing: fields.filter(([present]) => !present).map(([, name]) => name),
  independentlyVerified: false };
}
export function conferenceMatchReasons(result: ConferenceSignalsInput, interests: string): string[] {
 const tokens = [...new Set(interests.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4))].slice(0, 12);
 const subject = [result.title, result.category, ...(result.categories || []), result.description].filter(Boolean).join(' ').toLowerCase();
 return tokens.filter(token => subject.split(/[^a-z0-9]+/).some(word => word.startsWith(token))).slice(0, 3);
}
