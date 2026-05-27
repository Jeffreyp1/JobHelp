import { describe, it, expect } from 'vitest';
import { dedupe } from '../../core/pipeline/dedupe.js';
import type { NormalizedJob } from '../../core/types/index.js';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'adzuna:abc',
    source: 'adzuna',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Irvine, CA',
    remote: 'remote',
    description: 'Build software',
    ...overrides,
  };
}

describe('dedupe', () => {
  it('returns an empty array unchanged', async () => {
    const out = await dedupe([]);
    expect(out).toEqual([]);
  });

  it('passes a single job through', async () => {
    const out = await dedupe([makeJob()]);
    expect(out).toHaveLength(1);
  });

  it('removes exact-id duplicates, keeping the first occurrence', async () => {
    const a = makeJob({ id: 'adzuna:1', title: 'First' });
    const b = makeJob({ id: 'adzuna:1', title: 'Second' });
    const c = makeJob({ id: 'adzuna:2', title: 'Other' });
    const out = await dedupe([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('First');
    expect(out[1]?.title).toBe('Other');
  });

  it('removes duplicate postings across sources by title, company, and url', async () => {
    const a = makeJob({ id: 'greenhouse:stripe:1' });
    const b = makeJob({
      id: 'lever:stripe:1',
      source: 'lever',
      url: 'https://example.com/job?utm_source=lever',
      title: ' software engineer ',
      company: 'ACME',
    });
    const out = await dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('greenhouse:stripe:1');
  });
});
