import { describe, it, expect } from 'vitest';

import { analyzeFit } from '../../core/pipeline/fit.js';

describe('analyzeFit', () => {
  it('reports job skills the resume covers as matched', () => {
    const jobText = 'Backend Engineer. We use Python, Postgres, and Kubernetes.';
    const resumeText = 'Skills: Python, PostgreSQL, REST APIs';

    const result = analyzeFit(jobText, resumeText);

    expect(result.matched).toContain('python');
    expect(result.matched).toContain('postgresql');
  });

  it('reports job skills absent from the resume as missing', () => {
    const jobText = 'We use Python and Kubernetes.';
    const resumeText = 'Skills: Python';

    const result = analyzeFit(jobText, resumeText);

    expect(result.missing).toContain('kubernetes');
    expect(result.matched).not.toContain('kubernetes');
  });

  it('counts matched skills against total detected job skills', () => {
    const jobText = 'We use Python, Kubernetes, and Go.';
    const resumeText = 'Skills: Python, Go';

    const result = analyzeFit(jobText, resumeText);

    expect(result.jobSkillCount).toBe(3);
    expect(result.matchedCount).toBe(2);
  });

  it('matches through aliases on both sides', () => {
    const jobText = 'Experience with k8s and golang required.';
    const resumeText = 'Skills: Kubernetes, Go';

    const result = analyzeFit(jobText, resumeText);

    expect(result.matched).toContain('kubernetes');
    expect(result.matched).toContain('go');
    expect(result.missing).toHaveLength(0);
  });

  it('only counts recognized skills, not arbitrary words', () => {
    const jobText = 'We are a fast-paced team building great products with Python.';
    const resumeText = 'Skills: Python';

    const result = analyzeFit(jobText, resumeText);

    expect(result.jobSkillCount).toBe(1);
    expect(result.matched).toEqual(['python']);
  });

  it('returns empty analysis when the job lists no recognized skills', () => {
    const result = analyzeFit('We want a passionate team player.', 'Skills: Python');

    expect(result.jobSkillCount).toBe(0);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('treats an empty resume as covering nothing', () => {
    const result = analyzeFit('We use Python and Go.', '');

    expect(result.matched).toHaveLength(0);
    expect(result.missing).toEqual(expect.arrayContaining(['python', 'go']));
    expect(result.matchedCount).toBe(0);
    expect(result.jobSkillCount).toBe(2);
  });

  it('returns empty analysis for an empty job description', () => {
    const result = analyzeFit('', 'Skills: Python, Go');

    expect(result.jobSkillCount).toBe(0);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('collapses duplicate mentions and aliases of the same skill', () => {
    const jobText = 'Python, python, and py experience with Python tooling.';
    const resumeText = 'Skills: Python';

    const result = analyzeFit(jobText, resumeText);

    expect(result.matched).toEqual(['python']);
    expect(result.jobSkillCount).toBe(1);
  });

  it('always satisfies matchedCount + missing.length === jobSkillCount', () => {
    const jobText = 'We use Python, Kubernetes, Go, and GraphQL.';
    const resumeText = 'Skills: Python, GraphQL';

    const result = analyzeFit(jobText, resumeText);

    expect(result.matchedCount).toBe(result.matched.length);
    expect(result.matched.length + result.missing.length).toBe(result.jobSkillCount);
  });
});
