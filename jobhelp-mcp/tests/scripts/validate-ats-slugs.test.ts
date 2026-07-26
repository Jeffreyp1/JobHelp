import { describe, it, expect } from 'vitest';
import {
  SlugValidateError,
  buildOutput,
  createTokenBucket,
  dedupeCandidates,
  extractSlugs,
  normalizeName,
  parseStateLines,
  parseVerdict,
  retryDelayMs,
  slugMatchesName,
  stateKey,
  type SlugVerdict,
} from '../../scripts/lib/slug-validate.js';

describe('normalizeName', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeName('Acme, Inc.')).toBe('acmeinc');
    expect(normalizeName('10a Labs / AI')).toBe('10alabsai');
    expect(normalizeName('---')).toBe('');
  });
});

describe('slugMatchesName', () => {
  it('matches when normalized name contains normalized slug or vice versa', () => {
    expect(slugMatchesName('acme-inc', 'Acme Inc')).toBe(true);
    expect(slugMatchesName('acme-inc-2', 'Acme Inc')).toBe(true);
    expect(slugMatchesName('acme', 'Acme Incorporated')).toBe(true);
  });

  it('rejects unrelated or empty names', () => {
    expect(slugMatchesName('foobar', 'Acme Inc')).toBe(false);
    expect(slugMatchesName('---', 'Acme')).toBe(false);
    expect(slugMatchesName('acme', '')).toBe(false);
  });
});

describe('extractSlugs', () => {
  it('accepts a flat string array', () => {
    expect(extractSlugs(['a', ' b ', ''], 'f.json')).toEqual(['a', 'b']);
  });

  it('accepts a { tokens } wrapper', () => {
    expect(extractSlugs({ tokens: ['x', 'y'] }, 'f.json')).toEqual(['x', 'y']);
  });

  it('accepts an array of { slug } records', () => {
    expect(extractSlugs([{ slug: 'a' }, 'b'], 'f.json')).toEqual(['a', 'b']);
  });

  it('throws a typed error on unrecognized shapes', () => {
    expect(() => extractSlugs({ foo: 1 }, 'f.json')).toThrow(SlugValidateError);
    expect(() => extractSlugs([42], 'f.json')).toThrow(SlugValidateError);
  });
});

describe('dedupeCandidates', () => {
  it('flattens and dedupes exact strings preserving first-seen order', () => {
    expect(dedupeCandidates([['b', 'a', 'b'], ['a', 'c']])).toEqual(['b', 'a', 'c']);
  });
});

describe('parseVerdict — workable', () => {
  const account = (name: string, jobs: number): string =>
    JSON.stringify({ name, jobs: Array.from({ length: jobs }, (_, i) => ({ id: String(i) })) });

  it('valid when account name matches slug; count is jobs length', () => {
    expect(parseVerdict('workable', 'acme-inc', 200, account('Acme Inc', 3))).toEqual({
      slug: 'acme-inc',
      ats: 'workable',
      valid: true,
      count: 3,
    });
  });

  it('invalid when 200 account name does not match (placeholder trap)', () => {
    expect(parseVerdict('workable', 'zzz-nope', 200, account('Acme Inc', 5))).toEqual({
      slug: 'zzz-nope',
      ats: 'workable',
      valid: false,
      count: 0,
    });
  });

  it('valid with count 0 when jobs array is absent but name matches', () => {
    expect(parseVerdict('workable', 'acme', 200, JSON.stringify({ name: 'Acme' }))).toEqual({
      slug: 'acme',
      ats: 'workable',
      valid: true,
      count: 0,
    });
  });

  it('404 is invalid', () => {
    expect(parseVerdict('workable', 'gone', 404, '')).toEqual({
      slug: 'gone',
      ats: 'workable',
      valid: false,
      count: 0,
    });
  });

  it('throws on malformed or non-object 200 bodies', () => {
    expect(() => parseVerdict('workable', 'a', 200, 'not json')).toThrow(SlugValidateError);
    expect(() => parseVerdict('workable', 'a', 200, '[1]')).toThrow(SlugValidateError);
  });
});

describe('parseVerdict — lever', () => {
  it('200 array is valid including empty', () => {
    expect(parseVerdict('lever', 'netflix', 200, '[{"id":"1"},{"id":"2"}]')).toEqual({
      slug: 'netflix',
      ats: 'lever',
      valid: true,
      count: 2,
    });
    expect(parseVerdict('lever', 'quiet', 200, '[]')).toEqual({
      slug: 'quiet',
      ats: 'lever',
      valid: true,
      count: 0,
    });
  });

  it('404 is invalid; 200 non-array throws', () => {
    expect(parseVerdict('lever', 'nope', 404, '')).toEqual({
      slug: 'nope',
      ats: 'lever',
      valid: false,
      count: 0,
    });
    expect(() => parseVerdict('lever', 'a', 200, '{"ok":false}')).toThrow(SlugValidateError);
  });
});

describe('parseVerdict — smartrecruiters', () => {
  it('200 with totalFound is valid, recording totalFound', () => {
    expect(
      parseVerdict('smartrecruiters', 'Visa', 200, JSON.stringify({ totalFound: 12, content: [] })),
    ).toEqual({ slug: 'Visa', ats: 'smartrecruiters', valid: true, count: 12 });
    expect(
      parseVerdict('smartrecruiters', 'Visa', 200, JSON.stringify({ totalFound: '7' })),
    ).toEqual({ slug: 'Visa', ats: 'smartrecruiters', valid: true, count: 7 });
  });

  it('404 is invalid; missing totalFound throws', () => {
    expect(parseVerdict('smartrecruiters', 'nope', 404, '')).toEqual({
      slug: 'nope',
      ats: 'smartrecruiters',
      valid: false,
      count: 0,
    });
    expect(() => parseVerdict('smartrecruiters', 'a', 200, '{"content":[]}')).toThrow(
      SlugValidateError,
    );
  });
});

describe('parseVerdict — unexpected status', () => {
  it('throws for statuses other than 200/404', () => {
    expect(() => parseVerdict('lever', 'a', 403, '')).toThrow(SlugValidateError);
  });
});

describe('parseStateLines', () => {
  it('parses JSONL, skips torn/blank lines, keys by (ats, slug)', () => {
    const text = [
      '{"slug":"a","ats":"lever","valid":true,"count":4}',
      '',
      '{"slug":"b","ats":"lever","valid":false,"count":0}',
      '{"slug":"c","ats":"lev',
    ].join('\n');
    const { verdicts, malformed } = parseStateLines(text);
    expect(malformed).toBe(1);
    expect(verdicts.size).toBe(2);
    expect(verdicts.get(stateKey('lever', 'a'))).toEqual({
      slug: 'a',
      ats: 'lever',
      valid: true,
      count: 4,
    });
  });
});

describe('buildOutput', () => {
  it('keeps only valid verdicts for the requested ats, sorted by count desc then slug', () => {
    const verdicts: SlugVerdict[] = [
      { slug: 'low', ats: 'lever', valid: true, count: 1 },
      { slug: 'invalid', ats: 'lever', valid: false, count: 0 },
      { slug: 'other', ats: 'workable', valid: true, count: 99 },
      { slug: 'b-high', ats: 'lever', valid: true, count: 7 },
      { slug: 'a-high', ats: 'lever', valid: true, count: 7 },
    ];
    expect(buildOutput(verdicts, 'lever')).toEqual([
      { slug: 'a-high', count: 7 },
      { slug: 'b-high', count: 7 },
      { slug: 'low', count: 1 },
    ]);
  });

  it('dedupes by slug keeping the latest verdict', () => {
    const verdicts: SlugVerdict[] = [
      { slug: 'x', ats: 'lever', valid: true, count: 1 },
      { slug: 'x', ats: 'lever', valid: true, count: 5 },
    ];
    expect(buildOutput(verdicts, 'lever')).toEqual([{ slug: 'x', count: 5 }]);
  });
});

describe('retryDelayMs', () => {
  it('honors numeric Retry-After seconds', () => {
    expect(retryDelayMs('2', 0, 0)).toBe(2000);
  });

  it('honors HTTP-date Retry-After relative to now, floored at 0', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryDelayMs('Thu, 01 Jan 2026 00:00:03 GMT', 0, now)).toBe(3000);
    expect(retryDelayMs('Wed, 31 Dec 2025 23:59:00 GMT', 0, now)).toBe(0);
  });

  it('caps honored Retry-After at 60s', () => {
    expect(retryDelayMs('600', 0, 0)).toBe(60000);
  });

  it('falls back to exponential backoff when header is absent or unparseable', () => {
    expect(retryDelayMs(null, 0, 0)).toBe(500);
    expect(retryDelayMs(null, 1, 0)).toBe(1000);
    expect(retryDelayMs('soon', 2, 0)).toBe(2000);
  });
});

describe('createTokenBucket', () => {
  it('paces acquires at the configured rps using the injected clock', async () => {
    let t = 0;
    const bucket = createTokenBucket(2, {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    for (let i = 0; i < 5; i++) await bucket.acquire();
    expect(t).toBe(1500);
  });
});
