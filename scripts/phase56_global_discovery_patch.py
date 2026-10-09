from pathlib import Path
import json

branch_root = Path('.')

# 1) Add a rich, official-source WPC Riyadh record to the verified major-conference manifest.
manifest_path = branch_root / 'data' / 'phase52-major-conference-expansion.json'
events = json.loads(manifest_path.read_text())
if not any('WPC Energy Congress' in str(e.get('title', '')) and str(e.get('start', '')).startswith('2026') for e in events):
    events.append({
        'title': '25th WPC Energy Congress 2026',
        'url': 'https://wpcenergy2026.org/',
        'start': '2026-10-11',
        'end': '2026-10-15',
        'city': 'Riyadh',
        'country': 'Saudi Arabia',
        'venue': 'Riyadh Front Exhibition & Conference Center (RFECC)',
        'format': 'in-person',
        'organizer': 'WPC Energy',
        'categories': ['Energy', 'Petroleum & Geoscience', 'Engineering', 'Natural Gas & LNG', 'Hydrogen & CCUS', 'Climate & Sustainability', 'Artificial Intelligence', 'Business'],
        'description': 'The 25th WPC Energy Congress in Riyadh brings together global energy leaders, scientists, policymakers, operators and innovators under the theme Pathways to an Energy Future for All, covering energy security, petroleum, gas, carbon management, technology, investment and the energy transition.',
        'program': {
            'overview': 'The official Congress programme runs 11–15 October 2026 and combines ministerial and strategic sessions, a peer-reviewed technical programme, synergy and special programmes, exhibition activity and networking. The technical programme spans five thematic blocks and 31 specialised forums.',
            'themes': ['Energy security and resilience', 'Oil and gas', 'Natural gas and LNG', 'CCUS and carbon markets', 'Energy transition', 'AI and digitalisation', 'Technology and innovation', 'Investment and policy', 'Young professionals and talent']
        },
        'speakers': [
            {'name': 'HRH Prince Abdulaziz bin Salman Al Saud', 'organization': 'Ministry of Energy, Saudi Arabia', 'role': 'Executive Speaker', 'title': 'Minister of Energy'},
            {'name': 'Pedro Miras', 'organization': 'WPC Energy', 'role': 'Executive Speaker', 'title': 'President'},
            {'name': 'Amin Nasser', 'organization': 'Aramco', 'role': 'Executive Speaker', 'title': 'President & CEO'},
            {'name': 'Dr. Daniel Yergin', 'organization': 'S&P Global', 'role': 'Executive Speaker', 'title': 'Vice Chairman'},
            {'name': 'Patrick Pouyanné', 'organization': 'TotalEnergies', 'role': 'Executive Speaker', 'title': 'Chairman & CEO'},
            {'name': 'Wael Sawan', 'organization': 'Shell', 'role': 'Executive Speaker', 'title': 'CEO'},
            {'name': 'Lorenzo Simonelli', 'organization': 'Baker Hughes', 'role': 'Executive Speaker', 'title': 'Chairman & CEO'},
            {'name': 'Haitham Al Ghais', 'organization': 'OPEC', 'role': 'Executive Speaker', 'title': 'Secretary General'}
        ],
        'sponsors': [
            {'name': 'Principal Buyer', 'role': 'Congress Partner'},
            {'name': 'Dr. Sulaiman Al-Habib Medical Group', 'role': 'Health Partner'},
            {'name': 'Kuwait Petroleum Corporation (KPC)', 'role': 'Industry Sponsor'},
            {'name': 'Riyadh Bank', 'role': 'Industry Sponsor'}
        ],
        'fees': {
            'registration_url': 'https://wpcenergy2026.org/register/',
            'registration_fees': [
                {'category': 'Delegate — Regular', 'amount': 3150, 'currency': 'USD', 'deadline': '2026-09-11', 'notes': 'VAT included; official regular delegate price.'},
                {'category': 'Delegate — Late', 'amount': 3450, 'currency': 'USD', 'deadline': '2026-10-15', 'notes': 'VAT included; valid through the end of the Congress.'},
                {'category': 'Visitor', 'amount': 0, 'currency': 'USD', 'deadline': None, 'notes': 'Official visitor registration is free to attend.'}
            ]
        },
        'venueInfo': {
            'venue_name': 'Riyadh Front Exhibition & Conference Center (RFECC)',
            'address': 'King Khalid International Airport Road, Riyadh 13413, Saudi Arabia',
            'accommodation': 'The venue is near King Khalid International Airport and multiple hotels; use the official Congress travel/venue guidance for current accommodation information.',
            'hotels': []
        },
        'community': {'overview': 'WPC Energy convenes ministers, national and international energy companies, engineers, geoscientists, researchers, policymakers, investors, technology providers and young professionals from around the world.'},
        'sourceUrls': [
            'https://wpcenergy2026.org/',
            'https://wpcenergy2026.org/congress/venue/',
            'https://wpcenergy2026.org/programme/',
            'https://wpcenergy2026.org/programme/all-programmes/',
            'https://wpcenergy2026.org/programme/technical-programme/',
            'https://wpcenergy2026.org/speakers/',
            'https://wpcenergy2026.org/sponsors/',
            'https://wpcenergy2026.org/register/'
        ]
    })
manifest_path.write_text(json.dumps(events, indent=2, ensure_ascii=False) + '\n')

# 2) Seed WPC Riyadh into the fast hard-crawl catalogue as a flagship event.
seed_path = branch_root / 'scripts' / 'seedPopularCategoryHardCrawl.mjs'
seed_text = seed_path.read_text()
wpc_seed = "  ['25th WPC Energy Congress 2026','https://wpcenergy2026.org/','2026-10-11','2026-10-15','Riyadh','Saudi Arabia',['Energy','Petroleum & Geoscience','Engineering','Natural Gas & LNG','Hydrogen & CCUS','Climate & Sustainability','Artificial Intelligence','Business']],\n"
if '25th WPC Energy Congress 2026' not in seed_text:
    anchor = "  ['ADIPEC 2026','https://www.adipec.com/','2026-11-02','2026-11-05','Abu Dhabi','United Arab Emirates',['Energy','Petroleum & Geoscience','Engineering','Hydrogen & CCUS','Climate & Sustainability']],\n"
    if anchor not in seed_text:
        raise SystemExit('ADIPEC seed anchor not found')
    seed_text = seed_text.replace(anchor, wpc_seed + anchor, 1)
seed_path.write_text(seed_text)

# 3) Refresh the authoritative source registry with current global flagship domains.
source_path = branch_root / 'server' / 'discovery' / 'sources.seed.ts'
source_text = source_path.read_text()
legacy = '  ["world-petroleum.org", "World Petroleum Council", "professional_association", "United Kingdom", "Europe"],\n'
energy_additions = [
    '  ["wpcenergy.org", "WPC Energy", "professional_association", "United Kingdom", "Europe"],',
    '  ["wpcenergy2026.org", "25th WPC Energy Congress 2026", "official_conference_site", "Saudi Arabia", "Middle East"],',
    '  ["adipec.com", "ADIPEC", "official_conference_site", "United Arab Emirates", "Middle East"],',
    '  ["iptcnet.org", "International Petroleum Technology Conference", "conference_organizer", "United States", "Global"],',
    '  ["otcnet.org", "Offshore Technology Conference", "conference_organizer", "United States", "North America"],',
    '  ["meos-geo.com", "MEOS GEO", "official_conference_site", "Bahrain", "Middle East"],',
    '  ["ghgt.info", "Greenhouse Gas Control Technologies Conference", "official_conference_site", "Australia", "Oceania"],',
    '  ["futuremineralsforum.com", "Future Minerals Forum", "official_conference_site", "Saudi Arabia", "Middle East"],',
    '  ["worldutilitiescongress.com", "World Utilities Congress", "official_conference_site", "United Arab Emirates", "Middle East"],',
]
if legacy not in source_text:
    raise SystemExit('World Petroleum source anchor not found')
for row in energy_additions:
    domain = row.split('["', 1)[1].split('"', 1)[0]
    if f'["{domain}"' not in source_text:
        source_text = source_text.replace(legacy, legacy + row + '\n', 1)

# Independent flagship technology events are often announced on event-specific domains rather than societies.
tech_anchor = '  ["neurips.cc", "Conference on Neural Information Processing Systems", "conference_organizer", "United States", "North America"],\n'
tech_additions = [
    '  ["mwcbarcelona.com", "MWC Barcelona", "official_conference_site", "Spain", "Europe"],',
    '  ["ces.tech", "CES", "official_conference_site", "United States", "North America"],',
    '  ["gitex.com", "GITEX GLOBAL", "official_conference_site", "United Arab Emirates", "Middle East"],',
    '  ["websummit.com", "Web Summit", "conference_organizer", "Portugal", "Europe"],',
    '  ["rsaconference.com", "RSA Conference", "official_conference_site", "United States", "North America"],',
]
if tech_anchor not in source_text:
    raise SystemExit('Technology source anchor not found')
for row in tech_additions:
    domain = row.split('["', 1)[1].split('"', 1)[0]
    if f'["{domain}"' not in source_text:
        source_text = source_text.replace(tech_anchor, tech_anchor + row + '\n', 1)

medical_anchor = '  ["rsna.org", "Radiological Society of North America", "medical_society", "United States", "North America"],\n'
medical_additions = [
    '  ["himssconference.com", "HIMSS Global Health Conference", "official_conference_site", "United States", "North America"],',
    '  ["bio.org", "BIO International Convention", "professional_association", "United States", "North America"],',
]
if medical_anchor not in source_text:
    raise SystemExit('Medical source anchor not found')
for row in medical_additions:
    domain = row.split('["', 1)[1].split('"', 1)[0]
    if f'["{domain}"' not in source_text:
        source_text = source_text.replace(medical_anchor, medical_anchor + row + '\n', 1)
source_path.write_text(source_text)

print('Phase 56 patch applied: WPC Riyadh deep record + global flagship source coverage')
