import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { FilledField } from '../src/ats/types.ts';
import { buildReport } from '../src/review.ts';
import {
  buildArtifact,
  deriveTiers,
  readArtifact,
  writeArtifact,
  type ReviewArtifact,
} from '../src/review-artifact.ts';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'review-artifact-'));
}

const JOB = { jobId: 'j1', company: 'Acme', role: 'SWE', url: 'https://fake.test/j1' };

const FIELDS: readonly FilledField[] = [
  { fieldKey: 'name', question: 'Full Name', value: 'Jane Doe', source: 'profile' },
  { fieldKey: 'email', question: 'Email', value: 'jane@example.com', source: 'profile' },
  { fieldKey: 'sponsor', question: 'Need sponsorship?', value: 'No', source: 'answer-bank', exact: true, options: ['Yes', 'No'] },
  { fieldKey: 'notice', question: 'Notice period', value: '2 weeks', source: 'answer-bank', exact: false, reason: 'freeform' },
  { fieldKey: 'years', question: 'Years of experience', value: '0 - 3 years', source: 'guessed', reason: 'dropdown' },
  { fieldKey: 'why', question: 'Why us?', value: 'Because...', source: 'drafted', reason: 'freeform', provenance: 'resume.v1.md: LLM bullets' },
];

describe('deriveTiers', () => {
  it('matches buildReport for equivalent inputs', () => {
    const derived = deriveTiers({ fields: FIELDS, blockers: ['Location'], captcha: false, notes: ['PDF trimmed: 1 bullets dropped'] });
    const legacy = buildReport({
      green: 3,
      guessed: [
        { fieldKey: 'notice', question: 'Notice period', answer: '2 weeks', reason: 'freeform' },
        { fieldKey: 'years', question: 'Years of experience', answer: '0 - 3 years', reason: 'dropdown' },
        { fieldKey: 'why', question: 'Why us?', answer: 'Because...', reason: 'freeform' },
      ],
      blockers: ['Location'],
      captcha: false,
      notes: ['PDF trimmed: 1 bullets dropped'],
    });
    expect(derived).toEqual(legacy);
  });

  it('is ready with only deterministic fields, review with a yellow, blocked with a captcha', () => {
    const deterministic = FIELDS.slice(0, 3);
    expect(deriveTiers({ fields: deterministic, blockers: [], captcha: false }).verdict).toBe('ready');
    expect(deriveTiers({ fields: FIELDS, blockers: [], captcha: false }).verdict).toBe('review');
    expect(deriveTiers({ fields: deterministic, blockers: [], captcha: true }).verdict).toBe('blocked');
  });
});

describe('buildArtifact + write + read round-trip', () => {
  it('persists every field with source and survives a round-trip', async () => {
    const dir = await tmp();
    const artifact = buildArtifact({
      ...JOB,
      fields: FIELDS,
      blockers: [],
      captcha: false,
      now: () => '2026-07-23T00:00:00.000Z',
    });
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.verdict).toBe('review');
    expect(artifact.green).toBe(3);
    expect(artifact.fields).toHaveLength(6);
    await writeArtifact(dir, artifact);
    expect(await readArtifact(dir)).toEqual(artifact);
  });

  it('carries notes only when non-empty', () => {
    const bare = buildArtifact({ ...JOB, fields: [], blockers: [], captcha: false, now: () => 't' });
    expect('notes' in bare).toBe(false);
  });
});

describe('readArtifact legacy tolerance', () => {
  it('returns null when the file is absent', async () => {
    expect(await readArtifact(await tmp())).toBeNull();
  });

  it('throws on a malformed file', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'autoapply-review.json'), JSON.stringify({ green: 'nope' }));
    await expect(readArtifact(dir)).rejects.toThrow(/review/);
  });

  it('upgrades the legacy engine report shape', async () => {
    const dir = await tmp();
    const legacy = buildReport({
      green: 4,
      guessed: [{ fieldKey: 'q1', question: 'Why us?', answer: 'Because...', reason: 'freeform' }],
      blockers: ['Location'],
      captcha: false,
      notes: ['submit selector drifted - review before submitting'],
    });
    await writeFile(join(dir, 'autoapply-review.json'), JSON.stringify(legacy));
    const up = (await readArtifact(dir)) as ReviewArtifact;
    expect(up.schemaVersion).toBe(2);
    expect(up.verdict).toBe('blocked');
    expect(up.green).toBe(4);
    expect(up.blockers).toEqual(['Location']);
    expect(up.notes).toEqual(['submit selector drifted - review before submitting']);
    expect(up.fields).toEqual([
      { fieldKey: 'Why us?', question: 'Why us?', value: 'Because...', source: 'guessed', reason: 'freeform' },
    ]);
  });

  it('upgrades the legacy skill-written shape', async () => {
    const dir = await tmp();
    const legacy = {
      company: 'Writer',
      role: 'SWE, generative AI',
      url: 'https://jobs.ashbyhq.com/writer/x/application',
      filledAt: '2026-06-10T00:13:40Z',
      fields: [
        { label: 'Email', value: 'jane@example.com', source: 'profile', review: false },
        { label: 'Why us?', value: 'Because...', source: 'drafted', provenance: 'resume.v4.md: bullets', review: true },
      ],
      blockers: ['Relocation - not in profile'],
      screenshotNote: 'final state verified',
    };
    await writeFile(join(dir, 'autoapply-review.json'), JSON.stringify(legacy));
    const up = (await readArtifact(dir)) as ReviewArtifact;
    expect(up.schemaVersion).toBe(2);
    expect(up.company).toBe('Writer');
    expect(up.url).toBe('https://jobs.ashbyhq.com/writer/x/application');
    expect(up.blockers).toEqual(['Relocation - not in profile']);
    expect(up.verdict).toBe('blocked');
    expect(up.green).toBe(1);
    expect(up.fields).toEqual([
      { fieldKey: 'Email', question: 'Email', value: 'jane@example.com', source: 'profile' },
      { fieldKey: 'Why us?', question: 'Why us?', value: 'Because...', source: 'drafted', reason: 'freeform', provenance: 'resume.v4.md: bullets' },
    ]);
  });

  it('reads a raw JSON file that already carries schemaVersion 2 unchanged', async () => {
    const dir = await tmp();
    const artifact = buildArtifact({ ...JOB, fields: FIELDS.slice(0, 2), blockers: [], captcha: false, now: () => 't' });
    await writeFile(join(dir, 'autoapply-review.json'), JSON.stringify(artifact));
    expect(await readArtifact(dir)).toEqual(artifact);
  });
});
