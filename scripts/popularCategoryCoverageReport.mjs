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
const TARGET=Math.max(1,Number(process.env.POPULAR_CATEGORY_RICH_TARGET||25));

function safe(value,fallback){try{return value?JSON.parse(String(value)):fallback;}catch{return fallback;}}
function meaningful(v){
  if(Array.isArray(v)) return v.some(meaningful);
  if(v&&typeof v==='object') return Object.entries(v).some(([k,x])=>!['source_url','source_urls','status'].includes(k)&&meaningful(x));
  if(typeof v==='string') return v.trim().length>2&&!/^(not found|not retrieved|not yet announced|unknown|n\/a|tbd|tba)$/i.test(v.trim());
  return typeof v==='number'||v===true;
}
function sectionFilled(kind,value){
  if(kind==='overview') return meaningful(value);
  if(kind==='cfp') return [
    value?.status,value?.abstract_submission_deadline,value?.notification_date,value?.submission_guidelines,
    value?.submission_format,value?.length_limit,value?.review_process,value?.publication_information,
    ...(Array.isArray(value?.topics_tracks)?value.topics_tracks:[])
  ].some(meaningful);
  if(kind==='fees') return meaningful(value?.pricing_text)||meaningful(value?.early_bird_deadline)||
    (Array.isArray(value?.registration_fees)&&value.registration_fees.some(meaningful));
  if(kind==='program') return (Array.isArray(value?.sessions)&&value.sessions.some(meaningful))||
    (Array.isArray(value?.themes)&&value.themes.some(meaningful));
  if(kind==='speakers') return Array.isArray(value)&&value.some((x)=>meaningful(x?.name||x?.full_name));
  if(kind==='committee') return Array.isArray(value)&&value.some((x)=>meaningful(x?.name||x?.full_name));
  if(kind==='sponsors') return Array.isArray(value)&&value.some((x)=>
    meaningful(x?.name)&&meaningful(x?.logoUrl||x?.logo_url));
  if(kind==='venue') return [
    value?.venue_name,value?.address,value?.accommodation,value?.travel_information,
    ...(Array.isArray(value?.hotels)?value.hotels:[])
  ].some(meaningful);
  if(kind==='community') return meaningful(value?.summary)||
    (Array.isArray(value?.social_media)&&value.social_media.some(meaningful));
  return false;
}
function sections(row){
  const values=[
    ['overview',safe(row.overview,{})],['cfp',safe(row.call_for_papers,{})],['fees',safe(row.fees_pricing,{})],
    ['program',safe(row.program_agenda,{})],['speakers',safe(row.keynote_speakers,[])],
    ['committee',safe(row.technical_committee,[])],['sponsors',safe(row.sponsors_exhibitors,[])],
    ['venue',safe(row.venue_accommodation,{})],['community',safe(row.community,{})]
  ];
  return values.filter(([kind,value])=>sectionFilled(kind,value)).length;
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
      ec.technical_committee,ec.sponsors_exhibitors,ec.venue_accommodation,ec.community,ec.extraction_metadata
      FROM discovery_events de
      JOIN discovery_event_categories dec ON dec.event_id=de.id
      LEFT JOIN extracted_conferences ec
        ON ec.source_url=de.official_url OR ec.source_url=de.canonical_url
      WHERE de.status='published'
        AND (
          (de.start_date IS NOT NULL AND date(de.start_date)>=date('now'))
          OR (de.start_date IS NULL AND de.start_year>=CAST(strftime('%Y','now') AS INTEGER))
        )`);
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
