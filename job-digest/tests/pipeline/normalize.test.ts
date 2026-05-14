import { describe, it, expect } from 'vitest';
import { normalize } from '../../core/pipeline/normalize.js';
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

describe('normalize', () => {
  it('returns valid jobs unchanged in shape', async () => {
    const out = await normalize([makeJob()]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('adzuna:abc');
  });

  it('drops jobs missing a required id', async () => {
    const out = await normalize([makeJob({ id: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops jobs missing required source', async () => {
    const out = await normalize([makeJob({ source: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops jobs missing required url', async () => {
    const out = await normalize([makeJob({ url: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops jobs missing required title', async () => {
    const out = await normalize([makeJob({ title: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops jobs missing required company', async () => {
    const out = await normalize([makeJob({ company: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops jobs missing required description', async () => {
    const out = await normalize([makeJob({ description: '' })]);
    expect(out).toHaveLength(0);
  });

  it('drops a job with undefined location', async () => {
    const laundered: NormalizedJob = {
      id: 'adzuna:no-loc',
      source: 'adzuna',
      url: 'https://example.com/job',
      title: 'Software Engineer',
      company: 'Acme',
      // @ts-expect-error simulating type-laundered runtime where location is undefined
      location: undefined,
      remote: 'remote',
      description: 'Build software',
    };
    const out = await normalize([laundered]);
    expect(out).toHaveLength(0);
  });

  it('drops a job with empty-string location', async () => {
    const out = await normalize([makeJob({ location: '' })]);
    expect(out).toHaveLength(0);
  });

  it('trims whitespace in title, company, location', async () => {
    const out = await normalize([
      makeJob({ title: '  Senior Eng  ', company: '	Acme ', location: '  NY  ' }),
    ]);
    expect(out[0]?.title).toBe('Senior Eng');
    expect(out[0]?.company).toBe('Acme');
    expect(out[0]?.location).toBe('NY');
  });

  it('caps description at 8000 chars', async () => {
    const long = 'a'.repeat(9000);
    const out = await normalize([makeJob({ description: long })]);
    expect(out[0]?.description.length).toBe(8000);
  });

  it('preserves descriptions <= 8000 chars', async () => {
    const desc = 'a'.repeat(7999);
    const out = await normalize([makeJob({ description: desc })]);
    expect(out[0]?.description.length).toBe(7999);
  });

  it('keeps valid jobs while dropping malformed ones in the same batch', async () => {
    const out = await normalize([makeJob(), makeJob({ id: '' }), makeJob({ id: 'adzuna:xyz' })]);
    expect(out).toHaveLength(2);
    expect(out.map((j) => j.id)).toEqual(['adzuna:abc', 'adzuna:xyz']);
  });
});
