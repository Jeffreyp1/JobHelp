import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FilledField } from './ats/types.ts';
import type { GuessedField, ReviewReport, ReviewVerdict } from './types.ts';
import { buildReport } from './review.ts';

export interface VerifierSummary {
  readonly verdict: 'PASS' | 'BLOCK';
  readonly checked: number;
  readonly flaggedKeys: readonly string[];
  readonly checkedAt: string;
}

/** The one canonical per-job review file (schemaVersion 2): every filled field
 * with its source, plus the legacy verdict/green tiers derived from them. Both
 * the engine and the skill layer write this shape. */
export interface ReviewArtifact {
  readonly schemaVersion: 2;
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly url: string;
  readonly filledAt: string;
  readonly verdict: ReviewVerdict;
  readonly green: number;
  readonly captcha: boolean;
  readonly blockers: readonly string[];
  readonly fields: readonly FilledField[];
  readonly notes?: readonly string[];
  readonly screenshotPath?: string;
  readonly verifier?: VerifierSummary;
}

/** A field the human (or verifier) must look at: model-drafted, fuzzy-matched,
 * or an answer-bank replay whose option set did not match exactly. */
export function reviewable(f: FilledField): boolean {
  if (f.source === 'drafted' || f.source === 'guessed') return true;
  return f.source === 'answer-bank' && f.exact !== true;
}

export function deriveTiers(i: {
  fields: readonly FilledField[];
  blockers: readonly string[];
  captcha: boolean;
  notes?: readonly string[];
}): ReviewReport {
  const guessed: GuessedField[] = i.fields.filter(reviewable).map((f) => ({
    fieldKey: f.fieldKey,
    question: f.question,
    answer: f.value,
    reason: f.reason ?? 'freeform',
  }));
  return buildReport({
    green: i.fields.length - guessed.length,
    guessed,
    blockers: i.blockers,
    captcha: i.captcha,
    ...(i.notes !== undefined ? { notes: i.notes } : {}),
  });
}

export interface BuildArtifactInput {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly url: string;
  readonly fields: readonly FilledField[];
  readonly blockers: readonly string[];
  readonly captcha: boolean;
  readonly now: () => string;
  readonly notes?: readonly string[];
}

export function buildArtifact(i: BuildArtifactInput): ReviewArtifact {
  const tiers = deriveTiers({
    fields: i.fields,
    blockers: i.blockers,
    captcha: i.captcha,
    ...(i.notes !== undefined ? { notes: i.notes } : {}),
  });
  return {
    schemaVersion: 2,
    jobId: i.jobId,
    company: i.company,
    role: i.role,
    url: i.url,
    filledAt: i.now(),
    verdict: tiers.verdict,
    green: tiers.green,
    captcha: i.captcha,
    blockers: [...i.blockers],
    fields: [...i.fields],
    ...(tiers.notes !== undefined ? { notes: tiers.notes } : {}),
  };
}

const FILE = 'autoapply-review.json';

export async function writeArtifact(dir: string, artifact: ReviewArtifact): Promise<void> {
  await writeFile(join(dir, FILE), JSON.stringify(artifact, null, 2));
}

const KNOWN_SOURCES = new Set<FilledField['source']>(['profile', 'answer-bank', 'job-context', 'drafted', 'guessed']);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isV2(r: Record<string, unknown>): boolean {
  return r['schemaVersion'] === 2 && Array.isArray(r['fields']) && typeof r['green'] === 'number';
}

function isLegacyEngine(r: Record<string, unknown>): boolean {
  return typeof r['green'] === 'number' && Array.isArray(r['yellow']) && Array.isArray(r['red']);
}

function isLegacySkill(r: Record<string, unknown>): boolean {
  return (
    Array.isArray(r['fields']) &&
    r['fields'].every((f: unknown) => typeof f === 'object' && f !== null && typeof Reflect.get(f, 'label') === 'string')
  );
}

function upgradeEngine(r: Record<string, unknown>): ReviewArtifact {
  const yellow = r['yellow'] as ReadonlyArray<Record<string, unknown>>;
  const red = r['red'] as ReadonlyArray<Record<string, unknown>>;
  const fields: FilledField[] = yellow.map((y) => ({
    fieldKey: str(y['field']),
    question: str(y['field']),
    value: str(y['answer']),
    source: 'guessed',
    reason: y['why'] === 'closest match' ? 'dropdown' : 'freeform',
  }));
  const notes = Array.isArray(r['notes']) ? r['notes'].map(str) : undefined;
  return {
    schemaVersion: 2,
    jobId: '',
    company: '',
    role: '',
    url: '',
    filledAt: '',
    verdict: (r['verdict'] === 'ready' || r['verdict'] === 'review' ? r['verdict'] : 'blocked') as ReviewVerdict,
    green: r['green'] as number,
    captcha: r['captcha'] === true,
    blockers: red.map((f) => str(f['field'])).filter((f) => f !== 'captcha'),
    fields,
    ...(notes !== undefined && notes.length > 0 ? { notes } : {}),
  };
}

function upgradeSkill(r: Record<string, unknown>): ReviewArtifact {
  const fields: FilledField[] = (r['fields'] as ReadonlyArray<Record<string, unknown>>).map((f) => {
    const rawSource = str(f['source']) as FilledField['source'];
    const source = KNOWN_SOURCES.has(rawSource) ? rawSource : 'guessed';
    return {
      fieldKey: str(f['label']),
      question: str(f['label']),
      value: str(f['value']),
      source,
      ...(source === 'drafted' ? { reason: 'freeform' as const } : {}),
      ...(typeof f['provenance'] === 'string' ? { provenance: f['provenance'] } : {}),
    };
  });
  const blockers = Array.isArray(r['blockers']) ? r['blockers'].map(str) : [];
  const note = str(r['screenshotNote']);
  const tiers = deriveTiers({ fields, blockers, captcha: false });
  return {
    schemaVersion: 2,
    jobId: str(r['jobId']),
    company: str(r['company']),
    role: str(r['role']),
    url: str(r['url']),
    filledAt: str(r['filledAt']),
    verdict: tiers.verdict,
    green: tiers.green,
    captcha: false,
    blockers,
    fields,
    ...(note !== '' ? { notes: [note] } : {}),
  };
}

export async function readArtifact(dir: string): Promise<ReviewArtifact | null> {
  const path = join(dir, FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && Reflect.get(e, 'code') === 'ENOENT') return null;
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path} is not a valid review artifact`);
  const r = parsed as Record<string, unknown>;
  if (isV2(r)) return r as unknown as ReviewArtifact;
  if (isLegacyEngine(r)) return upgradeEngine(r);
  if (isLegacySkill(r)) return upgradeSkill(r);
  throw new Error(`${path} is not a valid review artifact`);
}
