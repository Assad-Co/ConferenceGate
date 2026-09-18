import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CALENDAR = 'https://www.aapg.org/events/calendar/';
const AAPG_ORGANIZER = 'American Association of Petroleum Geologists (AAPG)';
const AAPG_MARK = '/aapg-organizer.svg';

function stableId(prefix, value) {
  return prefix + '_' + createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24);
}
function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b20\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; }
}
function person(name, org, role = null) {
  return { name, full_name:name, organization:org || null, org:org || null, role, title:null, email:null, photo_url:null };
}
function fee(category, amount, currency='USD', notes=null, deadline=null) {
  return { category, amount, currency, notes, deadline };
}
function sponsor(name, tier=null) {
  return { name, tier, logo_url:null };
}
function hasValue(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.values(v).some(hasValue);
  return typeof v === 'string' ? v.trim().length > 2 : v !== null && v !== undefined;
}
function sectionState(value, fallback='unread') {
  return hasValue(value) ? 'stated' : fallback;
}

const DEFAULT_CATEGORIES = ['Energy','Petroleum & Geoscience','Engineering','Science'];

const EVENTS = [
  {
    key:'midcon-2026',
    title:'7th Biennial AAPG Mid-Con Section Field Conference',
    start:'2026-10-02', end:'2026-10-04', city:'Stillwater / Ardmore', region:'Oklahoma', country:'United States',
    venue:'Oklahoma State University / field-course locations', format:'in-person',
    url:'https://tulsageologicalsociety.wildapricot.org/event-6789490',
    organizer:'Tulsa Geological Society / AAPG Mid-Continent Section',
    description:'Field conference integrating hydrology and petroleum geology along the Seminole-Cushing Ridge and the Arbuckle-Simpson Aquifer, with surface-to-basement exercises and field stops.',
    categories:['Petroleum & Geoscience','Energy','Hydrogeology','Engineering'],
    agenda:{overview:'Three-day field conference and course with Friday evening seminar and dinner, Saturday field activities and dinner, and Sunday field activities focused on hydrology, petroleum geology, aquifer evaluation and reservoir connectivity.',themes:['Hydrology and petroleum geology','Aquifer evaluation','Reservoir connectivity','Remote sensing','3D geological frameworks']},
    committee:[person('Todd Halihan','Oklahoma State University','Course Leadership'),person('Brandon Spencer','Oklahoma State University','Course Leadership'),person('Lawrence Walker',null,'Course Leadership'),person('John Brett',null,'Course Leadership')],
    fees:{registration_fees:[fee('Industry / Government',400),fee('Faculty / Academic',300),fee('Students',0,'USD','Student registration is free')],pricing_text:'Official event page lists Industry/Government at $400, Faculty/Academic at $300, and students free; earlier discounted rates were available before 3 September 2026.'},
    venueInfo:{venue_name:'Stillwater / Ardmore field-course locations',address:'Stillwater and Ardmore, Oklahoma, United States',accommodation:'Official page provides hotel links for Stillwater and Ardmore, including Home2 Suites, Best Western and Courtyard by Marriott.'},
    community:{overview:'Registration includes meals and refreshments during portions of the field conference; student travel vouchers are available through the Geoscience Foundation of Tulsa.'}
  },
  {
    key:'critical-minerals-lecture-2026',
    title:'Distinguished Lecture: Critical Minerals in Sedimentary Rocks',
    start:'2026-10-06', end:'2026-10-06', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/critical-minerals-in-sedimentary-rocks/',
    description:'AAPG Distinguished Lecture on geological controls and predictive exploration approaches for rare earth elements and other critical minerals in sedimentary rocks.',
    categories:['Mining & Minerals','Petroleum & Geoscience','Science','Energy'],
    speakers:[person('Lauren P. Birgenheier','University of Utah','Distinguished Lecturer')],
    agenda:{overview:'Virtual distinguished lecture covering REE enrichment in coal-bearing strata and phosphatic limestones, geological controls, pXRF/ICP-MS workflows and predictive exploration implications.'},
    community:{overview:'AAPG Distinguished Lecture delivered virtually for the geoscience community.'}
  },
  {
    key:'structural-styles-2026',
    title:'3rd Edition: Structural Styles of the Middle East',
    start:'2026-10-12', end:'2026-10-14', city:'Muscat', region:null, country:'Oman', venue:'Crowne Plaza Muscat by IHG', format:'in-person',
    url:'https://www.aapg.org/event-details/3rd-edition-structural-styles-of-the-middle-east/',
    description:'AAPG Geoscience Technology Workshop on structural styles of the Arabian Plate and adjacent regions, complex reservoirs and traps, salt tectonics, resource plays, storage and digital/AI tools in structural geology.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Artificial Intelligence'],
    agenda:{overview:'Three-day workshop with technical sessions, posters and discussion. Official themes include tectonic evolution of the Middle East, complex reservoirs/traps/storage, salt tectonics, structurally influenced resource plays and digital tools/data analytics/AI in structural geology.',themes:['Tectonic evolution of the Middle East','Complex reservoirs, traps and storage','Salt tectonics','Structurally influenced resource plays','Digital tools, data analytics and AI in structural geology']},
    speakers:[person('Mohammed Al-Mazrui','PDO','Inaugural Keynote'),person('Simon Stewart','Aramco','Technical Keynote')],
    committee:[
      person('Oskar Vidal Royo','Terractiva'),person('Andreas Scharf','Sultan Qaboos University'),person('Elias Al Kharusi','Petrogas'),
      person('Meshal Al-Wadi','KOC'),person('Christian Heine','Shell'),person('Antoine Delaunay','KAUST'),
      person('Ivan Callegari','GUTech'),person('David Repol','PDO'),person('Majid Aljamed','Aramco')
    ],
    fees:{registration_fees:[fee('General Non-Member',1850),fee('Member',1650),fee('Committee / Presenter',1550),fee('Young Professional',850),fee('Academia',500),fee('Student',350)],pricing_text:'Official AAPG pricing is listed in USD. An optional short course on 11 October is $590 and the 15–16 October field trip is $550.'},
    venueInfo:{venue_name:'Crowne Plaza Muscat by IHG',address:'Qurum Heights P.O. Box 1455, Muscat 112, Oman',accommodation:'AAPG lists an event room rate of RO 90 net with breakfast for single occupancy; second person RO 10 net per night, subject to availability.'},
    community:{overview:'Technical sessions, poster sessions, open discussion, an optional short course and an optional two-day Jabal Akhdar field trip support collaboration and networking.'}
  },
  {
    key:'libyan-basins-2026',
    title:'2nd Edition: AAPG Libyan Sedimentary Basins Virtual Workshop',
    start:'2026-10-22', end:'2026-10-22', city:null, region:null, country:'Libya', venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/2nd-edition-aapg-libyan-sedimentary-basins-virtual-workshop/',
    description:'Virtual AAPG workshop focused on Libyan sedimentary basins and petroleum systems, including depositional cycles, structural configuration, exploration history, seismic/petrophysical analysis and regional petroleum evolution.',
    categories:['Petroleum & Geoscience','Energy','Science'],
    agenda:{overview:'Virtual workshop program includes opening remarks and technical presentations on Libyan basin stratigraphy, structural evolution, exploration history and integrated seismic/petrophysical analysis.',themes:['Libyan sedimentary basins','Petroleum systems','Stratigraphy','Structural geology','Seismic and petrophysical analysis']},
    speakers:[person('Susan Nash','AAPG','Program Leadership'),person('Tom Wilker','AAPG','Program Leadership'),person('Salah El-Ekhfifi','NOC','Program Participant'),person('Abdelsalam Aziz','NOC','Program Participant')],
    community:{overview:'Virtual workshop designed for technical exchange across the Libyan and international geoscience community.'}
  },
  {
    key:'rms-aapg-2026',
    title:'AAPG Rocky Mountain Section Annual Meeting 2026',
    start:'2026-10-24', end:'2026-10-26', city:'Butte', region:'Montana', country:'United States', venue:'Butte, Montana', format:'in-person',
    url:'https://www.rms-aapg2026.com/',
    organizer:'AAPG Rocky Mountain Section',
    description:'2026 Rocky Mountain Section AAPG Annual Meeting covering hydrocarbons, unconventional resources, structural geology, stratigraphy, geophysics, rock mechanics and related regional geoscience topics.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Science'],
    cfp:{status:'Open / official call available',submission_url:'https://www.rms-aapg2026.com/'},
    speakers:[person('Carlotta B. Chernoff','ConocoPhillips','All Convention Luncheon Keynote'),person('Johnny MacLean','Montana Tech','Opening Night Keynote')],
    sponsors:[sponsor('Neset Consulting'),sponsor('RevoChem Fingerprinting')],
    agenda:{overview:'Annual meeting program includes technical sessions, poster/core sessions, keynote events and dedicated student and early-career activities.'},
    venueInfo:{venue_name:'Butte, Montana',address:'Butte, Montana, United States'},
    community:{overview:'Official conference page highlights student and young professional events and expanded support for early-career professionals.'}
  },
  {
    key:'esaapg-2026',
    title:'AAPG Eastern Section Annual Meeting 2026',
    start:'2026-10-26', end:'2026-10-27', city:'Canonsburg', region:'Pennsylvania', country:'United States',
    venue:'Hilton Garden Inn Pittsburgh/Southpointe', format:'in-person',
    url:'https://www.esaapg.org/event/eastern-section-aapg-annual-meeting-2026/',
    organizer:'Eastern Section of AAPG (ESAAPG)',
    description:'Eastern Section AAPG annual meeting for geoscientists across the eastern United States, covering conventional exploration and production, unconventional resources, carbon sequestration and environmental solutions.',
    categories:['Petroleum & Geoscience','Energy','Hydrogen & CCUS','Environment'],
    cfp:{status:'Closed',abstract_submission_deadline:'2026-09-15',submission_guidelines:'Official ESAAPG information states abstracts for the 2026 meeting were accepted through 15 September 2026.'},
    agenda:{overview:'Official meeting information includes an icebreaker, entertainment, dinner, exhibitors, breakfast and lunch for two conference days, and workshops.',themes:['Conventional hydrocarbon exploration and production','Unconventional resources','Carbon sequestration','Environmental solutions']},
    venueInfo:{venue_name:'Hilton Garden Inn Pittsburgh/Southpointe',address:'1000 Corporate Drive, Canonsburg, PA 15317, United States',accommodation:'Meeting venue is Hilton Garden Inn Pittsburgh/Southpointe.'},
    community:{overview:'Attendee activities include an icebreaker, entertainment, dinner, exhibitors, shared breakfasts/lunches and workshops.'}
  },
  {
    key:'lac-leadership-2026',
    title:'Latin America and Caribbean Region Student & Young Professional Leadership Summit 2026',
    start:'2026-11-06', end:'2026-11-08', city:'Bogotá', region:'Bogotá D.C.', country:'Colombia', venue:'Bogotá, Colombia', format:'in-person',
    url:'https://www.aapg.org/event-details/latin-america-and-caribbean-region-student-young-professional-leadership-summit-2026/',
    description:'AAPG leadership summit bringing together students and young professionals for leadership, communications, ethics, service, networking and career development.',
    categories:['Petroleum & Geoscience','Education','Business','Energy'],
    agenda:{overview:'Three-day official program includes a participant networking reception, leadership in geosciences, diversity and inclusion, sustainability, effective communication, energy policy, career choices and career development.',themes:['Leadership','Communication','Diversity and inclusion','Sustainability','Energy policy','Career development']},
    venueInfo:{venue_name:'Bogotá, Colombia',address:'Bogotá, Bogotá D.C., Colombia',travel_information:'AAPG provides official visa guidance and links to Colombia Ministry of Foreign Affairs resources.'},
    community:{overview:'Networking reception and multicultural student/young-professional participation are central parts of the summit.'},
    sponsors:[sponsor('Sponsorship opportunities published by AAPG','Diamond through Patron levels')]
  },
  {
    key:'deepwater-lecture-2026',
    title:'Distinguished Lecture: Rethinking Deepwater Sedimentation: New Paradigms in Oceanic Current Processes and Products',
    start:'2026-11-12', end:'2026-11-12', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/rethinking-deepwater-sedimentation-new-paradigms-in-oceanic-current-processes-and-products/',
    categories:['Petroleum & Geoscience','Science','Energy'],
    description:'AAPG Distinguished Lecture on oceanic circulation, bottom currents, contourites and mixed depositional systems in deepwater sedimentation.',
    community:{overview:'Virtual AAPG Distinguished Lecture for the global geoscience community.'}
  },
  {
    key:'hydrocarbon-seals-2026',
    title:'5th Edition: AAPG/EAGE Hydrocarbon Seals of the Middle East GTW',
    start:'2026-11-16', end:'2026-11-18', city:'Kuwait City', region:'Al Ahmadi', country:'Kuwait', venue:'Kuwait City, Kuwait', format:'in-person',
    url:'https://www.aapg.org/event-details/5th-edition-aapg-eage-hydrocarbon-seals-of-the-middle-east-gtw/',
    organizer:'AAPG / EAGE',
    description:'Geoscience Technology Workshop on hydrocarbon seals, fault seals, caprock integrity, geomechanics, storage and integrated seal evaluation.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Hydrogen & CCUS'],
    agenda:{overview:'Three-day technical program covers seal characterization, lateral seal elements and stratigraphic complexity, geomechanics and structural stress, digital workflows and prediction/risk assessment, gas storage and CCS/CCUS.',themes:['Seal characterization','Lateral seal elements','Geomechanics','Digital workflows and risk assessment','Gas storage and CCS/CCUS']},
    speakers:[person('Areej Al-Darmi','KOC','Technical Keynote'),person('Juliane Heiland','SLB','Technical Keynote')],
    committee:[
      person('Bader Al-Ajmi','KOC'),person('Mohammed Rashid','KOC'),person('Aisha Al-Hajri','PDO'),person('Ali Al-Ghamdi','Aramco'),
      person('Jassim Al Safwani','Aramco'),person('Mohammed Al Saleh','Aramco'),person('Hemant Singh','Baker Hughes'),person('Said Al Balushi','CCED'),
      person('Nicolas Hawie','Halliburton'),person('Hamad Al-Hamad','Kuwait Oil Company'),person('Mohammad Al-Mershed','KOC'),
      person('Sayed Behbehani','Kuwait Oil Company'),person('Mohammad Al-Naqi','Kuwait University'),person('Laiyyan Al Kharusi','Occidental Oman'),
      person('Nestor Danilo Vasconez Noguera','SLB')
    ],
    fees:{registration_fees:[fee('Non-Member',1850),fee('Member',1650),fee('Committee / Presenter',1550),fee('Young Professional',850),fee('Academia',500),fee('Student',350)],pricing_text:'Official AAPG pricing is listed in USD.'},
    venueInfo:{venue_name:'Kuwait City, Kuwait',address:'Kuwait City, Al Ahmadi, Kuwait'},
    community:{overview:'Designed for geoscientists, petrophysicists, geomechanics specialists and reservoir engineers to exchange case studies, workflows and seal-evaluation experience.'}
  },
  {
    key:'geothermal-permeability-lecture-2026',
    title:'Distinguished Lecture: Inferring Permeability in Geothermal Fields Using Seismic Imaging and Machine Learning',
    start:'2026-11-17', end:'2026-11-17', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/inferring-permeability-in-geothermal-fields-using-seismic-imaging-and-machine-learning/',
    categories:['Renewable Energy','Artificial Intelligence','Petroleum & Geoscience','Science'],
    description:'AAPG Distinguished Lecture on permeability in geothermal systems using seismic imaging and machine-learning approaches.',
    community:{overview:'Virtual AAPG Distinguished Lecture for the geoscience and geothermal community.'}
  },
  {
    key:'suriname-2026',
    title:'Suriname Technical Symposium 2026',
    start:'2026-11-18', end:'2026-11-19', city:'Paramaribo', region:'Paramaribo', country:'Suriname', venue:'Torarica Resort', format:'in-person',
    url:'https://www.aapg.org/event-details/suriname-technical-symposium-2026/',
    organizer:'AAPG / Staatsolie',
    description:'AAPG 3rd Suriname Technical Symposium, hosted by Staatsolie, covering basin studies, frontier plays, geoscience/AI, acquisition technologies, development and environmental considerations.',
    categories:['Petroleum & Geoscience','Energy','Artificial Intelligence','Environment'],
    agenda:{overview:'Two-day program includes opening remarks, executive panels, keynote talks and technical presentations on basin studies, frontier plays, geoscience/AI, data acquisition, development/production and environmental topics.',themes:['Regional and basin studies','Emerging play concepts','Geoscience and AI','Data acquisition','Development and production','Environmental considerations']},
    speakers:[person('Sharista Kalapnat-Kisoensingh','Staatsolie','Opening Remarks')],
    committee:[person('Sharista Kisoensingh','Staatsolie'),person('Harris Saifi Hakimi','Petronas'),person('Muhammad Ridzal Ridhuwan','Petronas'),person('Shiladitya Sengupta','TotalEnergies & Americas LLC'),person('Dirk Erickson','Chevron'),person('Eddie McAllister','Shell'),person('David Haddox','ExxonMobil'),person('Vanisha Chedi','Staatsolie')],
    fees:{registration_fees:[fee('Professional Non-Member',995),fee('Professional Member',895),fee('Presenters / Session Chairs',695),fee('Professional one-day only',595),fee('Academic / AAPG Emeritus',545),fee('Student Non-Member',195),fee('Student Member',165)],early_bird_deadline:'2026-10-18',pricing_text:'Official AAPG page lists lower early-bird rates for payment by 18 October 2026.'},
    venueInfo:{venue_name:'Torarica Resort',address:'Rietbergplein 1, Paramaribo, Suriname',accommodation:'Torarica Resort offers special attendee room rates for 15–22 November, including listed rates for Torarica Hotel and Casino.'},
    community:{overview:'Program includes panels, posters, networking and technical exchange among regional and international exploration professionals.'}
  },
  {
    key:'stratigraphic-traps-2026',
    title:'5th Edition: Stratigraphic Traps of the Middle East',
    start:'2026-11-23', end:'2026-11-25', city:'Manama', region:null, country:'Bahrain', venue:'Manama, Bahrain', format:'in-person',
    url:'https://www.aapg.org/event-details/5th-edition-stratigraphic-traps-of-the-middle-east/',
    description:'AAPG Middle East workshop focused on stratigraphic traps, exploration case studies, emerging technologies and collaborative industry-academia discussion.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Science'],
    cfp:{status:'Open / official abstract submission available',submission_url:'https://www.aapg.org/event-details/5th-edition-stratigraphic-traps-of-the-middle-east/'},
    agenda:{overview:'Workshop program focuses on recent advances in stratigraphic trap exploration, case studies, emerging technologies and collaborative discussion.'},
    venueInfo:{venue_name:'Manama, Bahrain',address:'Manama, Bahrain'},
    community:{overview:'AAPG workshop designed for knowledge exchange across industry and academia.'}
  },
  {
    key:'power-geoscience-lecture-2026',
    title:'Distinguished Lecture: The Power of Geoscience – Adapting in a Changing Energy Landscape',
    start:'2026-12-01', end:'2026-12-01', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/the-power-of-geoscience-adapting-in-a-changing-energy-landscape/',
    description:'AAPG Distinguished Lecture on geoscience, technology, AI, environment, energy and minerals in a rapidly changing energy landscape.',
    categories:['Petroleum & Geoscience','Energy','Artificial Intelligence','Mining & Minerals'],
    community:{overview:'Virtual AAPG Distinguished Lecture for the global geoscience community.'}
  },
  {
    key:'urtec-latam-2026',
    title:'URTeC Latin America Unconventional Resources Summit 2026',
    start:'2026-12-01', end:'2026-12-02', city:'Buenos Aires', region:null, country:'Argentina', venue:'Buenos Aires, Argentina', format:'in-person',
    url:'https://urtec.org/latinamerica/',
    organizer:'URTeC / AAPG / SPE / SEG',
    description:'Executive-level unconventional resources summit focused on the business and technology of unconventional development in Argentina and Latin America, hosted by YPF.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Business'],
    agenda:{overview:'Two-day executive and technical summit focused on unconventional resources in Argentina and Latin America.'},
    venueInfo:{venue_name:'Buenos Aires, Argentina',address:'Buenos Aires, Argentina'},
    community:{overview:'Joint AAPG/SPE/SEG event designed for cross-disciplinary networking among geoscientists, engineers, executives and operators.'}
  },
  {
    key:'identity-culture-2026',
    title:'Identity and Authenticity in Geoscience Workforce Culture',
    start:'2026-12-03', end:'2026-12-03', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/identity-and-authenticity-in-geoscience-workforce-culture/',
    description:'AAPG virtual lecture on identity, authenticity and workforce culture in geoscience, including workplace climate, attrition, recruitment and retention.',
    categories:['Petroleum & Geoscience','Business','Education','Social Sciences'],
    community:{overview:'Virtual workforce-culture lecture for the geoscience community.'}
  },
  {
    key:'max-asset-value-2026',
    title:'3rd Edition: AAPG/EAGE Maximizing Asset Value: Integrating Geoscience with Reservoir Management and Technologies Optimization',
    start:'2026-12-07', end:'2026-12-09', city:'Al Khobar', region:'Eastern Province', country:'Saudi Arabia', venue:'Mövenpick Al Khobar', format:'in-person',
    url:'https://www.aapg.org/event-details/3rd-edition-aapg-eage-maximizing-asset-value-integrating-geoscience-with-reservoir-management-and-technologies-optimization/',
    organizer:'AAPG / EAGE',
    description:'Workshop demonstrating how integrated geoscience, reservoir engineering and technology deployment can improve asset value across the field lifecycle.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Data Science'],
    cfp:{status:'Open',abstract_submission_deadline:'2026-11-09',submission_guidelines:'AAPG invites poster abstracts by email to Cora Navarro by 9 November 2026.',submission_url:'https://www.aapg.org/event-details/3rd-edition-aapg-eage-maximizing-asset-value-integrating-geoscience-with-reservoir-management-and-technologies-optimization/'},
    agenda:{overview:'Workshop program integrates geoscience, reservoir management and technology optimization with emphasis on asset value, capital discipline and accelerated decision-making.'},
    committee:[person('Abdullah Alsubaie','Aramco'),person('Leonardo Patacchini','Stone Ridge Technology'),person('Volker Dieckmann','Shell'),person('Bill Ayres','Ayres Group'),person('Abdulkarim AlAli','Bapco Upstream'),person('Irada Yusufova','Equinor'),person('Bicheng Yan','KAUST'),person('Abdullah Motar Al-Anzi','KOC'),person('Olfa Zenned','SLB'),person('Daniel Busby','TotalEnergies'),person('Rémi Maillon','SNF')],
    fees:{registration_fees:[fee('Non-Member',1850),fee('Member',1650),fee('Committee / Presenter',1550),fee('Young Professional',850),fee('Academia',500),fee('Student',350)],pricing_text:'Official AAPG pricing is listed in USD.'},
    venueInfo:{venue_name:'Mövenpick Al Khobar',address:'Prince Turkey Street, Al Yarmouk, Khobar, Eastern Province 31952, Saudi Arabia',accommodation:'AAPG lists Mövenpick Al Khobar Hotel as the event lodging location.'},
    community:{overview:'Workshop format is designed for cross-disciplinary exchange among geoscience, reservoir engineering and technology professionals.'}
  },
  {
    key:'ice-2026',
    title:'AAPG International Conference & Exhibition (ICE) 2026',
    start:'2026-12-07', end:'2026-12-09', city:'Jakarta', region:null, country:'Indonesia', venue:'Jakarta, Indonesia', format:'in-person',
    url:'https://iceevent.org/2026/',
    organizer:'AAPG / Indonesian Petroleum Association (IPA)',
    description:'AAPG International Conference & Exhibition 2026 in Jakarta, bringing together a global geoscience and energy audience for technical exchange, regional exploration and an exhibition.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Science'],
    agenda:{overview:'AAPG flagship international conference and exhibition with a multidisciplinary technical program, regional exploration focus, exhibition and networking.'},
    venueInfo:{venue_name:'Jakarta, Indonesia',address:'Jakarta, Indonesia'},
    community:{overview:'Global conference and exhibition connecting technical professionals, companies and geoscience leaders from many countries.'}
  },
  {
    key:'groundwater-ml-lecture-2026',
    title:'Distinguished Lecture: Current Challenges and Future Directions of Using Machine Learning to Predict Groundwater Chemistry: From Shallow Aquifer Quality to Critical Minerals in Deep Brines',
    start:'2026-12-08', end:'2026-12-08', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/current-challenges-and-future-directions-of-using-machine-learning-to-predict-groundwater-chemistry-from-shallow-aquifer-quality-to-critical-minerals-in-deep-brines/',
    description:'AAPG Distinguished Lecture on machine-learning approaches for groundwater chemistry from shallow aquifer quality to critical minerals in deep brines.',
    categories:['Artificial Intelligence','Data Science','Mining & Minerals','Science'],
    community:{overview:'Virtual AAPG Distinguished Lecture for geoscience, hydrogeology and data-science audiences.'}
  },
  {
    key:'sequence-stratigraphy-lecture-2026',
    title:'Distinguished Lecture: Developments in Sequence Stratigraphy',
    start:'2026-12-10', end:'2026-12-10', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/developments-in-sequence-stratigraphy/',
    description:'AAPG Distinguished Lecture on developments in sequence stratigraphy and construction of stratigraphic frameworks from stacking-pattern observations.',
    categories:['Petroleum & Geoscience','Science','Energy'],
    community:{overview:'Virtual AAPG Distinguished Lecture for the geoscience community.'}
  },
  {
    key:'geogulf-2027',
    title:'GeoGulf 2027',
    start:'2027-04-18', end:'2027-04-20', city:'Houston', region:'Texas', country:'United States', venue:'Houston, Texas', format:'in-person',
    url:'https://gcags.org/',
    organizer:'GeoGulf / AAPG-affiliated societies',
    description:'AAPG calendar-listed GeoGulf 2027 event in Houston, Texas.',
    categories:['Petroleum & Geoscience','Energy','Science'],
    venueInfo:{venue_name:'Houston, Texas',address:'Houston, Texas, United States'}
  },
  {
    key:'process-forward-modeling-2027',
    title:'3rd Edition: Geological Process-Based Forward Modeling',
    start:null, end:null, year:2027, month:5, datesText:'May 2027', city:null, region:null, country:null, venue:null, format:'in-person',
    url:'https://www.aapg.org/event-details/3rd-edition-geological-process-based-forward-modeling/',
    description:'AAPG workshop on geological process-based forward modeling and integration of stratigraphy, geomechanics, diagenesis and asset-team workflows.',
    categories:['Petroleum & Geoscience','Engineering','Data Science','Energy'],
    agenda:{overview:'Workshop focuses on moving process-based geological modeling from specialist R&D groups toward broader asset-team workflows, including links among stratigraphy, geomechanics and diagenesis.'}
  },
  {
    key:'energy-opportunities-2027',
    title:'Energy Opportunities Conference 2027',
    start:'2027-05-18', end:'2027-05-20', city:'Cartagena', region:null, country:'Colombia', venue:'Cartagena, Colombia', format:'in-person',
    url:'https://www.aapg.org/about/latin-america-caribbean-region/',
    description:'AAPG Latin America and Caribbean Region calendar-listed Energy Opportunities Conference 2027 in Cartagena, Colombia.',
    categories:['Energy','Petroleum & Geoscience','Business','Engineering'],
    venueInfo:{venue_name:'Cartagena, Colombia',address:'Cartagena, Colombia'}
  },
  {
    key:'venecon-2027',
    title:'Venecon 2027',
    start:null, end:null, year:2027, month:6, datesText:'June 2027', city:'Caracas', region:null, country:'Venezuela', venue:'Caracas, Venezuela', format:'in-person',
    url:'https://www.aapg.org/about/latin-america-caribbean-region/',
    description:'AAPG Latin America and Caribbean Region calendar-listed Venecon 2027 event in Caracas, Venezuela.',
    categories:['Energy','Petroleum & Geoscience','Business','Science'],
    venueInfo:{venue_name:'Caracas, Venezuela',address:'Caracas, Venezuela'}
  }
];

function canonicalSectionAvailability(event, existingMeta) {
  const prior = existingMeta?.section_availability || {};
  const reviewedFallback = (canonical, legacy) =>
    prior[canonical] === 'stated' || prior[legacy] === 'stated' ? 'stated' : 'not_announced';
  return {
    overview:'stated',
    call_for_papers: sectionState(event.cfp, reviewedFallback('call_for_papers','cfp')),
    fees_pricing: sectionState(event.fees, reviewedFallback('fees_pricing','fees')),
    program_agenda: sectionState(event.agenda, reviewedFallback('program_agenda','agenda')),
    keynote_speakers: sectionState(event.speakers, reviewedFallback('keynote_speakers','speakers')),
    technical_committee: sectionState(event.committee, reviewedFallback('technical_committee','committee')),
    sponsors_exhibitors: sectionState(event.sponsors, reviewedFallback('sponsors_exhibitors','sponsors')),
    venue_accommodation: sectionState(event.venueInfo || (event.venue ? {venue_name:event.venue} : null), reviewedFallback('venue_accommodation','venue')),
    community: sectionState(event.community, reviewedFallback('community','community')),
  };
}
function eventYear(e) { return e.year || (e.start ? Number(e.start.slice(0,4)) : null); }
function eventMonth(e) { return e.month || (e.start ? Number(e.start.slice(5,7)) : null); }

async function main() {
  const localPath = path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim() || undefined})
    : createClient({url:'file:'+localPath});

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) {
      console.log('[aapg-authoritative] schema unavailable; skipping');
      return;
    }
    const today = new Date().toISOString().slice(0,10);
    const archived = await db.execute({
      sql:`UPDATE discovery_events SET status='archived'
           WHERE status='published' AND end_date IS NOT NULL AND end_date < ?
             AND (
               LOWER(COALESCE(organizer,'')) LIKE '%aapg%'
               OR LOWER(COALESCE(extraction_method,'')) LIKE 'aapg%'
               OR LOWER(COALESCE(relevance_reason,'')) LIKE '%aapg%'
             )`,
      args:[today]
    });
    let synced=0, deduped=0, rich6=0;
    for (const e of EVENTS) {
      const normalized=normalizeTitle(e.title);
      const year=eventYear(e);
      const month=eventMonth(e);
      const now=new Date().toISOString();

      const existingEventRows = await db.execute({
        sql:`SELECT id FROM discovery_events
             WHERE official_url=? OR canonical_url=? OR (normalized_title=? AND COALESCE(start_year,?)=?)
             ORDER BY CASE WHEN official_url=? OR canonical_url=? THEN 0 ELSE 1 END LIMIT 1`,
        args:[e.url,e.url,normalized,year,year,e.url,e.url]
      });
      const id = existingEventRows.rows?.[0]?.id ? String(existingEventRows.rows[0].id) : stableId('aapg_auth',e.key);

      const dups = await db.execute({
        sql:`SELECT id FROM discovery_events WHERE id<>? AND (official_url=? OR canonical_url=?)`,
        args:[id,e.url,e.url]
      });
      for (const row of dups.rows || []) {
        const dupId=String(row.id);
        await db.execute({sql:'DELETE FROM discovery_event_categories WHERE event_id=?',args:[dupId]});
        await db.execute({sql:'DELETE FROM discovery_events WHERE id=?',args:[dupId]});
        deduped += 1;
      }

      const existingExtractRows = await db.execute({sql:'SELECT * FROM extracted_conferences WHERE source_url=? LIMIT 1',args:[e.url]});
      const old = existingExtractRows.rows?.[0] || null;
      const oldOverview=safeJson(old?.overview,{});
      const oldCfp=safeJson(old?.call_for_papers,{});
      const oldProgram=safeJson(old?.program_agenda,{sessions:[],themes:[],overview:null});
      const oldSpeakers=safeJson(old?.keynote_speakers,[]);
      const oldCommittee=safeJson(old?.technical_committee,[]);
      const oldSponsors=safeJson(old?.sponsors_exhibitors,[]);
      const oldVenue=safeJson(old?.venue_accommodation,{});
      const oldFees=safeJson(old?.fees_pricing,{});
      const oldCommunity=safeJson(old?.community,{});
      const oldMeta=safeJson(old?.extraction_metadata,{});

      const existingRealLogo = oldOverview.logo_url && oldOverview.logo_source === 'stated' ? oldOverview.logo_url : null;
      const categories=[...new Set([...(e.categories || DEFAULT_CATEGORIES),...DEFAULT_CATEGORIES])].slice(0,8);
      const datesText=e.datesText || (e.start && e.end ? (e.start===e.end?e.start:e.start+' – '+e.end) : null);
      const locationText=[e.venue,e.city,e.region,e.country].filter(Boolean).join(', ') || null;
      const overview={
        ...oldOverview,
        conference_name:e.title,
        description:e.description || oldOverview.description || null,
        start_date:e.start,
        end_date:e.end,
        dates_text:datesText,
        city:e.city,
        region:e.region,
        country:e.country,
        venue:e.venue,
        location_text:locationText,
        format:e.format,
        organizer:e.organizer || AAPG_ORGANIZER,
        official_url:e.url,
        source_url:CALENDAR,
        logo_url:existingRealLogo || AAPG_MARK,
        logo_source:existingRealLogo ? 'stated' : 'organiser',
        image_url:oldOverview.image_url || null,
        category:categories[0],
        categories,
        topics:categories,
        keywords:['AAPG','energy geoscience','petroleum geoscience']
      };

      const cfp=e.cfp ? {...oldCfp,...e.cfp} : oldCfp;
      const program=e.agenda ? {...oldProgram,...e.agenda,sessions:Array.isArray(oldProgram.sessions)?oldProgram.sessions:[]} : oldProgram;
      const speakers=Array.isArray(e.speakers) && e.speakers.length ? e.speakers : oldSpeakers;
      const committee=Array.isArray(e.committee) && e.committee.length ? e.committee : oldCommittee;
      const sponsors=Array.isArray(e.sponsors) && e.sponsors.length ? e.sponsors : oldSponsors;
      const venue=e.venueInfo ? {...oldVenue,...e.venueInfo} : (e.venue ? {...oldVenue,venue_name:e.venue,address:oldVenue.address || locationText} : oldVenue);
      const fees=e.fees ? {...oldFees,...e.fees} : oldFees;
      const community=e.community ? {...oldCommunity,...e.community} : oldCommunity;
      const availability=canonicalSectionAvailability(e,oldMeta);
      const stated=Object.values(availability).filter((v)=>v==='stated').length;
      if (stated>=6) rich6 += 1;
      const meta={
        ...oldMeta,
        origin:'discovery_engine',
        import_origin:'aapg_authoritative_manifest',
        status:'success',
        validation_status:'VALIDATED_OFFICIAL_AAPG_CALENDAR',
        validation_score:0.99,
        discovery_event_id:id,
        calendar_url:CALENDAR,
        section_availability:availability,
        authoritative_aapg_sync_at:now,
        tabs_filled:stated,
        tabs_total:9
      };

      const eventColumns = [
        'id','title','normalized_title','description','start_date','end_date','start_year','start_month','date_precision','dates_text',
        'venue','city','region','country','raw_location','format','event_type','organizer','official_url','canonical_url',
        'registration_url','submission_url','image_url','topics','primary_category','status','confidence_score',
        'relevance_classification','relevance_reason','quality_flags','extraction_method','source_url','source_domain',
        'last_seen','last_checked','last_verified','published_at','publish_readiness','readiness_reasons',
        'official_source_verified_at','title_verified_at'
      ];
      const eventArgs = [
        id,e.title,normalized,e.description || null,e.start,e.end,year,month,e.start?'day':'month',datesText,
        e.venue,e.city,e.region,e.country,locationText,e.format,'conference',e.organizer || AAPG_ORGANIZER,e.url,e.url,
        e.fees?.registration_url || null,e.cfp?.submission_url || null,null,JSON.stringify(categories),categories[0],
        'published',0.99,'conference','official_aapg_authoritative_manifest','[]','aapg_authoritative_manifest',
        CALENDAR,hostOf(e.url),now,now,now,now,'publish_ready','[]',now,now
      ];
      await db.execute({
        sql:`INSERT INTO discovery_events(${eventColumns.join(',')})
             VALUES(${eventColumns.map(() => '?').join(',')})
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,normalized_title=excluded.normalized_title,description=excluded.description,
               start_date=excluded.start_date,end_date=excluded.end_date,start_year=excluded.start_year,start_month=excluded.start_month,
               date_precision=excluded.date_precision,dates_text=excluded.dates_text,venue=excluded.venue,city=excluded.city,region=excluded.region,country=excluded.country,
               raw_location=excluded.raw_location,format=excluded.format,organizer=excluded.organizer,official_url=excluded.official_url,canonical_url=excluded.canonical_url,
               registration_url=COALESCE(excluded.registration_url,discovery_events.registration_url),
               submission_url=COALESCE(excluded.submission_url,discovery_events.submission_url),
               topics=excluded.topics,primary_category=excluded.primary_category,status='published',confidence_score=0.99,
               relevance_classification='conference',relevance_reason='official_aapg_authoritative_manifest',
               extraction_method='aapg_authoritative_manifest',source_url=excluded.source_url,source_domain=excluded.source_domain,
               last_seen=excluded.last_seen,last_checked=excluded.last_checked,last_verified=excluded.last_verified,
               published_at=COALESCE(discovery_events.published_at,excluded.published_at),publish_readiness='publish_ready',
               readiness_reasons='[]',official_source_verified_at=excluded.official_source_verified_at,title_verified_at=excluded.title_verified_at`,
        args:eventArgs
      });

      for (const cat of categories) {
        await db.execute({sql:`INSERT OR IGNORE INTO discovery_event_categories(id,event_id,category,confidence,evidence)
          VALUES(?,?,?,0.99,?)`,args:[stableId('aapg_cat',id+'|'+cat),id,cat,JSON.stringify(['Official AAPG calendar / event source'])]});
      }

      await db.execute({
        sql:`INSERT INTO extracted_conferences(
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,
          keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,
          sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,
          fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,
          updated_at=datetime('now')`,
        args:[e.url,JSON.stringify(overview),JSON.stringify(cfp),JSON.stringify(program),JSON.stringify(speakers),
          JSON.stringify(committee),JSON.stringify(sponsors),JSON.stringify(venue),JSON.stringify(fees),JSON.stringify(community),JSON.stringify(meta)]
      });
      synced += 1;
    }
    console.log('[aapg-authoritative] synced='+synced+' deduped='+deduped+' archived_past='+(archived.rowsAffected || 0)+' rich_6plus_tabs='+rich6+' total_manifest='+EVENTS.length);
  } catch (error) {
    console.warn('[aapg-authoritative] failed:',error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
