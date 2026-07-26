import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FreeformQuestion } from './types.ts';

export async function writeQuestions(dir: string, qs: readonly FreeformQuestion[]): Promise<void> {
  await writeFile(join(dir, 'freeform-questions.json'), JSON.stringify(qs, null, 2));
}

export async function readAnswers(dir: string): Promise<Record<string, string> | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'freeform-answers.json'), 'utf8');
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
