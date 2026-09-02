// Country normalization.
//
// "USA", "U.S.", "United States of America" and "US" all name one place, and Conference Gate
// already has a spelling for it — the one its own location filters use ("United States", "United
// Kingdom", "United Arab Emirates", "South Korea", "Czechia"). Those spellings are the canonical
// forms here, so a discovered conference lands in the same bucket as one an organiser created.
//
// The raw location string is never modified by any of this; it is preserved separately for
// auditing (section 14). A name that cannot be resolved leaves `country` null rather than being
// guessed at.

export interface CountryRecord {
  /** The spelling Conference Gate uses. */
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  aliases: string[];
}

// Ordered by nothing in particular; lookups are by index built below.
export const COUNTRIES: CountryRecord[] = [
  { name: "Afghanistan", iso2: "AF", iso3: "AFG", region: "Asia", aliases: [] },
  { name: "Albania", iso2: "AL", iso3: "ALB", region: "Europe", aliases: [] },
  { name: "Algeria", iso2: "DZ", iso3: "DZA", region: "Africa", aliases: [] },
  { name: "Argentina", iso2: "AR", iso3: "ARG", region: "South America", aliases: [] },
  { name: "Armenia", iso2: "AM", iso3: "ARM", region: "Asia", aliases: [] },
  { name: "Australia", iso2: "AU", iso3: "AUS", region: "Oceania", aliases: [] },
  { name: "Austria", iso2: "AT", iso3: "AUT", region: "Europe", aliases: ["österreich", "osterreich"] },
  { name: "Azerbaijan", iso2: "AZ", iso3: "AZE", region: "Asia", aliases: [] },
  { name: "Bahrain", iso2: "BH", iso3: "BHR", region: "Middle East", aliases: [] },
  { name: "Bangladesh", iso2: "BD", iso3: "BGD", region: "Asia", aliases: [] },
  { name: "Belarus", iso2: "BY", iso3: "BLR", region: "Europe", aliases: [] },
  { name: "Belgium", iso2: "BE", iso3: "BEL", region: "Europe", aliases: ["belgique", "belgië", "belgie"] },
  { name: "Bolivia", iso2: "BO", iso3: "BOL", region: "South America", aliases: [] },
  { name: "Bosnia and Herzegovina", iso2: "BA", iso3: "BIH", region: "Europe", aliases: ["bosnia"] },
  { name: "Botswana", iso2: "BW", iso3: "BWA", region: "Africa", aliases: [] },
  { name: "Brazil", iso2: "BR", iso3: "BRA", region: "South America", aliases: ["brasil"] },
  { name: "Brunei", iso2: "BN", iso3: "BRN", region: "Asia", aliases: ["brunei darussalam"] },
  { name: "Bulgaria", iso2: "BG", iso3: "BGR", region: "Europe", aliases: [] },
  { name: "Cambodia", iso2: "KH", iso3: "KHM", region: "Asia", aliases: [] },
  { name: "Cameroon", iso2: "CM", iso3: "CMR", region: "Africa", aliases: [] },
  { name: "Canada", iso2: "CA", iso3: "CAN", region: "North America", aliases: [] },
  { name: "Chile", iso2: "CL", iso3: "CHL", region: "South America", aliases: [] },
  { name: "China", iso2: "CN", iso3: "CHN", region: "Asia", aliases: ["people's republic of china", "prc", "mainland china"] },
  { name: "Colombia", iso2: "CO", iso3: "COL", region: "South America", aliases: [] },
  { name: "Costa Rica", iso2: "CR", iso3: "CRI", region: "North America", aliases: [] },
  { name: "Croatia", iso2: "HR", iso3: "HRV", region: "Europe", aliases: ["hrvatska"] },
  { name: "Cuba", iso2: "CU", iso3: "CUB", region: "North America", aliases: [] },
  { name: "Cyprus", iso2: "CY", iso3: "CYP", region: "Europe", aliases: [] },
  { name: "Czechia", iso2: "CZ", iso3: "CZE", region: "Europe", aliases: ["czech republic", "česká republika", "ceska republika"] },
  { name: "Denmark", iso2: "DK", iso3: "DNK", region: "Europe", aliases: ["danmark"] },
  { name: "Ecuador", iso2: "EC", iso3: "ECU", region: "South America", aliases: [] },
  { name: "Egypt", iso2: "EG", iso3: "EGY", region: "Africa", aliases: ["arab republic of egypt"] },
  { name: "Estonia", iso2: "EE", iso3: "EST", region: "Europe", aliases: ["eesti"] },
  { name: "Ethiopia", iso2: "ET", iso3: "ETH", region: "Africa", aliases: [] },
  { name: "Finland", iso2: "FI", iso3: "FIN", region: "Europe", aliases: ["suomi"] },
  { name: "France", iso2: "FR", iso3: "FRA", region: "Europe", aliases: [] },
  { name: "Georgia", iso2: "GE", iso3: "GEO", region: "Asia", aliases: [] },
  { name: "Germany", iso2: "DE", iso3: "DEU", region: "Europe", aliases: ["deutschland", "federal republic of germany", "brd"] },
  { name: "Ghana", iso2: "GH", iso3: "GHA", region: "Africa", aliases: [] },
  { name: "Greece", iso2: "GR", iso3: "GRC", region: "Europe", aliases: ["hellas", "ελλάδα"] },
  { name: "Hong Kong", iso2: "HK", iso3: "HKG", region: "Asia", aliases: ["hong kong sar", "hong kong s.a.r."] },
  { name: "Hungary", iso2: "HU", iso3: "HUN", region: "Europe", aliases: ["magyarország", "magyarorszag"] },
  { name: "Iceland", iso2: "IS", iso3: "ISL", region: "Europe", aliases: ["ísland"] },
  { name: "India", iso2: "IN", iso3: "IND", region: "Asia", aliases: ["bharat", "republic of india"] },
  { name: "Indonesia", iso2: "ID", iso3: "IDN", region: "Asia", aliases: [] },
  { name: "Iran", iso2: "IR", iso3: "IRN", region: "Middle East", aliases: ["islamic republic of iran"] },
  { name: "Iraq", iso2: "IQ", iso3: "IRQ", region: "Middle East", aliases: [] },
  { name: "Ireland", iso2: "IE", iso3: "IRL", region: "Europe", aliases: ["republic of ireland", "éire", "eire"] },
  { name: "Israel", iso2: "IL", iso3: "ISR", region: "Middle East", aliases: [] },
  { name: "Italy", iso2: "IT", iso3: "ITA", region: "Europe", aliases: ["italia"] },
  { name: "Japan", iso2: "JP", iso3: "JPN", region: "Asia", aliases: ["nippon", "nihon", "日本"] },
  { name: "Jordan", iso2: "JO", iso3: "JOR", region: "Middle East", aliases: ["hashemite kingdom of jordan"] },
  { name: "Kazakhstan", iso2: "KZ", iso3: "KAZ", region: "Asia", aliases: [] },
  { name: "Kenya", iso2: "KE", iso3: "KEN", region: "Africa", aliases: [] },
  { name: "Kuwait", iso2: "KW", iso3: "KWT", region: "Middle East", aliases: [] },
  { name: "Latvia", iso2: "LV", iso3: "LVA", region: "Europe", aliases: [] },
  { name: "Lebanon", iso2: "LB", iso3: "LBN", region: "Middle East", aliases: [] },
  { name: "Lithuania", iso2: "LT", iso3: "LTU", region: "Europe", aliases: [] },
  { name: "Luxembourg", iso2: "LU", iso3: "LUX", region: "Europe", aliases: [] },
  { name: "Malaysia", iso2: "MY", iso3: "MYS", region: "Asia", aliases: [] },
  { name: "Malta", iso2: "MT", iso3: "MLT", region: "Europe", aliases: [] },
  { name: "Mexico", iso2: "MX", iso3: "MEX", region: "North America", aliases: ["méxico", "estados unidos mexicanos"] },
  { name: "Morocco", iso2: "MA", iso3: "MAR", region: "Africa", aliases: ["maroc"] },
  { name: "Mozambique", iso2: "MZ", iso3: "MOZ", region: "Africa", aliases: [] },
  { name: "Nepal", iso2: "NP", iso3: "NPL", region: "Asia", aliases: [] },
  { name: "Netherlands", iso2: "NL", iso3: "NLD", region: "Europe", aliases: ["the netherlands", "holland", "nederland"] },
  { name: "New Zealand", iso2: "NZ", iso3: "NZL", region: "Oceania", aliases: ["aotearoa"] },
  { name: "Nigeria", iso2: "NG", iso3: "NGA", region: "Africa", aliases: [] },
  { name: "Norway", iso2: "NO", iso3: "NOR", region: "Europe", aliases: ["norge"] },
  { name: "Oman", iso2: "OM", iso3: "OMN", region: "Middle East", aliases: ["sultanate of oman"] },
  { name: "Pakistan", iso2: "PK", iso3: "PAK", region: "Asia", aliases: [] },
  { name: "Panama", iso2: "PA", iso3: "PAN", region: "North America", aliases: [] },
  { name: "Peru", iso2: "PE", iso3: "PER", region: "South America", aliases: ["perú"] },
  { name: "Philippines", iso2: "PH", iso3: "PHL", region: "Asia", aliases: ["the philippines"] },
  { name: "Poland", iso2: "PL", iso3: "POL", region: "Europe", aliases: ["polska"] },
  { name: "Portugal", iso2: "PT", iso3: "PRT", region: "Europe", aliases: [] },
  { name: "Qatar", iso2: "QA", iso3: "QAT", region: "Middle East", aliases: [] },
  { name: "Romania", iso2: "RO", iso3: "ROU", region: "Europe", aliases: ["românia"] },
  { name: "Russia", iso2: "RU", iso3: "RUS", region: "Europe", aliases: ["russian federation"] },
  { name: "Rwanda", iso2: "RW", iso3: "RWA", region: "Africa", aliases: [] },
  { name: "Saudi Arabia", iso2: "SA", iso3: "SAU", region: "Middle East", aliases: ["ksa", "kingdom of saudi arabia"] },
  { name: "Senegal", iso2: "SN", iso3: "SEN", region: "Africa", aliases: [] },
  { name: "Serbia", iso2: "RS", iso3: "SRB", region: "Europe", aliases: [] },
  { name: "Singapore", iso2: "SG", iso3: "SGP", region: "Asia", aliases: [] },
  { name: "Slovakia", iso2: "SK", iso3: "SVK", region: "Europe", aliases: ["slovak republic"] },
  { name: "Slovenia", iso2: "SI", iso3: "SVN", region: "Europe", aliases: [] },
  { name: "South Africa", iso2: "ZA", iso3: "ZAF", region: "Africa", aliases: ["rsa", "republic of south africa"] },
  { name: "South Korea", iso2: "KR", iso3: "KOR", region: "Asia", aliases: ["korea", "republic of korea", "korea, republic of", "korea (south)", "대한민국"] },
  { name: "Spain", iso2: "ES", iso3: "ESP", region: "Europe", aliases: ["españa", "espana"] },
  { name: "Sri Lanka", iso2: "LK", iso3: "LKA", region: "Asia", aliases: [] },
  { name: "Sweden", iso2: "SE", iso3: "SWE", region: "Europe", aliases: ["sverige"] },
  { name: "Switzerland", iso2: "CH", iso3: "CHE", region: "Europe", aliases: ["suisse", "schweiz", "svizzera", "confoederatio helvetica"] },
  { name: "Taiwan", iso2: "TW", iso3: "TWN", region: "Asia", aliases: ["chinese taipei", "taiwan, province of china"] },
  { name: "Tanzania", iso2: "TZ", iso3: "TZA", region: "Africa", aliases: ["united republic of tanzania"] },
  { name: "Thailand", iso2: "TH", iso3: "THA", region: "Asia", aliases: [] },
  { name: "Tunisia", iso2: "TN", iso3: "TUN", region: "Africa", aliases: ["tunisie"] },
  { name: "Turkey", iso2: "TR", iso3: "TUR", region: "Europe", aliases: ["türkiye", "turkiye", "republic of türkiye"] },
  { name: "Uganda", iso2: "UG", iso3: "UGA", region: "Africa", aliases: [] },
  { name: "Ukraine", iso2: "UA", iso3: "UKR", region: "Europe", aliases: [] },
  {
    name: "United Arab Emirates",
    iso2: "AE",
    iso3: "ARE",
    region: "Middle East",
    aliases: ["uae", "u.a.e.", "emirates", "the emirates"],
  },
  {
    name: "United Kingdom",
    iso2: "GB",
    iso3: "GBR",
    region: "Europe",
    aliases: [
      "uk", "u.k.", "great britain", "britain", "england", "scotland", "wales",
      "northern ireland", "united kingdom of great britain and northern ireland",
    ],
  },
  {
    name: "United States",
    iso2: "US",
    iso3: "USA",
    region: "North America",
    aliases: [
      "usa", "u.s.", "u.s.a.", "us", "united states of america", "america",
      "the united states", "the us", "u s a",
    ],
  },
  { name: "Uruguay", iso2: "UY", iso3: "URY", region: "South America", aliases: [] },
  { name: "Uzbekistan", iso2: "UZ", iso3: "UZB", region: "Asia", aliases: [] },
  { name: "Venezuela", iso2: "VE", iso3: "VEN", region: "South America", aliases: [] },
  { name: "Vietnam", iso2: "VN", iso3: "VNM", region: "Asia", aliases: ["viet nam", "socialist republic of vietnam"] },
  { name: "Zambia", iso2: "ZM", iso3: "ZMB", region: "Africa", aliases: [] },
  { name: "Zimbabwe", iso2: "ZW", iso3: "ZWE", region: "Africa", aliases: [] },
];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX = new Map<string, CountryRecord>();
for (const country of COUNTRIES) {
  INDEX.set(normalizeKey(country.name), country);
  INDEX.set(normalizeKey(country.iso2), country);
  INDEX.set(normalizeKey(country.iso3), country);
  for (const alias of country.aliases) INDEX.set(normalizeKey(alias), country);
}

/**
 * Resolves a country name, code or alias to Conference Gate's own spelling.
 *
 * Two-letter tokens are only accepted when they are an exact ISO code, because plenty of ordinary
 * words ("in", "at") would otherwise resolve to a country. Anything unrecognised returns null —
 * an unknown country is recorded as unknown, never as the nearest-looking guess.
 */
export function normalizeCountry(value: string | null | undefined): CountryRecord | null {
  if (!value || typeof value !== "string") return null;
  const key = normalizeKey(value);
  if (!key || key.length < 2) return null;
  return INDEX.get(key) ?? null;
}

/** Finds a country named anywhere inside a longer location string ("Doha, Qatar"). */
export function findCountryInText(text: string | null | undefined): CountryRecord | null {
  if (!text) return null;
  const normalized = normalizeKey(text);

  // Comma-separated tails first: "Barcelona, Spain" almost always ends with the country.
  const parts = text.split(/[,،|/•·]/).map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const match = normalizeCountry(parts[i]);
    if (match) return match;
  }

  // Otherwise look for any country name as a whole-word substring, longest name first so
  // "United States" is preferred over a shorter accidental match.
  const byLength = [...COUNTRIES].sort((a, b) => b.name.length - a.name.length);
  for (const country of byLength) {
    const names = [country.name, ...country.aliases].filter((name) => name.length > 3);
    for (const name of names) {
      const needle = normalizeKey(name);
      const re = new RegExp(`(?:^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`);
      if (re.test(normalized)) return country;
    }
  }
  return null;
}

export function regionForCountry(name: string | null): string | null {
  const country = normalizeCountry(name);
  return country ? country.region : null;
}
