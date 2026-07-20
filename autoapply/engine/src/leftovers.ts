import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FillOutcome } from './ats/types.ts';
import type { ValidationOutcome } from './ats/types.ts';
import type { FreeformQuestion, GuessedField } from './types.ts';

export interface LeftoversFile {
  readonly url: string;
  readonly company: string;
  readonly role: string;
  readonly fields: readonly FreeformQuestion[];
  readonly blockers: readonly string[];
  readonly captcha: boolean;
  readonly resumeUploaded: boolean;
  readonly guesses: readonly GuessedField[];
  readonly filledKnown: number;
  readonly prefilledAt: string;
  /** Run-level caveats (e.g. resume PDF trimmed to fit one page). Present only
   * when non-empty. */
  readonly notes?: readonly string[];
}

export interface BuildLeftoversInput {
  readonly url: string;
  readonly company: string;
  readonly role: string;
  readonly outcome: FillOutcome;
  readonly validation: ValidationOutcome;
  readonly now: () => string;
  readonly notes?: readonly string[];
}

export function buildLeftovers(i: BuildLeftoversInput): LeftoversFile {
  return {
    url: i.url,
    company: i.company,
    role: i.role,
    fields: i.outcome.freeform.map((q) =>
      q.options !== undefined
        ? { fieldKey: q.fieldKey, label: q.label, kind: q.kind, options: q.options }
        : { fieldKey: q.fieldKey, label: q.label, kind: q.kind },
    ),
    blockers: [...i.validation.blockers],
    captcha: i.validation.captcha,
    resumeUploaded: i.outcome.resumeUploaded,
    guesses: [...i.outcome.guesses],
    filledKnown: i.outcome.filledKnown,
    prefilledAt: i.now(),
    ...(i.notes !== undefined && i.notes.length > 0 ? { notes: i.notes } : {}),
  };
}

export async function writeLeftovers(dir: string, data: LeftoversFile): Promise<void> {
  await writeFile(join(dir, 'autoapply-leftovers.json'), JSON.stringify(data, null, 2));
}

function isLeftoversFile(v: unknown): v is LeftoversFile {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['url'] === 'string' &&
    typeof r['resumeUploaded'] === 'boolean' &&
    Array.isArray(r['fields']) &&
    Array.isArray(r['blockers'])
  );
}

export async function readLeftovers(dir: string): Promise<LeftoversFile | null> {
  const path = join(dir, 'autoapply-leftovers.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && Reflect.get(e, 'code') === 'ENOENT') return null;
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isLeftoversFile(parsed)) throw new Error(`${path} is not a valid leftovers file`);
  return parsed;
}
