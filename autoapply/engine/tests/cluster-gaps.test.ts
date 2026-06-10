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
});
