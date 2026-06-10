import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FieldConcept, StandingProfile } from './types.ts';

const VALID_CONCEPTS = new Set<string>([
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'location', 'locationCity',
  'country', 'linkedin', 'github', 'portfolio', 'website', 'workAuthorization',
  'sponsorship', 'gender', 'race', 'veteranStatus', 'disabilityStatus', 'howHeard',
]);

interface LabelRule {
  readonly pattern: string;
  readonly flags: string;
  readonly concept: string;
  readonly ats: string | null;
}

interface OverridesFile {
  readonly labelRules: readonly LabelRule[];
}

let overridesPath: string | null = null;
let overridesCache: OverridesFile | null | 'empty' = null;
let warnedBadFile = false;

function defaultOverridesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'overrides.json');
}

export function setOverridesPath(p: string): void {
  overridesPath = p;
  overridesCache = null;
  warnedBadFile = false;
}

async function loadOverrides(): Promise<OverridesFile | null> {
  if (overridesCache !== null) return overridesCache === 'empty' ? null : overridesCache;
  const p = overridesPath ?? defaultOverridesPath();
  let raw: string;
  try {
    raw = await readFile(p, 'utf8');
  } catch {
    if (!warnedBadFile) {
      warnedBadFile = true;
    }
    overridesCache = 'empty';
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!warnedBadFile) {
      warnedBadFile = true;
    }
    overridesCache = 'empty';
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>)['labelRules'])) {
    overridesCache = 'empty';
    return null;
  }
  const result = parsed as OverridesFile;
  overridesCache = result;
  return result;
}

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
  // sponsorship/work-authorization MUST precede location/country: these questions
  // often contain "location" or "country" ("...remain in your current location?",
  // "...authorized to work in this country?") and would otherwise mis-match those.
  // sponsorship itself precedes workAuthorization for the same reason — a sponsorship
  // question often also names "work authorization".
  [/sponsor(ship)?|require (a )?visa|need (a )?visa|\bvisa status\b/i, 'sponsorship'],
  [/authoriz(ed|ation) to work|legally authorized|work authorization|eligible to work/i, 'workAuthorization'],
  [/\bcountry\b/i, 'country'],
  [/location.*city|\(city\)|^city\b/i, 'locationCity'],
  [/\b(city|location)\b|where are you|where are you based|\bbased\b/i, 'location'],
  [/\bgender\b/i, 'gender'],
  [/\b(race|ethnicity)\b|ethnic background|hispanic|latino/i, 'race'],
  [/\bveteran\b/i, 'veteranStatus'],
  [/\bdisab(ility|led)\b/i, 'disabilityStatus'],
  [/how did you (hear|find)|where did you (hear|find)|referral source/i, 'howHeard'],
];

export function classifyLabel(label: string): FieldConcept | null {
  const text = label.trim();
  for (const [re, concept] of RULES) {
    if (re.test(text)) return concept;
  }
  return null;
}

export async function classifyLabelWithOverrides(label: string, ats: string | null): Promise<FieldConcept | null> {
  const overrides = await loadOverrides();
  if (overrides) {
    const text = label.trim();
    for (const rule of overrides.labelRules) {
      if (rule.ats !== null && rule.ats !== ats) continue;
      if (!VALID_CONCEPTS.has(rule.concept)) {
        continue;
      }
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, rule.flags);
      } catch {
        continue;
      }
      if (re.test(text)) return rule.concept as FieldConcept;
    }
  }
  return classifyLabel(label);
}

export function answerFor(concept: FieldConcept, p: StandingProfile): string | undefined {
  const direct = p[concept];
  if (direct !== undefined && direct !== '') return direct;
  if (concept === 'fullName' && p.firstName && p.lastName) return `${p.firstName} ${p.lastName}`;
  if (concept === 'locationCity' && p.location) return p.location;
  return undefined;
}
