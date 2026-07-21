/**
 * The stored application profile carries scalar standing answers plus a
 * structured list of schools. Form fields are filled from a flat scalar view,
 * so `resolveScalars` collapses the profile into that view — deriving a single
 * `school` text value from the first schools[] entry when no explicit scalar is
 * set. Pure and unit-tested.
 */
import type { ApplicationProfile, ProfileScalars } from './autofill.js';

export interface SchoolEntry {
  school: string;
  degree?: string;
  field?: string;
  startYear?: string;
  endYear?: string;
}

export function resolveScalars(profile: ApplicationProfile): ProfileScalars {
  const { schools, ...scalars } = profile;
  const primary = schools && schools.length > 0 ? schools[0].school : undefined;
  if (!scalars.school && primary) scalars.school = primary;
  return scalars;
}
