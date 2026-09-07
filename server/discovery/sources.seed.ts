// The organisation registry: the authoritative sites conferences are announced on.
//
// A society announces its own annual meeting long before a search engine indexes it, and states it
// on a page it controls. Harvesting those pages directly is therefore both the cheapest and the
// most trustworthy way to learn that a conference exists — no query spend, no ranking to fight,
// and the organisation's identity attached from the first moment. That identity is what makes a
// customer search for "AAPG" or "SPE" return those societies' conferences rather than whatever
// happens to mention them.
//
// This is data, not behaviour. Rows are editable through the admin API or the CLI, and removing
// one changes nothing except which domain gets seeded. Nothing here is a permission slip either:
// the engine reads each site's robots.txt first and skips any domain that asks not to be crawled,
// and `Crawl-delay` can only slow it down.
//
// Coverage is deliberately global — North America, Europe, the Middle East, Asia, Africa, Latin
// America and Oceania — because a conference index that knows only American societies is not a
// global conference index.

import type { DomainInput } from "./sourceRegistry";
import type { SourceType } from "./types";

type Seed = [domain: string, name: string, type: SourceType, country: string, region: string];

/** Energy, petroleum and the geosciences — the categories this index leads with. */
const GEOSCIENCE_AND_ENERGY: Seed[] = [
  ["aapg.org", "American Association of Petroleum Geologists", "professional_society", "United States", "North America"],
  ["spe.org", "Society of Petroleum Engineers", "professional_society", "United States", "North America"],
  ["seg.org", "Society of Exploration Geophysicists", "professional_society", "United States", "North America"],
  ["eage.org", "European Association of Geoscientists and Engineers", "professional_society", "Netherlands", "Europe"],
  ["agu.org", "American Geophysical Union", "scientific_organization", "United States", "North America"],
  ["egu.eu", "European Geosciences Union", "scientific_organization", "Germany", "Europe"],
  ["geosociety.org", "Geological Society of America", "scientific_organization", "United States", "North America"],
  ["geolsoc.org.uk", "Geological Society of London", "scientific_organization", "United Kingdom", "Europe"],
  ["sepm.org", "SEPM Society for Sedimentary Geology", "scientific_organization", "United States", "North America"],
  ["seg.org.cn", "Chinese Geophysical Society", "scientific_organization", "China", "Asia"],
  ["world-petroleum.org", "World Petroleum Council", "professional_association", "United Kingdom", "Europe"],
  ["irena.org", "International Renewable Energy Agency", "government", "United Arab Emirates", "Middle East"],
  ["iea.org", "International Energy Agency", "government", "France", "Europe"],
  ["ampp.org", "Association for Materials Protection and Performance", "professional_society", "United States", "North America"],
  ["smenet.org", "Society for Mining, Metallurgy and Exploration", "professional_society", "United States", "North America"],
  ["ausimm.com", "Australasian Institute of Mining and Metallurgy", "professional_society", "Australia", "Oceania"],
  ["saimm.co.za", "Southern African Institute of Mining and Metallurgy", "professional_society", "South Africa", "Africa"],
  ["cim.org", "Canadian Institute of Mining, Metallurgy and Petroleum", "professional_society", "Canada", "North America"],
  ["iodp.org", "International Ocean Discovery Program", "scientific_organization", "United States", "North America"],
  ["ametsoc.org", "American Meteorological Society", "scientific_organization", "United States", "North America"],
  ["rmets.org", "Royal Meteorological Society", "scientific_organization", "United Kingdom", "Europe"],
  ["ipcc.ch", "Intergovernmental Panel on Climate Change", "government", "Switzerland", "Europe"],
];

/** Engineering institutions and the standards bodies that convene with them. */
const ENGINEERING: Seed[] = [
  ["ieee.org", "Institute of Electrical and Electronics Engineers", "engineering_society", "United States", "North America"],
  ["asme.org", "American Society of Mechanical Engineers", "engineering_society", "United States", "North America"],
  ["asce.org", "American Society of Civil Engineers", "engineering_society", "United States", "North America"],
  ["sae.org", "SAE International", "engineering_society", "United States", "North America"],
  ["aiaa.org", "American Institute of Aeronautics and Astronautics", "engineering_society", "United States", "North America"],
  ["aiche.org", "American Institute of Chemical Engineers", "engineering_society", "United States", "North America"],
  ["ashrae.org", "ASHRAE", "engineering_society", "United States", "North America"],
  ["ans.org", "American Nuclear Society", "engineering_society", "United States", "North America"],
  ["aws.org", "American Welding Society", "engineering_society", "United States", "North America"],
  ["tms.org", "The Minerals, Metals and Materials Society", "engineering_society", "United States", "North America"],
  ["asminternational.org", "ASM International", "engineering_society", "United States", "North America"],
  ["nspe.org", "National Society of Professional Engineers", "professional_association", "United States", "North America"],
  ["incose.org", "International Council on Systems Engineering", "engineering_society", "United States", "North America"],
  ["iise.org", "Institute of Industrial and Systems Engineers", "engineering_society", "United States", "North America"],
  ["asq.org", "American Society for Quality", "professional_association", "United States", "North America"],
  ["isa.org", "International Society of Automation", "engineering_society", "United States", "North America"],
  ["sme.org", "SME Manufacturing", "engineering_society", "United States", "North America"],
  ["sname.org", "Society of Naval Architects and Marine Engineers", "engineering_society", "United States", "North America"],
  ["imeche.org", "Institution of Mechanical Engineers", "engineering_society", "United Kingdom", "Europe"],
  ["theiet.org", "Institution of Engineering and Technology", "engineering_society", "United Kingdom", "Europe"],
  ["ice.org.uk", "Institution of Civil Engineers", "engineering_society", "United Kingdom", "Europe"],
  ["rina.org.uk", "Royal Institution of Naval Architects", "engineering_society", "United Kingdom", "Europe"],
  ["icheme.org", "Institution of Chemical Engineers", "engineering_society", "United Kingdom", "Europe"],
  ["vde.com", "VDE Association for Electrical, Electronic and Information Technologies", "engineering_society", "Germany", "Europe"],
  ["vdi.de", "Association of German Engineers", "engineering_society", "Germany", "Europe"],
  ["engineersaustralia.org.au", "Engineers Australia", "engineering_society", "Australia", "Oceania"],
  ["ieice.org", "Institute of Electronics, Information and Communication Engineers", "engineering_society", "Japan", "Asia"],
  ["jsme.or.jp", "Japan Society of Mechanical Engineers", "engineering_society", "Japan", "Asia"],
  ["ieej.or.jp", "Institute of Electrical Engineers of Japan", "engineering_society", "Japan", "Asia"],
  ["kiee.or.kr", "Korean Institute of Electrical Engineers", "engineering_society", "South Korea", "Asia"],
  ["ieindia.org", "Institution of Engineers India", "engineering_society", "India", "Asia"],
  ["cmes.org", "Chinese Mechanical Engineering Society", "engineering_society", "China", "Asia"],
];

/** Computing, mathematics and information security. */
const COMPUTING: Seed[] = [
  ["acm.org", "Association for Computing Machinery", "professional_society", "United States", "North America"],
  ["usenix.org", "USENIX Association", "professional_society", "United States", "North America"],
  ["siam.org", "Society for Industrial and Applied Mathematics", "scientific_organization", "United States", "North America"],
  ["informs.org", "Institute for Operations Research and the Management Sciences", "professional_society", "United States", "North America"],
  ["aaai.org", "Association for the Advancement of Artificial Intelligence", "scientific_organization", "United States", "North America"],
  ["neurips.cc", "Conference on Neural Information Processing Systems", "conference_organizer", "United States", "North America"],
  ["icml.cc", "International Conference on Machine Learning", "conference_organizer", "United States", "North America"],
  ["iclr.cc", "International Conference on Learning Representations", "conference_organizer", "United States", "North America"],
  ["aclweb.org", "Association for Computational Linguistics", "scientific_organization", "United States", "North America"],
  ["iacr.org", "International Association for Cryptologic Research", "scientific_organization", "United States", "North America"],
  ["owasp.org", "Open Worldwide Application Security Project", "professional_association", "United States", "North America"],
  ["first.org", "Forum of Incident Response and Security Teams", "professional_association", "United States", "North America"],
  ["isaca.org", "ISACA", "professional_association", "United States", "North America"],
  ["ams.org", "American Mathematical Society", "scientific_organization", "United States", "North America"],
  ["maa.org", "Mathematical Association of America", "scientific_organization", "United States", "North America"],
  ["lms.ac.uk", "London Mathematical Society", "scientific_organization", "United Kingdom", "Europe"],
  ["euro-math-soc.eu", "European Mathematical Society", "scientific_organization", "Germany", "Europe"],
  ["ipsj.or.jp", "Information Processing Society of Japan", "professional_society", "Japan", "Asia"],
  ["ccf.org.cn", "China Computer Federation", "professional_society", "China", "Asia"],
  ["gi.de", "Gesellschaft für Informatik", "professional_society", "Germany", "Europe"],
  ["bcs.org", "BCS, The Chartered Institute for IT", "professional_society", "United Kingdom", "Europe"],
  ["pmi.org", "Project Management Institute", "professional_association", "United States", "North America"],
];

/** Chemistry, physics, optics and materials. */
const PHYSICAL_SCIENCES: Seed[] = [
  ["acs.org", "American Chemical Society", "scientific_organization", "United States", "North America"],
  ["rsc.org", "Royal Society of Chemistry", "scientific_organization", "United Kingdom", "Europe"],
  ["gdch.de", "German Chemical Society", "scientific_organization", "Germany", "Europe"],
  ["iupac.org", "International Union of Pure and Applied Chemistry", "scientific_organization", "United States", "North America"],
  ["aps.org", "American Physical Society", "scientific_organization", "United States", "North America"],
  ["aip.org", "American Institute of Physics", "scientific_organization", "United States", "North America"],
  ["iop.org", "Institute of Physics", "scientific_organization", "United Kingdom", "Europe"],
  ["optica.org", "Optica", "scientific_organization", "United States", "North America"],
  ["spie.org", "SPIE, the international society for optics and photonics", "scientific_organization", "United States", "North America"],
  ["iucr.org", "International Union of Crystallography", "scientific_organization", "United Kingdom", "Europe"],
  ["mrs.org", "Materials Research Society", "scientific_organization", "United States", "North America"],
  ["e-mrs.org", "European Materials Research Society", "scientific_organization", "France", "Europe"],
  ["electrochem.org", "The Electrochemical Society", "scientific_organization", "United States", "North America"],
  ["csj.jp", "Chemical Society of Japan", "scientific_organization", "Japan", "Asia"],
  ["chemsoc.org.cn", "Chinese Chemical Society", "scientific_organization", "China", "Asia"],
  ["jps.or.jp", "Physical Society of Japan", "scientific_organization", "Japan", "Asia"],
  ["eps.org", "European Physical Society", "scientific_organization", "France", "Europe"],
  ["home.cern", "CERN", "research_institute", "Switzerland", "Europe"],
  ["esa.int", "European Space Agency", "government", "France", "Europe"],
  ["eso.org", "European Southern Observatory", "research_institute", "Germany", "Europe"],
  ["desy.de", "Deutsches Elektronen-Synchrotron", "research_institute", "Germany", "Europe"],
  ["aas.org", "American Astronomical Society", "scientific_organization", "United States", "North America"],
  ["iau.org", "International Astronomical Union", "scientific_organization", "France", "Europe"],
];

/** Medicine and the life sciences, where conference volume is highest. */
const MEDICAL_AND_LIFE_SCIENCES: Seed[] = [
  ["escardio.org", "European Society of Cardiology", "medical_society", "France", "Europe"],
  ["acc.org", "American College of Cardiology", "medical_society", "United States", "North America"],
  ["heart.org", "American Heart Association", "medical_society", "United States", "North America"],
  ["asco.org", "American Society of Clinical Oncology", "medical_society", "United States", "North America"],
  ["esmo.org", "European Society for Medical Oncology", "medical_society", "Switzerland", "Europe"],
  ["aacr.org", "American Association for Cancer Research", "medical_society", "United States", "North America"],
  ["hematology.org", "American Society of Hematology", "medical_society", "United States", "North America"],
  ["ehaweb.org", "European Hematology Association", "medical_society", "Netherlands", "Europe"],
  ["diabetes.org", "American Diabetes Association", "medical_society", "United States", "North America"],
  ["easd.org", "European Association for the Study of Diabetes", "medical_society", "Germany", "Europe"],
  ["endocrine.org", "Endocrine Society", "medical_society", "United States", "North America"],
  ["aan.com", "American Academy of Neurology", "medical_society", "United States", "North America"],
  ["ean.org", "European Academy of Neurology", "medical_society", "Austria", "Europe"],
  ["wfneurology.org", "World Federation of Neurology", "medical_society", "United Kingdom", "Europe"],
  ["rsna.org", "Radiological Society of North America", "medical_society", "United States", "North America"],
  ["myesr.org", "European Society of Radiology", "medical_society", "Austria", "Europe"],
  ["aaos.org", "American Academy of Orthopaedic Surgeons", "medical_society", "United States", "North America"],
  ["efort.org", "European Federation of National Associations of Orthopaedics", "medical_society", "Switzerland", "Europe"],
  ["auanet.org", "American Urological Association", "medical_society", "United States", "North America"],
  ["uroweb.org", "European Association of Urology", "medical_society", "Netherlands", "Europe"],
  ["asahq.org", "American Society of Anesthesiologists", "medical_society", "United States", "North America"],
  ["esaic.org", "European Society of Anaesthesiology and Intensive Care", "medical_society", "Belgium", "Europe"],
  ["idsociety.org", "Infectious Diseases Society of America", "medical_society", "United States", "North America"],
  ["escmid.org", "European Society of Clinical Microbiology and Infectious Diseases", "medical_society", "Switzerland", "Europe"],
  ["thoracic.org", "American Thoracic Society", "medical_society", "United States", "North America"],
  ["ersnet.org", "European Respiratory Society", "medical_society", "Switzerland", "Europe"],
  ["gastro.org", "American Gastroenterological Association", "medical_society", "United States", "North America"],
  ["ueg.eu", "United European Gastroenterology", "medical_society", "Austria", "Europe"],
  ["easl.eu", "European Association for the Study of the Liver", "medical_society", "Switzerland", "Europe"],
  ["facs.org", "American College of Surgeons", "medical_society", "United States", "North America"],
  ["sages.org", "Society of American Gastrointestinal and Endoscopic Surgeons", "medical_society", "United States", "North America"],
  ["rcseng.ac.uk", "Royal College of Surgeons of England", "medical_society", "United Kingdom", "Europe"],
  ["era-online.org", "European Renal Association", "medical_society", "Italy", "Europe"],
  ["kidney.org", "National Kidney Foundation", "medical_society", "United States", "North America"],
  ["isth.org", "International Society on Thrombosis and Haemostasis", "medical_society", "United States", "North America"],
  ["ama-assn.org", "American Medical Association", "medical_society", "United States", "North America"],
  ["who.int", "World Health Organization", "government", "Switzerland", "Europe"],
  ["asm.org", "American Society for Microbiology", "scientific_organization", "United States", "North America"],
  ["asbmb.org", "American Society for Biochemistry and Molecular Biology", "scientific_organization", "United States", "North America"],
  ["ascb.org", "American Society for Cell Biology", "scientific_organization", "United States", "North America"],
  ["faseb.org", "Federation of American Societies for Experimental Biology", "scientific_organization", "United States", "North America"],
  ["embo.org", "European Molecular Biology Organization", "scientific_organization", "Germany", "Europe"],
  ["febs.org", "Federation of European Biochemical Societies", "scientific_organization", "United Kingdom", "Europe"],
  ["biochemistry.org", "Biochemical Society", "scientific_organization", "United Kingdom", "Europe"],
  ["genetics-gsa.org", "Genetics Society of America", "scientific_organization", "United States", "North America"],
  ["ashg.org", "American Society of Human Genetics", "scientific_organization", "United States", "North America"],
  ["eshg.org", "European Society of Human Genetics", "scientific_organization", "Austria", "Europe"],
  ["sfn.org", "Society for Neuroscience", "scientific_organization", "United States", "North America"],
  ["fens.org", "Federation of European Neuroscience Societies", "scientific_organization", "Belgium", "Europe"],
  ["apha.org", "American Public Health Association", "medical_society", "United States", "North America"],
  ["eupha.org", "European Public Health Association", "medical_society", "Netherlands", "Europe"],
  ["saudicardiacsociety.com", "Saudi Heart Association", "medical_society", "Saudi Arabia", "Middle East"],
  ["emiratesmedicalassociation.org", "Emirates Medical Association", "medical_society", "United Arab Emirates", "Middle East"],
  ["ima.org.il", "Israeli Medical Association", "medical_society", "Israel", "Middle East"],
  ["ranzcp.org", "Royal Australian and New Zealand College of Psychiatrists", "medical_society", "Australia", "Oceania"],
  ["racs.edu.au", "Royal Australasian College of Surgeons", "medical_society", "Australia", "Oceania"],
  ["samedical.org", "South African Medical Association", "medical_society", "South Africa", "Africa"],
  ["amc.org.br", "Brazilian Society of Cardiology", "medical_society", "Brazil", "Latin America"],
];

/** Research institutes and funders, which convene as often as they fund. */
const RESEARCH_INSTITUTES: Seed[] = [
  ["mpg.de", "Max Planck Society", "research_institute", "Germany", "Europe"],
  ["fraunhofer.de", "Fraunhofer-Gesellschaft", "research_institute", "Germany", "Europe"],
  ["helmholtz.de", "Helmholtz Association", "research_institute", "Germany", "Europe"],
  ["cnrs.fr", "French National Centre for Scientific Research", "research_institute", "France", "Europe"],
  ["inria.fr", "Inria", "research_institute", "France", "Europe"],
  ["csic.es", "Spanish National Research Council", "research_institute", "Spain", "Europe"],
  ["cnr.it", "National Research Council of Italy", "research_institute", "Italy", "Europe"],
  ["tno.nl", "TNO", "research_institute", "Netherlands", "Europe"],
  ["vtt.fi", "VTT Technical Research Centre of Finland", "research_institute", "Finland", "Europe"],
  ["sintef.no", "SINTEF", "research_institute", "Norway", "Europe"],
  ["ri.se", "RISE Research Institutes of Sweden", "research_institute", "Sweden", "Europe"],
  ["embl.org", "European Molecular Biology Laboratory", "research_institute", "Germany", "Europe"],
  ["riken.jp", "RIKEN", "research_institute", "Japan", "Asia"],
  ["jst.go.jp", "Japan Science and Technology Agency", "government", "Japan", "Asia"],
  ["cas.cn", "Chinese Academy of Sciences", "research_institute", "China", "Asia"],
  ["csir.res.in", "Council of Scientific and Industrial Research", "research_institute", "India", "Asia"],
  ["kacst.gov.sa", "King Abdulaziz City for Science and Technology", "government", "Saudi Arabia", "Middle East"],
  ["csiro.au", "CSIRO", "research_institute", "Australia", "Oceania"],
  ["ansto.gov.au", "Australian Nuclear Science and Technology Organisation", "government", "Australia", "Oceania"],
  ["nrf.ac.za", "National Research Foundation of South Africa", "government", "South Africa", "Africa"],
  ["conicet.gov.ar", "CONICET", "research_institute", "Argentina", "Latin America"],
  ["nsf.gov", "National Science Foundation", "government", "United States", "North America"],
  ["nih.gov", "National Institutes of Health", "government", "United States", "North America"],
  ["nist.gov", "National Institute of Standards and Technology", "government", "United States", "North America"],
  ["nasa.gov", "NASA", "government", "United States", "North America"],
  ["noaa.gov", "National Oceanic and Atmospheric Administration", "government", "United States", "North America"],
  ["energy.gov", "United States Department of Energy", "government", "United States", "North America"],
  ["nationalacademies.org", "National Academies of Sciences, Engineering and Medicine", "scientific_organization", "United States", "North America"],
  ["aaas.org", "American Association for the Advancement of Science", "scientific_organization", "United States", "North America"],
  ["royalsociety.org", "The Royal Society", "scientific_organization", "United Kingdom", "Europe"],
  ["leopoldina.org", "German National Academy of Sciences Leopoldina", "scientific_organization", "Germany", "Europe"],
];

/** Universities that host large international conferences, chosen for global spread. */
const UNIVERSITIES: Seed[] = [
  ["mit.edu", "Massachusetts Institute of Technology", "university", "United States", "North America"],
  ["stanford.edu", "Stanford University", "university", "United States", "North America"],
  ["berkeley.edu", "University of California, Berkeley", "university", "United States", "North America"],
  ["caltech.edu", "California Institute of Technology", "university", "United States", "North America"],
  ["utexas.edu", "University of Texas at Austin", "university", "United States", "North America"],
  ["tamu.edu", "Texas A&M University", "university", "United States", "North America"],
  ["utoronto.ca", "University of Toronto", "university", "Canada", "North America"],
  ["ubc.ca", "University of British Columbia", "university", "Canada", "North America"],
  ["mcgill.ca", "McGill University", "university", "Canada", "North America"],
  ["ox.ac.uk", "University of Oxford", "university", "United Kingdom", "Europe"],
  ["cam.ac.uk", "University of Cambridge", "university", "United Kingdom", "Europe"],
  ["imperial.ac.uk", "Imperial College London", "university", "United Kingdom", "Europe"],
  ["ethz.ch", "ETH Zurich", "university", "Switzerland", "Europe"],
  ["epfl.ch", "EPFL", "university", "Switzerland", "Europe"],
  ["tudelft.nl", "Delft University of Technology", "university", "Netherlands", "Europe"],
  ["kth.se", "KTH Royal Institute of Technology", "university", "Sweden", "Europe"],
  ["dtu.dk", "Technical University of Denmark", "university", "Denmark", "Europe"],
  ["ntnu.edu", "Norwegian University of Science and Technology", "university", "Norway", "Europe"],
  ["tum.de", "Technical University of Munich", "university", "Germany", "Europe"],
  ["rwth-aachen.de", "RWTH Aachen University", "university", "Germany", "Europe"],
  ["polimi.it", "Politecnico di Milano", "university", "Italy", "Europe"],
  ["upm.es", "Universidad Politécnica de Madrid", "university", "Spain", "Europe"],
  ["kaust.edu.sa", "King Abdullah University of Science and Technology", "university", "Saudi Arabia", "Middle East"],
  ["kfupm.edu.sa", "King Fahd University of Petroleum and Minerals", "university", "Saudi Arabia", "Middle East"],
  ["ku.ac.ae", "Khalifa University", "university", "United Arab Emirates", "Middle East"],
  ["aus.edu", "American University of Sharjah", "university", "United Arab Emirates", "Middle East"],
  ["qu.edu.qa", "Qatar University", "university", "Qatar", "Middle East"],
  ["aucegypt.edu", "American University in Cairo", "university", "Egypt", "Africa"],
  ["metu.edu.tr", "Middle East Technical University", "university", "Turkey", "Middle East"],
  ["technion.ac.il", "Technion Israel Institute of Technology", "university", "Israel", "Middle East"],
  ["nus.edu.sg", "National University of Singapore", "university", "Singapore", "Asia"],
  ["ntu.edu.sg", "Nanyang Technological University", "university", "Singapore", "Asia"],
  ["kaist.ac.kr", "KAIST", "university", "South Korea", "Asia"],
  ["snu.ac.kr", "Seoul National University", "university", "South Korea", "Asia"],
  ["u-tokyo.ac.jp", "University of Tokyo", "university", "Japan", "Asia"],
  ["kyoto-u.ac.jp", "Kyoto University", "university", "Japan", "Asia"],
  ["tsinghua.edu.cn", "Tsinghua University", "university", "China", "Asia"],
  ["pku.edu.cn", "Peking University", "university", "China", "Asia"],
  ["hku.hk", "University of Hong Kong", "university", "Hong Kong", "Asia"],
  ["iisc.ac.in", "Indian Institute of Science", "university", "India", "Asia"],
  ["iitb.ac.in", "Indian Institute of Technology Bombay", "university", "India", "Asia"],
  ["iitd.ac.in", "Indian Institute of Technology Delhi", "university", "India", "Asia"],
  ["unimelb.edu.au", "University of Melbourne", "university", "Australia", "Oceania"],
  ["sydney.edu.au", "University of Sydney", "university", "Australia", "Oceania"],
  ["anu.edu.au", "Australian National University", "university", "Australia", "Oceania"],
  ["auckland.ac.nz", "University of Auckland", "university", "New Zealand", "Oceania"],
  ["uct.ac.za", "University of Cape Town", "university", "South Africa", "Africa"],
  ["wits.ac.za", "University of the Witwatersrand", "university", "South Africa", "Africa"],
  ["up.ac.za", "University of Pretoria", "university", "South Africa", "Africa"],
  ["ui.edu.ng", "University of Ibadan", "university", "Nigeria", "Africa"],
  ["uonbi.ac.ke", "University of Nairobi", "university", "Kenya", "Africa"],
  ["usp.br", "Universidade de São Paulo", "university", "Brazil", "Latin America"],
  ["unicamp.br", "Universidade Estadual de Campinas", "university", "Brazil", "Latin America"],
  ["unam.mx", "Universidad Nacional Autónoma de México", "university", "Mexico", "Latin America"],
  ["tec.mx", "Tecnológico de Monterrey", "university", "Mexico", "Latin America"],
  ["uchile.cl", "Universidad de Chile", "university", "Chile", "Latin America"],
  ["uba.ar", "Universidad de Buenos Aires", "university", "Argentina", "Latin America"],
  ["unal.edu.co", "Universidad Nacional de Colombia", "university", "Colombia", "Latin America"],
];

const ALL: Seed[] = [
  ...GEOSCIENCE_AND_ENERGY, ...ENGINEERING, ...COMPUTING, ...PHYSICAL_SCIENCES,
  ...MEDICAL_AND_LIFE_SCIENCES, ...RESEARCH_INSTITUTES, ...UNIVERSITIES,
];

export const SEED_DOMAINS: DomainInput[] = ALL.map(([domain, sourceName, sourceType, country, region]) => ({
  domain, sourceName, sourceType, country, region,
  // Weekly is often enough: a society announces next year's meeting once, not hourly. The
  // scheduler spreads domains out anyway, and robots.txt Crawl-delay still overrides downwards.
  crawlFrequencyHours: 168,
  notes: `${sourceName} — authoritative conference announcements.`,
}));

/** Registry composition, for the report a harvest prints and for tests to assert against. */
export function seedBreakdown(): { total: number; byRegion: Record<string, number>; byType: Record<string, number> } {
  const byRegion: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const seed of SEED_DOMAINS) {
    byRegion[String(seed.region)] = (byRegion[String(seed.region)] || 0) + 1;
    byType[seed.sourceType] = (byType[seed.sourceType] || 0) + 1;
  }
  return { total: SEED_DOMAINS.length, byRegion, byType };
}
