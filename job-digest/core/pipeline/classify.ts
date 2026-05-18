export type RoleFamily =
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'mobile'
  | 'ml'
  | 'data'
  | 'security'
  | 'devops'
  | 'sre'
  | 'pm'
  | 'sales'
  | 'ops'
  | 'designer'
  | 'analyst'
  | 'marketing'
  | 'support'
  | 'finance'
  | 'solutions-architect';

export type SeniorityLevel = 'intern' | 'entry' | 'mid' | 'senior' | 'staff';

interface RoleFamilyRule {
  readonly pattern: RegExp;
  readonly family: RoleFamily;
}

const ROLE_FAMILY_RULES: readonly RoleFamilyRule[] = [
  // 'pm' covers IC product/program/project managers and people-manager titles ("Engineering Manager",
  // "Manager I, Engineering"). For an IC engineering profile, manager IS a role-family mismatch and
  // should drop — so these all bucket under 'pm' and fall outside roleFamily=['backend',...].
  // 'technical product' tightened to require manager|owner suffix so "Technical Product Architect"
  // doesn't false-positive into 'pm'.
  {
    pattern: /\b(?:product|program|project|engineering)\s+manager\b|^manager\s+[IVX0-9]+\b|\bmanager,\s*engineering\b|product owner|\btechnical\s+product\s+(?:manager|owner)\b/i,
    family: 'pm',
  },
  {
    pattern: /operations associate|operations manager|chief of staff|business operations/i,
    family: 'ops',
  },
  {
    pattern: /sales engineer|account executive|business development|sdr/i,
    family: 'sales',
  },
  { pattern: /marketing|brand|content strategist|seo manager/i, family: 'marketing' },
  // 'finance' must precede 'solutions-architect' so "Accounting Technical Solutions Lead" wins.
  {
    pattern: /\baccounting\b|financial\s+analyst|financial\s+planning|finance.{0,15}analyt|\bfinance\s+(?:systems|technical|technology)?\s*(?:lead|engineer|analyst|associate)\b/i,
    family: 'finance',
  },
  // 'support' must precede 'backend' so "Support Engineer" lands here, not in backend's systems-engineer match.
  // Customer success + technical specialist + solutions specialist are customer-facing — bucketed here,
  // not in 'sales', so an engineering-profile drop trips on role-family rather than a sales/support distinction.
  {
    pattern: /\b(?:product|technical|customer)\s+support\b|\bsupport\s+(?:specialist|engineer|lead|associate)\b|\btechnical\s+specialist\b|\bcustomer\s+success\b|\bsolutions?\s+specialist\b/i,
    family: 'support',
  },
  {
    pattern: /data scientist|machine learning|ml engineer|applied scientist|nlp/i,
    family: 'ml',
  },
  { pattern: /data engineer|analytics engineer|data analyst/i, family: 'data' },
  {
    pattern: /security engineer|application security|appsec|offensive security|red team/i,
    family: 'security',
  },
  { pattern: /site reliability|\bsre\b|production engineer/i, family: 'sre' },
  { pattern: /devops|platform engineer|infrastructure engineer/i, family: 'devops' },
  {
    pattern: /android engineer|ios engineer|mobile engineer|react native engineer/i,
    family: 'mobile',
  },
  { pattern: /frontend engineer|front-end|ui engineer/i, family: 'frontend' },
  // Must precede 'backend' so "Solutions Engineer" / "Services Architect" / "Network Solution Lead"
  // don't fall into backend's systems-engineer match. The (solutions?|services) alternation keeps the
  // immediate (architect|engineer|lead) constraint so "Customer Service Representative" never matches.
  {
    pattern: /\b(?:solutions?\s+(?:architect|engineer|lead)|services\s+(?:architect|lead))\b/i,
    family: 'solutions-architect',
  },
  {
    pattern: /backend engineer|back-end|api engineer|systems engineer|,\s*backend\b/i,
    family: 'backend',
  },
  { pattern: /full ?stack|full-stack|software engineer$/i, family: 'fullstack' },
  { pattern: /designer|design engineer|ux engineer/i, family: 'designer' },
];

// Title-only classifier; descriptions are too noisy. Returns undefined when no rule matches
// (preserves the filter's missing-data-never-drops invariant). `_description` reserved for a future tiebreaker.
export function detectRoleFamily(
  title: string,
  _description: string,
): RoleFamily | undefined {
  const t = title.trim();
  for (const rule of ROLE_FAMILY_RULES) {
    if (rule.pattern.test(t)) return rule.family;
  }
  return undefined;
}

const GHOST_TITLE_RE = /\[TEMPLATE\]|\[TEST\]|\[DRAFT\]|default template|do not apply|placeholder|sample posting/i;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RUN_RE = /\s+/g;
const DESCRIPTION_MIN_CHARS = 200;

function stripHtml(s: string): string {
  return s.replace(HTML_TAG_RE, ' ').replace(WHITESPACE_RUN_RE, ' ').trim();
}

// Detects template/placeholder postings via title pattern OR description too short after HTML strip.
// TODO_FUTURE: duplicate-posting detection (same title+company within 7 days) requires digest history; defer.
export function isGhostJob(job: { readonly title: string; readonly description: string }): boolean {
  if (GHOST_TITLE_RE.test(job.title)) return true;
  const cleaned = stripHtml(job.description);
  return cleaned.length < DESCRIPTION_MIN_CHARS;
}

interface SeniorityRule {
  readonly pattern: RegExp;
  readonly level: SeniorityLevel;
}

const SENIORITY_TITLE_RULES: readonly SeniorityRule[] = [
  { pattern: /\b(intern|internship|new ?grad)\b/i, level: 'intern' },
  { pattern: /\b(staff|principal|distinguished)\b/i, level: 'staff' },
  { pattern: /\b(senior|sr\.|lead engineer|forward[\s-]+deployed|head of)\b/i, level: 'senior' },
  {
    pattern: /\b(?:engineer|developer|swe|sde)\s+(II|III|IV)\b|\b(II|III|IV)\s+(?:engineer|developer|swe|sde)\b/i,
    level: 'mid',
  },
  {
    pattern: /\b(junior|jr\.|entry[- ]level|associate engineer|graduate engineer)\b/i,
    level: 'entry',
  },
];

const ROLE_NOUN = '(?:engineer|developer|swe|sde)';
const SENIORITY_DESC_RULES: readonly SeniorityRule[] = [
  { pattern: /\b(intern|internship|new ?grad)\b/i, level: 'intern' },
  { pattern: new RegExp(`\\b(staff|principal|distinguished)\\s+${ROLE_NOUN}\\b`, 'i'), level: 'staff' },
  // 5+ years (or higher) of experience/industry/professional is a strong senior signal; sub-5
  // year counts (2+, 3+, 4+) are ambiguous between entry and mid so they stay signal-less.
  {
    pattern: /\b(?:[5-9]|[12]\d)(?:[\s-]+\d+)?\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp(?:erience)?|industry|professional|relevant)\b/i,
    level: 'senior',
  },
  {
    pattern: new RegExp(`\\b(senior|forward[\\s-]+deployed|head of|lead)\\s+${ROLE_NOUN}\\b`, 'i'),
    level: 'senior',
  },
  {
    pattern: new RegExp(`\\b${ROLE_NOUN}\\s+(II|III|IV)\\b|\\b(II|III|IV)\\s+${ROLE_NOUN}\\b`, 'i'),
    level: 'mid',
  },
  {
    pattern: new RegExp(`\\b(junior|jr\\.|graduate|associate)\\s+${ROLE_NOUN}\\b`, 'i'),
    level: 'entry',
  },
];

// 3000 covers qualifications section where "X+ years required" typically lives.
const DESCRIPTION_SCAN_LIMIT = 3000;

function scanRules(text: string, rules: readonly SeniorityRule[]): SeniorityLevel | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.level;
  }
  return undefined;
}

// Title first; description fallback uses tighter level+role-noun patterns so generic mentions
// ("we are hiring senior engineers") don't trip. Returns undefined when neither surface signals.
export function detectSeniorityLevel(
  title: string,
  description: string,
): SeniorityLevel | undefined {
  const fromTitle = scanRules(title, SENIORITY_TITLE_RULES);
  if (fromTitle !== undefined) return fromTitle;
  if (description.length === 0) return undefined;
  return scanRules(description.slice(0, DESCRIPTION_SCAN_LIMIT), SENIORITY_DESC_RULES);
}

interface CountryRule {
  readonly pattern: RegExp;
  readonly country: string;
}

// Order matters. More-specific / disambiguating rules go first so that a
// "Dublin, CA" or "Indianapolis" string lands in US before the broader
// Ireland / India rules can claim them. Two-letter state codes require a
// preceding comma (", CA") so they don't false-positive on prose words.
const COUNTRY_RULES: ReadonlyArray<CountryRule> = [
  { pattern: /\b(united states|usa|u\.s\.a\.?|us)\b/i, country: 'US' },
  { pattern: /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i, country: 'US' },
  { pattern: /\b(california|new york state|texas|florida|washington state|massachusetts|illinois|pennsylvania|colorado|oregon|georgia|virginia|new jersey)\b/i, country: 'US' },
  { pattern: /\b(san francisco|sf bay|silicon valley|new york city|nyc|los angeles|chicago|seattle|austin|boston|denver|atlanta|miami|portland|san diego|dallas|houston|phoenix|philadelphia|washington dc|minneapolis|detroit|charlotte|nashville|raleigh|salt lake city|cincinnati|columbus|indianapolis|baltimore|orlando)\b/i, country: 'US' },
  { pattern: /\bcanada\b|\b(toronto|vancouver|montreal|ottawa|calgary|edmonton|quebec)\b|,\s*(ON|BC|AB|QC|MB|SK|NS|NB|PE|NL|YT|NT|NU)\b/i, country: 'Canada' },
  { pattern: /\b(united kingdom|u\.k\.?|england|scotland|wales|northern ireland|london|manchester|edinburgh|leeds|liverpool|bristol|glasgow)\b/i, country: 'UK' },
  { pattern: /\b(ireland|dublin|cork|galway|limerick)\b/i, country: 'Ireland' },
  { pattern: /\b(germany|berlin|munich|hamburg|frankfurt|cologne|stuttgart)\b/i, country: 'Germany' },
  { pattern: /\b(france|paris|lyon|marseille|toulouse|nice)\b/i, country: 'France' },
  { pattern: /\b(spain|madrid|barcelona|valencia|seville|bilbao)\b/i, country: 'Spain' },
  { pattern: /\b(netherlands|amsterdam|rotterdam|the hague|utrecht|eindhoven)\b/i, country: 'Netherlands' },
  { pattern: /\b(italy|rome|milan|turin|naples|florence)\b/i, country: 'Italy' },
  { pattern: /\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|kolkata|noida|gurgaon|gurugram)\b/i, country: 'India' },
  { pattern: /\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/i, country: 'Australia' },
  { pattern: /\b(new zealand|auckland|wellington)\b/i, country: 'New Zealand' },
  { pattern: /\bsingapore\b/i, country: 'Singapore' },
  { pattern: /\b(japan|tokyo|osaka|kyoto|yokohama)\b/i, country: 'Japan' },
  { pattern: /\b(china|beijing|shanghai|shenzhen|guangzhou|hong kong)\b/i, country: 'China' },
  { pattern: /\b(korea|seoul|busan)\b/i, country: 'South Korea' },
  { pattern: /\b(brazil|brasil|sao paulo|rio de janeiro|brasilia)\b/i, country: 'Brazil' },
  { pattern: /\b(mexico|cdmx|mexico city|guadalajara|monterrey)\b/i, country: 'Mexico' },
  { pattern: /\b(argentina|buenos aires|cordoba)\b/i, country: 'Argentina' },
  { pattern: /\b(europe|emea)\b/i, country: 'EU' },
  { pattern: /\b(apac|asia[\s-]pacific)\b/i, country: 'APAC' },
  { pattern: /\b(latam|latin america)\b/i, country: 'LATAM' },
  { pattern: /\b(aunz|anz)\b/i, country: 'Australia' },
];

// Returns canonical country label or undefined when no rule matches (bare 'Remote' stays undetected).
// Region buckets ('EU', 'APAC', 'LATAM') are emitted for broad descriptors like 'Remote - Europe'.
export function detectCountryFromLocation(location: string): string | undefined {
  if (typeof location !== 'string' || location.trim().length === 0) return undefined;
  for (const rule of COUNTRY_RULES) {
    if (rule.pattern.test(location)) return rule.country;
  }
  return undefined;
}
