import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const POPULAR = [
  'Artificial Intelligence','Data Science','Cybersecurity','Software & Cloud','Telecommunications',
  'Semiconductors & Electronics','Robotics & Automation','Engineering','Civil & Construction',
  'Mechanical Engineering','Electrical Engineering','Chemical Engineering','Materials Science','Energy',
  'Petroleum & Geoscience','Geoscience','Geology','Organic Geochemistry','Renewable Energy','Hydrogen & CCUS','Mining & Minerals','Environment',
  'Climate & Sustainability','Healthcare','Health','Public Health','Pharmaceuticals & Biotechnology','Nursing',
  'Dentistry','Cardiology','Oncology','Neuroscience','Life Sciences','Chemistry','Physics',
  'Mathematics & Statistics','Science','Education','Business','Finance','Economics','Marketing',
  'Supply Chain & Logistics','Manufacturing','Aviation & Aerospace','Maritime','Automotive & Mobility',
  'Architecture & Urbanism','Architecture','Agriculture & Food','Law & Regulation','Government & Policy','Social Sciences',
  'Arts & Culture','Tourism & Hospitality','Blockchain & Web3','Real Estate','Virtual conferences','Open call for papers'
];

const SEEDS = [
  ['33rd International Meeting on Organic Geochemistry (IMOG 2027)','https://imogconference.org/','2027-09-12','2027-09-16','Rotterdam','Netherlands',['Organic Geochemistry','Geoscience','Geology','Petroleum & Geoscience','Science','Open call for papers']],
  ['EAGE Annual 2027','https://eageannual.org/','2027-05-31','2027-06-03','Amsterdam','Netherlands',['Geoscience','Geology','Petroleum & Geoscience','Energy','Engineering','Open call for papers']],
  ['MEOS GEO 2027','https://www.meos-geo.com/','2027-09-14','2027-09-16','Sakhir','Bahrain',['Petroleum & Geoscience','Energy','Engineering','Mechanical Engineering','Electrical Engineering','Civil & Construction','Environment','Climate & Sustainability','Business']],
  ['123rd APSA Annual Meeting & Exhibition','https://apsanet.org/events/annual-meeting-exhibition/','2027-09-02','2027-09-05','Washington, DC','United States',['Politics','Government & Policy','Social Sciences','Education','Open call for papers']],
  ['HIMSS27 Global Health Conference & Exhibition','https://www.himssconference.com/','2027-04-05','2027-04-08','Chicago','United States',['Health','Healthcare','Public Health','Artificial Intelligence','Cybersecurity','Business']],
  ['IDS 2027 International Dental Show','https://www.english.ids-cologne.de/trade-fair/ids/','2027-03-16','2027-03-20','Cologne','Germany',['Dentistry','Health','Healthcare','Business','Science']],
  ['AIA Conference on Architecture & Design 2027','https://conferenceonarchitecture.com/','2027-05-19','2027-05-22','Philadelphia','United States',['Architecture','Architecture & Urbanism','Civil & Construction','Education','Business']],
  ['ISTELive 27','https://conference.iste.org/2027/','2027-06-27','2027-06-30','Boston','United States',['Education','Artificial Intelligence','Software & Cloud','Business','Open call for papers']],
  ['2027 MRS Spring Meeting & Exhibit','https://www.mrs.org/meetings-events/annual-meetings/2027-mrs-spring-meeting-exhibit','2027-04-05','2027-04-09','Seattle','United States',['Materials','Materials Science','Chemistry','Physics','Science','Open call for papers']],
  ['World Summit AI Amsterdam 2026','https://worldsummit.ai/','2026-10-07','2026-10-08','Amsterdam','Netherlands',['Artificial Intelligence','Data Science','Business','Science']],
  ['KubeCon + CloudNativeCon North America 2026','https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/','2026-11-09','2026-11-12','Salt Lake City','United States',['Software & Cloud','Artificial Intelligence','Engineering','Data Science']],
  ['Black Hat Europe 2026','https://blackhat.com/europe/','2026-12-07','2026-12-10','London','United Kingdom',['Cybersecurity','Software & Cloud','Law & Regulation','Business']],
  ['MWC Barcelona 2027','https://www.mwcbarcelona.com/','2027-03-01','2027-03-04','Barcelona','Spain',['Telecommunications','Artificial Intelligence','Software & Cloud','Business','Open call for papers']],
  ['SEMICON Europa 2026','https://www.semiconeuropa.org/','2026-11-10','2026-11-13','Munich','Germany',['Semiconductors & Electronics','Manufacturing','Electrical Engineering','Engineering']],
  ['automatica 2027','https://automatica-munich.com/en/','2027-06-22','2027-06-25','Munich','Germany',['Robotics & Automation','Manufacturing','Mechanical Engineering','Engineering']],
  ['ASME IMECE 2026','https://event.asme.org/IMECE','2026-11-08','2026-11-12','Vancouver','Canada',['Mechanical Engineering','Engineering','Manufacturing','Science']],
  ['IEEE ECCE 2026','https://www.ieee-ecce.org/2026/','2026-10-04','2026-10-08','Vancouver','Canada',['Electrical Engineering','Engineering','Energy','Renewable Energy']],
  ['AIChE Annual Meeting 2026','https://www.aiche.org/conferences/aiche-annual-meeting/2026','2026-11-08','2026-11-12','Minneapolis','United States',['Chemical Engineering','Engineering','Energy','Science']],
  ['2026 MRS Fall Meeting & Exhibit','https://www.mrs.org/meetings-events/fall-meetings-exhibits/2026-mrs-fall-meeting','2026-11-29','2026-12-04','Boston','United States',['Materials Science','Science','Physics','Chemistry']],
  ['ADIPEC 2026','https://www.adipec.com/','2026-11-02','2026-11-05','Abu Dhabi','United Arab Emirates',['Energy','Petroleum & Geoscience','Engineering','Hydrogen & CCUS','Climate & Sustainability']],
  ['RE+ 2026','https://www.re-plus.com/','2026-11-16','2026-11-19','Las Vegas','United States',['Renewable Energy','Energy','Climate & Sustainability','Engineering']],
  ['GHGT-18','https://ghgt.info/','2026-10-25','2026-10-29','Perth','Australia',['Hydrogen & CCUS','Climate & Sustainability','Energy','Engineering','Environment']],
  ['PDAC 2027 Convention','https://pdac.ca/convention','2027-03-07','2027-03-10','Toronto','Canada',['Mining & Minerals','Petroleum & Geoscience','Business','Science']],
  ['Greenbuild 2026','https://informaconnect.com/greenbuild/','2026-10-20','2026-10-23','New York City','United States',['Civil & Construction','Architecture & Urbanism','Environment','Climate & Sustainability']],
  ['Smart City Expo World Congress 2026','https://www.smartcityexpo.com/','2026-11-03','2026-11-05','Barcelona','Spain',['Architecture & Urbanism','Government & Policy','Environment','Artificial Intelligence','Civil & Construction']],
  ['HLTH 2026','https://www.hlth.com/','2026-11-15','2026-11-18','Las Vegas','United States',['Healthcare','Artificial Intelligence','Business','Life Sciences']],
  ['APHA Annual Meeting and Expo 2026','https://www.apha.org/events-and-meetings/annual','2026-11-01','2026-11-04','San Antonio','United States',['Public Health','Healthcare','Government & Policy','Education']],
  ['SLAS2027 International Conference & Exhibition','https://www.slas.org/events-calendar/slas2027-international-conference-exhibition/','2027-01-30','2027-02-03','San Diego','United States',['Life Sciences','Pharmaceuticals & Biotechnology','Robotics & Automation','Artificial Intelligence','Open call for papers']],
  ['38th International Nursing Research Congress','https://www.sigmanursing.org/events/international-nursing-research-congress','2027-07-16','2027-07-18','Dublin','Ireland',['Nursing','Healthcare','Life Sciences','Education','Open call for papers']],
  ['Greater New York Dental Meeting 2026','https://www.gnydm.com/','2026-11-27','2026-12-01','New York City','United States',['Dentistry','Healthcare','Education','Business']],
  ['AHA Scientific Sessions 2026','https://professional.heart.org/en/meetings/scientific-sessions','2026-11-06','2026-11-09','Chicago','United States',['Cardiology','Healthcare','Life Sciences','Science']],
  ['ESMO Congress 2026','https://www.esmo.org/meeting-calendar/esmo-congress-2026','2026-10-23','2026-10-27','Madrid','Spain',['Oncology','Healthcare','Life Sciences','Pharmaceuticals & Biotechnology']],
  ['Neuroscience 2026','https://www.sfn.org/meetings/neuroscience-2026','2026-11-14','2026-11-18','Washington, D.C.','United States',['Neuroscience','Life Sciences','Healthcare','Science']],
  ['ACS Spring 2027','https://www.acs.org/events/spring.html','2027-03-21','2027-03-25','New Orleans','United States',['Chemistry','Science','Materials Science','Education','Open call for papers']],
  ['APS Global Physics Summit 2027','https://summit.aps.org/','2027-04-11','2027-04-16','Atlanta','United States',['Physics','Science','Education','Open call for papers']],
  ['2027 Joint Mathematics Meetings','https://jointmathematicsmeetings.org/','2027-01-12','2027-01-15','Chicago','United States',['Mathematics & Statistics','Science','Education','Open call for papers']],
  ['SXSW EDU 2027','https://sxswedu.com/','2027-03-13','2027-03-16','Austin','United States',['Education','Business','Artificial Intelligence','Social Sciences']],
  ['Web Summit Lisbon 2026','https://websummit.com/','2026-11-09','2026-11-12','Lisbon','Portugal',['Business','Artificial Intelligence','Software & Cloud','Data Science','Marketing']],
  ['Money20/20 USA 2026','https://us.money2020.com/','2026-10-18','2026-10-21','Las Vegas','United States',['Finance','Business','Artificial Intelligence','Law & Regulation']],
  ['AAEA Annual Meeting 2027','https://www.aaea.org/meetings/2027-aaea-annual-meeting','2027-07-25','2027-07-27','Philadelphia','United States',['Economics','Agriculture & Food','Business','Science']],
  ['Content Marketing World 2026','https://www.contentmarketingworld.com/','2026-10-05','2026-10-07','Denver','United States',['Marketing','Business','Arts & Culture','Education']],
  ['CSCMP EDGE 2026','https://www.cscmpedge.org/','2026-10-04','2026-10-07','Nashville','United States',['Supply Chain & Logistics','Business','Manufacturing','Data Science']],
  ['HANNOVER MESSE 2027','https://www.hannovermesse.de/en/','2027-04-05','2027-04-08','Hannover','Germany',['Manufacturing','Engineering','Robotics & Automation','Energy','Artificial Intelligence']],
  ['Paris Air Show 2027','https://www.siae.fr/en/','2027-06-14','2027-06-20','Le Bourget','France',['Aviation & Aerospace','Engineering','Manufacturing','Business']],
  ['Nor-Shipping 2027','https://nor-shipping.com/','2027-06-07','2027-06-11','Oslo / Lillestrøm','Norway',['Maritime','Business','Hydrogen & CCUS','Artificial Intelligence','Energy']],
  ['IAA MOBILITY 2027','https://www.iaa-mobility.com/en','2027-09-07','2027-09-12','Munich','Germany',['Automotive & Mobility','Automotive','Manufacturing','Engineering','Renewable Energy']],
  ['World Agri-Tech Innovation Summit London 2026','https://worldagritechinnovation.com/','2026-09-22','2026-09-23','London','United Kingdom',['Agriculture & Food','Artificial Intelligence','Business','Climate & Sustainability']],
  ['IAPP Global Privacy Summit 2027','https://iapp.org/conference/iapp-global-summit','2027-03-21','2027-03-24','Washington, D.C.','United States',['Law & Regulation','Cybersecurity','Government & Policy','Artificial Intelligence']],
  ['ASPA Annual Conference 2027','https://www.aspanet.org/annualconference','2027-04-09','2027-04-13','New Orleans','United States',['Government & Policy','Social Sciences','Education','Business','Open call for papers']],
  ['ISA World Congress of Sociology 2027','https://www.isa-sociology.org/en/conferences/world-congress/gwangju-2027','2027-07-04','2027-07-10','Gwangju','South Korea',['Social Sciences','Education','Government & Policy','Open call for papers']],
  ['SXSW 2027','https://sxsw.com/','2027-03-15','2027-03-21','Austin','United States',['Arts & Culture','Business','Marketing','Artificial Intelligence']],
  ['ITB Berlin 2027','https://www.itb.com/en/','2027-03-16','2027-03-18','Berlin','Germany',['Tourism & Hospitality','Business','Marketing','Technology & Travel']],
  ['Consensus Hong Kong 2027','https://consensus-hongkong.coindesk.com/','2027-02-01','2027-02-03','Hong Kong','Hong Kong',['Blockchain & Web3','Finance','Artificial Intelligence','Business','Open call for papers']],
  ['MIPIM 2027','https://www.mipim.com/','2027-03-16','2027-03-19','Cannes','France',['Real Estate','Architecture & Urbanism','Finance','Business']],
  ['AAPG Academy – Two Margins, One Cretaceous Play','https://aapg.zoom.us/webinar/register/WN_BbyQ2vCETqSFS_-k-kqWcw#/registration','2026-09-23','2026-09-23',null,null,['Virtual conferences','Petroleum & Geoscience','Energy','Business']],

  // Flagship events: multiple globally important conferences per major category, not one demo seed.
  ['NeurIPS 2026 – Main Conference','https://neurips.cc/Conferences/2026','2026-12-06','2026-12-12','Sydney','Australia',['Artificial Intelligence','Data Science','Science','Life Sciences','Robotics & Automation','Open call for papers']],
  ['CVPR 2027','https://cvpr.thecvf.com/','2027-06-20','2027-06-25','Seattle','United States',['Artificial Intelligence','Data Science','Robotics & Automation','Engineering','Open call for papers']],
  ['RSA Conference 2027','https://www.rsaconference.com/usa','2027-04-05','2027-04-08','San Francisco','United States',['Cybersecurity','Artificial Intelligence','Business','Law & Regulation','Open call for papers']],
  ['CES 2027','https://www.ces.tech/','2027-01-06','2027-01-09','Las Vegas','United States',['Artificial Intelligence','Semiconductors & Electronics','Robotics & Automation','Automotive & Mobility','Healthcare','Business']],
  ['IEEE ICRA 2027','https://www.ieee-ras.org/conferences-workshops/fully-sponsored/icra/','2027-05-24','2027-05-28','Seoul','South Korea',['Robotics & Automation','Artificial Intelligence','Engineering','Mechanical Engineering','Open call for papers']],
  ['IEEE/RSJ IROS 2027','https://2027.ieee-iros.org/','2027-09-26','2027-10-01','Florence','Italy',['Robotics & Automation','Artificial Intelligence','Engineering','Climate & Sustainability']],
  ['BIO International Convention 2027','https://convention.bio.org/','2027-06-07','2027-06-10','Philadelphia','United States',['Pharmaceuticals & Biotechnology','Life Sciences','Healthcare','Business','Open call for papers']],
  ['RSNA 2026 Annual Meeting','https://www.rsna.org/Annual-Meeting','2026-11-29','2026-12-03','Chicago','United States',['Healthcare','Artificial Intelligence','Life Sciences','Science']],
  ['AGU26 Annual Meeting','https://www.agu.org/agu26','2026-12-07','2026-12-11','San Francisco','United States',['Science','Climate & Sustainability','Environment','Petroleum & Geoscience','Education','Open call for papers']],
  ['EGU General Assembly 2027','https://www.egu27.eu/','2027-04-04','2027-04-09','Vienna','Austria',['Science','Petroleum & Geoscience','Climate & Sustainability','Environment','Education','Open call for papers']],
  ['Offshore Technology Conference 2027','https://2027.otcnet.org/','2027-05-03','2027-05-05','Houston','United States',['Petroleum & Geoscience','Energy','Engineering','Hydrogen & CCUS','Renewable Energy','Business']],
  ['OTC Brasil 2027','https://www.otcbrasil.org/','2027-10-26','2027-10-28','Rio de Janeiro','Brazil',['Petroleum & Geoscience','Energy','Engineering','Maritime','Business']],
  ['Gastech 2027','https://www.gastechevent.com/','2027-09-14','2027-09-17','Houston','United States',['Energy','Hydrogen & CCUS','Petroleum & Geoscience','Business','Engineering']],
  ['World Nuclear Exhibition 2027','https://www.world-nuclear-exhibition.com/','2027-12-07','2027-12-09','Paris','France',['Energy','Engineering','Manufacturing','Climate & Sustainability','Business']],
  ['Formnext 2026','https://formnext.mesago.com/frankfurt/en.html','2026-11-17','2026-11-20','Frankfurt','Germany',['Manufacturing','Engineering','Materials Science','Robotics & Automation','Artificial Intelligence']],
  ['World Travel Market London 2026','https://www.wtm.com/london/en-gb.html','2026-11-03','2026-11-05','London','United Kingdom',['Tourism & Hospitality','Business','Marketing','Supply Chain & Logistics']],
  ['SMM 2028','https://www.smm-hamburg.com/','2028-09-05','2028-09-08','Hamburg','Germany',['Maritime','Engineering','Manufacturing','Energy','Supply Chain & Logistics']],
  ['2027 AIChE Spring Meeting & Global Congress on Process Safety','https://www.aiche.org/conferences/aiche-spring-meeting-and-global-congress-on-process-safety/2027','2027-03-21','2027-03-25','Oklahoma City','United States',['Chemical Engineering','Engineering','Energy','Science','Open call for papers']],
  ['MINEXCHANGE 2027','https://smeannualconference.org/','2027-02-28','2027-03-03','Denver','United States',['Mining & Minerals','Engineering','Manufacturing','Business']],
  ['20th European Public Health Conference 2027','https://ephconference.eu/belgrade-2027/','2027-11-16','2027-11-19','Belgrade','Serbia',['Public Health','Healthcare','Government & Policy','Social Sciences','Open call for papers']],
  ['ICN Congress 2027','https://www.icn.ch/events/icn-congress-2027-worlds-largest-international-gathering-nurses','2027-07-08','2027-07-11','Taipei','Taiwan',['Nursing','Healthcare','Public Health','Education','Open call for papers']],
  ['IDS 2027 International Dental Show','https://www.english.ids-cologne.de/trade-fair/ids/','2027-03-16','2027-03-20','Cologne','Germany',['Dentistry','Healthcare','Business','Manufacturing']],
  ['ASCO Annual Meeting 2027','https://www.asco.org/annual-meeting/','2027-06-04','2027-06-08','Chicago','United States',['Oncology','Healthcare','Life Sciences','Pharmaceuticals & Biotechnology']],
  ['ASSA 2027 Annual Meeting','https://www.aeaweb.org/conference','2027-01-03','2027-01-05','Washington, D.C.','United States',['Economics','Finance','Business','Education']],
  ['AIAA SciTech Forum 2027','https://scitech.aiaa.org/','2027-01-11','2027-01-15','Orlando','United States',['Aviation & Aerospace','Engineering','Artificial Intelligence','Science']],
  ['TOKEN2049 Singapore 2026','https://token2049.com/singapore','2026-10-07','2026-10-08','Singapore','Singapore',['Blockchain & Web3','Finance','Artificial Intelligence','Business']],
  ['EXPO REAL 2026','https://exporeal.net/en/trade-fair/','2026-10-05','2026-10-07','Munich','Germany',['Real Estate','Business','Finance','Architecture & Urbanism']],
  ['MWC Shanghai 2027','https://www.mwcshanghai.com/','2027-06-23','2027-06-25','Shanghai','China',['Telecommunications','Artificial Intelligence','Software & Cloud','Semiconductors & Electronics','Business']],
  ['ESC Congress 2027','https://www.escardio.org/events/congresses/esc-congress/future-destinations/','2027-08-27','2027-08-30','Milan','Italy',['Cardiology','Healthcare','Life Sciences','Science']],
  ['Alzheimer’s Association International Conference 2027','https://aaic.alz.org/','2027-07-18','2027-07-21','Chicago','United States',['Neuroscience','Healthcare','Life Sciences','Public Health','Open call for papers']],
  ['International Congress for Industrial and Applied Mathematics 2027','https://www.siam.org/conferences-events/siam-conferences/iciam27/','2027-07-12','2027-07-16','The Hague','Netherlands',['Mathematics & Statistics','Science','Engineering','Data Science']],
  ['AAIC Neuroscience Next 2027','https://www.alz.org/neurosciencenext','2027-02-15','2027-02-18',null,null,['Virtual conferences','Neuroscience','Healthcare','Life Sciences','Education']],
  ['World of Concrete 2027','https://www.worldofconcrete.com/','2027-01-19','2027-01-21','Las Vegas','United States',['Civil & Construction','Engineering','Manufacturing','Architecture & Urbanism','Business']],
  ['2027 AIChE Annual Meeting','https://www.aiche.org/conferences/aiche-annual-meeting/2027','2027-10-31','2027-11-04','San Diego','United States',['Chemical Engineering','Engineering','Energy','Science','Education','Business']],
  ['Sigma Nursing 49th Biennial Convention','https://www.sigmanursing.org/events/biennial-convention','2027-10-29','2027-11-01','Denver','United States',['Nursing','Healthcare','Public Health','Education','Life Sciences','Open call for papers']],
  ['AACR Annual Meeting 2027','https://www.aacr.org/meeting/aacr-annual-meeting-2027/','2027-04-02','2027-04-07','Orlando','United States',['Oncology','Healthcare','Life Sciences','Pharmaceuticals & Biotechnology','Science','Open call for papers']],
  ['AGU27 Annual Meeting','https://www.agu.org/meetings/all-meetings/agu27','2027-12-13','2027-12-17','Washington, D.C.','United States',['Science','Environment','Climate & Sustainability','Petroleum & Geoscience','Education','Virtual conferences','Open call for papers']],
  ['RE+ 2027','https://www.re-plus.com/about/future-dates/','2027-11-15','2027-11-18','Las Vegas','United States',['Renewable Energy','Energy','Climate & Sustainability','Hydrogen & CCUS','Engineering','Business']],
  ['Neuroscience 2027','https://www.sfn.org/meetings/past-and-future-sfn-meetings','2027-10-23','2027-10-27','Chicago','United States',['Neuroscience','Life Sciences','Healthcare','Science','Education']],
  ['DAC 2027 — Design Automation Conference','https://dac.com/2027','2027-07-11','2027-07-14','San Jose','United States',['Semiconductors & Electronics','Electrical Engineering','Software & Cloud','Artificial Intelligence','Cybersecurity','Engineering','Open call for papers']],
  ['ACS Fall 2027','https://www.acs.org/events/acs-meetings/future-meetings.html','2027-08-22','2027-08-26','San Diego','United States',['Chemistry','Materials Science','Science','Education','Engineering','Open call for papers']],
  ['AHA BCVS Scientific Sessions 2027','https://professional.heart.org/en/meetings/basic-cardiovascular-sciences','2027-07-19','2027-07-22','Boston','United States',['Cardiology','Healthcare','Life Sciences','Science','Education','Open call for papers']],

];

function idFor(value) { return 'popular_' + createHash('sha1').update(String(value)).digest('hex').slice(0,24); }
function normalize(value) { return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b20\d{2}\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
function originIcon(url) { try { return new URL('/favicon.ico',url).href; } catch { return null; } }

async function main() {
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim() || undefined})
    : createClient({url:'file:'+localPath});
  try {
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences','discovery_event_categories')");
    if ((tables.rows||[]).length < 3) { console.log('[popular-hard-seed] schema unavailable; skipping'); return; }
    let inserted=0,matched=0,categoriesAdded=0;
    for (const seed of SEEDS) {
      const [title,url,start,end,city,country,categories]=seed;
      const normalized=normalize(title);
      const year=start ? Number(start.slice(0,4)) : null;
      const found=await db.execute({
        sql:`SELECT id FROM discovery_events
             WHERE official_url=? OR canonical_url=? OR (normalized_title=? AND (? IS NULL OR start_year=?))
             ORDER BY CASE WHEN official_url=? OR canonical_url=? THEN 0 ELSE 1 END LIMIT 1`,
        args:[url,url,normalized,year,year,url,url]
      });
      const existingId=found.rows?.[0]?.id ? String(found.rows[0].id) : null;
      const id=existingId || idFor(title+'|'+url);
      const now=new Date().toISOString();
      const logo=originIcon(url);
      const overview={
        conference_name:title,start_date:start,end_date:end,city,country,
        location_text:[city,country].filter(Boolean).join(', ') || null,
        official_url:url,source_url:url,logo_url:logo,logo_source:logo ? 'organiser' : null,
        category:categories[0],categories,topics:categories
      };
      const availability={
        overview:'stated',call_for_papers:'unread',fees_pricing:'unread',program_agenda:'unread',
        keynote_speakers:'unread',technical_committee:'unread',sponsors_exhibitors:'unread',
        venue_accommodation:'unread',community:'unread'
      };
      const meta={
        origin:'discovery_engine',status:'success',discovery_event_id:id,
        import_origin:'popular_category_hard_crawl_seed',hard_crawl_priority:true,
        section_availability:availability,tabs_filled:1,tabs_total:9,seeded_at:now
      };
      const cols=['id','title','normalized_title','start_date','end_date','start_year','start_month','date_precision',
        'city','country','raw_location','event_type','organizer','official_url','canonical_url','topics','primary_category',
        'status','confidence_score','relevance_classification','relevance_reason','quality_flags','extraction_method',
        'source_url','source_domain','last_seen','last_checked','publish_readiness','readiness_reasons'];
      const args=[id,title,normalized,start,end,year,start?Number(start.slice(5,7)):null,start?'day':'unknown',
        city,country,[city,country].filter(Boolean).join(', ')||null,'conference',hostOf(url),url,url,JSON.stringify(categories),categories[0],
        'published',0.96,'conference','popular_category_priority','[]','popular_category_hard_crawl_seed',
        url,hostOf(url),now,now,'publish_ready','[]'];
      await db.execute({
        sql:`INSERT INTO discovery_events(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,normalized_title=excluded.normalized_title,start_date=COALESCE(discovery_events.start_date,excluded.start_date),
               end_date=COALESCE(discovery_events.end_date,excluded.end_date),start_year=COALESCE(discovery_events.start_year,excluded.start_year),
               start_month=COALESCE(discovery_events.start_month,excluded.start_month),city=COALESCE(discovery_events.city,excluded.city),
               country=COALESCE(discovery_events.country,excluded.country),official_url=excluded.official_url,
               canonical_url=excluded.canonical_url,topics=excluded.topics,primary_category=excluded.primary_category,
               status='published',relevance_classification='conference',relevance_reason='popular_category_priority',
               extraction_method=CASE WHEN discovery_events.extraction_method IS NULL THEN excluded.extraction_method ELSE discovery_events.extraction_method END,
               source_url=excluded.source_url,source_domain=excluded.source_domain,last_seen=excluded.last_seen,publish_readiness='publish_ready'`,
        args
      });
      if(existingId) matched+=1; else inserted+=1;
      for(const category of categories){
        await db.execute({
          sql:'INSERT OR IGNORE INTO discovery_event_categories(id,event_id,category,confidence,evidence) VALUES(?,?,?,0.99,?)',
          args:[idFor(id+'|'+category),id,category,JSON.stringify(['Popular-search hard-crawl priority seed'])]
        });
        categoriesAdded+=1;
      }
      const ex=await db.execute({sql:'SELECT source_url FROM extracted_conferences WHERE source_url=? LIMIT 1',args:[url]});
      if(!(ex.rows||[]).length){
        await db.execute({
          sql:`INSERT INTO extracted_conferences(source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
               sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at)
               VALUES(?,?,'{}','{"sessions":[],"themes":[],"overview":null}','[]','[]','[]','{}','{}','{}',?,datetime('now'))`,
          args:[url,JSON.stringify(overview),JSON.stringify(meta)]
        });
      } else {
        const row=await db.execute({sql:'SELECT overview,extraction_metadata FROM extracted_conferences WHERE source_url=? LIMIT 1',args:[url]});
        let oldOverview={},oldMeta={};
        try{oldOverview=JSON.parse(String(row.rows?.[0]?.overview||'{}'));}catch{}
        try{oldMeta=JSON.parse(String(row.rows?.[0]?.extraction_metadata||'{}'));}catch{}
        const mergedOverview={...overview,...oldOverview,categories:[...new Set([...(oldOverview.categories||[]),...categories])],topics:[...new Set([...(oldOverview.topics||[]),...categories])]};
        const mergedMeta={...oldMeta,hard_crawl_priority:true,hard_crawl_categories:categories,discovery_event_id:oldMeta.discovery_event_id||id};
        await db.execute({sql:'UPDATE extracted_conferences SET overview=?,extraction_metadata=?,updated_at=datetime(\'now\') WHERE source_url=?',
          args:[JSON.stringify(mergedOverview),JSON.stringify(mergedMeta),url]});
      }
    }
    const coveredAll=new Set(SEEDS.flatMap((seed)=>seed[6]));
    const covered=new Set(POPULAR.filter((category)=>coveredAll.has(category)));
    const missing=POPULAR.filter((category)=>!covered.has(category));
    console.log('[popular-hard-seed] targets='+SEEDS.length+' inserted='+inserted+' matched='+matched+' categories_added='+categoriesAdded+' covered='+covered.size+'/'+POPULAR.length+' missing='+missing.join('|'));
  } catch(error) {
    console.warn('[popular-hard-seed] failed:',error?.message||error);
  } finally { try{db.close();}catch{} }
}
await main();
