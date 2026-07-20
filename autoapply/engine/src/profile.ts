import { readFile } from 'node:fs/promises';
import { FIELD_CONCEPTS } from './types.ts';
import type { StandingProfile, ProfileScalars, EducationEntry } from './types.ts';
import { log } from './log.ts';

const EDU_REQUIRED = ['school', 'degree', 'discipline', 'startYear', 'endYear'] as const;

const KNOWN_KEYS = new Set<string>([...FIELD_CONCEPTS, 'education', 'coverLetterPath']);

function optionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function parseEducation(value: unknown): EducationEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: EducationEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (EDU_REQUIRED.every((f) => typeof rec[f] === 'string' && rec[f] !== '')) {
      const startMonth = optionalString(rec, 'startMonth');
      const endMonth = optionalString(rec, 'endMonth');
      out.push({
        school: rec['school'] as string,
        degree: rec['degree'] as string,
        discipline: rec['discipline'] as string,
        startYear: rec['startYear'] as string,
        endYear: rec['endYear'] as string,
        ...(startMonth !== undefined ? { startMonth } : {}),
        ...(endMonth !== undefined ? { endMonth } : {}),
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
  for (const c of FIELD_CONCEPTS) {
    const v = record[c];
    if (typeof v === 'string' && v !== '') scalars[c] = v;
  }
  const unknown = Object.keys(record).filter((k) => !KNOWN_KEYS.has(k) && !k.startsWith('_'));
  if (unknown.length > 0) {
    log('warn', 'autoapply profile has unknown keys the engine will ignore', { keys: unknown });
  }
  const education = parseEducation(record['education']);
  const coverLetterPath = typeof record['coverLetterPath'] === 'string' ? record['coverLetterPath'] : undefined;
  return {
    ...scalars,
    ...(education !== undefined ? { education } : {}),
    ...(coverLetterPath !== undefined ? { coverLetterPath } : {}),
  };
}
