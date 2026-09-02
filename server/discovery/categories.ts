// Category classification onto Conference Gate's EXISTING taxonomy.
//
// The platform already has one: `Conference.industry` — a single label from the set below, used
// on every conference in the catalogue — plus free-text `topics`. This does not invent a second,
// competing taxonomy (section 15). It maps a discovered conference onto the labels already in
// use, and keeps the words that justified each match so a classification is never a bare
// assertion.
//
// The taxonomy is data, not structure: a new label is one entry in CATEGORY_RULES. The engine's
// storage, matching and reporting are unchanged by adding one.

export interface CategoryRule {
  /** The existing Conference Gate industry label. */
  category: string;
  /** Terms that indicate this category. Matched as whole words, case-insensitively. */
  terms: string[];
  /** Terms that would otherwise match but mean something else here. */
  negativeTerms?: string[];
}

/**
 * The first fifteen labels are exactly the industries already present in the catalogue; the rest
 * extend it to the subject areas section 2 names, in the same "Field & Field" style so a new
 * label sits beside the existing ones rather than looking foreign.
 */
export const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Artificial Intelligence & Machine Learning",
    terms: [
      "artificial intelligence", "machine learning", "deep learning", "neural network", "generative ai",
      "large language model", "llm", "computer vision", "natural language processing", "nlp",
      "reinforcement learning", "agentic", "foundation model", "data mining", "pattern recognition",
    ],
  },
  {
    category: "Technology & Consumer Electronics",
    terms: [
      "software engineering", "computer science", "computing", "information technology", "cloud computing",
      "consumer electronics", "semiconductor", "internet of things", "iot", "quantum computing",
      "human-computer interaction", "distributed systems", "devops", "open source",
    ],
  },
  {
    category: "Cybersecurity & Privacy",
    terms: [
      "cybersecurity", "cyber security", "information security", "infosec", "network security",
      "cryptography", "privacy", "penetration testing", "threat intelligence", "zero trust",
      "security operations", "malware", "incident response",
    ],
  },
  {
    category: "Data Science & Analytics",
    terms: [
      "data science", "big data", "analytics", "data engineering", "business intelligence",
      "statistics", "statistical", "visualization", "data warehouse", "predictive modeling",
    ],
  },
  {
    category: "Engineering",
    terms: [
      "mechanical engineering", "civil engineering", "electrical engineering", "structural engineering",
      "industrial engineering", "systems engineering", "control systems", "mechatronics",
      "engineering design", "applied mechanics", "engineering education",
    ],
  },
  {
    category: "Robotics & Automation",
    terms: ["robotics", "autonomous systems", "automation", "unmanned", "drone", "uav", "humanoid", "actuator"],
  },
  {
    category: "Manufacturing & Industry",
    terms: [
      "manufacturing", "additive manufacturing", "industry 4.0", "production engineering",
      "supply chain", "lean manufacturing", "machining", "welding", "metrology",
    ],
  },
  {
    category: "Automotive & Mobility",
    terms: ["automotive", "vehicle", "electric vehicle", "mobility", "autonomous driving", "powertrain", "transport engineering"],
  },
  {
    category: "Aerospace & Aviation",
    terms: ["aerospace", "aeronautic", "astronautic", "aviation", "space mission", "satellite", "propulsion", "flight test"],
  },
  {
    category: "Energy & Geosciences",
    terms: [
      "energy transition", "power systems", "smart grid", "energy policy", "energy storage",
      "hydrogen", "nuclear energy", "geothermal", "energy efficiency", "electricity market",
    ],
  },
  {
    category: "Renewable Energy",
    terms: ["renewable energy", "solar", "photovoltaic", "wind energy", "wind power", "bioenergy", "biofuel", "clean energy"],
  },
  {
    category: "Petroleum & Energy",
    terms: [
      "petroleum", "oil and gas", "oil & gas", "upstream", "downstream", "reservoir", "drilling",
      "well logging", "hydrocarbon", "refinery", "lng", "offshore engineering", "subsea",
    ],
  },
  {
    category: "Geosciences & Earth Systems",
    terms: [
      "geoscience", "geology", "geophysics", "seismology", "earth science", "hydrology",
      "volcanology", "tectonic", "stratigraphy", "geochemistry", "remote sensing", "geodesy",
    ],
  },
  {
    category: "Mining & Metallurgy",
    terms: ["mining", "mineral processing", "metallurgy", "ore", "quarry", "extractive industry", "beneficiation"],
  },
  {
    category: "Marine & Ocean Sciences",
    terms: ["oceanography", "marine science", "marine biology", "maritime", "coastal engineering", "fisheries", "aquaculture"],
  },
  {
    category: "Environment & Sustainability",
    terms: [
      "sustainability", "climate change", "climate policy", "environmental science", "carbon capture",
      "net zero", "emissions", "circular economy", "biodiversity", "conservation", "pollution",
      "waste management", "ecology",
    ],
  },
  {
    category: "Agriculture & Food",
    terms: [
      "agriculture", "agronomy", "crop science", "soil science", "horticulture", "food science",
      "food security", "agri-food", "livestock", "plant breeding", "irrigation", "nutrition science",
    ],
  },
  {
    category: "Healthcare & Health IT",
    terms: [
      "digital health", "health informatics", "health it", "telemedicine", "telehealth",
      "healthcare interoperability", "electronic health record", "ehr", "public health",
      "health systems", "nursing", "patient safety", "healthcare management",
    ],
  },
  {
    category: "Medicine & Oncology",
    terms: [
      "oncology", "cancer", "clinical trial", "cardiology", "neurology", "surgery", "radiology",
      "paediatric", "pediatric", "immunology", "psychiatry", "dermatology", "anaesthesia",
      "anesthesia", "internal medicine", "orthopaedic", "orthopedic", "medical imaging", "diagnosis",
    ],
  },
  {
    category: "Pharmaceutical & Biotechnology",
    terms: [
      "pharmaceutical", "pharmacology", "drug discovery", "drug development", "biotechnology",
      "biopharma", "clinical pharmacology", "vaccine", "regulatory affairs", "gmp", "bioprocess",
    ],
  },
  {
    category: "Life Sciences",
    terms: ["biology", "genomics", "molecular biology", "biochemistry", "microbiology", "neuroscience", "bioinformatics", "cell biology", "proteomics"],
  },
  {
    category: "Chemistry & Materials",
    terms: [
      "chemistry", "chemical engineering", "materials science", "polymer", "catalysis",
      "nanomaterial", "nanotechnology", "composites", "corrosion", "electrochemistry", "crystallography",
    ],
  },
  {
    category: "Physics & Astronomy",
    terms: ["physics", "astronomy", "astrophysics", "particle physics", "optics", "photonics", "condensed matter", "plasma", "quantum mechanics"],
  },
  {
    category: "Business & Finance",
    terms: [
      "business", "management", "finance", "economics", "accounting", "banking", "investment",
      "marketing", "entrepreneurship", "strategy", "human resources", "corporate governance",
      "financial technology", "risk management",
    ],
  },
  {
    category: "Blockchain & Fintech",
    terms: ["blockchain", "distributed ledger", "smart contract", "fintech", "digital asset", "cryptocurrency", "web3", "tokenization", "payments"],
  },
  {
    category: "Telecommunications & Networking",
    terms: ["telecommunication", "wireless", "5g", "6g", "networking", "antenna", "spectrum", "satellite communication", "optical network"],
  },
  {
    category: "Logistics & Transportation",
    terms: ["logistics", "transportation", "freight", "shipping", "port", "rail", "traffic engineering", "urban mobility", "warehousing"],
  },
  {
    category: "Architecture & Construction",
    terms: ["architecture", "construction", "built environment", "urban planning", "building information modeling", "bim", "structural design", "smart city", "real estate development"],
  },
  {
    category: "Education & EdTech",
    terms: ["education", "edtech", "e-learning", "pedagogy", "curriculum", "teaching", "higher education", "vocational training", "learning analytics", "assessment"],
  },
  {
    category: "Law & Policy",
    terms: ["law", "legal", "jurisprudence", "human rights", "regulation", "policy", "governance", "arbitration", "intellectual property", "compliance"],
  },
  {
    category: "Social Sciences",
    terms: ["sociology", "psychology", "anthropology", "political science", "social policy", "demography", "gender studies", "criminology", "development studies"],
  },
  {
    category: "Arts & Humanities",
    terms: ["humanities", "literature", "philosophy", "history", "linguistics", "cultural studies", "musicology", "archaeology", "religious studies", "translation studies"],
  },
  {
    category: "Tourism & Hospitality",
    terms: ["tourism", "hospitality", "hotel management", "travel industry", "destination management", "event management", "leisure"],
  },
];

/** Words too generic to distinguish anything on their own; they need company to count. */
const WEAK_TERMS = new Set(["policy", "management", "business", "education", "law", "physics", "chemistry", "biology", "history"]);

function wholeWordRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
}

const COMPILED = CATEGORY_RULES.map((rule) => ({
  category: rule.category,
  terms: rule.terms.map((term) => ({ term, re: wholeWordRegex(term) })),
  negatives: (rule.negativeTerms || []).map((term) => wholeWordRegex(term)),
}));

export interface CategoryInput {
  title: string | null;
  description: string | null;
  topics: string[];
  organizer: string | null;
  /** Page text, used at a lower weight than the title. */
  pageText?: string;
}

export interface CategoryResult {
  category: string;
  confidence: number;
  evidence: string[];
}

/**
 * Assigns categories, most confident first.
 *
 * A term in the title counts for much more than the same term buried in body text, because a
 * conference's own name is the most deliberate statement it makes about its subject. Multiple
 * categories are normal and expected — "AI in Medical Imaging" is genuinely both.
 */
export function classifyCategories(input: CategoryInput, limit = 4): CategoryResult[] {
  const title = (input.title || "").toLowerCase();
  const topics = input.topics.join(" ").toLowerCase();
  const description = (input.description || "").toLowerCase();
  const organizer = (input.organizer || "").toLowerCase();
  const body = (input.pageText || "").slice(0, 12000).toLowerCase();

  const results: CategoryResult[] = [];

  for (const rule of COMPILED) {
    if (rule.negatives.some((re) => re.test(title) || re.test(description))) continue;

    let score = 0;
    const evidence: string[] = [];
    let strongHit = false;

    for (const { term, re } of rule.terms) {
      const weak = WEAK_TERMS.has(term);
      let hit = 0;
      if (re.test(title)) hit = weak ? 0.25 : 0.5;
      else if (re.test(topics)) hit = weak ? 0.2 : 0.35;
      else if (re.test(description)) hit = weak ? 0.08 : 0.2;
      else if (re.test(organizer)) hit = weak ? 0.05 : 0.15;
      else if (body && re.test(body)) hit = weak ? 0.02 : 0.07;
      if (hit === 0) continue;
      if (!weak) strongHit = true;
      score += hit;
      if (evidence.length < 6) evidence.push(term);
    }

    // A category resting only on a generic word like "management" is not a classification.
    if (!strongHit) continue;
    if (score < 0.15) continue;
    results.push({ category: rule.category, confidence: Math.min(1, Number(score.toFixed(3))), evidence });
  }

  return results.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/** The single label that best fits, for the platform's one-industry-per-conference field. */
export function primaryCategory(results: CategoryResult[]): string | null {
  return results.length > 0 ? results[0].category : null;
}

/** Every label the taxonomy currently offers — used by the metrics report. */
export function allCategories(): string[] {
  return CATEGORY_RULES.map((rule) => rule.category);
}
