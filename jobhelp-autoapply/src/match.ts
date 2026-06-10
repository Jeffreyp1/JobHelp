import type { FieldConcept, StandingProfile } from './types.ts';

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

export function answerFor(concept: FieldConcept, p: StandingProfile): string | undefined {
  const direct = p[concept];
  if (direct !== undefined && direct !== '') return direct;
  if (concept === 'fullName' && p.firstName && p.lastName) return `${p.firstName} ${p.lastName}`;
  if (concept === 'locationCity' && p.location) return p.location;
  return undefined;
}
