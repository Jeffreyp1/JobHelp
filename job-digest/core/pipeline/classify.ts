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

/**
 * Title-first regex classifier. Returns undefined when no rule confidently matches
 * (so the filter's missing-data-never-drops invariant holds).
 *
 * The `description` parameter is reserved for a future tiebreaker pass; the current
 * implementation is intentionally title-only — descriptions are too noisy to classify on.
 */
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

/**
 * Detects "ghost" / template / placeholder postings that should never enter the digest.
 * Two signals: title pattern OR descriptions shorter than {@link DESCRIPTION_MIN_CHARS}
 * after a cheap HTML strip.
 */
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

const DESCRIPTION_SCAN_LIMIT = 500;

function scanRules(text: string, rules: readonly SeniorityRule[]): SeniorityLevel | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.level;
  }
  return undefined;
}

/**
 * Returns a confident seniority signal from the title; falls back to the first
 * {@link DESCRIPTION_SCAN_LIMIT} characters of the description ONLY when the title
 * yields nothing. Returns undefined when neither surface gives a clear signal —
 * callers must NOT default to a level (preserves missing-data-never-drops).
 *
 * Description fallback uses TIGHTER patterns (level + role-noun) so generic mentions
 * like "we are hiring senior engineers" (plural; no word-boundary after "engineer")
 * are intentionally ignored, while a posting that literally describes itself as a
 * "staff engineer" / "senior engineer" still triggers.
 */
export function detectSeniorityLevel(
  title: string,
  description: string,
): SeniorityLevel | undefined {
  const fromTitle = scanRules(title, SENIORITY_TITLE_RULES);
  if (fromTitle !== undefined) return fromTitle;
  if (description.length === 0) return undefined;
  return scanRules(description.slice(0, DESCRIPTION_SCAN_LIMIT), SENIORITY_DESC_RULES);
}
