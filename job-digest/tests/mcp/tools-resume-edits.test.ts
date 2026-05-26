import { describe, expect, it } from 'vitest';
import type { ToolError } from '../../mcp/src/tools.js';
import { createTools } from '../../mcp/src/tools.js';
import { getTool, makeDeps, parseResponseBody } from './_fixtures.js';

describe('apply_scoped_resume_edits', () => {
  it('applies selected bullet replacements without calling deps', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n- Wrote tests.\n',
      replacements: [
        {
          selectionId: 'section-1-experience-bullet-2',
          replacementMarkdown: '- Wrote Vitest coverage.',
        },
      ],
    });
    expect(res.isError).toBeUndefined();
    expect(calls.writeApplicationOutput).toEqual([]);
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { content: string; changedSelections: Array<{ id: string; type: string }> };
    };
    expect(body.value.content).toBe('# R\n\n## Experience\n- Built APIs.\n- Wrote Vitest coverage.\n');
    expect(body.value.changedSelections).toEqual([
      { id: 'section-1-experience-bullet-2', type: 'bullet', startLine: 4, endLine: 4 },
    ]);
  });

  it('rejects missing replacements', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({ resumeMarkdown: '# R' });
    expect(res.isError).toBe(true);
  });

  it('rejects duplicate replacement ids', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n',
      replacements: [
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built APIs.' },
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built services.' },
      ],
    });
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
    expect(body.error.message).toContain('duplicate selectionId');
  });

  it('rejects overlapping section and bullet replacements', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n',
      replacements: [
        { selectionId: 'section-1-experience', replacementMarkdown: '## Experience\n- Built APIs.' },
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built services.' },
      ],
    });
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
    expect(body.error.message).toContain('overlapping selections');
  });
});

describe('apply_validator_resume_edits', () => {
  it('returns PASS trust evidence after applying validator flag edits', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_validator_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n- Claimed Kubernetes ownership.\n',
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
      edits: { mode: 'edits', edits: [{ flagId: 7, replaceWith: 'Built API health checks.' }] },
    });

    expect(res.isError).toBeUndefined();
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: {
        verdict: string;
        content: string;
        trust: { verdict: string; stage: string; appliedFlagIds: number[]; errors: string[] };
      };
    };
    expect(body.value.verdict).toBe('PASS');
    expect(body.value.content).toContain('- Built API health checks.');
    expect(body.value.trust).toEqual({
      verdict: 'PASS',
      stage: 'complete',
      checkedFlagIds: [7],
      appliedFlagIds: [7],
      errors: [],
    });
  });

  it('returns BLOCK trust evidence as a normal result for incomplete edits', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_validator_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Claimed Kubernetes ownership.\n',
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

    expect(res.isError).toBeUndefined();
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { verdict: string; trust: { stage: string; errors: string[] } };
    };
    expect(body.value.verdict).toBe('BLOCK');
    expect(body.value.trust.stage).toBe('coverage');
    expect(body.value.trust.errors).toEqual(['Missing edit for flagId 7']);
  });
});
