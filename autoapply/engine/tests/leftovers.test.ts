import { describe, it, expect } from 'vitest';
import { buildLeftovers } from '../src/leftovers.ts';
import type { FillOutcome } from '../src/ats/types.ts';
import type { ValidationOutcome } from '../src/ats/types.ts';

const FILL: FillOutcome = {
  filledKnown: 12,
  freeform: [
    { fieldKey: 'q1', label: 'Why do you want this role?', kind: 'textarea' },
    { fieldKey: 'q2', label: 'Years of experience', kind: 'select', options: ['0-2', '3-5', '5+'] },
  ],
  guesses: [
    { fieldKey: 'location', question: 'Location', answer: 'San Francisco', reason: 'dropdown' },
  ],
  resumeUploaded: true,
};

const VALIDATION: ValidationOutcome = {
  ok: false,
  blockers: ['Cover letter'],
  captcha: false,
};

describe('buildLeftovers', () => {
  it('includes url, company, role', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.url).toBe('https://example.com/job/123');
    expect(result.company).toBe('Acme');
    expect(result.role).toBe('Engineer');
  });

  it('maps freeform questions to fields array', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toEqual({ fieldKey: 'q1', label: 'Why do you want this role?', kind: 'textarea' });
    expect(result.fields[1]).toEqual({
      fieldKey: 'q2',
      label: 'Years of experience',
      kind: 'select',
      options: ['0-2', '3-5', '5+'],
    });
  });

  it('includes blockers from validation', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.blockers).toEqual(['Cover letter']);
  });

  it('sets captcha from validation', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: { ok: false, blockers: [], captcha: true },
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.captcha).toBe(true);
  });

  it('sets resumeUploaded and filledKnown from outcome', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.resumeUploaded).toBe(true);
    expect(result.filledKnown).toBe(12);
  });

  it('copies guesses array', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(result.guesses).toEqual(FILL.guesses);
  });

  it('sets prefilledAt from now()', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'Engineer',
      outcome: FILL,
      validation: VALIDATION,
      now: () => '2026-06-10T15:00:00.000Z',
    });
    expect(result.prefilledAt).toBe('2026-06-10T15:00:00.000Z');
  });

  it('produces exact schema shape', () => {
    const result = buildLeftovers({
      url: 'https://example.com/job/123',
      company: 'Acme',
      role: 'SWE',
      outcome: { filledKnown: 0, freeform: [], guesses: [], resumeUploaded: false },
      validation: { ok: true, blockers: [], captcha: false },
      now: () => '2026-06-10T00:00:00.000Z',
    });
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      ['blockers', 'captcha', 'company', 'fields', 'filledKnown', 'guesses', 'prefilledAt', 'resumeUploaded', 'role', 'url'].sort(),
    );
  });
});
