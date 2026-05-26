import { describe, expect, it } from 'vitest';
import {
  applyValidatorResumeEdits,
  applyScopedResumeEdits,
  getResumeOutline,
} from '../../core/resumes/scoped-edit.js';

const RESUME = `# Jane Doe

## Summary
- Backend engineer focused on APIs.

## Experience
### Acme
- Built REST APIs in Node.js.
- Improved latency by 20%.

### Beta
- Maintained ETL jobs.

## Projects
- Built a job tracker.
`;

describe('getResumeOutline', () => {
  it('returns sections and selectable bullets with stable ids', () => {
    const outline = getResumeOutline(RESUME);
    expect(outline.sections.map((s) => [s.id, s.title])).toEqual([
      ['section-1-summary', 'Summary'],
      ['section-2-experience', 'Experience'],
      ['section-3-acme', 'Acme'],
      ['section-4-beta', 'Beta'],
      ['section-5-projects', 'Projects'],
    ]);
    expect(outline.sections[2]?.bullets).toEqual([
      {
        id: 'section-3-acme-bullet-1',
        text: '- Built REST APIs in Node.js.',
        startLine: 7,
        endLine: 7,
      },
      {
        id: 'section-3-acme-bullet-2',
        text: '- Improved latency by 20%.',
        startLine: 8,
        endLine: 8,
      },
    ]);
  });

  it('includes indented continuation lines in the bullet range', () => {
    const outline = getResumeOutline('# R\n\n## Experience\n- Built APIs\n  with Node.\n- Wrote tests.\n');
    expect(outline.sections[0]?.bullets[0]).toEqual({
      id: 'section-1-experience-bullet-1',
      text: '- Built APIs\n  with Node.',
      startLine: 3,
      endLine: 4,
    });
  });
});

describe('applyScopedResumeEdits', () => {
  it('replaces selected bullets and leaves surrounding resume byte-identical', () => {
    const result = applyScopedResumeEdits(RESUME, {
      replacements: [
        {
          selectionId: 'section-3-acme-bullet-2',
          replacementMarkdown: '- Improved API latency by 20% through query tuning.',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain('- Built REST APIs in Node.js.');
    expect(result.value.content).toContain('- Improved API latency by 20% through query tuning.');
    expect(result.value.content).toContain('### Beta\n- Maintained ETL jobs.');
    expect(result.value.changedSelections).toEqual([
      {
        id: 'section-3-acme-bullet-2',
        type: 'bullet',
        startLine: 8,
        endLine: 8,
      },
    ]);
  });

  it('can replace a whole selected section', () => {
    const result = applyScopedResumeEdits(RESUME, {
      replacements: [
        {
          selectionId: 'section-5-projects',
          replacementMarkdown: '## Projects\n- Built a job tracker with TypeScript.',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain('## Projects\n- Built a job tracker with TypeScript.');
    expect(result.value.content).not.toContain('- Built a job tracker.\n');
    expect(result.value.content).toContain('## Experience\n### Acme');
  });

  it('replaces selected bullets with continuation lines as one unit', () => {
    const result = applyScopedResumeEdits('# R\n\n## Experience\n- Built APIs\n  with Node.\n- Wrote tests.\n', {
      replacements: [
        {
          selectionId: 'section-1-experience-bullet-1',
          replacementMarkdown: '- Built TypeScript APIs.',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('# R\n\n## Experience\n- Built TypeScript APIs.\n- Wrote tests.\n');
  });

  it('preserves CRLF newlines when replacing a selected bullet', () => {
    const resume = '# R\r\n\r\n## Skills\r\n- Python\r\n- Go\r\n';
    const result = applyScopedResumeEdits(resume, {
      replacements: [
        {
          selectionId: 'section-1-skills-bullet-1',
          replacementMarkdown: '- TypeScript',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('# R\r\n\r\n## Skills\r\n- TypeScript\r\n- Go\r\n');
    expect(result.value.content).not.toContain('- TypeScript\n');
  });

  it('preserves mixed newline delimiters outside a selected bullet', () => {
    const resume = '# R\r\n\r\n## Skills\n- Python\r\n- Go\n';
    const result = applyScopedResumeEdits(resume, {
      replacements: [
        {
          selectionId: 'section-1-skills-bullet-1',
          replacementMarkdown: '- TypeScript',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('# R\r\n\r\n## Skills\n- TypeScript\r\n- Go\n');
  });

  it('rejects overlapping section and bullet replacements', () => {
    const result = applyScopedResumeEdits(RESUME, {
      replacements: [
        { selectionId: 'section-2-experience', replacementMarkdown: '## Experience\n- x' },
        { selectionId: 'section-3-acme-bullet-1', replacementMarkdown: '- y' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('overlapping selections');
  });

  it('rejects unknown selections', () => {
    const result = applyScopedResumeEdits(RESUME, {
      replacements: [{ selectionId: 'missing', replacementMarkdown: '- x' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('unknown selectionId');
  });
});

describe('applyValidatorResumeEdits', () => {
  it('applies validator edits and returns auditable PASS evidence', () => {
    const result = applyValidatorResumeEdits({
      prevContent: '# R\n\n## Experience\n- Built APIs.\n- Claimed Kubernetes ownership.\n',
      critique: {
        schemaVersion: 1,
        jobId: 'adzuna:1',
        resumeVersion: 1,
        verdict: 'BLOCK',
        thresholdConfig: { blockOn: ['made-up', 'exaggerated'] },
        counts: { supported: 1, 'fair-rephrase': 0, exaggerated: 0, 'made-up': 1, total: 2 },
        flagged: [
          {
            id: 7,
            severity: 'made-up',
            location: 'Experience',
            draftText: 'Claimed Kubernetes ownership.',
            originalEvidence: null,
            suggestedFix: 'Remove unsupported Kubernetes ownership.',
          },
        ],
      },
      edits: {
        mode: 'edits',
        edits: [{ flagId: 7, replaceWith: 'Built API health checks.' }],
      },
    });

    expect(result.verdict).toBe('PASS');
    expect(result.content).toBe('# R\n\n## Experience\n- Built APIs.\n- Built API health checks.\n');
    expect(result.appliedFlagIds).toEqual([7]);
    expect(result.trust).toEqual({
      verdict: 'PASS',
      stage: 'complete',
      checkedFlagIds: [7],
      appliedFlagIds: [7],
      errors: [],
    });
  });

  it('accepts markdown bullet replacements from tailor_resume edit rounds', () => {
    const result = applyValidatorResumeEdits({
      prevContent: '# R\n\n## Experience\n- Built APIs.\n- Claimed Kubernetes ownership.\n',
      critique: {
        schemaVersion: 1,
        jobId: 'adzuna:1',
        resumeVersion: 1,
        verdict: 'BLOCK',
        thresholdConfig: { blockOn: ['made-up', 'exaggerated'] },
        counts: { supported: 1, 'fair-rephrase': 0, exaggerated: 0, 'made-up': 1, total: 2 },
        flagged: [
          {
            id: 7,
            severity: 'made-up',
            location: 'Experience',
            draftText: 'Claimed Kubernetes ownership.',
            originalEvidence: null,
            suggestedFix: 'Remove unsupported Kubernetes ownership.',
          },
        ],
      },
      edits: {
        mode: 'edits',
        edits: [{ flagId: 7, replaceWith: '- Built API health checks.' }],
      },
    });

    expect(result.verdict).toBe('PASS');
    expect(result.content).toBe('# R\n\n## Experience\n- Built APIs.\n- Built API health checks.\n');
    expect(result.trust.errors).toEqual([]);
  });

  it('returns BLOCK evidence when validator edits do not cover every flag', () => {
    const result = applyValidatorResumeEdits({
      prevContent: '# R\n\n## Experience\n- Claimed Kubernetes ownership.\n',
      critique: {
        schemaVersion: 1,
        jobId: 'adzuna:1',
        resumeVersion: 1,
        verdict: 'BLOCK',
        thresholdConfig: { blockOn: ['made-up', 'exaggerated'] },
        counts: { supported: 0, 'fair-rephrase': 0, exaggerated: 0, 'made-up': 1, total: 1 },
        flagged: [
          {
            id: 7,
            severity: 'made-up',
            location: 'Experience',
            draftText: 'Claimed Kubernetes ownership.',
            originalEvidence: null,
            suggestedFix: 'Remove unsupported Kubernetes ownership.',
          },
        ],
      },
      edits: { mode: 'edits', edits: [] },
    });

    expect(result.verdict).toBe('BLOCK');
    expect(result.content).toBe('# R\n\n## Experience\n- Claimed Kubernetes ownership.\n');
    expect(result.trust.stage).toBe('coverage');
    expect(result.trust.checkedFlagIds).toEqual([7]);
    expect(result.trust.errors).toEqual(['Missing edit for flagId 7']);
  });
});
