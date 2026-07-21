/**
 * Maps a scanned form field to a known profile concept using label/id keyword
 * rules. Deterministic and free — the AI fallback (for fields this returns
 * `null` on) is a separate, later step. Rules are ordered most-specific-first.
 */
import type { FormField } from './scanForm.js';

export type FieldConcept =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'website'
  | 'school'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'currentCompany'
  | 'currentTitle'
  | 'country'
  | 'workAuthorization'
  | 'sponsorship';

interface Rule {
  concept: FieldConcept;
  match: (label: string, id: string) => boolean;
}

const RULES: readonly Rule[] = [
  { concept: 'firstName', match: (l, id) => id === 'first_name' || l.includes('first name') },
  { concept: 'lastName', match: (l, id) => id === 'last_name' || l.includes('last name') },
  { concept: 'email', match: (l, id) => id === 'email' || l.includes('email') },
  {
    concept: 'currentCompany',
    match: (l) =>
      l.includes('current company') || l.includes('current employer') || l.includes('company name'),
  },
  {
    concept: 'currentTitle',
    match: (l) =>
      l.includes('current title') || l.includes('current role') || l.includes('job title') ||
      l.includes('current position'),
  },
  { concept: 'zip', match: (l) => l.includes('zip') || l.includes('postal') },
  { concept: 'city', match: (l) => l.includes('city') },
  { concept: 'state', match: (l) => l.includes('province') || /\bstate\b/.test(l) },
  { concept: 'address', match: (l) => l.includes('address') },
  { concept: 'linkedin', match: (l) => l.includes('linkedin') },
  { concept: 'github', match: (l) => l.includes('github') },
  { concept: 'portfolio', match: (l) => l.includes('portfolio') },
  { concept: 'website', match: (l) => l.includes('website') || l.includes('personal site') },
  {
    concept: 'school',
    match: (l) => l.includes('school') || l.includes('university') || l.includes('college'),
  },
  { concept: 'sponsorship', match: (l) => l.includes('sponsorship') || l.includes('sponsor') },
  {
    concept: 'workAuthorization',
    match: (l) => l.includes('authorized to work') || l.includes('work authorization'),
  },
  { concept: 'country', match: (l, id) => id === 'country' || l.includes('country') },
  { concept: 'phone', match: (l, id) => id === 'phone' || l.includes('phone') },
];

export function classifyField(field: FormField): FieldConcept | null {
  const label = field.label.toLowerCase();
  const id = field.id.toLowerCase();
  for (const rule of RULES) {
    if (rule.match(label, id)) return rule.concept;
  }
  return null;
}
