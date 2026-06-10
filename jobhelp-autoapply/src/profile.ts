import { readFile } from 'node:fs/promises';
import type { StandingProfile, ProfileScalars, FieldConcept, EducationEntry } from './types.ts';

const CONCEPTS: readonly FieldConcept[] = [
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'location', 'locationCity', 'country',
  'linkedin', 'github', 'portfolio', 'website', 'workAuthorization', 'sponsorship', 'gender',
  'race', 'veteranStatus', 'disabilityStatus', 'howHeard',
];

const EDU_FIELDS = ['school', 'degree', 'discipline', 'startYear', 'endYear'] as const;

function parseEducation(value: unknown): EducationEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: EducationEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (EDU_FIELDS.every((f) => typeof rec[f] === 'string' && rec[f] !== '')) {
      out.push({
        school: rec['school'] as string,
        degree: rec['degree'] as string,
        discipline: rec['discipline'] as string,
        startYear: rec['startYear'] as string,
        endYear: rec['endYear'] as string,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

export async function loadProfile(path: string): Promise<StandingProfile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`autoapply profile not found at ${path}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('autoapply profile must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const scalars: ProfileScalars = {};
  for (const c of CONCEPTS) {
    const v = record[c];
    if (typeof v === 'string' && v !== '') scalars[c] = v;
  }
  const education = parseEducation(record['education']);
  const coverLetterPath = typeof record['coverLetterPath'] === 'string' ? record['coverLetterPath'] : undefined;
  return {
    ...scalars,
    ...(education !== undefined ? { education } : {}),
    ...(coverLetterPath !== undefined ? { coverLetterPath } : {}),
  };
}
