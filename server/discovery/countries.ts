// Country normalization for Conference Gate's worldwide discovery catalogue.
//
// A conference source may say "USA", "U.S.", "United States of America", "US", "KSA",
// "Türkiye", "Macao" or a local-language country name. Those all need to resolve to the same
// canonical location bucket or country filters, regional search and deduplication become unreliable.
//
// The table intentionally covers the 195 commonly recognised sovereign states plus major
// conference-hosting territories/economies that appear independently in event data. The raw source
// location is preserved elsewhere for provenance; an unrecognised value remains null rather than
// being guessed.

export interface CountryRecord {
  /** The spelling Conference Gate uses. */
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  aliases: string[];
}

const c = (
  name: string,
  iso2: string,
  iso3: string,
  region: string,
  aliases: string[] = []
): CountryRecord => ({ name, iso2, iso3, region, aliases });

export const COUNTRIES: CountryRecord[] = [
  c("Afghanistan", "AF", "AFG", "Asia"),
  c("Albania", "AL", "ALB", "Europe"),
  c("Algeria", "DZ", "DZA", "Africa"),
  c("Andorra", "AD", "AND", "Europe"),
  c("Angola", "AO", "AGO", "Africa"),
  c("Antigua and Barbuda", "AG", "ATG", "North America", ["antigua & barbuda"]),
  c("Argentina", "AR", "ARG", "South America"),
  c("Armenia", "AM", "ARM", "Asia"),
  c("Australia", "AU", "AUS", "Oceania"),
  c("Austria", "AT", "AUT", "Europe", ["österreich", "osterreich"]),
  c("Azerbaijan", "AZ", "AZE", "Asia"),
  c("Bahamas", "BS", "BHS", "North America", ["the bahamas"]),
  c("Bahrain", "BH", "BHR", "Middle East", ["kingdom of bahrain"]),
  c("Bangladesh", "BD", "BGD", "Asia"),
  c("Barbados", "BB", "BRB", "North America"),
  c("Belarus", "BY", "BLR", "Europe"),
  c("Belgium", "BE", "BEL", "Europe", ["belgique", "belgië", "belgie"]),
  c("Belize", "BZ", "BLZ", "North America"),
  c("Benin", "BJ", "BEN", "Africa"),
  c("Bhutan", "BT", "BTN", "Asia"),
  c("Bolivia", "BO", "BOL", "South America", ["bolivia plurinational state of"]),
  c("Bosnia and Herzegovina", "BA", "BIH", "Europe", ["bosnia", "bosnia & herzegovina"]),
  c("Botswana", "BW", "BWA", "Africa"),
  c("Brazil", "BR", "BRA", "South America", ["brasil"]),
  c("Brunei", "BN", "BRN", "Asia", ["brunei darussalam"]),
  c("Bulgaria", "BG", "BGR", "Europe"),
  c("Burkina Faso", "BF", "BFA", "Africa"),
  c("Burundi", "BI", "BDI", "Africa"),
  c("Cabo Verde", "CV", "CPV", "Africa", ["cape verde"]),
  c("Cambodia", "KH", "KHM", "Asia"),
  c("Cameroon", "CM", "CMR", "Africa"),
  c("Canada", "CA", "CAN", "North America"),
  c("Central African Republic", "CF", "CAF", "Africa", ["car"]),
  c("Chad", "TD", "TCD", "Africa"),
  c("Chile", "CL", "CHL", "South America"),
  c("China", "CN", "CHN", "Asia", ["people's republic of china", "peoples republic of china", "prc", "mainland china"]),
  c("Colombia", "CO", "COL", "South America"),
  c("Comoros", "KM", "COM", "Africa"),
  c("Congo", "CG", "COG", "Africa", ["republic of the congo", "congo brazzaville"]),
  c("Democratic Republic of the Congo", "CD", "COD", "Africa", ["drc", "dr congo", "congo kinshasa", "congo democratic republic of the"]),
  c("Costa Rica", "CR", "CRI", "North America"),
  c("Côte d'Ivoire", "CI", "CIV", "Africa", ["cote d'ivoire", "cote divoire", "ivory coast"]),
  c("Croatia", "HR", "HRV", "Europe", ["hrvatska"]),
  c("Cuba", "CU", "CUB", "North America"),
  c("Cyprus", "CY", "CYP", "Europe"),
  c("Czechia", "CZ", "CZE", "Europe", ["czech republic", "česká republika", "ceska republika"]),
  c("Denmark", "DK", "DNK", "Europe", ["danmark"]),
  c("Djibouti", "DJ", "DJI", "Africa"),
  c("Dominica", "DM", "DMA", "North America"),
  c("Dominican Republic", "DO", "DOM", "North America"),
  c("Ecuador", "EC", "ECU", "South America"),
  c("Egypt", "EG", "EGY", "Africa", ["arab republic of egypt"]),
  c("El Salvador", "SV", "SLV", "North America"),
  c("Equatorial Guinea", "GQ", "GNQ", "Africa"),
  c("Eritrea", "ER", "ERI", "Africa"),
  c("Estonia", "EE", "EST", "Europe", ["eesti"]),
  c("Eswatini", "SZ", "SWZ", "Africa", ["swaziland"]),
  c("Ethiopia", "ET", "ETH", "Africa"),
  c("Fiji", "FJ", "FJI", "Oceania"),
  c("Finland", "FI", "FIN", "Europe", ["suomi"]),
  c("France", "FR", "FRA", "Europe"),
  c("Gabon", "GA", "GAB", "Africa"),
  c("Gambia", "GM", "GMB", "Africa", ["the gambia"]),
  c("Georgia", "GE", "GEO", "Asia"),
  c("Germany", "DE", "DEU", "Europe", ["deutschland", "federal republic of germany", "brd"]),
  c("Ghana", "GH", "GHA", "Africa"),
  c("Greece", "GR", "GRC", "Europe", ["hellas", "ellada", "ελλάδα"]),
  c("Grenada", "GD", "GRD", "North America"),
  c("Guatemala", "GT", "GTM", "North America"),
  c("Guinea", "GN", "GIN", "Africa"),
  c("Guinea-Bissau", "GW", "GNB", "Africa", ["guinea bissau"]),
  c("Guyana", "GY", "GUY", "South America"),
  c("Haiti", "HT", "HTI", "North America"),
  c("Honduras", "HN", "HND", "North America"),
  c("Hungary", "HU", "HUN", "Europe", ["magyarország", "magyarorszag"]),
  c("Iceland", "IS", "ISL", "Europe", ["ísland", "island"]),
  c("India", "IN", "IND", "Asia", ["bharat", "republic of india"]),
  c("Indonesia", "ID", "IDN", "Asia"),
  c("Iran", "IR", "IRN", "Middle East", ["islamic republic of iran"]),
  c("Iraq", "IQ", "IRQ", "Middle East"),
  c("Ireland", "IE", "IRL", "Europe", ["republic of ireland", "éire", "eire"]),
  c("Israel", "IL", "ISR", "Middle East"),
  c("Italy", "IT", "ITA", "Europe", ["italia"]),
  c("Jamaica", "JM", "JAM", "North America"),
  c("Japan", "JP", "JPN", "Asia", ["nippon", "nihon", "日本"]),
  c("Jordan", "JO", "JOR", "Middle East", ["hashemite kingdom of jordan"]),
  c("Kazakhstan", "KZ", "KAZ", "Asia"),
  c("Kenya", "KE", "KEN", "Africa"),
  c("Kiribati", "KI", "KIR", "Oceania"),
  c("North Korea", "KP", "PRK", "Asia", ["democratic people's republic of korea", "dprk", "korea north"]),
  c("South Korea", "KR", "KOR", "Asia", ["korea", "republic of korea", "korea republic of", "korea (south)", "대한민국"]),
  c("Kuwait", "KW", "KWT", "Middle East", ["state of kuwait"]),
  c("Kyrgyzstan", "KG", "KGZ", "Asia", ["kyrgyz republic"]),
  c("Laos", "LA", "LAO", "Asia", ["lao pdr", "lao people's democratic republic"]),
  c("Latvia", "LV", "LVA", "Europe"),
  c("Lebanon", "LB", "LBN", "Middle East"),
  c("Lesotho", "LS", "LSO", "Africa"),
  c("Liberia", "LR", "LBR", "Africa"),
  c("Libya", "LY", "LBY", "Africa"),
  c("Liechtenstein", "LI", "LIE", "Europe"),
  c("Lithuania", "LT", "LTU", "Europe"),
  c("Luxembourg", "LU", "LUX", "Europe"),
  c("Madagascar", "MG", "MDG", "Africa"),
  c("Malawi", "MW", "MWI", "Africa"),
  c("Malaysia", "MY", "MYS", "Asia"),
  c("Maldives", "MV", "MDV", "Asia"),
  c("Mali", "ML", "MLI", "Africa"),
  c("Malta", "MT", "MLT", "Europe"),
  c("Marshall Islands", "MH", "MHL", "Oceania"),
  c("Mauritania", "MR", "MRT", "Africa"),
  c("Mauritius", "MU", "MUS", "Africa"),
  c("Mexico", "MX", "MEX", "North America", ["méxico", "estados unidos mexicanos"]),
  c("Micronesia", "FM", "FSM", "Oceania", ["federated states of micronesia", "micronesia federated states of"]),
  c("Moldova", "MD", "MDA", "Europe", ["republic of moldova"]),
  c("Monaco", "MC", "MCO", "Europe"),
  c("Mongolia", "MN", "MNG", "Asia"),
  c("Montenegro", "ME", "MNE", "Europe"),
  c("Morocco", "MA", "MAR", "Africa", ["maroc", "kingdom of morocco"]),
  c("Mozambique", "MZ", "MOZ", "Africa"),
  c("Myanmar", "MM", "MMR", "Asia", ["burma"]),
  c("Namibia", "NA", "NAM", "Africa"),
  c("Nauru", "NR", "NRU", "Oceania"),
  c("Nepal", "NP", "NPL", "Asia"),
  c("Netherlands", "NL", "NLD", "Europe", ["the netherlands", "holland", "nederland"]),
  c("New Zealand", "NZ", "NZL", "Oceania", ["aotearoa"]),
  c("Nicaragua", "NI", "NIC", "North America"),
  c("Niger", "NE", "NER", "Africa"),
  c("Nigeria", "NG", "NGA", "Africa"),
  c("North Macedonia", "MK", "MKD", "Europe", ["macedonia", "republic of north macedonia"]),
  c("Norway", "NO", "NOR", "Europe", ["norge"]),
  c("Oman", "OM", "OMN", "Middle East", ["sultanate of oman"]),
  c("Pakistan", "PK", "PAK", "Asia"),
  c("Palau", "PW", "PLW", "Oceania"),
  c("Palestine", "PS", "PSE", "Middle East", ["state of palestine", "palestinian territories", "occupied palestinian territory"]),
  c("Panama", "PA", "PAN", "North America"),
  c("Papua New Guinea", "PG", "PNG", "Oceania", ["png"]),
  c("Paraguay", "PY", "PRY", "South America"),
  c("Peru", "PE", "PER", "South America", ["perú"]),
  c("Philippines", "PH", "PHL", "Asia", ["the philippines"]),
  c("Poland", "PL", "POL", "Europe", ["polska"]),
  c("Portugal", "PT", "PRT", "Europe"),
  c("Qatar", "QA", "QAT", "Middle East", ["state of qatar"]),
  c("Romania", "RO", "ROU", "Europe", ["românia", "romania"]),
  c("Russia", "RU", "RUS", "Europe", ["russian federation"]),
  c("Rwanda", "RW", "RWA", "Africa"),
  c("Saint Kitts and Nevis", "KN", "KNA", "North America", ["st kitts and nevis", "st. kitts and nevis"]),
  c("Saint Lucia", "LC", "LCA", "North America", ["st lucia", "st. lucia"]),
  c("Saint Vincent and the Grenadines", "VC", "VCT", "North America", ["st vincent and the grenadines", "st. vincent and the grenadines"]),
  c("Samoa", "WS", "WSM", "Oceania"),
  c("San Marino", "SM", "SMR", "Europe"),
  c("São Tomé and Príncipe", "ST", "STP", "Africa", ["sao tome and principe", "são tomé & príncipe"]),
  c("Saudi Arabia", "SA", "SAU", "Middle East", ["ksa", "kingdom of saudi arabia", "saudi"]),
  c("Senegal", "SN", "SEN", "Africa"),
  c("Serbia", "RS", "SRB", "Europe"),
  c("Seychelles", "SC", "SYC", "Africa"),
  c("Sierra Leone", "SL", "SLE", "Africa"),
  c("Singapore", "SG", "SGP", "Asia", ["republic of singapore"]),
  c("Slovakia", "SK", "SVK", "Europe", ["slovak republic"]),
  c("Slovenia", "SI", "SVN", "Europe"),
  c("Solomon Islands", "SB", "SLB", "Oceania"),
  c("Somalia", "SO", "SOM", "Africa"),
  c("South Africa", "ZA", "ZAF", "Africa", ["rsa", "republic of south africa"]),
  c("South Sudan", "SS", "SSD", "Africa"),
  c("Spain", "ES", "ESP", "Europe", ["españa", "espana"]),
  c("Sri Lanka", "LK", "LKA", "Asia"),
  c("Sudan", "SD", "SDN", "Africa"),
  c("Suriname", "SR", "SUR", "South America"),
  c("Sweden", "SE", "SWE", "Europe", ["sverige"]),
  c("Switzerland", "CH", "CHE", "Europe", ["suisse", "schweiz", "svizzera", "confoederatio helvetica"]),
  c("Syria", "SY", "SYR", "Middle East", ["syrian arab republic"]),
  c("Tajikistan", "TJ", "TJK", "Asia"),
  c("Tanzania", "TZ", "TZA", "Africa", ["united republic of tanzania"]),
  c("Thailand", "TH", "THA", "Asia"),
  c("Timor-Leste", "TL", "TLS", "Asia", ["east timor", "timor leste"]),
  c("Togo", "TG", "TGO", "Africa"),
  c("Tonga", "TO", "TON", "Oceania"),
  c("Trinidad and Tobago", "TT", "TTO", "North America", ["trinidad & tobago"]),
  c("Tunisia", "TN", "TUN", "Africa", ["tunisie"]),
  c("Turkey", "TR", "TUR", "Europe", ["türkiye", "turkiye", "republic of türkiye", "republic of turkiye"]),
  c("Turkmenistan", "TM", "TKM", "Asia"),
  c("Tuvalu", "TV", "TUV", "Oceania"),
  c("Uganda", "UG", "UGA", "Africa"),
  c("Ukraine", "UA", "UKR", "Europe"),
  c("United Arab Emirates", "AE", "ARE", "Middle East", ["uae", "u.a.e.", "emirates", "the emirates"]),
  c("United Kingdom", "GB", "GBR", "Europe", ["uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "united kingdom of great britain and northern ireland"]),
  c("United States", "US", "USA", "North America", ["usa", "u.s.", "u.s.a.", "us", "united states of america", "america", "the united states", "the us", "u s a"]),
  c("Uruguay", "UY", "URY", "South America"),
  c("Uzbekistan", "UZ", "UZB", "Asia"),
  c("Vanuatu", "VU", "VUT", "Oceania"),
  c("Vatican City", "VA", "VAT", "Europe", ["holy see", "vatican"]),
  c("Venezuela", "VE", "VEN", "South America", ["bolivarian republic of venezuela"]),
  c("Vietnam", "VN", "VNM", "Asia", ["viet nam", "socialist republic of vietnam"]),
  c("Yemen", "YE", "YEM", "Middle East"),
  c("Zambia", "ZM", "ZMB", "Africa"),
  c("Zimbabwe", "ZW", "ZWE", "Africa"),

  // Major conference-hosting territories/economies commonly represented independently in event feeds.
  c("Hong Kong", "HK", "HKG", "Asia", ["hong kong sar", "hong kong s.a.r.", "hong kong china"]),
  c("Macao", "MO", "MAC", "Asia", ["macau", "macao sar", "macau sar", "macao china"]),
  c("Taiwan", "TW", "TWN", "Asia", ["chinese taipei", "taiwan province of china"]),
  c("Puerto Rico", "PR", "PRI", "North America"),
  c("Bermuda", "BM", "BMU", "North America"),
  c("Cayman Islands", "KY", "CYM", "North America"),
  c("British Virgin Islands", "VG", "VGB", "North America", ["bvi"]),
  c("U.S. Virgin Islands", "VI", "VIR", "North America", ["us virgin islands", "united states virgin islands"]),
  c("Aruba", "AW", "ABW", "North America"),
  c("Curaçao", "CW", "CUW", "North America", ["curacao"]),
  c("Sint Maarten", "SX", "SXM", "North America", ["st maarten", "st. maarten"]),
  c("Guam", "GU", "GUM", "Oceania"),
  c("Northern Mariana Islands", "MP", "MNP", "Oceania", ["cnmi"]),
  c("American Samoa", "AS", "ASM", "Oceania"),
  c("New Caledonia", "NC", "NCL", "Oceania"),
  c("French Polynesia", "PF", "PYF", "Oceania", ["tahiti"]),
  c("Greenland", "GL", "GRL", "North America"),
  c("Faroe Islands", "FO", "FRO", "Europe"),
  c("Gibraltar", "GI", "GIB", "Europe"),
  c("Isle of Man", "IM", "IMN", "Europe"),
  c("Jersey", "JE", "JEY", "Europe"),
  c("Guernsey", "GG", "GGY", "Europe"),
  c("Réunion", "RE", "REU", "Africa", ["reunion"]),
  c("Mayotte", "YT", "MYT", "Africa"),
  c("Åland Islands", "AX", "ALA", "Europe", ["aland islands", "aland"]),
];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
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
 * Resolves a country name, code or alias to Conference Gate's canonical spelling.
 *
 * Two-letter tokens are accepted only when they are exact ISO codes because ordinary words such as
 * "in" and "at" must never resolve to countries. Anything unrecognised returns null — an unknown
 * country is recorded as unknown rather than coerced into the nearest-looking name.
 */
export function normalizeCountry(value: string | null | undefined): CountryRecord | null {
  if (!value || typeof value !== "string") return null;
  const key = normalizeKey(value);
  if (!key || key.length < 2) return null;
  return INDEX.get(key) ?? null;
}

/** Finds a country or recognised alias named anywhere inside a longer location string. */
export function findCountryInText(text: string | null | undefined): CountryRecord | null {
  if (!text) return null;
  const normalized = normalizeKey(text);

  // Comma-separated tails first: "Barcelona, Spain" almost always ends with the country.
  const parts = text.split(/[,،|/•·]/).map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const match = normalizeCountry(parts[i]);
    if (match) return match;
  }

  // Otherwise scan every canonical name and alias, longest first. Length ordering matters for
  // country pairs such as Congo / Democratic Republic of the Congo and Korea / South Korea.
  const candidates = COUNTRIES
    .flatMap((country) => [country.name, ...country.aliases].map((name) => ({ country, name })))
    .filter(({ name }) => normalizeKey(name).length > 3)
    .sort((a, b) => normalizeKey(b.name).length - normalizeKey(a.name).length);

  for (const { country, name } of candidates) {
    const needle = normalizeKey(name);
    const re = new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`);
    if (re.test(normalized)) return country;
  }
  return null;
}

export function regionForCountry(name: string | null): string | null {
  const country = normalizeCountry(name);
  return country ? country.region : null;
}

/** Canonical country names for global facets/dropdowns. */
export function worldwideCountryNames(): string[] {
  return COUNTRIES.map((country) => country.name).sort((a, b) => a.localeCompare(b));
}

/** Countries belonging to a broad Conference Gate region. */
export function countriesInRegion(region: string): CountryRecord[] {
  const key = normalizeKey(region);
  return COUNTRIES.filter((country) => normalizeKey(country.region) === key);
}
