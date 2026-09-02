// The Phase 1 seed registry.
//
// Ten independent, publicly reachable domains of deliberately different kinds and regions, so the
// first run proves the engine works across source types rather than proving one directory's HTML
// can be parsed. Nothing about the engine depends on this list: it is data, editable through the
// admin API or the CLI, and a domain removed from here changes nothing but which rows get seeded.
//
// Regional spread is intentional (section 49): North America, Europe, Middle East, Asia, Oceania,
// Africa and South America are all represented among the organisations below, either by their
// head office or by the conferences they run.
//
// A seeded domain is a *candidate*, not a permission slip. The engine still reads each site's
// robots.txt first and skips any domain that asks not to be crawled.

import type { DomainInput } from "./sourceRegistry";

export const SEED_DOMAINS: DomainInput[] = [
  {
    domain: "acm.org",
    sourceName: "Association for Computing Machinery",
    sourceType: "professional_society",
    country: "United States",
    region: "North America",
    crawlFrequencyHours: 168,
    notes: "Computing conferences worldwide; publishes a conference calendar.",
  },
  {
    domain: "asme.org",
    sourceName: "American Society of Mechanical Engineers",
    sourceType: "engineering_society",
    country: "United States",
    region: "North America",
    crawlFrequencyHours: 168,
    notes: "Mechanical, manufacturing and energy engineering events.",
  },
  {
    domain: "egu.eu",
    sourceName: "European Geosciences Union",
    sourceType: "scientific_organization",
    country: "Germany",
    region: "Europe",
    crawlFrequencyHours: 168,
    notes: "Geoscience assemblies and topical meetings across Europe.",
  },
  {
    domain: "esmo.org",
    sourceName: "European Society for Medical Oncology",
    sourceType: "medical_society",
    country: "Switzerland",
    region: "Europe",
    crawlFrequencyHours: 168,
    notes: "Medical congresses; strong structured data on event pages.",
  },
  {
    domain: "springer.com",
    sourceName: "Springer Nature",
    sourceType: "publisher",
    country: "Germany",
    region: "Europe",
    crawlFrequencyHours: 336,
    notes: "Conference proceedings and associated event pages across every discipline.",
  },
  {
    domain: "kaust.edu.sa",
    sourceName: "King Abdullah University of Science and Technology",
    sourceType: "university",
    country: "Saudi Arabia",
    region: "Middle East",
    crawlFrequencyHours: 168,
    notes: "Middle East research university with a public events calendar.",
  },
  {
    domain: "nus.edu.sg",
    sourceName: "National University of Singapore",
    sourceType: "university",
    country: "Singapore",
    region: "Asia",
    crawlFrequencyHours: 168,
    notes: "Asia-Pacific academic conferences and symposia.",
  },
  {
    domain: "csiro.au",
    sourceName: "CSIRO",
    sourceType: "research_institute",
    country: "Australia",
    region: "Oceania",
    crawlFrequencyHours: 336,
    notes: "Australia's national science agency; workshops and scientific meetings.",
  },
  {
    domain: "uct.ac.za",
    sourceName: "University of Cape Town",
    sourceType: "university",
    country: "South Africa",
    region: "Africa",
    crawlFrequencyHours: 336,
    notes: "African academic conferences, seminars and symposia.",
  },
  {
    domain: "usp.br",
    sourceName: "Universidade de São Paulo",
    sourceType: "university",
    country: "Brazil",
    region: "South America",
    crawlFrequencyHours: 336,
    notes: "South American academic events; pages are frequently in Portuguese.",
  },
];
