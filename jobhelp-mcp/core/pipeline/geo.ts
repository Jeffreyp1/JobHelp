interface CountryRule {
  readonly pattern: RegExp;
  readonly country: string;
}

// Order matters. More-specific / disambiguating rules go first so that a
// "Dublin, CA", "Vienna, VA", or "Indianapolis" string lands in US before the
// broader Ireland / Austria / India rules can claim them. Two-letter state
// codes require a preceding comma (", CA") so they don't false-positive on
// prose words. Patterns match against a diacritics-stripped copy of the
// location ("São Paulo" -> "Sao Paulo"), so spell city names in plain ASCII.
const COUNTRY_RULES: ReadonlyArray<CountryRule> = [
  // Before the US rules: "Tbilisi, Georgia" must not land on the US state name,
  // and "San Jose, CR / Costa Rica" must not land on the bare san-jose US rule.
  { pattern: /\btbilisi\b/i, country: 'Georgia' },
  { pattern: /\bcosta rica\b|,\s*c\.?r\.?(?:$|\b)/i, country: 'Costa Rica' },
  { pattern: /\b(united states|usa|u\.s\.a\.?|u\.s\.?|us)\b/i, country: 'US' },
  // Case-SENSITIVE: real postings write state codes uppercase ("Austin, TX"). Matching
  // case-insensitively made lowercase prose collide (", or" -> OR, ", in" -> IN). The
  // ISO-collision codes (CA/IN/DE/CO/AR/ID/MD) are disambiguated ahead of this rule.
  { pattern: /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/, country: 'US' },
  { pattern: /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york state|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming)\b/i, country: 'US' },
  { pattern: /\b(san francisco|sf bay|bay area|silicon valley|new\s?york|nyc|brooklyn|los angeles|chicago|seattle|austin|boston|denver|atlanta|miami|portland|san diego|dallas|houston|phoenix|philadelphia|washington,?\s*d\.?c\.?|minneapolis|detroit|charlotte|nashville|raleigh|salt lake city|cincinnati|columbus|indianapolis|baltimore|orlando|palo alto|sunnyvale|mountain view|menlo park|santa clara|san mateo|san carlos|san jose|redwood city|rwc|oakland|berkeley|cupertino|bellevue|redmond|pittsburgh|sacramento|san antonio|fort worth|tampa|ann arbor|boulder|las vegas|alexandria|stamford|west coast|east coast|namer|north america|sf|ny)\b/i, country: 'US' },
  { pattern: /\bcanada\b|\b(toronto|vancouver|montreal|ottawa|calgary|edmonton|quebec|ontario|british columbia|alberta|manitoba|saskatchewan|nova scotia)\b|,\s*(ON|BC|AB|QC|MB|SK|NS|NB|PE|NL|YT|NT|NU)\b/i, country: 'Canada' },
  { pattern: /\b(united kingdom|u\.k\.?|uk|england|scotland|wales|northern ireland|london|manchester|edinburgh|leeds|liverpool|bristol|glasgow|belfast)\b/i, country: 'UK' },
  { pattern: /\b(ireland|dublin|cork|galway|limerick)\b/i, country: 'Ireland' },
  { pattern: /\b(germany|berlin|munich|hamburg|frankfurt|cologne|stuttgart)\b/i, country: 'Germany' },
  { pattern: /\b(france|paris|lyon|marseille|toulouse|nice)\b/i, country: 'France' },
  { pattern: /\b(spain|madrid|barcelona|valencia|seville|bilbao)\b/i, country: 'Spain' },
  { pattern: /\b(netherlands|amsterdam|rotterdam|the hague|utrecht|eindhoven|hilversum)\b/i, country: 'Netherlands' },
  { pattern: /\b(italy|rome|milan|turin|naples|florence)\b/i, country: 'Italy' },
  { pattern: /\b(portugal|lisbon|lisboa|porto\b(?!\s+alegre)|braga)\b/i, country: 'Portugal' },
  { pattern: /\b(switzerland|zurich|geneva|basel|bern|lausanne)\b/i, country: 'Switzerland' },
  { pattern: /\b(austria|vienna|graz|linz)\b/i, country: 'Austria' },
  { pattern: /\b(belgium|brussels|antwerp|ghent)\b/i, country: 'Belgium' },
  { pattern: /\b(poland|warsaw|warszawa|krakow|wroclaw|gdansk|poznan)\b/i, country: 'Poland' },
  { pattern: /\b(czech republic|czechia|czech|prague|brno|pilsen|ostrava)\b/i, country: 'Czech Republic' },
  { pattern: /\b(hungary|budapest)\b/i, country: 'Hungary' },
  { pattern: /\b(romania|bucharest|cluj|timisoara|iasi)\b/i, country: 'Romania' },
  { pattern: /\b(serbia|belgrade|novi sad)\b/i, country: 'Serbia' },
  { pattern: /\b(ukraine|kyiv|kiev|lviv|kharkiv)\b/i, country: 'Ukraine' },
  { pattern: /\b(lithuania|vilnius|kaunas)\b/i, country: 'Lithuania' },
  { pattern: /\b(latvia|riga)\b/i, country: 'Latvia' },
  { pattern: /\b(estonia|tallinn)\b/i, country: 'Estonia' },
  { pattern: /\b(bulgaria|sofia|plovdiv)\b/i, country: 'Bulgaria' },
  { pattern: /\b(croatia|zagreb)\b/i, country: 'Croatia' },
  { pattern: /\b(slovakia|bratislava)\b/i, country: 'Slovakia' },
  { pattern: /\b(slovenia|ljubljana)\b/i, country: 'Slovenia' },
  { pattern: /\b(greece|athens|thessaloniki)\b/i, country: 'Greece' },
  { pattern: /\b(finland|helsinki|espoo|tampere)\b/i, country: 'Finland' },
  { pattern: /\b(sweden|stockholm|gothenburg|malmo)\b/i, country: 'Sweden' },
  { pattern: /\b(norway|oslo)\b/i, country: 'Norway' },
  { pattern: /\b(denmark|copenhagen|aarhus)\b/i, country: 'Denmark' },
  { pattern: /\b(moldova|chisinau)\b/i, country: 'Moldova' },
  { pattern: /\b(belarus|minsk)\b/i, country: 'Belarus' },
  { pattern: /\b(turkey|turkiye|istanbul|ankara|izmir)\b/i, country: 'Turkey' },
  { pattern: /\b(israel|tel aviv|herzliya|jerusalem|haifa)\b/i, country: 'Israel' },
  { pattern: /\b(saudi arabia|riyadh|jeddah)\b/i, country: 'Saudi Arabia' },
  { pattern: /\b(united arab emirates|uae|dubai|abu dhabi)\b/i, country: 'UAE' },
  { pattern: /\b(egypt|cairo)\b/i, country: 'Egypt' },
  { pattern: /\b(south africa|cape town|johannesburg|pretoria|durban)\b/i, country: 'South Africa' },
  { pattern: /\b(nigeria|lagos)\b/i, country: 'Nigeria' },
  { pattern: /\b(kenya|nairobi)\b/i, country: 'Kenya' },
  { pattern: /\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|kolkata|noida|gurgaon|gurugram|karnataka)\b/i, country: 'India' },
  { pattern: /\b(pakistan|karachi|lahore|islamabad)\b/i, country: 'Pakistan' },
  { pattern: /\b(bangladesh|dhaka)\b/i, country: 'Bangladesh' },
  { pattern: /\b(sri lanka|colombo)\b/i, country: 'Sri Lanka' },
  { pattern: /\b(kazakhstan|almaty|astana)\b/i, country: 'Kazakhstan' },
  { pattern: /\b(armenia|yerevan)\b/i, country: 'Armenia' },
  { pattern: /\b(thailand|bangkok)\b/i, country: 'Thailand' },
  { pattern: /\b(vietnam|hanoi|ho chi minh|saigon|danang)\b/i, country: 'Vietnam' },
  { pattern: /\b(philippines|manila|cebu)\b/i, country: 'Philippines' },
  { pattern: /\b(indonesia|jakarta|bandung)\b/i, country: 'Indonesia' },
  { pattern: /\b(malaysia|kuala lumpur)\b/i, country: 'Malaysia' },
  { pattern: /\b(taiwan|taipei)\b/i, country: 'Taiwan' },
  { pattern: /\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/i, country: 'Australia' },
  { pattern: /\b(new zealand|auckland|wellington)\b/i, country: 'New Zealand' },
  { pattern: /\bsingapore\b/i, country: 'Singapore' },
  { pattern: /\b(japan|tokyo|osaka|kyoto|yokohama)\b/i, country: 'Japan' },
  { pattern: /\b(china|beijing|shanghai|shenzhen|guangzhou|hong kong)\b/i, country: 'China' },
  { pattern: /\b(korea|seoul|busan|pangyo)\b/i, country: 'South Korea' },
  { pattern: /\b(brazil|brasil|sao paulo|rio de janeiro|brasilia|belo horizonte|curitiba|porto alegre|campinas|florianopolis|recife|fortaleza|londrina)\b/i, country: 'Brazil' },
  { pattern: /\b(mexico|cdmx|mexico city|guadalajara|monterrey)\b/i, country: 'Mexico' },
  { pattern: /\b(argentina|buenos aires|cordoba)\b/i, country: 'Argentina' },
  { pattern: /\b(colombia|bogota|medellin)\b/i, country: 'Colombia' },
  { pattern: /\b(chile|santiago)\b/i, country: 'Chile' },
  { pattern: /\b(peru|lima)\b/i, country: 'Peru' },
  { pattern: /\b(uruguay|montevideo)\b/i, country: 'Uruguay' },
  { pattern: /\bcosta rica\b/i, country: 'Costa Rica' },
  { pattern: /\b(europe|emea)\b/i, country: 'EU' },
  { pattern: /\b(apac|asia[\s-]pacific)\b/i, country: 'APAC' },
  { pattern: /\b(latam|latin america)\b/i, country: 'LATAM' },
  { pattern: /\b(aunz|anz)\b/i, country: 'Australia' },
];

const ARRANGEMENT_TOKENS = new Set([
  'remote', 'remotely', 'remoto', 'hybrid', 'onsite', 'on', 'site', 'in', 'office',
  'home', 'based', 'work', 'from', 'anywhere', 'worldwide', 'world', 'wide', 'global',
  'distributed', 'flexible', 'full', 'part', 'time', 'contract', 'freelance',
  'location', 'locations', 'multiple', 'various', 'open', 'only', 'preferred',
  'field', 'or', 'and', 'the', 'us', 'usa',
]);

// True when the location string names an actual place (vs. a pure work-arrangement
// descriptor like "Remote" / "Hybrid" / "Home based - Worldwide"). Used by the
// opt-in strict location filter: an unclassifiable NAMED place is presumed foreign,
// while arrangement-only strings keep the missing-data-never-drops invariant.
export function looksLikeConcretePlace(location: string): boolean {
  const words = location.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  return words.some((w) => !ARRANGEMENT_TOKENS.has(w) && !/^\d+$/.test(w));
}

// US state codes that are ALSO ISO country codes. A "<city>, <code>" string resolves to the
// country only when the city independently matches that same country, so "Toronto, CA" -> Canada
// but "Dublin, CA" -> US (Dublin resolves to Ireland, not Canada) and "Vienna, VA" -> US.
const ISO_COLLISION_COUNTRY: Readonly<Record<string, string>> = {
  CA: 'Canada', IN: 'India', DE: 'Germany', CO: 'Colombia',
  AR: 'Argentina', ID: 'Indonesia', MD: 'Moldova',
};

function matchCountryRules(ascii: string): string | undefined {
  return COUNTRY_RULES.find((rule) => rule.pattern.test(ascii))?.country;
}

// Returns canonical country label or undefined when no rule matches (bare 'Remote' stays undetected).
// Region buckets ('EU', 'APAC', 'LATAM') are emitted for broad descriptors like 'Remote - Europe'.
export function detectCountryFromLocation(location: string): string | undefined {
  if (typeof location !== 'string' || location.trim().length === 0) return undefined;
  const ascii = location.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const trailer = ascii.match(/,\s*([A-Za-z]{2})\s*$/);
  const code = trailer?.[1]?.toUpperCase();
  if (code !== undefined && trailer?.index !== undefined) {
    const isoCountry = ISO_COLLISION_COUNTRY[code];
    if (isoCountry !== undefined && matchCountryRules(ascii.slice(0, trailer.index)) === isoCountry) {
      return isoCountry;
    }
  }
  return matchCountryRules(ascii);
}
