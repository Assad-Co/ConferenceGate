import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";

const IMPORT_ORIGIN = "linkedin_v1_5";
const BATCH = "linkedin-v1.5-validated-2026-09-15";
const ROWS = [["WERA Congress 2027","2027-06-22","2027-06-24",2027,"Bilbao","Spain","in-person","https://weracongress2027.es/","https://www.linkedin.com/posts/world-education-research-association-wera_wera2027-wera-educationresearch-activity-7505541097859940352-3ipf"],["9th Theranostics World Congress","2027-03-11","2027-03-14",2027,"Osaka","Japan","in-person","https://www.theranostics-world-congress.org/abstracts","https://www.linkedin.com/posts/theranostics-world-congress_twc2027-theranostics-nuclearmedicine-activity-7505528567699505153-Q5os"],["22nd ASSITEJ World Congress & Performing Arts Festival","2027-07-21","2027-08-01",2027,"Suwon","Republic of Korea","in-person","https://korea2027.assitej-international.org/","https://www.linkedin.com/posts/assitej-international_assitej-assitejkorea-bravefutures-activity-7505535609646608385-ie5D"],["30th DVPW Congress 2027","2027-09-07","2027-09-10",2027,"Leipzig","Germany","in-person","https://www.scripts-berlin.eu/knowledge-exchange/news/2026-09-CfP-DVPW.html","https://www.linkedin.com/posts/scripts-berlin_callforpapers-dvpw2027-politicalscience-activity-7505520860003409921-FJC2"],["World Evidence, Pricing and Access Congress 2027","2027-03-02","2027-03-03",2027,null,null,"in-person","https://www.terrapinn.com/conference/world-evidence-pricing-access-congress-eu/agenda.stm?utm_source=general&utm_medium=post&utm_campaign=gnup&trc=gnup","https://www.linkedin.com/posts/world-epa-congress_epa-worldepacongress-marketaccess-activity-7505543834223919104-yRnD"],["Academy of Marketing Science World Marketing Congress 2027","2027-07-20","2027-07-23",2027,"Lisbon","Portugal","in-person","https://www.ams-web.org/wmc27-cfp","https://www.linkedin.com/posts/simoni-rohden-77730737_wmc-call-for-papers-academy-of-marketing-activity-7505559435164016640-FE3w"],["World Utilities Congress 2027","2027-05-25","2027-05-27",2027,null,null,"in-person","https://worldutilitiescongress.com/forms/download-call-for-papers-brochure/?utm_source=direct&utm_medium=social&utm_campaign=download-cfp-brochure&utm_content=social_post","https://www.linkedin.com/posts/world-utilities-congress_worldutilitiescongress-power-water-activity-7505551107960696832-dtGl"],["XXI ISA World Congress of Sociology","2027-07-04","2027-07-10",2027,"Gwangju","South Korea","in-person","https://isaconf.confex.com/isaconf/wc2027/webprogrampreliminary/Session27486.html","https://www.linkedin.com/posts/kirstine-zinck-pedersen-a905552_isa2027-organizationstudies-professionalwork-activity-7505534701835702273-5M8F"],["Cardiovascular Research Meeting 2027","2027-01-13","2027-01-14",2027,"Bern","Switzerland","in-person","https://meetings.ls2.ch/cardiovascular2027/program-abstracts-posters","https://www.linkedin.com/posts/life-sciences-switzerland_cardiovascularresearch-cardiology-vascularbiology-activity-7505566570975232000-YIei"],["IAIA27 Annual Conference","2027-04-20","2027-04-23",2027,"Christchurch","New Zealand","in-person","https://2027.iaia.org/","https://www.linkedin.com/posts/yunae-yi-b12bb81_iaia27-annual-conference-iaia27-activity-7505567668012343296-ji54"],["12th International Conference on Reproductive Health, Embryology and Fertility","2027-03-18","2027-03-19",2027,"Paris","France","in-person","https://reproductivehealth.conferenceseries.com/","https://www.linkedin.com/posts/anusha-adigarla-b50519416_reproductivehealth2027-callforspeakers-embryology-activity-7505565272804585472-Ag31"],["AFRIQOM Africa Fertiliser Conference 2027","2027-02-01","2027-02-03",2027,null,null,"in-person","https://www.afriqom.com/capetown-africa-fertilizer-conference-2027","https://www.linkedin.com/posts/fredagordon_southern-africa-sulphursulphuric-acid-quiz-activity-7505564950090690560-JJ3_"],["Birketts LLP South East Employment and Immigration Update Conference","2026-10-13","2026-10-13",2026,"Crawley","United Kingdom","in-person","https://birketts.pages.dealcloud.intapp.com/employment-annual-updates-2026.html","https://www.linkedin.com/posts/charlottesloan_employmentlaw-immigrationlaw-hrinsight-activity-7505566123636146176-zJwu"],["Bridal Collective Brand Ambassador Summit 2027","2027-06-07","2027-06-10",2027,null,"Mexico","in-person","https://bridal-collective.com/en/about-us/newsroom/bridal-collective-celebrates-the-success-of-its-first-ever-brand-ambassador-summit","https://www.linkedin.com/posts/bridal-collective_bridalcollective-brandambassadorsummit-bridalindustry-activity-7505565488597581824-NkEJ"],["URBAN TEC Congress 2027",null,null,2027,"Offenburg","Germany","in-person","https://www.urban-tec-offenburg.de/de/call-papers","https://www.linkedin.com/posts/urban-tec-offenburg_urbantec-callforpapers-smartcity-activity-7505563760615636992-1d2t"],["IRSPM Conference 2027","2027-04-28","2027-04-30",2027,"Trondheim","Norway","in-person","https://www.irspm.org/conference-2027/conferences/call-for-abstracts-2027","https://www.linkedin.com/posts/evyelfira_p19-public-service-institutions-as-human-activity-7505559010855522305-SpB0"],["7th Fusion HPC Workshop","2027-02-23","2027-02-24",2027,null,null,"online","https://hpcfusion.bsc.es/2027/","https://www.linkedin.com/posts/case-department_hpc-fusion-hpc-activity-7505556771978059776-c_qK"],["IPDA England Conference 2027","2027-01-22","2027-01-22",2027,"Birmingham","United Kingdom","in-person","https://ipda.org.uk/event/ipda-england-conference-2027/","https://www.linkedin.com/posts/ipdainternational_ipdaconnect-professionallearning-callforabstracts-activity-7505556122699829248-xoow"],["India Energy Week 2027 Technical Conference","2027-01-28","2027-01-31",2027,null,"India","in-person","https://www.indiaenergyweek.com/forms-2027/conference-call-for-abstract-submission/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=cfp&utm_id=indiaenergyweek27","https://www.linkedin.com/posts/indiaenergyweek_indiaenergyweek2027-iew2027-indiaenergyweek-activity-7505551193763618817-Esr7"],["International Experts Summit on Public Health and Preventive Medicine 2027","2027-04-12","2027-04-14",2027,"Osaka","Japan","in-person","https://www.globalpublichealth.theiconicmeetings.com/","https://www.linkedin.com/posts/leila-leila-bb7835395_publichealthsummit2027-publichealth-preventivemedicine-activity-7505563383061098496-seHd"],["6th International Online Conference on Nutrients (IOCNu2027)","2027-02-10","2027-02-11",2027,null,null,"online","https://sciforum.net/event/IOCNu2027","https://www.linkedin.com/posts/nutrients-mdpi_nutritionscience-neonatology-iocnu2027-activity-7505560860283777024-7us8"],["International Conference on Data Science & Intelligence (ICDSI-2027)","2027-02-04","2027-02-05",2027,"Delhi","India","in-person","https://icdsi.co.in/","https://www.linkedin.com/posts/aims-dtu_icdsi2027-datascience-artificialintelligence-activity-7505545618786799616-Ft1E"],["European FlexPack Summit 2027","2027-02-22","2027-02-24",2027,null,null,"in-person","https://www.flexpack-summit.com/","https://www.linkedin.com/posts/flexpack-europe_europeanflexpacksummit-flexiblepackaging-activity-7505560309269610496-alMT"],["ICEEE 2027","2027-04-16","2027-04-18",2027,"Ankara","Turkey","in-person","https://iceee.org/cfp.html","https://www.linkedin.com/posts/ramazan-yeniceri_take-a-look-at-the-call-for-papers-for-iceee-activity-7505551145436672000-EdKs"],["HESG Winter Meeting 2027","2027-01-13","2027-01-15",2027,"London","United Kingdom","in-person","https://eshop.qmul.ac.uk/conferences-and-events/conferences-events/conferences-events/hesg-winter-meeting-2027-queen-mary-university-of-london","https://www.linkedin.com/posts/montasir-ahmed-651a4831_winter-2027-queen-mary-university-of-london-activity-7505566500070703104-rNeY"],["NEUROSCIENCE2027 Global Summit","2027-03-29","2027-03-30",2027,"Zurich","Switzerland","in-person","https://neurology.researchconnects.org/","https://www.linkedin.com/posts/mr-ram-b66792245_neuroscience2027-keynotespeaker-alexandramacare-activity-7505550322136870914-Zdt6"],["Global Autism Research & Innovation Summit (GARIS 2027)","2027-03-22","2027-03-23",2027,"Paris","France","in-person","https://autism.scholarsconferences.com/","https://www.linkedin.com/posts/afreen-begum-805aa3416_garis2027-globalautism-autismresearch-activity-7505546448831262720-Y7Uv"],["Coram PACEY Childcare and Early Years Conference 2027","2027-02-06","2027-02-06",2027,null,null,"online","https://www.corampacey.org.uk/childcare-and-early-years-conference-2027/","https://www.linkedin.com/posts/corampacey_corampacey-conference-childrenslaureate-activity-7505539650036408320-W50x"]];

function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b20\d{2}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function idFor(v) {
  return `linkedin_${createHash("sha1").update(String(v)).digest("hex").slice(0,24)}`;
}
function host(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./,""); } catch { return ""; }
}
function fmt(v) {
  const x=String(v||"").toLowerCase();
  return x==="online" ? "online" : x==="hybrid" ? "hybrid" : "in-person";
}
function loc(city,country) {
  return [city,country].filter(Boolean).join(", ") || null;
}
function dt(start,end,year) {
  if (start && end) return start===end ? start : `${start} – ${end}`;
  return start || (year ? String(year) : null);
}

async function existingEvent(db,title,year,url) {
  let q=await db.execute({
    sql:`SELECT id, extraction_method FROM discovery_events
         WHERE official_url=? OR canonical_url=? OR source_url=? LIMIT 1`,
    args:[url,url,url]
  });
  if (q.rows?.length) return q.rows[0];
  q=await db.execute({
    sql:`SELECT id, extraction_method FROM discovery_events
         WHERE start_year=? AND normalized_title=? LIMIT 1`,
    args:[year,norm(title)]
  });
  return q.rows?.[0] || null;
}

async function main() {
  const url=process.env.TURSO_DATABASE_URL?.trim();
  const token=process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) {
    console.log("[linkedin-import] TURSO_DATABASE_URL missing; skipping");
    return;
  }
  const db=createClient({url,authToken:token||undefined});
  try {
    const check=await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_events' LIMIT 1`
    );
    if (!check.rows?.length) {
      console.log("[linkedin-import] discovery schema missing; skipping");
      return;
    }

    let inserted=0, updated=0, preserved=0;

    for (const row of ROWS) {
      const [title,start,end,year,city,country,format,officialUrl,linkedinUrl]=row;
      if (!title || !officialUrl || !year) continue;

      const existing=await existingEvent(db,title,year,officialUrl);
      if (existing && String(existing.extraction_method||"")!==IMPORT_ORIGIN) {
        preserved++;
        continue;
      }

      const eventId=existing?.id
        ? String(existing.id)
        : idFor(`${officialUrl}|${title}|${start||year}`);

      const now=new Date().toISOString();
      const startMonth=start ? Number(start.slice(5,7)) : null;

      await db.execute({
        sql:`INSERT INTO discovery_events (
          id,title,normalized_title,start_date,end_date,start_year,start_month,date_precision,dates_text,
          venue,city,region,country,raw_location,format,event_type,organizer,official_url,canonical_url,
          registration_url,submission_url,image_url,contact_email,topics,primary_category,
          status,confidence_score,relevance_classification,relevance_reason,quality_flags,
          extraction_method,source_url,source_domain,last_seen,last_checked,last_verified,published_at,
          publish_readiness,readiness_reasons,official_source_verified_at,title_verified_at
        ) VALUES (
          ?,?,?, ?,?,?,?,?,?, NULL,?,NULL,?,?,?,'conference',NULL,?,?, NULL,NULL,NULL,NULL,'[]',NULL,
          'published',1.0,'conference','verified_linkedin_v1_5','[]',
          'linkedin_v1_5',?,?, ?,?,?,?, 'publish_ready','[]',?,?
        )
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,
          normalized_title=excluded.normalized_title,
          start_date=excluded.start_date,
          end_date=excluded.end_date,
          start_year=excluded.start_year,
          start_month=excluded.start_month,
          date_precision=excluded.date_precision,
          dates_text=excluded.dates_text,
          city=excluded.city,
          country=excluded.country,
          raw_location=excluded.raw_location,
          format=excluded.format,
          official_url=excluded.official_url,
          canonical_url=excluded.canonical_url,
          status='published',
          confidence_score=1.0,
          relevance_classification='conference',
          relevance_reason='verified_linkedin_v1_5',
          extraction_method='linkedin_v1_5',
          source_url=excluded.source_url,
          source_domain=excluded.source_domain,
          last_seen=excluded.last_seen,
          last_checked=excluded.last_checked,
          last_verified=excluded.last_verified,
          published_at=COALESCE(discovery_events.published_at,excluded.published_at),
          publish_readiness='publish_ready',
          readiness_reasons='[]',
          official_source_verified_at=excluded.official_source_verified_at,
          title_verified_at=excluded.title_verified_at`,
        args:[
          eventId,title,norm(title),start||null,end||null,year,startMonth,start?"day":"year",dt(start,end,year),
          city||null,country||null,loc(city,country),fmt(format),officialUrl,officialUrl,
          officialUrl,host(officialUrl),now,now,now,now,now,now
        ]
      });

      const overview={
        conference_name:title,acronym:null,edition:null,description:null,
        dates_text:dt(start,end,year),start_date:start||null,end_date:end||null,
        city:city||null,region:null,country:country||null,world_region:null,venue:null,
        location_text:loc(city,country),format:fmt(format),organizer:null,topics:[],
        category:null,categories:[],keywords:[],important_dates:start?[{label:"Conference dates",date:start,isDeadline:false}]:[],
        official_url:officialUrl,source_url:officialUrl,logo_url:null,logo_source:null,image_url:null
      };
      const metadata={
        origin:"discovery_engine",import_origin:IMPORT_ORIGIN,source:"LINKEDIN",status:"success",
        validation_status:"VALIDATED",validation_score:100,official_site_verified:true,ready_for_import:true,
        verifier_version:"1.5-final-deploy",processor_version:"4.0-final-strict-evidence",
        source_domain:host(officialUrl),official_site_resolved:true,discovery_event_id:eventId,
        linkedin_post_url:linkedinUrl,section_availability:{
          overview:"stated",venue:(city||country)?"stated":"unread",cfp:"unread",fees:"unread",
          speakers:"unread",sponsors:"unread",agenda:"unread",committee:"unread",community:"stated"
        },pages_crawled:1,import_batch:BATCH
      };

      await db.execute({
        sql:`INSERT INTO extracted_conferences (
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,
          community=excluded.community,
          extraction_metadata=excluded.extraction_metadata,
          updated_at=datetime('now')`,
        args:[
          officialUrl,JSON.stringify(overview),"{}",'{"sessions":[],"themes":[],"overview":null}',"[]","[]","[]",
          JSON.stringify({venue_name:null,address:loc(city,country),accommodation:null,hotels:[],travel_advisory:null,travel_advisory_source:null}),
          '{"registration_url":null,"registration_fees":[],"early_bird_deadline":null,"pricing_text":null}',
          JSON.stringify({source:"LINKEDIN",linkedin_post_url:linkedinUrl}),
          JSON.stringify(metadata)
        ]
      });

      if (existing) updated++; else inserted++;
    }

    console.log(`[linkedin-import] target=Turso batch=${BATCH} inserted=${inserted} updated=${updated} preserved=${preserved}`);
  } finally {
    db.close();
  }
}

main().catch((e)=>{
  console.error("[linkedin-import] failed; ConferenceGate will still start:",e?.stack||e?.message||e);
  process.exitCode=0;
});
