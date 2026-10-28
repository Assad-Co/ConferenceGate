import fs from 'node:fs';
import { loadLaunchDataset } from '../server/dataset/staticDataset';
import { normalizeCountry } from '../server/discovery/countries';
import { auditCatalogue } from './auditCatalogueSnapshot.mjs';

const additions = JSON.parse(fs.readFileSync(new URL('../data/global-expansion-20261028.json',import.meta.url),'utf8'));
const key = (url: string, start: string) => url.replace(/\/$/,'').toLowerCase()+'|'+start;
const newKeys = new Set(additions.map((row: any) => key(row.url,row.start)));
const records = loadLaunchDataset().records;
const today = '2026-10-28';
function summarize(rows: typeof records) {
  const regional: Record<string,{total:number; upcoming:number}> = {};
  for(const row of rows) {
    let region = row.country?.includes(' / ') ? 'Multi-region' : normalizeCountry(row.country)?.region || row.worldRegion || 'Unknown';
    if (region === 'South America') region = 'Latin America';
    const stats = regional[region] ||= {total:0,upcoming:0};
    stats.total++;
    if((row.endDate || row.startDate || '')>=today) stats.upcoming++;
  }
  return { ...auditCatalogue(rows,today).counters, regional,
    officialSourceRecords:rows.filter(row=>row.sourceType==='official_site').length,
    evidenceTimestampRecords:rows.filter(row=>row.evidence?.retrievedAt).length,
    evidenceNote:'Evidence timestamps are source metadata, not proof every field or URL remains current.' };
}
const existing=records.filter(row=>!newKeys.has(key(row.officialUrl||row.sourceUrl,row.startDate||'')));
// Reproduce the prior loader's URL/date-only collision behavior for a comparable baseline.
const before=[...new Map(existing.map(row=>[key(row.officialUrl||row.sourceUrl,row.startDate||''),row])).values()];
const report={auditedAt:today,scope:'Release static catalogue, including production-enabled regional manifests; excludes live Turso additions.',baselineMethod:'Existing records under the previous URL/date-only identity rule. This incorrectly collapsed distinct same-day workshops sharing a homepage.',before:summarize(before),after:summarize(records),recoveredExistingRecords:existing.length-before.length,added: additions.map((row:any)=>({title:row.title,start:row.start,end:row.end,city:row.city,country:row.country,region:row.worldRegion,url:row.url,sourceUrls:row.sourceUrls,verifiedAt:row.verifiedAt,verificationScope:row.verificationScope})),freshlyReviewedOfficialSources:additions.length};
const output = JSON.stringify(report,null,2);
if(process.argv[2]) fs.writeFileSync(process.argv[2],output+'\n');
else console.log(output);
