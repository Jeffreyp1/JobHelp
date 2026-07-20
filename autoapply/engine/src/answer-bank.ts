import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { answerBankPath } from './paths.ts';
import { log } from './log.ts';

export interface BankHit {
  readonly answer: string;
  readonly exact: boolean;
}

/** Byte-identical to the derivation the auto-apply-review skill documents:
 * trim -> lowercase -> strip a trailing run of `* ? . :` -> remove `, : ; " ' ( )`
 * -> collapse whitespace runs -> trim. */
export function normalizeQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/[*?.:]+$/, '')
    .replace(/[,:;"'()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bankKey(question: string, options: readonly string[]): string {
  const sorted = [...options].sort();
  return createHash('sha256').update(JSON.stringify([normalizeQuestion(question), sorted])).digest('hex');
}

let cache: Map<string, string> | null = null;

export function resetAnswerBankCache(): void {
  cache = null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function stringArray(v: unknown): readonly string[] | null {
  return Array.isArray(v) && v.every((s): s is string => typeof s === 'string') ? v : null;
}

function indexEntry(map: Map<string, string>, raw: unknown): void {
  if (!isRecord(raw)) return;
  const { question, answer, approved, companySpecific, options, key } = raw;
  if (typeof question !== 'string' || question === '' || typeof answer !== 'string' || answer === '') return;
  if (approved !== true) return;
  // The engine replays verbatim; company-specific text has to be rewritten per
  // company, which only the reviewing session can do.
  if (companySpecific === true) return;
  const opts = stringArray(options) ?? [];
  const derived = bankKey(question, opts);
  map.set(derived, answer);
  if (typeof key === 'string' && key !== '' && key !== derived) {
    // Keep the stored key addressable (the question text may have been edited
    // after the key was minted) but surface the drift — it can also mean the
    // writer's derivation no longer matches this one.
    log('warn', 'answer-bank entry key differs from derived key', { key, derived });
    map.set(key, answer);
  }
}

async function loadBank(): Promise<Map<string, string>> {
  if (cache !== null) return cache;
  const map = new Map<string, string>();
  cache = map;
  const p = answerBankPath();
  let raw: string;
  try {
    raw = await readFile(p, 'utf8');
  } catch {
    return map;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('warn', 'answer bank is not valid JSON; ignoring', { path: p });
    return map;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['entries'])) {
    log('warn', 'answer bank has no entries array; ignoring', { path: p });
    return map;
  }
  for (const entry of parsed['entries']) indexEntry(map, entry);
  return map;
}

/** Approved, non-company-specific answers only. `exact` means the field's own
 * option set hashed to the stored key, so the stored text is one of the presented
 * options and fills deterministically; a free-text replay is never exact —
 * verbatim reuse of prose always lands in the review tier. */
export async function lookupApproved(question: string, options: readonly string[]): Promise<BankHit | null> {
  const bank = await loadBank();
  if (options.length > 0) {
    const optioned = bank.get(bankKey(question, options));
    if (optioned !== undefined) return { answer: optioned, exact: true };
  }
  const freeText = bank.get(bankKey(question, []));
  if (freeText !== undefined) return { answer: freeText, exact: false };
  return null;
}
