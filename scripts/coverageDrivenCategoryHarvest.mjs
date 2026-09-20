import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = [
  'Artificial Intelligence','Data Science','Cybersecurity','Software & Cloud','Telecommunications',
  'Semiconductors & Electronics','Robotics & Automation','Engineering','Civil & Construction',
  'Mechanical Engineering','Electrical Engineering','Chemical Engineering','Materials Science','Energy',
  'Petroleum & Geoscience','Renewable Energy','Hydrogen & CCUS','Mining & Minerals','Environment',
  'Climate & Sustainability','Healthcare','Public Health','Pharmaceuticals & Biotechnology','Nursing',
  'Dentistry','Cardiology','Oncology','Neuroscience','Life Sciences','Chemistry','Physics',
  'Mathematics & Statistics','Science','Education','Business','Finance','Economics','Marketing',
  'Supply Chain & Logistics','Manufacturing','Aviation & Aerospace','Maritime','Automotive & Mobility',
  'Architecture & Urbanism','Agriculture & Food','Law & Regulation','Government & Policy','Social Sciences',
  'Arts & Culture','Tourism & Hospitality','Blockchain & Web3','Real Estate','Virtual conferences',
  'Open call for papers'
]

const CATEGORY_SOURCES = {
  'Artificial Intelligence':['neurips.cc','cvpr.thecvf.com','worldsummit.ai','ces.tech','ieee-ras.org'],
  'Data Science':['neurips.cc','cvpr.thecvf.com','ieee.org','agu.org','slas.org'],
  'Cybersecurity':['rsaconference.com','blackhat.com','iapp.org','himssconference.com'],
  'Software & Cloud':['events.linuxfoundation.org','websummit.com','mwcbarcelona.com','ieee.org'],
  'Telecommunications':['mwcbarcelona.com','mwcshanghai.com','ieee.org'],
  'Semiconductors & Electronics':['semiconeuropa.org','ces.tech','ieee.org','mrs.org'],
  'Robotics & Automation':['ieee-ras.org','2027.ieee-iros.org','automatica-munich.com','hannovermesse.de'],
  'Engineering':['event.asme.org','asce.org','ieee.org','aiche.org'],
  'Civil & Construction':['asce.org','informaconnect.com','smartcityexpo.com','exporeal.net'],
  'Mechanical Engineering':['event.asme.org','automatica-munich.com','hannovermesse.de'],
  'Electrical Engineering':['ieee.org','ieee-ecce.org','semiconeuropa.org'],
  'Chemical Engineering':['aiche.org','acs.org','mrs.org'],
  'Materials Science':['mrs.org','acs.org','formnext.com','semiconeuropa.org'],
  'Materials':['mrs.org','acs.org','formnext.com','semiconeuropa.org'],
  'Energy':['adipec.com','gastechevent.com','otcnet.org','spe.org','aapg.org','re-plus.com'],
  'Petroleum & Geoscience':['aapg.org','spe.org','eage.org','adipec.com','otcnet.org','imogconference.org'],
  'Geoscience':['eageannual.org','imogconference.org','agu.org','egu.eu','aapg.org'],
  'Geology':['eageannual.org','imogconference.org','agu.org','egu.eu','aapg.org'],
  'Organic Geochemistry':['imogconference.org','eage.org','aapg.org'],
  'Renewable Energy':['re-plus.com','ieee-ecce.org','nor-shipping.com','gastechevent.com'],
  'Hydrogen & CCUS':['ghgt.info','gastechevent.com','adipec.com','nor-shipping.com'],
  'Mining & Minerals':['pdac.ca','smeannualconference.org','segweb.org'],
  'Environment':['agu.org','egu.eu','informaconnect.com','smartcityexpo.com'],
  'Climate & Sustainability':['agu.org','egu.eu','ghgt.info','re-plus.com'],
  'Healthcare':['himssconference.com','hlth.com','rsna.org','asco.org'],
  'Health':['himssconference.com','hlth.com','apha.org','rsna.org'],
  'Public Health':['apha.org','ephconference.eu','icn.ch'],
  'Pharmaceuticals & Biotechnology':['convention.bio.org','slas.org','asco.org','esmo.org'],
  'Nursing':['sigmanursing.org','icn.ch','apha.org'],
  'Dentistry':['ids-cologne.de','gnydm.com','ada.org'],
  'Cardiology':['professional.heart.org','escardio.org'],
  'Oncology':['esmo.org','asco.org','aacr.org'],
  'Neuroscience':['sfn.org','aaic.alz.org','alz.org'],
  'Life Sciences':['slas.org','convention.bio.org','sfn.org','acs.org'],
  'Chemistry':['acs.org','goldschmidt.info','imogconference.org'],
  'Physics':['summit.aps.org','aps.org','agu.org'],
  'Mathematics & Statistics':['jointmathematicsmeetings.org','siam.org','ams.org'],
  'Science':['agu.org','egu.eu','acs.org','aps.org'],
  'Education':['conference.iste.org','sxswedu.com','aspanet.org','asee.org','ieee.org'],
  'Business':['websummit.com','us.money2020.com','sxsw.com','mipim.com'],
  'Finance':['us.money2020.com','consensus.coindesk.com','mipim.com','aeaweb.org'],
  'Economics':['aeaweb.org','aaea.org'],
  'Marketing':['contentmarketingworld.com','sxsw.com','websummit.com'],
  'Supply Chain & Logistics':['cscmpedge.org','hannovermesse.de','nor-shipping.com'],
  'Manufacturing':['hannovermesse.de','formnext.com','semiconeuropa.org','automatica-munich.com'],
  'Aviation & Aerospace':['siae.fr','scitech.aiaa.org','aiaa.org'],
  'Maritime':['nor-shipping.com','smm-hamburg.com','otcnet.org'],
  'Automotive & Mobility':['iaa-mobility.com','ces.tech','hannovermesse.de'],
  'Automotive':['iaa-mobility.com','ces.tech','hannovermesse.de'],
  'Architecture & Urbanism':['smartcityexpo.com','informaconnect.com','mipim.com','exporeal.net'],
  'Architecture':['conferenceonarchitecture.com','smartcityexpo.com','mipim.com','exporeal.net'],
  'Agriculture & Food':['worldagritechinnovation.com','aaea.org','ifama.org'],
  'Law & Regulation':['iapp.org','americanbar.org','us.money2020.com'],
  'Government & Policy':['aspanet.org','smartcityexpo.com','apha.org'],
  'Politics':['apsanet.org','aspanet.org','isa-sociology.org'],
  'Social Sciences':['isa-sociology.org','aspanet.org','aeaweb.org'],
  'Arts & Culture':['sxsw.com','sxswedu.com','aaslh.org'],
  'Tourism & Hospitality':['itb.com','wtm.com','phocuswrightconference.com'],
  'Blockchain & Web3':['consensus.coindesk.com','token2049.com','us.money2020.com'],
  'Real Estate':['mipim.com','exporeal.net','smartcityexpo.com'],
  'Virtual conferences':['aapg.org','alz.org','acs.org','icn.ch'],
  'Open call for papers':['ieee.org','acm.org','aiche.org','acs.org','agu.org']
};

const CATEGORY_SPONSOR_SOURCES = {
  'Artificial Intelligence':['gitex.com','theaisummit.com','worldaishow.com','superai.com'],
  'Data Science':['odsc.com','databricks.com','snowflake.com','bigdata-london.com'],
  'Cybersecurity':['infosecurityeurope.com','gisec.ae','blackhatmea.com','cybertechisrael.com'],
  'Software & Cloud':['cloudfest.com','kubecon.io','events.linuxfoundation.org','websummit.com'],
  'Telecommunications':['mwckigali.com','capacitymedia.com','internationaltelecomsweek.com','mwcbarcelona.com'],
  'Semiconductors & Electronics':['semiconwest.org','semiconsea.org','semiconchina.org','electronica.de'],
  'Robotics & Automation':['automatica-munich.com','robotics-summit.com','promatshow.com','hannovermesse.de'],
  'Engineering':['bauma.de','worldofconcrete.com','event.asme.org','thebig5.ae'],
  'Civil & Construction':['worldofconcrete.com','bauma.de','big5global.com','thebig5.ae'],
  'Mechanical Engineering':['event.asme.org','bauma.de','hannovermesse.de','imts.com'],
  'Electrical Engineering':['middleeast-energy.com','electronica.de','ieee-pes.org','intersolar.de'],
  'Chemical Engineering':['achema.de','aiche.org','cphi.com','chemukexpo.com'],
  'Materials Science':['jec-world.events','tms.org','mrs.org','formnext.com'],
  'Materials':['jec-world.events','tms.org','mrs.org','formnext.com'],
  'Energy':['ceraweek.com','worldfutureenergysummit.com','middleeast-energy.com','adipec.com','gastechevent.com'],
  'Petroleum & Geoscience':['meos-geo.com','iptcnet.org','otcnet.org','spe.org','aapg.org','eage.org'],
  'Geoscience':['meos-geo.com','iptcnet.org','eage.org','aapg.org','seg.org'],
  'Geology':['meos-geo.com','eage.org','aapg.org','seg.org'],
  'Organic Geochemistry':['imogconference.org','eage.org','aapg.org','goldschmidt.info'],
  'Renewable Energy':['thesmartere.de','windeurope.org','re-plus.com','worldfutureenergysummit.com'],
  'Hydrogen & CCUS':['worldhydrogensummit.com','hydrogen-worldexpo.com','ghgt.info','gastechevent.com'],
  'Mining & Minerals':['miningindaba.com','minesandmoney.com','pdac.ca','smeannualconference.org'],
  'Environment':['pollutec.com','ifat.de','worldfutureenergysummit.com','smartcityexpo.com'],
  'Climate & Sustainability':['worldfutureenergysummit.com','windeurope.org','pollutec.com','smartcityexpo.com'],
  'Healthcare':['medica-tradefair.com','himssconference.com','worldhealthexpo.com','hlth.com'],
  'Health':['medica-tradefair.com','worldhealthexpo.com','himssconference.com','hlth.com'],
  'Public Health':['apha.org','ephconference.eu','worldhealthexpo.com','himssconference.com'],
  'Pharmaceuticals & Biotechnology':['cphi.com','bioeurope.com','convention.bio.org','slas.org'],
  'Nursing':['sigmanursing.org','icn.ch','worldhealthexpo.com','himssconference.com'],
  'Dentistry':['aeedc.com','ids-cologne.de','gnydm.com','ada.org'],
  'Cardiology':['escardio.org','professional.heart.org','tctconference.com','accscientificsession.acc.org'],
  'Oncology':['asco.org','esmo.org','aacr.org','nccn.org'],
  'Neuroscience':['sfn.org','aaic.alz.org','alz.org','fens.org'],
  'Life Sciences':['slas.org','convention.bio.org','cphi.com','bioeurope.com'],
  'Chemistry':['pittcon.org','acs.org','achema.de','analytica.de'],
  'Physics':['spie.org','photonicseurope.org','aps.org','summit.aps.org'],
  'Mathematics & Statistics':['amstat.org','siam.org','jointmathematicsmeetings.org','ams.org'],
  'Science':['pittcon.org','spie.org','agu.org','acs.org'],
  'Education':['bettshow.com','conference.iste.org','educause.edu','sxswedu.com'],
  'Business':['websummit.com','milkeninstitute.org','money2020.com','gitex.com'],
  'Finance':['sibos.com','money2020.com','seamlessxtra.com','consensus.coindesk.com'],
  'Economics':['aeaweb.org','milkeninstitute.org','money2020.com','aaea.org'],
  'Marketing':['dmexco.com','advertisingweek.com','contentmarketingworld.com','sxsw.com'],
  'Supply Chain & Logistics':['transportlogistic.de','manifestvegas.com','cscmpedge.org','promatshow.com'],
  'Manufacturing':['imts.com','hannovermesse.de','formnext.com','promatshow.com'],
  'Aviation & Aerospace':['dubaiairshow.aero','farnboroughairshow.com','siae.fr','scitech.aiaa.org'],
  'Maritime':['posidonia-events.com','nor-shipping.com','smm-hamburg.com','seatrade-maritime.com'],
  'Automotive & Mobility':['automechanika.messefrankfurt.com','iaa-mobility.com','ces.tech','mobilitymove.de'],
  'Automotive':['automechanika.messefrankfurt.com','iaa-mobility.com','ces.tech','mobilitymove.de'],
  'Architecture & Urbanism':['cityscapeglobal.com','mipim.com','smartcityexpo.com','big5global.com'],
  'Architecture':['cityscapeglobal.com','mipim.com','conferenceonarchitecture.com','big5global.com'],
  'Agriculture & Food':['agritechnica.com','gulfood.com','worldagritechinnovation.com','ifama.org'],
  'Law & Regulation':['legalweekshow.com','ibanet.org','iapp.org','americanbar.org'],
  'Government & Policy':['worldgovernmentsummit.org','milkeninstitute.org','smartcityexpo.com','aspanet.org'],
  'Social Sciences':['isa-sociology.org','apsanet.org','aspanet.org','aeaweb.org'],
  'Arts & Culture':['sxsw.com','artbasel.com','frieze.com','aaslh.org'],
  'Tourism & Hospitality':['itb.com','wtm.com','arabiantravelmarket.com','phocuswrightconference.com'],
  'Blockchain & Web3':['parisblockchainweek.com','token2049.com','consensus.coindesk.com','money2020.com'],
  'Real Estate':['cityscapeglobal.com','mipim.com','exporeal.net','smartcityexpo.com'],
  'Virtual conferences':['events.linuxfoundation.org','acs.org','aapg.org','alz.org'],
  'Open call for papers':['ieee.org','acm.org','aiche.org','acs.org','agu.org','spie.org']
};

const TARGET = Math.max(1, Number(process.env.POPULAR_CATEGORY_RICH_TARGET || 25));
const SPONSOR_TARGET = Math.max(1, Number(process.env.POPULAR_CATEGORY_SPONSOR_TARGET || 12));
const MAX_DOMAINS = Math.max(10, Number(process.env.CATEGORY_HARVEST_MAX_DOMAINS || 90));
const MAX_PAGES = Math.max(100, Number(process.env.CATEGORY_HARVEST_MAX_PAGES || 720));
const PAGES_PER_DOMAIN = Math.max(3, Number(process.env.CATEGORY_HARVEST_PAGES_PER_DOMAIN || 10));

function safe(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function meaningful(value) {
  if (Array.isArray(value)) return value.some(meaningful);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) =>
      !['source_url','source_urls','quality_flags','provenance','status'].includes(key) && meaningful(nested));
  }
  if (typeof value === 'string') {
    const v=value.trim();
    return v.length > 2 && !/^(not found|not retrieved|not yet announced|unknown|n\/a|tbd|tba)$/i.test(v);
  }
  return typeof value === 'number' || value === true;
}
function visibleTabs(row) {
  const overview=safe(row.overview,{});
  const cfp=safe(row.call_for_papers,{});
  const agenda=safe(row.program_agenda,{});
  const speakers=safe(row.keynote_speakers,[]);
  const committee=safe(row.technical_committee,[]);
  const sponsors=safe(row.sponsors_exhibitors,[]);
  const venue=safe(row.venue_accommodation,{});
  const fees=safe(row.fees_pricing,{});
  const community=safe(row.community,{});

  let tabs=meaningful(overview) ? 1 : 0;
  if ([
    cfp?.status,cfp?.abstract_submission_deadline,cfp?.notification_date,cfp?.submission_guidelines,
    cfp?.submission_format,cfp?.length_limit,cfp?.review_process,cfp?.publication_information,
    ...(Array.isArray(cfp?.topics_tracks)?cfp.topics_tracks:[])
  ].some(meaningful)) tabs++;
  if ((Array.isArray(agenda?.sessions)&&agenda.sessions.some(meaningful)) ||
      (Array.isArray(agenda?.themes)&&agenda.themes.some(meaningful))) tabs++;
  if (Array.isArray(speakers) && speakers.some((x)=>meaningful(x?.name || x?.full_name))) tabs++;
  if (Array.isArray(committee) && committee.some((x)=>meaningful(x?.name || x?.full_name))) tabs++;
  if (Array.isArray(sponsors) && sponsors.some((x)=>meaningful(x?.name) && meaningful(x?.logoUrl || x?.logo_url))) tabs++;
  if ([venue?.venue_name,venue?.address,venue?.accommodation,venue?.travel_information,
      ...(Array.isArray(venue?.hotels)?venue.hotels:[])].some(meaningful)) tabs++;
  if (meaningful(fees?.pricing_text) || meaningful(fees?.early_bird_deadline) ||
      (Array.isArray(fees?.registration_fees)&&fees.registration_fees.some(meaningful))) tabs++;
  if (meaningful(community?.summary) ||
      (Array.isArray(community?.social_media)&&community.social_media.some(meaningful))) tabs++;
  return tabs;
}
function visualReady(row) {
  const overview=safe(row.overview,{});
  return meaningful(overview.logo_url) || meaningful(overview.image_url) || meaningful(row.image_url);
}
function runCli(args) {
  return new Promise((resolve) => {
    const child=spawn(process.execPath,['--import','tsx','server/discovery/cli.ts',...args],{
      stdio:'inherit',env:process.env
    });
    child.on('exit',(code)=>resolve(code||0));
    child.on('error',(error)=>{ console.warn('[category-coverage-harvest] spawn failed:',error?.message||error); resolve(1); });
  });
}
async function main() {
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim()||undefined})
    : createClient({url:'file:'+localPath});

  try {
    const result=await db.execute(`
      SELECT de.id,de.image_url,ec.overview,ec.call_for_papers,ec.program_agenda,ec.keynote_speakers,
             ec.technical_committee,ec.sponsors_exhibitors,ec.venue_accommodation,ec.fees_pricing,
             ec.community,ec.extraction_metadata,GROUP_CONCAT(dec.category,'|') AS categories
        FROM discovery_events de
        JOIN extracted_conferences ec
          ON de.id=json_extract(ec.extraction_metadata,'$.discovery_event_id')
        LEFT JOIN discovery_event_categories dec ON dec.event_id=de.id
       WHERE de.status='published'
         AND (
           (de.start_date IS NOT NULL AND date(de.start_date)>=date('now'))
           OR (de.start_date IS NULL AND de.start_year>=CAST(strftime('%Y','now') AS INTEGER))
         )
       GROUP BY de.id
    `);

    const counts=Object.fromEntries(CATEGORIES.map((category)=>[category,0]));
    const sponsorCounts=Object.fromEntries(CATEGORIES.map((category)=>[category,0]));
    for (const row of result.rows || []) {
      const categories=String(row.categories||'').split('|').map((x)=>x.trim()).filter(Boolean);
      const meta=safe(row.extraction_metadata,{});
      const sponsorAvailable=meta?.external_sponsorship?.status==='available' && Boolean(meta?.external_sponsorship?.action_url);
      for (const category of new Set(categories)) {
        if (!Object.hasOwn(counts,category)) continue;
        if (visualReady(row) && visibleTabs(row) >= 6) counts[category]+=1;
        if (sponsorAvailable) sponsorCounts[category]+=1;
      }
    }

    const under=CATEGORIES
      .map((category)=>({
        category,
        count:counts[category]||0,
        sponsorCount:sponsorCounts[category]||0,
        richDeficit:Math.max(0,TARGET-(counts[category]||0)),
        sponsorDeficit:Math.max(0,SPONSOR_TARGET-(sponsorCounts[category]||0)),
      }))
      .map((row)=>({...row,deficit:Math.max(row.richDeficit,row.sponsorDeficit)}))
      .filter((row)=>row.deficit>0)
      .sort((a,b)=>b.sponsorDeficit-a.sponsorDeficit || b.richDeficit-a.richDeficit || a.category.localeCompare(b.category));

    if (!under.length) {
      console.log('[category-coverage-harvest] all='+CATEGORIES.length+' categories target_met='+TARGET);
      return;
    }

    const domains=[];
    const seen=new Set();
    for (const row of under) {
      for (const domain of [...(CATEGORY_SPONSOR_SOURCES[row.category] || []), ...(CATEGORY_SOURCES[row.category] || [])]) {
        if (seen.has(domain)) continue;
        seen.add(domain);
        domains.push(domain);
        if (domains.length>=MAX_DOMAINS) break;
      }
      if (domains.length>=MAX_DOMAINS) break;
    }

    console.log('[category-coverage-harvest] target='+TARGET+
      ' sponsor_target='+SPONSOR_TARGET+
      ' under_target='+under.length+'/'+CATEGORIES.length+
      ' selected_domains='+domains.length+
      ' weakest='+under.slice(0,12).map((x)=>x.category+':rich'+x.count+'/sponsor'+x.sponsorCount).join(' | '));

    if (!domains.length) return;
    await runCli([
      'harvest',
      '--orgs',domains.join(','),
      '--max-pages',String(MAX_PAGES),
      '--org-pages',String(PAGES_PER_DOMAIN),
      '--years','2026,2027,2028',
      '--quiet'
    ]);
  } catch (error) {
    console.warn('[category-coverage-harvest] failed:',error?.message||error);
  } finally {
    try { db.close(); } catch {}
  }
}
await main();
