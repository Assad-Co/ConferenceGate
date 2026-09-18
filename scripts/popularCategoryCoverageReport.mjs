import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES=[
  'Artificial Intelligence','Data Science','Cybersecurity','Software & Cloud','Telecommunications',
  'Semiconductors & Electronics','Robotics & Automation','Engineering','Civil & Construction',
  'Mechanical Engineering','Electrical Engineering','Chemical Engineering','Materials Science','Energy',
  'Petroleum & Geoscience','Renewable Energy','Hydrogen & CCUS','Mining & Minerals','Environment',
  'Climate & Sustainability','Healthcare','Public Health','Pharmaceuticals & Biotechnology','Nursing',
  'Dentistry','Cardiology','Oncology','Neuroscience','Life Sciences','Chemistry','Physics',
  'Mathematics & Statistics','Science','Education','Business','Finance','Economics','Marketing',
  'Supply Chain & Logistics','Manufacturing','Aviation & Aerospace','Maritime','Automotive & Mobility',
  'Architecture & Urbanism','Agriculture & Food','Law & Regulation','Government & Policy','Social Sciences',
  'Arts & Culture','Tourism & Hospitality','Blockchain & Web3','Real Estate','Virtual conferences','Open call for papers'
];
const TARGET=Math.max(1,Number(process.env.POPULAR_CATEGORY_RICH_TARGET||2));

function safe(value,fallback){try{return value?JSON.parse(String(value)):fallback;}catch{return fallback;}}
function meaningful(v){
  if(Array.isArray(v)) return v.some(meaningful);
  if(v&&typeof v==='object') return Object.entries(v).some(([k,x])=>!['source_url','source_urls','status'].includes(k)&&meaningful(x));
  if(typeof v==='string') return v.trim().length>2&&!/^(not found|not retrieved|not yet announced|unknown|n\/a|tbd|tba)$/i.test(v.trim());
  return typeof v==='number'||v===true;
}
function sections(row){
  const values=[
    safe(row.overview,{}),safe(row.call_for_papers,{}),safe(row.fees_pricing,{}),safe(row.program_agenda,{}),
    safe(row.keynote_speakers,[]),safe(row.technical_committee,[]),safe(row.sponsors_exhibitors,[]),
    safe(row.venue_accommodation,{}),safe(row.community,{})
  ];
  return values.filter(meaningful).length;
}
function logo(row){
  const overview=safe(row.overview,{});
  return Boolean(overview.logo_url||overview.image_url||row.image_url);
}
async function main(){
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim()||undefined})
    : createClient({url:'file:'+localPath});
  try{
    const rows=await db.execute(`SELECT de.id,de.title,de.image_url,dec.category,
      ec.overview,ec.call_for_papers,ec.fees_pricing,ec.program_agenda,ec.keynote_speakers,
      ec.technical_committee,ec.sponsors_exhibitors,ec.venue_accommodation,ec.community
      FROM discovery_events de
      JOIN discovery_event_categories dec ON dec.event_id=de.id
      LEFT JOIN extracted_conferences ec
        ON ec.source_url=de.official_url OR ec.source_url=de.canonical_url
      WHERE de.status='published'`);
    const counts=new Map(CATEGORIES.map((c)=>[c,{rich:0,total:0,examples:[]}]));
    for(const row of rows.rows||[]){
      const category=String(row.category||'');
      if(!counts.has(category)) continue;
      const bucket=counts.get(category);
      bucket.total+=1;
      const tabCount=sections(row);
      if(tabCount>=6&&logo(row)){
        bucket.rich+=1;
        if(bucket.examples.length<3) bucket.examples.push(String(row.title));
      }
    }
    let covered=0;
    const missing=[];
    for(const category of CATEGORIES){
      const bucket=counts.get(category);
      if(bucket.rich>=TARGET) covered+=1;
      else missing.push(category);
      console.log('[popular-coverage] '+category+' rich='+bucket.rich+' total='+bucket.total+(bucket.examples.length?' examples='+bucket.examples.join(' | '):''));
    }
    console.log('[popular-coverage] covered='+covered+'/'+CATEGORIES.length+' target_per_category='+TARGET+' missing='+missing.join('|'));
  }catch(error){
    console.warn('[popular-coverage] failed:',error?.message||error);
  }finally{try{db.close();}catch{}}
}
await main();
