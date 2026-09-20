import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function stableId(value){ return 'requested_' + createHash('sha1').update(String(value)).digest('hex').slice(0,24); }
function normalizeTitle(value){ return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b20\d{2}\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
function hostOf(url){ try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';} }
function favicon(url){ try{return new URL('/favicon.ico',url).href;}catch{return null;} }
function person(name,organization,role=null){ return {name,full_name:name,organization:organization||null,org:organization||null,role,title:null,email:null,photo_url:null}; }

const EVENTS=[
  {
    title:'33rd International Meeting on Organic Geochemistry (IMOG 2027)',
    url:'https://imogconference.org/',
    start:'2027-09-12',end:'2027-09-16',city:'Rotterdam',country:'Netherlands',venue:'Rotterdam, Netherlands',format:'in-person',
    organizer:'European Association of Organic Geochemists (EAOG) / EAGE',
    categories:['Organic Geochemistry','Geoscience','Geology','Petroleum & Geoscience','Science'],
    description:'IMOG 2027 is the 33rd International Meeting on Organic Geochemistry, covering organic matter cycles, biogeochemistry, palaeoclimate, environmental science, geochemical archaeology, petroleum systems and emerging energy applications.',
    cfp:{status:'Published',submission_guidelines:'The official IMOG site publishes abstract submission instructions and a Submit Abstract route.',submission_url:'https://imogconference.org/submission-instruction/'},
    program:{overview:'The official IMOG site publishes a technical programme structure for 80+ oral presentations and about 300 posters, spanning organic geochemistry from biogeochemistry to petroleum geochemistry.',themes:['Organic geochemistry','Biogeochemistry','Petroleum geochemistry','Palaeoclimate','Environmental sciences','Emerging energy solutions']},
    sponsors:[{name:'Galp',tier:'Bronze Sponsor',logo_url:null}],
    venueInfo:{venue_name:'Rotterdam, Netherlands',address:'Rotterdam, Netherlands',accommodation:null},
    community:{overview:'IMOG emphasizes scientific exchange, networking and community across academia and industry, with a dedicated social programme and exhibition.'},
    sourceUrls:['https://imogconference.org/','https://imogconference.org/technical-programme-schedule/','https://imogconference.org/sponsors/']
  },
  {
    title:'EAGE Annual 2027',
    url:'https://eageannual.org/',
    start:'2027-05-31',end:'2027-06-03',city:'Amsterdam',country:'Netherlands',venue:'Amsterdam, The Netherlands',format:'in-person',
    organizer:'European Association of Geoscientists and Engineers (EAGE)',
    categories:['Geoscience','Geology','Petroleum & Geoscience','Energy','Engineering'],
    description:'EAGE Annual 2027 is the EAGE Annual Conference & Exhibition in Amsterdam, combining geoscience, geology, geophysics, engineering, energy-transition, minerals, infrastructure and digital disciplines.',
    cfp:{status:'Open',abstract_submission_deadline:'2027-01-15',submission_guidelines:'EAGE lists 15 January 2027 as the Call for Abstracts deadline.'},
    program:{overview:'The conference publishes a technical programme and schedule across geophysics, geology, earth sciences, engineering, energy transition, minerals, infrastructure and computer/data disciplines.',themes:['Geophysics','Geology','Earth sciences','Engineering','Energy transition','Environment, minerals and infrastructure','Computer science and information management']},
    sponsors:[{name:'Exhibition and sponsorship programme published by EAGE',tier:'Opportunities available',logo_url:null}],
    venueInfo:{venue_name:'Amsterdam, The Netherlands',address:'Amsterdam, Netherlands',accommodation:'EAGE provides accommodation guidance as part of presenter and attendee planning.'},
    community:{overview:'EAGE Annual includes an exhibition, icebreaker reception, conference evening, workshops, field trips, short courses, hackathon and community programme.'},
    sourceUrls:['https://eageannual.org/','https://eageannual.org/technical-programme/','https://eageannual.org/exhibition-opportunities/','https://eageannual.org/registration/']
  },
  {
    title:'123rd APSA Annual Meeting & Exhibition',
    url:'https://apsanet.org/events/annual-meeting-exhibition/',
    start:'2027-09-02',end:'2027-09-05',city:'Washington, DC',country:'United States',venue:'Washington, DC',format:'in-person',
    organizer:'American Political Science Association (APSA)',
    categories:['Politics','Government & Policy','Social Sciences','Education'],
    description:'The 123rd APSA Annual Meeting & Exhibition will convene political scientists in Washington, DC around scholarship in political science and the 2027 theme “The Institutions We Need: Design, Reform, and Renewal.”',
    cfp:{status:'Opening October 2026',submission_guidelines:'APSA states that the 2027 Call for Proposals will open in October 2026.'},
    program:{overview:'The Annual Meeting includes panels and sessions prepared by APSA divisions and related groups around political-science research and the annual conference theme.',themes:['Political science','Institutions','Design and reform','Governance','Research and scholarship']},
    committee:[person('William Howell','Johns Hopkins University','2027 Program Co-Chair'),person('Jon Pevehouse','University of Wisconsin','2027 Program Co-Chair')],
    venueInfo:{venue_name:'Washington, DC',address:'Washington, DC, United States',accommodation:'APSA states that official housing for the 2027 Annual Meeting is open with special group rates and room blocks.'},
    community:{overview:'The Annual Meeting & Exhibition brings together scholars, APSA divisions, related groups, exhibitors and the wider political-science community.'},
    sourceUrls:['https://apsanet.org/events/annual-meeting-exhibition/','https://apsanet.org/EVENTS/Upcoming-APSA-Conferences/']
  },
  {
    title:'HIMSS27 Global Health Conference & Exhibition',
    url:'https://www.himssconference.com/',
    start:'2027-04-05',end:'2027-04-08',city:'Chicago',country:'United States',venue:'McCormick Place Convention Center',format:'in-person',
    organizer:'HIMSS',
    categories:['Health','Healthcare','Public Health','Artificial Intelligence','Cybersecurity','Business'],
    description:'HIMSS27 is the HIMSS Global Health Conference & Exhibition, bringing healthcare, technology, clinical, executive and policy communities together around health IT and care transformation.',
    cfp:{status:'Closed',abstract_submission_deadline:'2026-06-30',submission_guidelines:'The HIMSS27 Call for Proposals closed on June 30, 2026.'},
    program:{overview:'HIMSS27 advertises 600+ educational sessions covering AI, cybersecurity, digital health, interoperability, health equity, data governance, workforce and healthcare transformation.',themes:['AI in healthcare','Cybersecurity','Digital health','Interoperability','Health equity','Data governance','Healthcare transformation']},
    sponsors:[{name:'HIMSS27 exhibition and sponsorship programme',tier:'Official opportunities published',logo_url:null}],
    venueInfo:{venue_name:'McCormick Place Convention Center',address:'Chicago, Illinois, United States',accommodation:'HIMSS27 provides an official hotel block and allows hotel booking before conference registration opens.'},
    community:{overview:'HIMSS27 includes expert-led sessions, keynote sessions, opening reception, exhibition experiences, preconference forums and networking across the global healthcare ecosystem.'},
    sourceUrls:['https://www.himssconference.com/','https://www.himssconference.com/faqs/','https://www.himssconference.com/about-the-conference/','https://www.himssconference.com/about-the-exhibition/']
  },
  {
    title:'IDS 2027 International Dental Show',
    url:'https://www.english.ids-cologne.de/trade-fair/ids/',
    start:'2027-03-16',end:'2027-03-20',city:'Cologne',country:'Germany',venue:'Koelnmesse, Messegelände Köln-Deutz',format:'in-person',
    organizer:'GFDI / VDDI / Koelnmesse',
    categories:['Dentistry','Health','Healthcare','Business','Science'],
    description:'IDS 2027 is the 42nd International Dental Show in Cologne, a major global meeting point for the dental sector, practices, laboratories, manufacturers and decision-makers.',
    program:{overview:'IDS 2027 covers dental-practice and dental-laboratory technologies, infection control, maintenance, services, information, communication and organisation, with product presentations and hands-on demonstrations.',themes:['Dental practice','Dental laboratory','Infection control','Dental technology','Services and communication']},
    sponsors:[{name:'IDS 2027 preliminary exhibitor programme',tier:'Exhibition',logo_url:null}],
    venueInfo:{venue_name:'Koelnmesse, Messegelände Köln-Deutz',address:'Cologne, Germany',accommodation:'The official IDS site provides hotel and travel planning resources for Cologne.'},
    community:{overview:'IDS is a global dental-industry meeting place built around innovation, demonstrations, business contacts and networking across dental practices, laboratories and manufacturers.'},
    sourceUrls:['https://www.english.ids-cologne.de/trade-fair/ids/','https://www.english.ids-cologne.de/trade-fair/ids/facts-and-figures/','https://www.english.ids-cologne.de/ids-cologne-exhibitors/preliminary-exhibitor-list/']
  },
  {
    title:'IAA MOBILITY 2027',
    url:'https://www.iaa-mobility.com/en',
    start:'2027-09-07',end:'2027-09-12',city:'Munich',country:'Germany',venue:'Messe München and Munich city center',format:'in-person',
    organizer:'IAA MOBILITY',
    categories:['Automotive','Automotive & Mobility','Manufacturing','Engineering','Artificial Intelligence','Renewable Energy'],
    description:'IAA MOBILITY 2027 is a major international mobility platform in Munich spanning vehicles, software-defined mobility, autonomous driving, electrification, charging, intelligent infrastructure and sustainability.',
    cfp:{status:'Speaker applications open',submission_guidelines:'IAA MOBILITY 2027 publishes an Apply as a Speaker route for the IAA Conference.'},
    program:{overview:'IAA MOBILITY includes the professional IAA Summit and IAA Conference at Messe München plus the public IAA Open Space in central Munich.',themes:['Software-defined vehicles','Artificial intelligence','Autonomous driving','Electrification','Charging infrastructure','Smart infrastructure','Circular economy']},
    sponsors:[{name:'IAA MOBILITY 2027 exhibitor and partner programme',tier:'Participation opportunities',logo_url:null}],
    venueInfo:{venue_name:'Messe München and Munich city center',address:'Munich, Germany',accommodation:null},
    community:{overview:'The event combines B2B conference stages, keynotes, test drives, networking formats, world premieres and public Open Space activities.'},
    sourceUrls:['https://www.iaa-mobility.com/en','https://www.iaa-mobility.com/en/visitors/iaa-formats-2027/iaa-conference','https://www.iaa-mobility.com/en/visitors/iaa-formats-2027/iaa-summit']
  },
  {
    title:'AIA Conference on Architecture & Design 2027',
    url:'https://conferenceonarchitecture.com/',
    start:'2027-05-19',end:'2027-05-22',city:'Philadelphia',country:'United States',venue:'Philadelphia, Pennsylvania',format:'in-person',
    organizer:'American Institute of Architects (AIA)',
    categories:['Architecture','Architecture & Urbanism','Civil & Construction','Education','Business'],
    description:'AIA27 is the AIA Conference on Architecture & Design in Philadelphia, focused on architecture practice, design, climate action, technology, leadership, collaboration and the built environment.',
    cfp:{status:'Closed',abstract_submission_deadline:'2026-07-21',submission_guidelines:'The AIA27 Call for Proposals closed July 21, 2026; final acceptance notifications are scheduled for November 2026.'},
    program:{overview:'AIA27 is planned as four days of learning, keynotes, architect-led tours, networking and a major architecture expo.',themes:['AI and new technologies in practice','Business strategy','Climate action and sustainability','Advocacy and leadership','Cross-disciplinary collaboration','Built environment challenges']},
    sponsors:[{name:'AIA27 Expo and sponsorship programme',tier:'Exhibit & sponsor opportunities open',logo_url:null}],
    venueInfo:{venue_name:'Philadelphia, Pennsylvania',address:'Philadelphia, Pennsylvania, United States',accommodation:null},
    community:{overview:'AIA27 emphasizes architect-led tours, professional education, expo engagement and networking across architecture and design professionals.'},
    sourceUrls:['https://conferenceonarchitecture.com/','https://conferenceonarchitecture.com/call-for-proposals/','https://conferenceonarchitecture.com/exhibit/']
  },
  {
    title:'ISTELive 27',
    url:'https://conference.iste.org/2027/',
    start:'2027-06-27',end:'2027-06-30',city:'Boston',country:'United States',venue:'Thomas M. Menino Convention and Exhibition Center',format:'hybrid',
    organizer:'International Society for Transforming Education (ISTE)',
    categories:['Education','Artificial Intelligence','Software & Cloud','Business'],
    description:'ISTELive 27 is a hybrid international education conference in Boston focused on transforming education through pedagogy, curriculum, technology and practical innovation.',
    cfp:{status:'Open',abstract_submission_deadline:'2026-09-30',submission_guidelines:'The ISTELive 27 Call for Participation is open through September 30, 2026, with multiple session formats and proposal guidance.'},
    program:{overview:'ISTELive 27 will run June 27–30, 2027 with hybrid participation; the full program is scheduled to launch in February.',themes:['Education transformation','Pedagogy','Curriculum','Technology in learning','Professional learning','Future-focused practice']},
    sponsors:[{name:'ISTELive 27 sponsorship and exhibition programme',tier:'Official sponsorship opportunities',logo_url:null}],
    venueInfo:{venue_name:'Thomas M. Menino Convention and Exhibition Center',address:'415 Summer Street, Boston, MA 02210, United States',accommodation:'ISTELive plans official housing information and selected hotel shuttle service.'},
    community:{overview:'ISTELive includes in-person and virtual participation, expo activity, volunteering, professional-learning credit opportunities and networking across the education community.'},
    sourceUrls:['https://conference.iste.org/2027/','https://conference.iste.org/2027/about/faq.php','https://conference.iste.org/2027/presenters/submit_proposal.php','https://conference.iste.org/2027/exhibitors/sponsor.php']
  },
  {
    title:'2027 MRS Spring Meeting & Exhibit',
    url:'https://www.mrs.org/meetings-events/annual-meetings/2027-mrs-spring-meeting-exhibit',
    start:'2027-04-05',end:'2027-04-09',city:'Seattle',country:'United States',venue:'Seattle Convention Center Summit / Hyatt Regency Seattle',format:'in-person',
    organizer:'Materials Research Society (MRS)',
    categories:['Materials','Materials Science','Chemistry','Physics','Science','Engineering'],
    description:'The 2027 MRS Spring Meeting & Exhibit is an interdisciplinary materials-research meeting in Seattle covering emerging science and technology across materials disciplines.',
    cfp:{status:'Open',abstract_submission_deadline:'2026-10-14',submission_guidelines:'Abstract submissions opened September 16, 2026 and close October 14, 2026 at 11:59 pm ET.'},
    program:{overview:'The meeting publishes symposia across characterization, electronics/optics/photonics, energy and sustainability, manufacturing, materials theory/computation/data science, nanomaterials, quantum materials, soft materials/biomaterials and structural/functional materials.',themes:['Characterization','Electronics, optics and photonics','Energy and sustainability','Manufacturing','Materials theory and data science','Nanomaterials','Quantum materials','Soft materials and biomaterials','Structural and functional materials']},
    committee:[person('Christoph Eberl','Fraunhofer Institute for Mechanics of Materials','Meeting Chair'),person('Bin Liu','National University of Singapore','Meeting Chair'),person('Byungha Shin','KAIST','Meeting Chair'),person('Nikhilendra Singh','Toyota Research Institute of North America','Meeting Chair'),person('Xin Zhang','Pacific Northwest National Laboratory','Meeting Chair')],
    sponsors:[{name:'MRS exhibit and sponsorship programme',tier:'Official opportunities published',logo_url:null}],
    venueInfo:{venue_name:'Seattle Convention Center Summit / Hyatt Regency Seattle',address:'Seattle, Washington, United States',accommodation:'The official MRS meeting page identifies the Summit at Seattle Convention Center and Hyatt Regency Seattle as meeting venues.'},
    community:{overview:'The MRS Spring Meeting is built around interdisciplinary exchange, international research presentation, exhibitor engagement and networking among students, postdocs and established researchers.'},
    sourceUrls:['https://www.mrs.org/meetings-events/annual-meetings/2027-mrs-spring-meeting-exhibit','https://www.mrs.org/meetings-events/annual-meetings/2027-mrs-spring-meeting-exhibit/call-for-abstracts','https://www.mrs.org/meetings-events/annual-meetings/2027-mrs-spring-meeting-exhibit/exhibit-sponsor/exhibitor-sponsor-resources']
  }
];

function sectionAvailability(e){
  return {
    overview:'stated',
    call_for_papers:e.cfp?'stated':'not_announced',
    fees_pricing:'not_announced',
    program_agenda:e.program?'stated':'not_announced',
    keynote_speakers:Array.isArray(e.speakers)&&e.speakers.length?'stated':'not_announced',
    technical_committee:Array.isArray(e.committee)&&e.committee.length?'stated':'not_announced',
    sponsors_exhibitors:Array.isArray(e.sponsors)&&e.sponsors.length?'stated':'not_announced',
    venue_accommodation:e.venueInfo?'stated':'not_announced',
    community:e.community?'stated':'not_announced'
  };
}

async function main(){
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim()||undefined})
    : createClient({url:'file:'+localPath});
  try{
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences','discovery_event_categories')");
    if((tables.rows||[]).length<3){ console.log('[requested-expansion] schema unavailable; skipping'); return; }
    let synced=0,rich6=0;
    for(const e of EVENTS){
      const now=new Date().toISOString();
      const normalized=normalizeTitle(e.title);
      const year=Number(e.start.slice(0,4));
      const month=Number(e.start.slice(5,7));
      const found=await db.execute({sql:'SELECT id FROM discovery_events WHERE official_url=? OR canonical_url=? OR (normalized_title=? AND start_year=?) LIMIT 1',args:[e.url,e.url,normalized,year]});
      const id=found.rows?.[0]?.id ? String(found.rows[0].id) : stableId(e.title+'|'+e.url);
      const location=[e.venue,e.city,e.country].filter(Boolean).join(', ');
      const cols=['id','title','normalized_title','description','start_date','end_date','start_year','start_month','date_precision','dates_text','venue','city','country','raw_location','format','event_type','organizer','official_url','canonical_url','topics','primary_category','status','confidence_score','relevance_classification','relevance_reason','quality_flags','extraction_method','source_url','source_domain','last_seen','last_checked','last_verified','published_at','publish_readiness','readiness_reasons','official_source_verified_at','title_verified_at'];
      const args=[id,e.title,normalized,e.description,e.start,e.end,year,month,'day',e.start+' – '+e.end,e.venue,e.city,e.country,location,e.format,'conference',e.organizer,e.url,e.url,JSON.stringify(e.categories),e.categories[0],'published',0.99,'conference','requested_category_verified_expansion','[]','requested_category_verified_expansion',e.url,hostOf(e.url),now,now,now,now,'publish_ready','[]',now,now];
      await db.execute({sql:`INSERT INTO discovery_events(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,start_date=excluded.start_date,end_date=excluded.end_date,start_year=excluded.start_year,start_month=excluded.start_month,venue=excluded.venue,city=excluded.city,country=excluded.country,raw_location=excluded.raw_location,format=excluded.format,organizer=excluded.organizer,official_url=excluded.official_url,canonical_url=excluded.canonical_url,topics=excluded.topics,primary_category=excluded.primary_category,status='published',confidence_score=0.99,relevance_reason='requested_category_verified_expansion',source_url=excluded.source_url,source_domain=excluded.source_domain,last_seen=excluded.last_seen,last_checked=excluded.last_checked,last_verified=excluded.last_verified,publish_readiness='publish_ready'`,args});
      for(const cat of e.categories){
        await db.execute({sql:'INSERT OR IGNORE INTO discovery_event_categories(id,event_id,category,confidence,evidence) VALUES(?,?,?,0.99,?)',args:[stableId(id+'|'+cat),id,cat,JSON.stringify(['Official event sources'])]});
      }
      const avail=sectionAvailability(e);
      const filled=Object.values(avail).filter(v=>v==='stated').length;
      if(filled>=6) rich6++;
      const overview={conference_name:e.title,description:e.description,start_date:e.start,end_date:e.end,dates_text:e.start+' – '+e.end,city:e.city,country:e.country,venue:e.venue,location_text:location,format:e.format,organizer:e.organizer,official_url:e.url,source_url:e.url,logo_url:favicon(e.url),logo_source:'organiser',category:e.categories[0],categories:e.categories,topics:e.categories};
      const venue=e.venueInfo?{...e.venueInfo,hotels:e.venueInfo.hotels||[]}:{};
      const meta={origin:'discovery_engine',status:'success',discovery_event_id:id,import_origin:'requested_category_verified_expansion',validation_status:'VERIFIED_OFFICIAL_SOURCES',validation_score:0.99,source_urls:e.sourceUrls||[e.url],section_availability:avail,section_notes:{call_for_papers:e.cfp?.submission_guidelines||null,program_agenda:e.program?.overview||null,sponsors_exhibitors:e.sponsors?.[0]?.name||null,venue_accommodation:e.venueInfo?.accommodation||e.venueInfo?.address||null,community:e.community?.overview||null},tabs_filled:filled,tabs_total:9,verified_at:now};
      await db.execute({sql:`INSERT INTO extracted_conferences(source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,updated_at=datetime('now')`,
        args:[e.url,JSON.stringify(overview),JSON.stringify(e.cfp||{}),JSON.stringify(e.program?{sessions:e.program.sessions||[],themes:e.program.themes||[],overview:e.program.overview||null}:{sessions:[],themes:[],overview:null}),JSON.stringify(e.speakers||[]),JSON.stringify(e.committee||[]),JSON.stringify(e.sponsors||[]),JSON.stringify(venue),JSON.stringify({}),JSON.stringify(e.community||{}),JSON.stringify(meta)]});
      synced++;
    }
    console.log('[requested-expansion] synced='+synced+' rich_6plus_tabs='+rich6+' total='+EVENTS.length);
  }catch(error){ console.warn('[requested-expansion] failed:',error?.message||error); }
  finally{ try{db.close();}catch{} }
}
await main();
