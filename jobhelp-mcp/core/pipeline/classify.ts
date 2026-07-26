import { extractMinYears, SENIOR_MIN_YEARS } from './experience.js';

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
    pattern: /\baccounting\b|financial\s+analyst|financial\s+planning|\bfinance\s+(?:systems|technical|technology)?\s*(?:lead|engineer|analyst|associate)\b/i,
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
    pattern: /data scientist|machine learning|\bml\s+(?:engineer|developer|dev|swe|sde)\b|applied scientist|nlp|\bai\s+(?:engineer|developer|swe|sde)\b|\bapplied ai\b|\bgenai\b|\bgenerative ai\b|\bllm\b/i,
    family: 'ml',
  },
  { pattern: /data engineer|analytics engineer|data analyst/i, family: 'data' },
  { pattern: /\banalytics?\s+analyst\b|\banalyst\b/i, family: 'analyst' },
  {
    pattern: /security engineer|application security|appsec|offensive security|red team/i,
    family: 'security',
  },
  { pattern: /site reliability|\bsre\b|production engineer/i, family: 'sre' },
  {
    pattern: /devops|\bplatform\s+(?:engineer|developer)\b|\binfrastructure\s+(?:engineer|developer)\b/i,
    family: 'devops',
  },
  {
    pattern: /\b(?:android|ios|mobile|react native)\s+(?:engineer|developer)\b/i,
    family: 'mobile',
  },
  { pattern: /\bfrontend\s+(?:engineer|developer)\b|front-end|\bui\s+(?:engineer|developer)\b/i, family: 'frontend' },
  // Must precede 'backend' so "Solutions Engineer" / "Services Architect" / "Network Solution Lead"
  // don't fall into backend's systems-engineer match. The (solutions?|services) alternation keeps the
  // immediate (architect|engineer|lead) constraint so "Customer Service Representative" never matches.
  {
    pattern: /\b(?:solutions\s+(?:architect|engineer|lead)|services\s+(?:architect|lead))\b/i,
    family: 'solutions-architect',
  },
  {
    pattern: /\bbackend\s+(?:engineer|developer|dev|swe|sde)\b|back-end|\bapi\s+(?:engineer|developer)\b|\bsystems?\s+(?:engineer|developer)\b|,\s*backend\b/i,
    family: 'backend',
  },
  // "in Test" excluded so QA roles stay unclassified rather than claiming fullstack.
  // Bare SWE/SDE count: in job titles those abbreviations mean software engineer.
  {
    pattern: /full ?stack|full-stack|\bsoftware\s+(?:engineer|developer)\b(?!\s+in\s+test)|\b(?:swe|sde)\b/i,
    family: 'fullstack',
  },
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

// Feeds whose real postings are one-liners by design; the length heuristic would convict all of them.
const SHORT_DESCRIPTION_FEED_SOURCES = new Set(['yc']);

// Detects template/placeholder postings via title pattern OR description too short after HTML strip.
// TODO_FUTURE: duplicate-posting detection (same title+company within 7 days) requires digest history; defer.
export function isGhostJob(job: {
  readonly title: string;
  readonly description: string;
  readonly source?: string;
}): boolean {
  if (GHOST_TITLE_RE.test(job.title)) return true;
  if (job.source !== undefined && SHORT_DESCRIPTION_FEED_SOURCES.has(job.source)) return false;
  const cleaned = stripHtml(job.description);
  return cleaned.length < DESCRIPTION_MIN_CHARS;
}

interface SeniorityRule {
  readonly pattern: RegExp;
  readonly level: SeniorityLevel;
}

// "New grad" marks a full-time entry-level role, not an internship — classifying it as
// intern makes the intern-mismatch filter silently drop the best-fit postings for entry profiles.
const SENIORITY_TITLE_RULES: readonly SeniorityRule[] = [
  { pattern: /\b(intern|internship)\b/i, level: 'intern' },
  { pattern: /\b(staff|principal|distinguished)\b/i, level: 'staff' },
  { pattern: /\b(senior|sr\.|lead engineer|forward[\s-]+deployed|head of)\b/i, level: 'senior' },
  {
    pattern: /\b(?:engineer|developer|swe|sde)\s+(II|III|IV)\b|\b(II|III|IV)\s+(?:engineer|developer|swe|sde)\b/i,
    level: 'mid',
  },
  {
    pattern: /\b(junior|jr\.|entry[- ]level|associate engineer|graduate engineer|new[\s-]?grad(?:uate)?s?)\b/i,
    level: 'entry',
  },
];

const ROLE_NOUN = '(?:engineer|developer|dev|swe|sde)';
// Up to two modifier words between level and role noun ("Senior Full-Stack Engineer",
// "Staff Machine Learning Engineer"); and/or/to excluded so prose like
// "senior and junior engineers" cannot bridge the gap.
const LEVEL_MOD = '(?:(?!and\\b|or\\b|to\\b)[\\w/&+.-]+\\s+){0,2}';
// Intern and staff keyword signals take precedence over the years-of-experience count (a
// "Staff Engineer, 10+ years" body is staff, not just senior).
const SENIORITY_DESC_HEAD_RULES: readonly SeniorityRule[] = [
  { pattern: /\b(intern|internship)\b/i, level: 'intern' },
  {
    pattern: new RegExp(`\\b(staff|principal|distinguished)\\s+${LEVEL_MOD}${ROLE_NOUN}\\b`, 'i'),
    level: 'staff',
  },
];

// Consulted only after the years-of-experience signal (see detectSeniorityLevel): the
// years count sits where the old 5+-years regex did, between staff and these keyword rules.
const SENIORITY_DESC_TAIL_RULES: readonly SeniorityRule[] = [
  {
    pattern: new RegExp(
      `\\b(senior|forward[\\s-]+deployed|head of|lead)\\s+${LEVEL_MOD}${ROLE_NOUN}\\b`,
      'i',
    ),
    level: 'senior',
  },
  {
    pattern: new RegExp(`\\b${ROLE_NOUN}\\s+(II|III|IV)\\b|\\b(II|III|IV)\\s+${ROLE_NOUN}\\b`, 'i'),
    level: 'mid',
  },
  {
    pattern: new RegExp(`\\b(junior|jr\\.|graduate|associate)\\s+${LEVEL_MOD}${ROLE_NOUN}\\b`, 'i'),
    level: 'entry',
  },
  { pattern: /\bnew[\s-]?grad(?:uate)?s?\b/i, level: 'entry' },
];

// 3000 covers qualifications section where "X+ years required" typically lives.
const DESCRIPTION_SCAN_LIMIT = 3000;

function scanRules(text: string, rules: readonly SeniorityRule[]): SeniorityLevel | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.level;
  }
  return undefined;
}

// Title-only signal: the filter drops on this, while description-level signals only demote
// in ranking — a body mention is too weak to justify losing the job entirely.
export function detectTitleSeniority(title: string): SeniorityLevel | undefined {
  return scanRules(title, SENIORITY_TITLE_RULES);
}

// Title first; description fallback uses tighter level+role-noun patterns so generic mentions
// ("we are hiring senior engineers") don't trip. The years-of-experience requirement (>=5 senior,
// entry-friendly => entry) sits between the intern/staff keywords and the remaining keyword rules,
// where the old years regex lived. Returns undefined when neither surface signals.
export function detectSeniorityLevel(
  title: string,
  description: string,
): SeniorityLevel | undefined {
  const fromTitle = scanRules(title, SENIORITY_TITLE_RULES);
  if (fromTitle !== undefined) return fromTitle;
  if (description.length === 0) return undefined;
  const scanned = description.slice(0, DESCRIPTION_SCAN_LIMIT);
  const fromHead = scanRules(scanned, SENIORITY_DESC_HEAD_RULES);
  if (fromHead !== undefined) return fromHead;
  const minYears = extractMinYears(description);
  if (minYears !== undefined) {
    if (minYears >= SENIOR_MIN_YEARS) return 'senior';
    if (minYears === 0) return 'entry';
  }
  return scanRules(scanned, SENIORITY_DESC_TAIL_RULES);
}

export { detectCountryFromLocation } from './geo.js';
