import { writeFile } from 'node:fs/promises';
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
}

export interface BuildLeftoversInput {
  readonly url: string;
  readonly company: string;
  readonly role: string;
  readonly outcome: FillOutcome;
  readonly validation: ValidationOutcome;
  readonly now: () => string;
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
  };
}

export async function writeLeftovers(dir: string, data: LeftoversFile): Promise<void> {
  await writeFile(join(dir, 'autoapply-leftovers.json'), JSON.stringify(data, null, 2));
}
