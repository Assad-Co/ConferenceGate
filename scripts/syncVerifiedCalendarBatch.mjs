import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AAPG_MARK = '/aapg-organizer.svg';
const NOW = () => new Date().toISOString();

function stableId(prefix, value) {
  return prefix + '_' + createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24);
}
function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b20\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
function safeJson(value, fallback) { try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function person(name, organization, role = null) {
  return { name, full_name:name, organization:organization || null, org:organization || null, role, title:null, email:null, photo_url:null };
}
function fee(category, amount, currency='USD', notes=null, deadline=null) {
  return { category, amount, currency, notes, deadline };
}
function sponsor(name, tier=null) { return { name, tier, logo_url:null }; }

const EVENTS = [
  {
    key:'wtgs-sws-centennial-2026',
    title:'West Texas Geological Society (WTGS) and the Southwest Section (SWS) of AAPG Centennial Conference',
    start:'2026-09-12', end:'2026-09-16', city:'Midland', region:'Texas', country:'United States',
    venue:'Bush Convention Center', format:'in-person',
    url:'https://www.wtgs.org/news/2026-wtgs-sws-aapg-centennial-conference',
    organizer:'West Texas Geological Society (WTGS) / AAPG Southwest Section',
    logo:'https://www.aapg.org/wp-content/uploads/2026/07/AAPG-Southwest-Section-300x131.png',
    logoSource:'stated',
    image:'https://www.aapg.org/wp-content/uploads/2026/07/AAPG-Southwest-Section-300x131.png',
    description:'Centennial conference celebrating 100 years of the West Texas Geological Society under the theme “A Century Beneath the Surface,” with technical sessions, core workshop, short course, social events and Permian Basin geoscience programming.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Education'],
    cfp:{
      status:'Closed',
      abstract_submission_deadline:'2026-06-26',
      submission_email:'submissions@wtgs.org',
      length_limit:'500 words',
      submission_format:'Oral presentations: 20 minutes plus 5 minutes Q&A',
      submission_guidelines:'Abstracts were submitted by email with “ABSTRACT SUBMISSION” in the subject line. Images were excluded from the printed abstract booklet; acceptance notification was by email.'
    },
    program:{
      overview:'Five-day centennial conference program with a 100-Year Anniversary Core Workshop, K-12 teacher workshop, sequence-stratigraphy short course, SWS AAPG and WTGS technical presentations, luncheons and social events.',
      themes:['Permian Basin field discoveries','Siliciclastic sequence stratigraphy','Regional technical presentations','Energy education','Geoscience networking'],
      sessions:[
        {date:'2026-09-12',title:'100-Year Anniversary Core Workshop and K-12 Teacher Workshop'},
        {date:'2026-09-13',title:'Sequence Stratigraphy Short Course and Icebreaker'},
        {date:'2026-09-14',title:'SWS AAPG Presentations, DPA Luncheon and Casino Night'},
        {date:'2026-09-15',title:'WTGS Presentations, Networking Luncheon and Happy Hour'},
        {date:'2026-09-16',title:'WTGS Presentations and Ethics Luncheon'}
      ]
    },
    sponsorNote:'The organizer published sponsorship opportunities for the centennial conference, including the Monday evening social event.',
    venueInfo:{venue_name:'Bush Convention Center',address:'105 N. Main St, Midland, TX 79701, United States',accommodation:null},
    community:{overview:'Community activities included an icebreaker, Casino Night at the Petroleum Club of Midland, networking luncheon, happy hour, ethics luncheon and related field-trip/golf activities.'},
    sourceUrls:[
      'https://www.wtgs.org/news/2026-wtgs-sws-aapg-centennial-conference',
      'https://www.swsaapg.org/events/172/'
    ]
  },
  {
    key:'aapg-academy-south-atlantic-2026',
    title:'AAPG Academy – Two Margins, One Cretaceous Play: Where South Atlantic Exploration Capital Goes Next',
    start:'2026-09-23', end:'2026-09-23', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://aapg.zoom.us/webinar/register/WN_BbyQ2vCETqSFS_-k-kqWcw#/registration',
    organizer:'AAPG Academy / Wood Mackenzie',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/09/Wood-Mackenzie-Webinar-Sep-23-1-300x169.png',
    description:'AAPG Academy webinar comparing Brazil’s Santos Basin and the Southwest African Coastal Basin through their Upper Cretaceous sandstone play and examining how geology, economics and fiscal regimes shape the next round of South Atlantic exploration capital.',
    categories:['Petroleum & Geoscience','Energy','Business','Economics'],
    program:{
      overview:'Webinar scheduled for 23 September 2026 at 9:00 a.m. CT. The session benchmarks South Atlantic basins and focuses on geological analogues, fiscal regimes and where exploration capital may move next.',
      themes:['South Atlantic exploration','Santos Basin','Southwest African Coastal Basin','Upper Cretaceous sandstone play','Exploration economics and fiscal regimes']
    },
    speakers:[person('Fiona Piggott','Wood Mackenzie','Webinar Speaker')],
    sponsors:[sponsor('Wood Mackenzie','Webinar Sponsor')],
    venueInfo:{venue_name:'Virtual webinar',address:'Online via AAPG Zoom'},
    community:{overview:'AAPG Academy virtual professional-learning session for exploration and energy professionals.'},
    registrationUrl:'https://aapg.zoom.us/webinar/register/WN_BbyQ2vCETqSFS_-k-kqWcw#/registration',
    sourceUrls:[
      'https://aapg.zoom.us/webinar/register/WN_BbyQ2vCETqSFS_-k-kqWcw#/registration',
      'https://petroleumag.com/sep-23-webinar-two-margins-one-cretaceous-play-where-capital-goes-next/'
    ]
  },
  {
    key:'midcon-field-2026',
    title:'7th Biennial AAPG Mid-Con Section Field Conference',
    start:'2026-10-02', end:'2026-10-04', city:'Stillwater / Ardmore', region:'Oklahoma', country:'United States',
    venue:'Oklahoma State University / field-course locations', format:'in-person',
    url:'https://tulsageologicalsociety.wildapricot.org/event-6789490',
    organizer:'Tulsa Geological Society / AAPG Mid-Continent Section',
    logo:'https://www.aapg.org/wp-content/uploads/2026/09/AAPG-Mid-Continent-Section-300x131.png',
    logoSource:'stated',
    image:'https://www.aapg.org/wp-content/uploads/2026/09/AAPG-Mid-Continent-Section-300x131.png',
    description:'Field conference on geoscience integration of hydrology and petroleum geology along the Seminole-Cushing Ridge and Arbuckle-Simpson Aquifer in Oklahoma.',
    categories:['Petroleum & Geoscience','Energy','Hydrogeology','Engineering'],
    program:{
      overview:'Three-day field conference integrating outcrops, subsurface sites, remote sensing, borehole cross-sections, 3D frameworks and a Petrel aquifer model, with a Friday seminar/dinner and field activities on Saturday and Sunday.',
      themes:['Hydrology and petroleum geology','Aquifer evaluation','Reservoir connectivity','Remote sensing','3D geological frameworks']
    },
    committee:[
      person('Todd Halihan','Oklahoma State University','Course Leadership'),
      person('Brandon Spencer','Oklahoma State University','Course Leadership'),
      person('Lawrence Walker',null,'Course Leadership'),
      person('John Brett',null,'Course Leadership')
    ],
    fees:{
      registration_fees:[
        fee('Industry / Government',400),fee('Faculty / Academic',300),fee('Students',0,'USD','Student registration is free'),
        fee('Guest / Spouse',175)
      ],
      early_bird_deadline:'2026-09-03',
      pricing_text:'Early rates before 3 September were $325 industry/government, $225 faculty/academic and $125 guest/spouse. Late rates are $400, $300 and $175 respectively; students are free.'
    },
    sponsors:[sponsor('Geoscience Foundation of Tulsa (GFT)','Student registration and travel support')],
    venueInfo:{venue_name:'Stillwater / Ardmore field-course locations',address:'Stillwater and Ardmore, Oklahoma, United States',accommodation:'Official page links Home2 Suites and Best Western in Stillwater and Courtyard by Marriott in Ardmore.'},
    community:{overview:'Registration includes selected meals and refreshments; the Geoscience Foundation of Tulsa provides student registration support and travel vouchers.'},
    registrationUrl:'https://tulsageologicalsociety.wildapricot.org/event-6789490',
    sourceUrls:['https://tulsageologicalsociety.wildapricot.org/event-6789490']
  },
  {
    key:'critical-minerals-lecture-2026',
    title:'Distinguished Lecture: Critical Minerals in Sedimentary Rocks',
    start:'2026-10-06', end:'2026-10-06', city:null, region:null, country:null, venue:'Virtual', format:'online',
    url:'https://www.aapg.org/event-details/critical-minerals-in-sedimentary-rocks/',
    organizer:'American Association of Petroleum Geologists (AAPG)',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/08/hero-LB-1-300x172.jpg',
    description:'AAPG Distinguished Lecture on geological controls on critical-mineral enrichment in sedimentary rocks and predictive exploration approaches for rare earth elements.',
    categories:['Mining & Minerals','Petroleum & Geoscience','Science','Energy'],
    program:{
      overview:'Lecture covers REE enrichment in coal-bearing strata and phosphatic limestones, pXRF and ICP-MS quantification, petrography/SEM-EDS observations, depositional and diagenetic controls, and predictive mineral-exploration implications.',
      themes:['Rare earth elements','Coal-bearing strata','Phosphatic limestones','pXRF and ICP-MS','Predictive mineral exploration']
    },
    speakers:[person('Lauren P. Birgenheier','University of Utah','Distinguished Lecturer')],
    fees:{registration_url:'https://www.aapg.org/event-details/critical-minerals-in-sedimentary-rocks/',registration_fees:[],pricing_text:'The official AAPG calendar provides a Register Now action for this lecture; a public fee amount is not stated on the event page.'},
    venueInfo:{venue_name:'Virtual',address:'Online AAPG Distinguished Lecture'},
    community:{overview:'Virtual AAPG Distinguished Lecture serving the geoscience and critical-minerals community.'},
    sourceUrls:['https://www.aapg.org/event-details/critical-minerals-in-sedimentary-rocks/']
  },
  {
    key:'structural-styles-2026',
    title:'3rd Edition: Structural Styles of the Middle East',
    start:'2026-10-12', end:'2026-10-14', city:'Muscat', region:null, country:'Oman', venue:'Crowne Plaza Muscat by IHG', format:'in-person',
    url:'https://www.aapg.org/event-details/3rd-edition-structural-styles-of-the-middle-east/',
    organizer:'American Association of Petroleum Geologists (AAPG)',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/03/ws-3rd-edition-structural-styles-of-the-middle-east-2000px-hero-300x139.jpg',
    description:'AAPG Geoscience Technology Workshop exploring structural styles of the Arabian Plate and adjacent regions, complex reservoirs and traps, salt tectonics, storage and digital/AI tools in structural geology.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Artificial Intelligence'],
    program:{
      overview:'Three-day workshop with keynote talks, technical sessions, poster sessions and open discussion. An optional short course is offered on 11 October and an optional field trip on 15–16 October.',
      themes:['Tectonic evolution of the Middle East','Complex reservoirs, traps and storage','Salt tectonics','Structurally influenced resource plays','Digital tools, data analytics and AI']
    },
    speakers:[person('Mohammed Al-Mazrui','PDO','Inaugural Keynote'),person('Simon Stewart','Aramco','Technical Keynote')],
    committee:[
      person('Oskar Vidal Royo','Terractiva'),person('Andreas Scharf','Sultan Qaboos University'),person('Elias Al Kharusi','Petrogas'),
      person('Meshal Al-Wadi','KOC'),person('Christian Heine','Shell'),person('Antoine Delaunay','KAUST'),
      person('Ivan Callegari','GUTech'),person('David Repol','PDO'),person('Majid Aljamed','Aramco')
    ],
    fees:{
      registration_fees:[fee('General Non-Member',1850),fee('Member',1650),fee('Committee / Presenter',1550),fee('Young Professional',850),fee('Academia',500),fee('Student',350)],
      pricing_text:'Official AAPG pricing is in USD. Optional short course: $590. Optional 15–16 October field trip: $550.'
    },
    venueInfo:{venue_name:'Crowne Plaza Muscat by IHG',address:'Qurum Heights, P.O. Box 1455, Muscat 112, Oman',accommodation:'AAPG lists an event room rate of RO 90 net with breakfast for single occupancy; second person RO 10 net per night, subject to availability.'},
    community:{overview:'Technical sessions, poster sessions, open discussion, an optional short course and an optional two-day Jabal Akhdar field trip provide collaboration and networking opportunities.'},
    registrationUrl:'https://www.aapg.org/event-details/3rd-edition-structural-styles-of-the-middle-east/',
    sourceUrls:['https://www.aapg.org/event-details/3rd-edition-structural-styles-of-the-middle-east/']
  },
  {
    key:'geogulf-2027',
    title:'GeoGulf 2027',
    start:'2027-04-18', end:'2027-04-20', city:'Houston', region:'Texas', country:'United States', venue:'Norris Conference Center, West Houston', format:'in-person',
    url:'https://geogulf.org/',
    organizer:'GCAGS / GCSSEPM / Houston Geological Society',
    logo:'https://www.aapg.org/wp-content/uploads/2026/07/AAPG-Gulf-Coast-Section-300x131.png',
    logoSource:'stated',
    image:'https://www.aapg.org/wp-content/uploads/2026/07/AAPG-Gulf-Coast-Section-300x131.png',
    description:'76th GCAGS/GCSSEPM Convention and Exposition, hosted by the Houston Geological Society, focused on Gulf Coast geoscience, petroleum systems, technology, CCUS, geothermal and energy minerals.',
    categories:['Petroleum & Geoscience','Energy','Hydrogen & CCUS','Mining & Minerals'],
    cfp:{
      status:'Open',
      abstract_submission_deadline:'2026-12-01',
      submission_url:'https://forms.gle/KQbeDpXsX6v1FU4g9',
      submission_guidelines:'Open-call abstracts are due 1 December 2026. Longer submissions such as full papers or extended abstracts are welcome after abstract acceptance.',
      topics_tracks:['Gulf of Mexico onshore/offshore','Cretaceous and Jurassic plays','Geology and geophysics','Source rocks, basin history and geochemistry','Structural geology and salt tectonics','Seismic technology and modeling','Data analytics and VR','Environmental studies','CCUS, minerals and geothermal','Energy economics']
    },
    fees:{
      registration_url:'https://www.zeffy.com/en-US/ticketing/geogulf--2027',
      early_bird_deadline:'2027-03-01',
      registration_fees:[
        fee('Full Conference – Early Bird',395),fee('Full Conference – Standard',425),fee('Walk-in',475),
        fee('Speaker',250),fee('One-Day Pass',250),fee('Student',150),fee('Student Poster Presenter',100),fee('Exhibitor Pass',150)
      ],
      pricing_text:'Registration includes technical sessions, exhibition floor and convention luncheons for full-conference categories. Separate field trips, short courses and social-event tickets are also offered.'
    },
    program:{
      overview:'Program topics span Gulf Coast plays, field studies, source rocks, basin history, geochemistry, structural geology, salt tectonics, seismic technology, data analytics, environmental studies, CCUS, minerals, geothermal and energy economics.',
      themes:['Gulf Coast petroleum systems','Structural geology and salt tectonics','Seismic and data analytics','Environmental geoscience','CCUS, minerals and geothermal']
    },
    committee:[
      person('Charles Sternbach','Houston Geological Society','General Chair'),
      person('Ted Godo',null,'Program Chair'),
      person('James Willis',null,'Program Chair')
    ],
    sponsorNote:'GeoGulf/HGS has published 2027 sponsorship opportunities and a sponsorship flyer; named event sponsors can be added when the organizer publishes them.',
    venueInfo:{venue_name:'Norris Conference Center, West Houston',address:'816 Town and Country Blvd #210, Houston, TX 77024, United States',accommodation:'The registration page states that a list of conference hotels will be provided.'},
    community:{overview:'GeoGulf 2027 includes poster sessions, short courses, field trips, an icebreaker, convention luncheons, exhibition activity and a golf tournament.'},
    registrationUrl:'https://www.zeffy.com/en-US/ticketing/geogulf--2027',
    sourceUrls:['https://geogulf.org/','https://hgs.org/events/2727','https://www.zeffy.com/en-US/ticketing/geogulf--2027']
  },
  {
    key:'gpb-forward-modeling-2027',
    title:'3rd Edition: Geological Process-Based Forward Modeling',
    start:null, end:null, year:2027, month:5, datesText:'May 2027', city:null, region:null, country:null, venue:null, format:'in-person',
    url:'https://www.aapg.org/event-details/3rd-edition-geological-process-based-forward-modeling/',
    organizer:'American Association of Petroleum Geologists (AAPG)',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/03/26GPB_Hero_Web-300x200.jpg',
    description:'Third-edition AAPG workshop advancing process-based geological modeling from specialist R&D into asset-team workflows, with AI-enabled inversion, multi-physics calibration, petroleum systems integration and applications to storage, geothermal and critical minerals.',
    categories:['Petroleum & Geoscience','Engineering','Data Science','Artificial Intelligence','Hydrogen & CCUS','Mining & Minerals'],
    cfp:{status:'Workshop abstracts available',submission_guidelines:'The official AAPG page publishes a Workshop Abstracts section alongside the program; detailed deadline information is not yet stated on the public page.'},
    program:{
      overview:'Five-session technical program covering current status and emerging frontiers, model calibration/validation, FSM-PSM integration, basin-to-borehole applications and future resources.',
      themes:['Current status, challenges and emerging frontiers','Model calibration and multi-physics validation','Forward stratigraphic modeling with petroleum systems','Basin-to-borehole practical applications','Storage, geothermal and critical minerals']
    },
    committee:[
      person('Dan Tetzlaff','WSC'),person('Peter Burgess','University of Liverpool'),person('Rader Abdul Fattah','TNO'),
      person('Barbara Claussmann','SLB'),person('Shahad Al-Enezi','KOC'),person('Cédric M. John','Queen Mary University of London'),
      person('Didier Granjeon','IFP Energies nouvelles'),person('Nicolas Hawie','Halliburton'),person('Andy Davies','Halliburton'),
      person('Rainer Zulkhe','Aramco'),person('Yaser AlZayer','Aramco'),person('Salem Al-Ali','KOC')
    ],
    fees:{
      registration_fees:[fee('Non-Member',1850),fee('AAPG Member',1650),fee('Committee / Presenter',1550),fee('Young Professional',850),fee('Academia',500),fee('AAPG Student',350)],
      pricing_text:'AAPG states registration is opening soon; the published rate table is in USD.'
    },
    sponsorNote:'AAPG publishes a Sponsorship & Exhibition section and a workshop sponsorship brochure for this event.',
    community:{overview:'Workshop format is designed for practical technical exchange across stratigraphy, geomechanics, petroleum systems, reservoir modeling, AI, geothermal, storage and critical-mineral disciplines.'},
    sourceUrls:['https://www.aapg.org/event-details/3rd-edition-geological-process-based-forward-modeling/']
  },
  {
    key:'energy-opportunities-2027',
    title:'Energy Opportunities Conference 2027',
    start:'2027-05-18', end:'2027-05-20', city:'Cartagena', region:null, country:'Colombia', venue:'Hilton Cartagena', format:'in-person',
    url:'https://www.aapg.org/news-and-media/events/energy-opportunities-returns-to-cartagena-in-2027/',
    organizer:'AAPG Latin America & Caribbean Region',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/08/cartagena-clock-tower-300x201.png',
    description:'AAPG Energy Opportunities Conference returning to Cartagena, connecting decision-makers across oil, gas and renewable energy during a period of active Colombian E&P development.',
    categories:['Energy','Petroleum & Geoscience','Business','Renewable Energy'],
    program:{overview:'AAPG states the 2027 event will feature an executive program, business-to-business sessions and an exhibition featuring technological advances and investment opportunities in Latin America and beyond.',themes:['Executive program','Business-to-business sessions','Technology exhibition','Investment opportunities','Latin American energy']},
    sponsorNote:'The conference includes an exhibition for technology providers and investment opportunities; detailed 2027 exhibitor and sponsor rosters have not yet been published.',
    venueInfo:{venue_name:'Hilton Cartagena',address:'Laguito Peninsula, Cartagena, Colombia'},
    community:{overview:'Designed to connect decision-makers across oil, gas and renewable energy through executive sessions, B2B meetings and exhibition networking.'},
    sourceUrls:['https://www.aapg.org/news-and-media/events/energy-opportunities-returns-to-cartagena-in-2027/','https://www.aapg.org/about/latin-america-caribbean-region/']
  },
  {
    key:'venecon-2027',
    title:'Venecon 2027',
    start:null, end:null, year:2027, month:6, datesText:'June 2027', city:'Caracas', region:null, country:'Venezuela', venue:'Caracas, Venezuela', format:'in-person',
    url:'https://www.aapg.org/news-and-media/events/announcing-venecon-2026/',
    organizer:'AAPG / SPE / SEG',
    logo:AAPG_MARK, logoSource:'organiser',
    image:'https://www.aapg.org/wp-content/uploads/2026/08/Venecon-background-2027-300x169.jpeg',
    description:'Inaugural Venezuela Energy Conference and exhibition organized by AAPG, SPE and SEG, combining business sessions, commercial opportunities and a multidisciplinary technical program in Caracas.',
    categories:['Energy','Petroleum & Geoscience','Engineering','Business'],
    cfp:{status:'Coming soon',submission_guidelines:'AAPG states that the call for abstracts is coming soon.'},
    program:{overview:'Venecon will combine business sessions and commercial opportunities with a technical program featuring geoscience and engineering themes.',themes:['Geoscience','Engineering','Business and commercial opportunities','Venezuela E&P']},
    sponsorNote:'Venecon is announced as a multidisciplinary conference and exhibition; exhibitor and sponsor details are still developing.',
    venueInfo:{venue_name:'Caracas, Venezuela',address:'Caracas, Venezuela'},
    community:{overview:'Joint AAPG/SPE/SEG conference and exhibition intended to connect technical and business professionals across Venezuela’s energy sector.'},
    sourceUrls:['https://www.aapg.org/news-and-media/events/announcing-venecon-2026/','https://www.aapg.org/about/latin-america-caribbean-region/']
  },
  {
    key:'meos-geo-2027',
    title:'MEOS GEO 2027',
    start:'2027-09-14', end:'2027-09-16', city:'Sakhir', region:'Southern Governorate', country:'Bahrain', venue:'Exhibition World Bahrain', format:'in-person',
    url:'https://www.meos-geo.com/',
    organizer:'MEOS GEO',
    logo:'https://www.meos-geo.com/favicon.ico', logoSource:'organiser',
    image:null,
    description:'Middle East Oil, Gas & Geosciences Show bringing together upstream oil, gas and geoscience professionals, GCC operators, engineers, scientists, academia and technology providers for a technical conference and exhibition.',
    categories:['Petroleum & Geoscience','Energy','Engineering','Business'],
    cfp:{status:'Open',submission_url:'https://www.meos-geo.com/call-for-paper-proposals/',submission_guidelines:'The MEOS GEO 2027 Call for Proposals is open for technical contributions to the conference program.'},
    program:{overview:'Technical conference and exhibition focused on upstream and subsurface disciplines, practical insights, technical expertise, science, innovation and collaboration.',themes:['Upstream performance','Subsurface disciplines','Technology and innovation','Technical knowledge exchange']},
    sponsorNote:'MEOS GEO publishes sponsorship and exhibitor opportunities. The technical programme brings together SPE, AAPG, EAGE and SEG, and the conference is chaired by Saudi Aramco.',
    venueInfo:{venue_name:'Exhibition World Bahrain',address:'Sakhir, Kingdom of Bahrain'},
    community:{overview:'Conference and exhibition environment connects GCC operators, procurement teams, project engineers, technical specialists, scientists, academia, service companies and technology providers.'},
    sourceUrls:['https://www.meos-geo.com/','https://www.meos-geo.com/call-for-paper-proposals/','https://www.meos-geo.com/why-sponsor/','https://www.meos-geo.com/why-visit/']
  },
  {
    key:'imog-2027',
    title:'33rd International Meeting on Organic Geochemistry (IMOG 2027)',
    start:'2027-09-12', end:'2027-09-16', city:'Rotterdam', region:'South Holland', country:'Netherlands',
    venue:'Rotterdam, Netherlands', format:'in-person',
    url:'https://imogconference.org/',
    organizer:'European Association of Organic Geochemists (EAOG) / European Association of Geoscientists and Engineers (EAGE)',
    logo:'https://imogconference.org/wp-content/uploads/sites/10/2026/08/IMOG27_Full-Logo3.svg',
    logoSource:'stated',
    image:'https://imogconference.org/wp-content/uploads/sites/10/2026/08/Rotterdam.jpg?w=800',
    description:'The 33rd International Meeting on Organic Geochemistry brings together the global organic-geochemistry community across academia and industry, spanning biogeochemistry, palaeoenvironmental and climate studies, petroleum systems, environmental science, geochemical archaeology, data science and emerging energy applications.',
    categories:['Petroleum & Geoscience','Chemistry','Climate & Sustainability','Environment','Science','Energy','Data Science'],
    cfp:{
      status:'Open',
      abstract_submission_deadline:'2027-02-14',
      submission_url:'https://imogconference.org/submission-instruction/',
      submission_guidelines:'IMOG 2027 is accepting abstracts for the Rotterdam meeting. The official site lists 14 February 2027 as the call-for-abstracts submission deadline.',
      topics_tracks:['Organic matter cycles and transformation','Biogeochemistry','Palaeoenvironments and palaeoclimates','Petroleum systems and organic geochemistry','Soil and environmental geochemistry','Geochemical archaeology','Data science and artificial intelligence','Emerging energy solutions']
    },
    program:{
      overview:'IMOG 2027 will feature oral and poster presentations across the breadth of modern organic geochemistry, with the scientific programme designed around current academic and industry applications.',
      themes:['Biogeochemistry','Palaeoenvironments and palaeoclimates','Petroleum systems and organic geochemistry','Soil and environmental geochemistry','Geochemical archaeology','Data science and artificial intelligence','Emerging energy solutions']
    },
    committee:[
      person('Johan Weijers','Shell','Scientific Committee Chair'),
      person('Arnoud Boom','University of Leicester','Scientific Committee'),
      person('Caitlin Witkowski','University of Bristol','Scientific Committee'),
      person('Daniel Xia','Apache Corporation','Scientific Committee'),
      person('Gemma Spaak','Shell','Scientific Committee'),
      person('Marcel van der Meer','Royal NIOZ','Scientific Committee'),
      person('Marcus Elvert','MARUM – University of Bremen','Scientific Committee'),
      person('Mohammed Al-Ghammari','Petroleum Development Oman','Scientific Committee'),
      person('Norka Marcano Balliache','SLB','Scientific Committee'),
      person('Sarah Coffinet','University of Rennes','Scientific Committee'),
      person('Thorsten Bauersachs','RWTH Aachen','Scientific Committee')
    ],
    venueInfo:{
      venue_name:'Rotterdam, Netherlands — venue to be announced',
      address:'Rotterdam, South Holland, Netherlands',
      travel_information:'The official IMOG 2027 site highlights Rotterdam rail access, proximity to Amsterdam Schiphol Airport, and event travel offers. The specific 2027 conference venue has not yet been announced.'
    },
    community:{
      summary:'IMOG 2027 expects more than 500 attendees, around 300 poster presentations and more than 80 oral presentations, bringing together academic and industry organic geochemists for scientific exchange and networking.',
      overview:'IMOG 2027 expects more than 500 attendees, around 300 poster presentations and more than 80 oral presentations, bringing together academic and industry organic geochemists for scientific exchange and networking.'
    },
    sourceUrls:[
      'https://imogconference.org/',
      'https://imogconference.org/overview/',
      'https://imogconference.org/committees/',
      'https://imogconference.org/location/',
      'https://imogconference.org/topics/'
    ]
  }
];

function isAapgEvent(e) {
  return /aapg|american association of petroleum geologists/i.test([e.title,e.organizer,e.url].filter(Boolean).join(' '));
}
function yearOf(e) { return e.year || (e.start ? Number(e.start.slice(0,4)) : null); }
function monthOf(e) { return e.month || (e.start ? Number(e.start.slice(5,7)) : null); }
function availability(e) {
  return {
    overview:'stated',
    call_for_papers:e.cfp ? 'stated' : 'not_announced',
    fees_pricing:e.fees ? 'stated' : 'not_announced',
    program_agenda:e.program ? 'stated' : 'not_announced',
    keynote_speakers:Array.isArray(e.speakers) && e.speakers.length ? 'stated' : 'not_announced',
    technical_committee:Array.isArray(e.committee) && e.committee.length ? 'stated' : 'not_announced',
    sponsors_exhibitors:(Array.isArray(e.sponsors) && e.sponsors.length) || e.sponsorNote ? 'stated' : 'not_announced',
    venue_accommodation:e.venueInfo || e.venue ? 'stated' : 'not_announced',
    community:e.community ? 'stated' : 'not_announced'
  };
}
function sectionNotes(e) {
  return {
    call_for_papers:e.cfp?.submission_guidelines || e.cfp?.status || null,
    fees_pricing:e.fees?.pricing_text || null,
    program_agenda:e.program?.overview || null,
    keynote_speakers:null,
    technical_committee:null,
    sponsors_exhibitors:e.sponsorNote || null,
    venue_accommodation:e.venueInfo?.accommodation || e.venueInfo?.address || null,
    community:e.community?.overview || null
  };
}

async function main() {
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim() || undefined})
    : createClient({url:'file:'+localPath});

  try {
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) { console.log('[calendar-batch] schema unavailable; skipping'); return; }

    let synced=0, rich6=0, republishedPast=0;
    for (const e of EVENTS) {
      const now=NOW();
      const normalized=normalizeTitle(e.title);
      const year=yearOf(e);
      const month=monthOf(e);
      const datesText=e.datesText || (e.start && e.end ? (e.start===e.end ? e.start : e.start+' – '+e.end) : null);
      const location=[e.venue,e.city,e.region,e.country].filter(Boolean).join(', ') || null;
      const cats=[...new Set(e.categories || ['Energy','Petroleum & Geoscience'])].slice(0,8);
      const avail=availability(e);
      const filled=Object.values(avail).filter((x)=>x==='stated').length;
      if (filled>=6) rich6 += 1;

      const found=await db.execute({
        sql:`SELECT id FROM discovery_events
             WHERE official_url=? OR canonical_url=? OR (normalized_title=? AND COALESCE(start_year,?)=?)
             ORDER BY CASE WHEN official_url=? OR canonical_url=? THEN 0 ELSE 1 END LIMIT 1`,
        args:[e.url,e.url,normalized,year,year,e.url,e.url]
      });
      const id=found.rows?.[0]?.id ? String(found.rows[0].id) : stableId('calendar_batch',e.key);

      // Remove duplicate search rows for the same edition even when an older importer used a
      // different official URL. The extracted row can remain as provenance, but only one
      // discovery event should represent the conference.
      const dups=await db.execute({
        sql:'SELECT id FROM discovery_events WHERE id<>? AND normalized_title=? AND COALESCE(start_year,?)=?',
        args:[id,normalized,year,year]
      });
      for (const row of dups.rows || []) {
        const dupId=String(row.id);
        await db.execute({sql:'DELETE FROM discovery_event_categories WHERE event_id=?',args:[dupId]});
        await db.execute({sql:'DELETE FROM discovery_events WHERE id=?',args:[dupId]});
      }

      const eventColumns=[
        'id','title','normalized_title','description','start_date','end_date','start_year','start_month','date_precision','dates_text',
        'venue','city','region','country','raw_location','format','event_type','organizer','official_url','canonical_url',
        'registration_url','submission_url','image_url','topics','primary_category','status','confidence_score',
        'relevance_classification','relevance_reason','quality_flags','extraction_method','source_url','source_domain',
        'last_seen','last_checked','last_verified','published_at','publish_readiness','readiness_reasons','official_source_verified_at','title_verified_at'
      ];
      const eventArgs=[
        id,e.title,normalized,e.description || null,e.start,e.end,year,month,e.start?'day':'month',datesText,
        e.venue,e.city,e.region,e.country,location,e.format,'conference',e.organizer,e.url,e.url,
        e.registrationUrl || e.fees?.registration_url || null,e.cfp?.submission_url || null,e.image || null,
        JSON.stringify(cats),cats[0],'published',0.99,'conference','verified_calendar_batch','[]','verified_calendar_batch',
        e.url,hostOf(e.url),now,now,now,now,'publish_ready','[]',now,now
      ];
      await db.execute({
        sql:`INSERT INTO discovery_events(${eventColumns.join(',')}) VALUES(${eventColumns.map(()=>'?').join(',')})
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,normalized_title=excluded.normalized_title,description=excluded.description,
               start_date=excluded.start_date,end_date=excluded.end_date,start_year=excluded.start_year,start_month=excluded.start_month,
               date_precision=excluded.date_precision,dates_text=excluded.dates_text,venue=excluded.venue,city=excluded.city,
               region=excluded.region,country=excluded.country,raw_location=excluded.raw_location,format=excluded.format,
               organizer=excluded.organizer,official_url=excluded.official_url,canonical_url=excluded.canonical_url,
               registration_url=COALESCE(excluded.registration_url,discovery_events.registration_url),
               submission_url=COALESCE(excluded.submission_url,discovery_events.submission_url),
               image_url=COALESCE(excluded.image_url,discovery_events.image_url),
               topics=excluded.topics,primary_category=excluded.primary_category,status='published',confidence_score=0.99,
               relevance_classification='conference',relevance_reason='verified_calendar_batch',extraction_method='verified_calendar_batch',
               source_url=excluded.source_url,source_domain=excluded.source_domain,last_seen=excluded.last_seen,last_checked=excluded.last_checked,
               last_verified=excluded.last_verified,published_at=COALESCE(discovery_events.published_at,excluded.published_at),
               publish_readiness='publish_ready',readiness_reasons='[]',official_source_verified_at=excluded.official_source_verified_at,
               title_verified_at=excluded.title_verified_at`,
        args:eventArgs
      });
      if (e.end && e.end < new Date().toISOString().slice(0,10)) republishedPast += 1;

      for (const cat of cats) {
        await db.execute({
          sql:'INSERT OR IGNORE INTO discovery_event_categories(id,event_id,category,confidence,evidence) VALUES(?,?,?,0.99,?)',
          args:[stableId('batch_cat',id+'|'+cat),id,cat,JSON.stringify(['Official event/calendar sources'])]
        });
      }

      const oldRows=await db.execute({sql:'SELECT * FROM extracted_conferences WHERE source_url=? LIMIT 1',args:[e.url]});
      const old=oldRows.rows?.[0] || null;
      const oldOverview=safeJson(old?.overview,{});
      const overview={
        ...oldOverview,
        conference_name:e.title,
        description:e.description || null,
        start_date:e.start,
        end_date:e.end,
        dates_text:datesText,
        city:e.city,region:e.region,country:e.country,venue:e.venue,location_text:location,
        format:e.format,organizer:e.organizer,official_url:e.url,source_url:e.url,
        logo_url:e.logo || (isAapgEvent(e) ? AAPG_MARK : oldOverview.logo_url || null),
        logo_source:e.logoSource || (isAapgEvent(e) ? 'organiser' : oldOverview.logo_source || null),
        image_url:e.image || oldOverview.image_url || null,
        category:cats[0],categories:cats,topics:cats,
        important_dates:[
          ...(e.start ? [{label:'Conference start',date:e.start,isDeadline:false}] : []),
          ...(e.cfp?.abstract_submission_deadline ? [{label:'Abstract deadline',date:e.cfp.abstract_submission_deadline,isDeadline:true}] : [])
        ]
      };
      const cfp=e.cfp || {};
      const program=e.program ? {sessions:e.program.sessions || [],themes:e.program.themes || [],overview:e.program.overview || null} : {sessions:[],themes:[],overview:null};
      const speakers=e.speakers || [];
      const committee=e.committee || [];
      const sponsors=e.sponsors || [];
      const venue=e.venueInfo ? {...e.venueInfo,hotels:e.venueInfo.hotels || []} : (e.venue ? {venue_name:e.venue,address:location,hotels:[]} : {});
      const fees=e.fees ? {...e.fees,registration_url:e.registrationUrl || e.fees.registration_url || null} : (e.registrationUrl ? {registration_url:e.registrationUrl,registration_fees:[],pricing_text:null} : {});
      const community=e.community || {};
      const meta={
        origin:'discovery_engine',import_origin:'verified_calendar_batch',status:'success',
        validation_status:'VALIDATED_OFFICIAL_AND_CORROBORATING_SOURCES',validation_score:0.99,
        discovery_event_id:id,source_urls:e.sourceUrls || [e.url],
        section_availability:avail,section_notes:sectionNotes(e),
        tabs_filled:filled,tabs_total:9,verified_batch_at:now
      };
      await db.execute({
        sql:`INSERT INTO extracted_conferences(
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,
          keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,
          sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,
          fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,updated_at=datetime('now')`,
        args:[e.url,JSON.stringify(overview),JSON.stringify(cfp),JSON.stringify(program),JSON.stringify(speakers),
          JSON.stringify(committee),JSON.stringify(sponsors),JSON.stringify(venue),JSON.stringify(fees),JSON.stringify(community),JSON.stringify(meta)]
      });

      synced += 1;
    }
    console.log('[calendar-batch] synced='+synced+' rich_6plus_tabs='+rich6+' republished_recent_past='+republishedPast+' total='+EVENTS.length);
  } catch (error) {
    console.warn('[calendar-batch] failed:',error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
