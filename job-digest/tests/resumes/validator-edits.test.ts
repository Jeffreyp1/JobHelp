import { describe, expect, it } from 'vitest';
import { applyValidatorResumeEdits } from '../../core/resumes/scoped-edit.js';

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

  it('blocks duplicate edits that target the same resume line', () => {
    const result = applyValidatorResumeEdits({
      prevContent: '# R\n\n## Experience\n- Claimed Kubernetes ownership and led unsupported Terraform work.\n',
      critique: {
        schemaVersion: 1,
        jobId: 'adzuna:1',
        resumeVersion: 1,
        verdict: 'BLOCK',
        thresholdConfig: { blockOn: ['made-up', 'exaggerated'] },
        counts: { supported: 0, 'fair-rephrase': 0, exaggerated: 1, 'made-up': 1, total: 2 },
        flagged: [
          {
            id: 7,
            severity: 'made-up',
            location: 'Experience',
            draftText: 'Claimed Kubernetes ownership',
            originalEvidence: null,
            suggestedFix: 'Remove unsupported Kubernetes ownership.',
          },
          {
            id: 8,
            severity: 'exaggerated',
            location: 'Experience',
            draftText: 'led unsupported Terraform work',
            originalEvidence: 'Terraform exposure only.',
            suggestedFix: 'Keep Terraform exposure modest.',
          },
        ],
      },
      edits: {
        mode: 'edits',
        edits: [
          { flagId: 7, replaceWith: '- Led API reliability work.' },
          { flagId: 8, replaceWith: '- Supported Terraform maintenance.' },
        ],
      },
    });

    expect(result.verdict).toBe('BLOCK');
    expect(result.content).toBe(
      '# R\n\n## Experience\n- Claimed Kubernetes ownership and led unsupported Terraform work.\n',
    );
    expect(result.trust.stage).toBe('apply');
    expect(result.appliedFlagIds).toEqual([]);
    expect(result.trust.errors).toEqual([
      'Multiple validator edits target line 3; combine the fixes into one replacement before applying.',
    ]);
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
