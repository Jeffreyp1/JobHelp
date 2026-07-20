import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_CONCEPTS } from './types.ts';
import type { FieldConcept, StandingProfile } from './types.ts';
import { log } from './log.ts';

const VALID_CONCEPTS = new Set<string>(FIELD_CONCEPTS);

interface CompiledLabelRule {
  readonly re: RegExp;
  readonly concept: FieldConcept;
  readonly ats: string | null;
}

let overridesPath: string | null = null;
let compiledRules: readonly CompiledLabelRule[] | null = null;

function defaultOverridesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'overrides.json');
}

export function setOverridesPath(p: string): void {
  overridesPath = p;
  compiledRules = null;
}

export function resetLabelOverrides(): void {
  overridesPath = null;
  compiledRules = null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function compileRule(raw: unknown): CompiledLabelRule | null {
  if (!isRecord(raw)) return null;
  const { pattern, flags, concept, ats } = raw;
  if (typeof pattern !== 'string' || typeof flags !== 'string' || typeof concept !== 'string') return null;
  if (!VALID_CONCEPTS.has(concept)) return null;
  let re: RegExp;
  try {
    // g/y make .test stateful via lastIndex; rules are compiled once and reused.
    re = new RegExp(pattern, flags.replace(/[gy]/g, ''));
  } catch {
    return null;
  }
  return { re, concept: concept as FieldConcept, ats: typeof ats === 'string' ? ats : null };
}

/** Load learned label rules once per run so classifyLabelWithRules can stay
 * synchronous. A missing file means no rules yet; a malformed file warns and is
 * ignored — bad learned data must never break a fill run. */
export async function loadLabelOverrides(): Promise<void> {
  if (compiledRules !== null) return;
  const p = overridesPath ?? defaultOverridesPath();
  const compiled: CompiledLabelRule[] = [];
  compiledRules = compiled;
  let raw: string;
  try {
    raw = await readFile(p, 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('warn', 'overrides file is not valid JSON; ignoring', { path: p });
    return;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['labelRules'])) {
    log('warn', 'overrides file has no labelRules array; ignoring', { path: p });
    return;
  }
  for (const rule of parsed['labelRules']) {
    const c = compileRule(rule);
    if (c !== null) compiled.push(c);
  }
}

const SPONSORSHIP_RE = /sponsor(ship)?|require (a )?visa|need (a )?visa|\bvisa status\b/i;
const WORKAUTH_RE = /authoriz(ed|ation) to work|legally authorized|work authorization|eligible to work/i;

const RULES: ReadonlyArray<readonly [RegExp, FieldConcept]> = [
  [/\bfirst name\b|\bgiven name\b|\bpreferred name\b|name you'?d? prefer|name you prefer/i, 'firstName'],
  [/\blast name\b|\bsurname\b|\bfamily name\b/i, 'lastName'],
  [/\bfull name\b|^name\b/i, 'fullName'],
  [/\be-?mail\b/i, 'email'],
  [/\bphone\b|\bmobile\b|\bcell\b|\btelephone\b/i, 'phone'],
  [/\blinkedin\b/i, 'linkedin'],
  [/\bgithub\b/i, 'github'],
  [/\bportfolio\b/i, 'portfolio'],
  [/\bwebsite\b|\bpersonal site\b/i, 'website'],
  [/\bstart\b[^.]{0,30}\bmonth\b|\bmonth\b[^.]{0,20}\bstart\b/i, 'educationStartMonth'],
  [/\bend\b[^.]{0,30}\bmonth\b|\bmonth\b[^.]{0,20}\bend\b/i, 'educationEndMonth'],
  // citizenship precedes sponsorship: "Are you a US Citizen ... or do you require
  // visa sponsorship?" is a citizenship-status choice, not a yes/no sponsorship
  // question. The regex requires an explicit US-citizen phrasing so export-control
  // screens ("citizen or resident of ... Cuba, Iran ...") stay unmatched.
  [/\b(u\.?s\.?|united states)\s+citizen|\bcitizenship status\b|are you a citizen\b/i, 'citizenship'],
  [/\brelocat(e|ing|ion)\b/i, 'relocation'],
  [/\bon-?site\b|\bin[\s-]person\b[^.]{0,60}\b(office|work|session)/i, 'onsiteAvailability'],
  // sponsorship/work-authorization MUST precede location/country: these questions
  // often contain "location" or "country" ("...remain in your current location?",
  // "...authorized to work in this country?") and would otherwise mis-match those.
  // sponsorship itself precedes workAuthorization for the same reason — a sponsorship
  // question often also names "work authorization".
  [SPONSORSHIP_RE, 'sponsorship'],
  [WORKAUTH_RE, 'workAuthorization'],
  // expectedSalary precedes location: salary labels can contain "based" or
  // "location" ("desired salary for this role based in ...").
  [/\b(desired|expected)\b[^.]{0,40}\b(salary|compensation|pay)\b|\bsalary (expectation|requirement)s?\b/i, 'expectedSalary'],
  [/\bcountry\b/i, 'country'],
  [/which state\b|\bstate\b[^.]{0,30}\b(reside|residence|live)\b|\bstate of residence\b|^state\b\W*$/i, 'state'],
  [/location.*city|\(city\)|^city\b/i, 'locationCity'],
  [/\b(city|location)\b|where are you|where are you based|\bbased\b/i, 'location'],
  [/\b(relatives?|family members?)\b[^.]{0,30}\b(employ|work)/i, 'relativesAtCompany'],
  [/\b(ever|previously|prior)\b[^.]{0,30}\b(worked|employed|employment)\b|\bcurrently employed by\b/i, 'priorEmploymentAtCompany'],
  [/\bpercent(age)?\b[^.]{0,40}\bcoding\b|hands.on coding/i, 'percentHandsOnCoding'],
  [/acknowledge[^.]{0,40}privacy (notice|policy)/i, 'acknowledgePrivacyNotices'],
  [/gender identity/i, 'genderIdentity'],
  [/\bpronouns?\b/i, 'pronouns'],
  [/sexual orientation/i, 'sexualOrientation'],
  [/\bgender\b/i, 'gender'],
  [/\b(race|ethnicity)\b|ethnic background|hispanic|latino/i, 'race'],
  [/\bveteran\b/i, 'veteranStatus'],
  [/\bdisab(ility|led)\b/i, 'disabilityStatus'],
  [/how did you (hear|find)|where did you (hear|find)|referral source/i, 'howHeard'],
];

// Fallback for legacy call sites that classify then call answerFor without
// threading the label: classifyLabel records the label it matched so polarity
// still resolves. Correct only while classify and answer stay adjacent and
// synchronous — new call sites must pass the label explicitly.
let lastClassified: { readonly label: string; readonly concept: FieldConcept } | null = null;

export function classifyLabel(label: string): FieldConcept | null {
  const text = label.trim();
  for (const [re, concept] of RULES) {
    if (re.test(text)) {
      lastClassified = { label: text, concept };
      return concept;
    }
  }
  lastClassified = null;
  return null;
}

/** Learned rules first, built-in RULES second. Synchronous by design: callers
 * await loadLabelOverrides() once per run; before that the rule set is empty and
 * only built-ins apply. */
export function classifyLabelWithRules(label: string, ats: string | null): FieldConcept | null {
  const text = label.trim();
  for (const rule of compiledRules ?? []) {
    if (rule.ats !== null && rule.ats !== ats) continue;
    if (rule.re.test(text)) {
      lastClassified = { label: text, concept: rule.concept };
      return rule.concept;
    }
  }
  return classifyLabel(label);
}

export async function classifyLabelWithOverrides(label: string, ats: string | null): Promise<FieldConcept | null> {
  await loadLabelOverrides();
  return classifyLabelWithRules(label, ats);
}

const NEGATED_STATEMENT_RE =
  /\b(do(es)?\s+not|don['’]?t|will\s+not|won['’]?t|never)\s+(?:\w+\s+){0,6}(require|need)\b|\bwithout\s+(?:\w+\s+){0,4}sponsorship\b|\bno\s+sponsorship\b/i;
const REQUIREMENT_RE =
  /\b(will|do|does|would|are)\s+you\b.*\b(require|need)\b|\brequire[sd]?\b.*\b(sponsorship|visa|authorization)\b|\bneeds?\b.*\b(sponsorship|visa|authorization)\b|\b(sponsorship|visa)\b.*\brequired\b/i;

function yesLike(v: string | undefined): boolean {
  return v !== undefined && /^(y|yes|true)$/i.test(v.trim());
}

function noLike(v: string | undefined): boolean {
  return v !== undefined && /^(n|no|false)$/i.test(v.trim());
}

function statementAgreement(p: StandingProfile): string | undefined {
  if (yesLike(p.workAuthorization) && noLike(p.sponsorship)) return 'Yes';
  if (noLike(p.workAuthorization) || yesLike(p.sponsorship)) return 'No';
  return undefined;
}

function polarityAnswer(
  label: string,
  concept: 'sponsorship' | 'workAuthorization',
  p: StandingProfile,
): { readonly value: string | undefined } | null {
  if (NEGATED_STATEMENT_RE.test(label)) return { value: statementAgreement(p) };
  if (REQUIREMENT_RE.test(label)) {
    if (concept === 'sponsorship') {
      return { value: p.sponsorship !== undefined && p.sponsorship !== '' ? p.sponsorship : undefined };
    }
    return { value: yesLike(p.sponsorship) || noLike(p.sponsorship) ? p.sponsorship : undefined };
  }
  if (SPONSORSHIP_RE.test(label) && WORKAUTH_RE.test(label)) return { value: statementAgreement(p) };
  return null;
}

// prettier-ignore
const US_STATES: Readonly<Record<string, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function usStateFrom(location: string | undefined): string | undefined {
  if (location === undefined) return undefined;
  const m = /,\s*([A-Za-z]{2})\s*$/.exec(location.trim());
  return m?.[1] !== undefined ? US_STATES[m[1].toUpperCase()] : undefined;
}

function numericSalary(v: string): boolean {
  const stripped = v.replace(/usd|[$€£,\s]/gi, '');
  return /^\d+(\.\d+)?k?$/i.test(stripped);
}

// A wrong "No" on a knock-out question silently disqualifies the application,
// so when polarity is uncertain the answer must be undefined, never a guess.
export function answerFor(concept: FieldConcept, p: StandingProfile, label?: string): string | undefined {
  if (concept === 'sponsorship' || concept === 'workAuthorization') {
    const effectiveLabel =
      label ?? (lastClassified !== null && lastClassified.concept === concept ? lastClassified.label : undefined);
    if (effectiveLabel !== undefined) {
      const polar = polarityAnswer(effectiveLabel, concept, p);
      if (polar !== null) return polar.value;
    }
  }
  // The salary policy is guidance for the reviewing session, never a fill value —
  // a policy sentence typed into a salary box reads as a garbage answer.
  if (concept === 'desiredSalaryPolicy') return undefined;
  if (concept === 'expectedSalary') {
    return p.expectedSalary !== undefined && numericSalary(p.expectedSalary) ? p.expectedSalary : undefined;
  }
  // Needing relocation assistance is a different fact (opposite polarity risk)
  // from being willing to relocate.
  if (concept === 'relocation' && label !== undefined && /assistance/i.test(label)) return undefined;
  const direct = p[concept];
  if (direct !== undefined && direct !== '') return direct;
  if (concept === 'fullName' && p.firstName && p.lastName) return `${p.firstName} ${p.lastName}`;
  if (concept === 'locationCity' && p.location) return p.location;
  if (concept === 'state') return usStateFrom(p.location);
  if (concept === 'country' && usStateFrom(p.location) !== undefined) return 'United States';
  return undefined;
}
