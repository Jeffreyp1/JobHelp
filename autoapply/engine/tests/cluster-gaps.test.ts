import { describe, it, expect } from 'vitest';
import { parseGapLines, clusterGaps, renderMarkdown } from '../src/cluster-gaps.ts';

const ENTRY_A = JSON.stringify({
  ts: '2026-06-01T10:00:00Z',
  ats: 'greenhouse',
  company: 'Acme',
  jobSlug: 'acme-eng-001',
  url: 'https://example.com/1',
  question: 'How many years of C++ experience?',
  fieldKind: 'text',
  options: [],
  required: false,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: '',
});

const ENTRY_B = JSON.stringify({
  ts: '2026-06-02T12:00:00Z',
  ats: 'ashby',
  company: 'Beta',
  jobSlug: 'beta-eng-002',
  url: 'https://example.com/2',
  question: 'How many years of C++ experience?*',
  fieldKind: 'radio',
  options: ['0-2', '3-5', '5+'],
  required: true,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: '',
});

const ENTRY_C = JSON.stringify({
  ts: '2026-06-03T08:00:00Z',
  ats: 'greenhouse',
  company: 'Gamma',
  jobSlug: 'gamma-swe-003',
  url: 'https://example.com/3',
  question: 'HOW MANY YEARS OF C++ EXPERIENCE?',
  fieldKind: 'select',
  options: [],
  required: false,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: '',
});

const ENTRY_D = JSON.stringify({
  ts: '2026-06-01T09:00:00Z',
  ats: 'lever',
  company: 'Delta',
  jobSlug: 'delta-dev-004',
  url: 'https://example.com/4',
  question: 'Are you authorized to work in the US?',
  fieldKind: 'combobox',
  options: ['Yes', 'No'],
  required: true,
  reason: 'consent-or-signature',
  filledBy: 'none',
  notes: '',
});

describe('parseGapLines', () => {
  it('parses valid lines and skips blank lines', () => {
    const raw = `\n${ENTRY_A}\n\n${ENTRY_D}\n`;
    const entries = parseGapLines(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.question).toBe('How many years of C++ experience?');
    expect(entries[1]?.question).toBe('Are you authorized to work in the US?');
  });

  it('throws with line number on invalid JSON', () => {
    const raw = `${ENTRY_A}\nnot json\n${ENTRY_D}`;
    expect(() => parseGapLines(raw)).toThrow(/line 2/i);
  });

  it('throws with line number when question field is missing', () => {
    const noQuestion = JSON.stringify({ ts: '2026-06-01T00:00:00Z', ats: 'x', reason: 'no-standing-answer' });
    expect(() => parseGapLines(noQuestion)).toThrow(/line 1/i);
  });

  it('throws with line number when reason field is missing', () => {
    const noReason = JSON.stringify({ ts: '2026-06-01T00:00:00Z', ats: 'x', question: 'Q?' });
    expect(() => parseGapLines(noReason)).toThrow(/line 1/i);
  });

  it('defaults optional fields on sparse rows so clustering never crashes', () => {
    const sparse = JSON.stringify({
      ts: '2026-06-10T00:00:00Z',
      question: 'Do you require sponsorship?',
      reason: 'no-standing-answer',
    });
    const entries = parseGapLines(`${sparse}\n${ENTRY_A}`);
    expect(entries[0]?.options).toEqual([]);
    expect(entries[0]?.notes).toBe('');
    expect(entries[0]?.required).toBe(false);
    const clusters = clusterGaps(entries);
    expect(clusters.length).toBeGreaterThan(0);
    expect(() => renderMarkdown(clusters)).not.toThrow();
  });
});

describe('clusterGaps', () => {
  it('clusters entries with same normalized question together', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(3);
  });

  it('aggregates atses as unique sorted list', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.atses).toEqual(['ashby', 'greenhouse']);
  });

  it('aggregates fieldKinds as unique sorted list', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.fieldKinds).toEqual(['radio', 'select', 'text']);
  });

  it('required is true if ANY entry is required', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.required).toBe(true);
  });

  it('required is false when no entry is required', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.required).toBe(false);
  });

  it('options come from first entry that had options', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.options).toEqual(['0-2', '3-5', '5+']);
  });

  it('firstSeen is min ts, lastSeen is max ts', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.firstSeen).toBe('2026-06-01T10:00:00Z');
    expect(clusters[0]?.lastSeen).toBe('2026-06-03T08:00:00Z');
  });

  it('most frequent question text wins for question field', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.question).toBe('How many years of C++ experience?');
  });

  it('jobSlugs are unique, in first-seen order', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.jobSlugs).toEqual(['acme-eng-001', 'beta-eng-002', 'gamma-swe-003']);
  });

  it('sorts by count desc then lastSeen desc', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.count).toBe(3);
    expect(clusters[1]?.count).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(clusterGaps([])).toEqual([]);
  });

  it('normalizedKey strips trailing punctuation and collapses whitespace', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B].join('\n'));
    const clusters = clusterGaps(entries);
    const key = clusters[0]?.normalizedKey;
    expect(key).not.toMatch(/[?*]/);
    expect(key).not.toMatch(/\s{2,}/);
  });
});

const MONGO = JSON.stringify({
  ts: '2026-06-04T10:00:00Z',
  ats: 'greenhouse',
  company: 'MongoDB',
  jobSlug: 'mongodb-swe-005',
  url: 'https://example.com/5',
  question: 'Have you ever worked at MongoDB before?',
  fieldKind: 'radio',
  options: ['Yes', 'No'],
  required: true,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: 'asked on final page',
});

const TWILIO = JSON.stringify({
  ts: '2026-06-05T10:00:00Z',
  ats: 'lever',
  company: 'Twilio',
  jobSlug: 'twilio-swe-006',
  url: 'https://example.com/6',
  question: 'Have you ever worked at Twilio before?',
  fieldKind: 'radio',
  options: ['Yes', 'No'],
  required: true,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: 'radio pair under label',
});

const STRIPE_MISSPELLED_COMPANY = JSON.stringify({
  ts: '2026-06-06T10:00:00Z',
  ats: 'ashby',
  company: 'Stripe, Inc.',
  jobSlug: 'stripe-swe-007',
  url: 'https://example.com/7',
  question: 'Have you ever worked at Stripe before?',
  fieldKind: 'radio',
  options: ['Yes', 'No'],
  required: true,
  reason: 'no-standing-answer',
  filledBy: 'none',
  notes: '',
});

describe('company folding', () => {
  it('merges the same question phrased with different company names', () => {
    const entries = parseGapLines([MONGO, TWILIO].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(2);
  });

  it('folds "at <ProperNoun>" even when the company field spelling differs', () => {
    const entries = parseGapLines([MONGO, STRIPE_MISSPELLED_COMPANY].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters).toHaveLength(1);
  });

  it('normalizedKey contains the {company} placeholder, not the company name', () => {
    const entries = parseGapLines(MONGO);
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.normalizedKey).toContain('{company}');
    expect(clusters[0]?.normalizedKey).not.toMatch(/mongodb/i);
  });

  it('does not merge genuinely different questions', () => {
    const entries = parseGapLines([MONGO, ENTRY_A].join('\n'));
    expect(clusterGaps(entries)).toHaveLength(2);
  });
});

describe('reason as attribute', () => {
  const Q_NSA = JSON.stringify({
    ts: '2026-06-07T10:00:00Z', ats: 'greenhouse', company: 'Acme',
    jobSlug: 'acme-eng-001', url: 'https://example.com/1',
    question: 'What is your notice period?', fieldKind: 'text', options: [],
    required: false, reason: 'no-standing-answer', filledBy: 'none', notes: '',
  });
  const Q_WIDGET = JSON.stringify({
    ts: '2026-06-08T10:00:00Z', ats: 'ashby', company: 'Beta',
    jobSlug: 'beta-eng-002', url: 'https://example.com/2',
    question: 'What is your notice period?', fieldKind: 'combobox', options: [],
    required: false, reason: 'unrecognized-widget', filledBy: 'none', notes: '',
  });

  it('clusters the same question across different reasons', () => {
    const entries = parseGapLines([Q_NSA, Q_WIDGET, Q_NSA].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(3);
  });

  it('reason is the most frequent reason; reasons lists all unique sorted', () => {
    const entries = parseGapLines([Q_NSA, Q_WIDGET, Q_NSA].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.reason).toBe('no-standing-answer');
    expect(clusters[0]?.reasons).toEqual(['no-standing-answer', 'unrecognized-widget']);
  });

  it('normalizedKey does not embed the reason', () => {
    const entries = parseGapLines(ENTRY_A);
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.normalizedKey).not.toContain('no-standing-answer');
  });
});

describe('notes aggregation', () => {
  it('collects unique non-empty notes', () => {
    const entries = parseGapLines([MONGO, TWILIO, STRIPE_MISSPELLED_COMPANY].join('\n'));
    const clusters = clusterGaps(entries);
    expect(clusters[0]?.notes).toEqual(['asked on final page', 'radio pair under label']);
  });
});

describe('renderMarkdown', () => {
  it('contains the question text in the table', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D].join('\n'));
    const clusters = clusterGaps(entries);
    const md = renderMarkdown(clusters);
    expect(md).toContain('How many years of C++ experience?');
    expect(md).toContain('Are you authorized to work in the US?');
  });

  it('contains the count in the table', () => {
    const entries = parseGapLines([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D].join('\n'));
    const clusters = clusterGaps(entries);
    const md = renderMarkdown(clusters);
    expect(md).toContain('3');
  });

  it('contains reason column header', () => {
    const entries = parseGapLines(ENTRY_A);
    const md = renderMarkdown(clusterGaps(entries));
    expect(md).toContain('reason');
  });

  it('returns empty string for empty cluster list', () => {
    expect(renderMarkdown([])).toBe('');
  });

  it('includes options and notes columns', () => {
    const entries = parseGapLines([MONGO, TWILIO].join('\n'));
    const md = renderMarkdown(clusterGaps(entries));
    expect(md).toContain('| options |');
    expect(md).toContain('| notes |');
    expect(md).toContain('Yes / No');
    expect(md).toContain('asked on final page');
  });

  it('renders empty options and notes as blank cells without crashing', () => {
    const entries = parseGapLines(ENTRY_A);
    const md = renderMarkdown(clusterGaps(entries));
    expect(md).toContain('How many years of C++ experience?');
  });
});
