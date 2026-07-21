import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type {
  JobDigestConfig,
  NormalizedJob,
  RankedJob,
} from '../../core/types/index.js';
import {
  extractAtsTokens,
  harvestNewCompanyTokens,
  HarvestError,
  type HarvestSource,
} from '../../core/init/harvest.js';
import {
  companyFromHnComment,
  filterNewCandidates,
  slugVariants,
} from '../../scripts/expand-companies-lib.js';

const mocks = vi.hoisted(() => ({
  fetchJobs: vi.fn<[], Promise<readonly NormalizedJob[]>>(),
  runPipeline: vi.fn<[readonly NormalizedJob[]], Promise<readonly RankedJob[]>>(),
}));

vi.mock('../../core/sources/index.js', () => ({
  ALL_ADAPTERS: [{ name: 'alpha', enabled: (): boolean => true, fetch: (): Promise<readonly NormalizedJob[]> => mocks.fetchJobs() }],
}));

vi.mock('../../core/pipeline/index.js', () => ({
  runPipeline: (jobs: readonly NormalizedJob[]): Promise<readonly RankedJob[]> => mocks.runPipeline(jobs),
}));

import { runDigest } from '../../core/digest/generate.js';

function makeJob(url: string): NormalizedJob {
  return {
    id: `t:${url}`,
    source: 'test',
    url,
    title: 'Engineer',
    company: 'Co',
    location: 'Remote',
    remote: 'remote',
    description: 'd',
  };
}

describe('extractAtsTokens', () => {
  const cases: readonly [string, HarvestSource, string][] = [
    ['https://boards.greenhouse.io/AcmeCo/jobs/123', 'greenhouse', 'acmeco'],
    ['https://job-boards.greenhouse.io/nova/jobs/4001?src=x', 'greenhouse', 'nova'],
    ['https://boards.greenhouse.io/embed/job_app?for=EmbedCo&token=99', 'greenhouse', 'embedco'],
    ['https://jobs.lever.co/LeverCo/8f2-uuid', 'lever', 'leverco'],
    ['https://jobs.ashbyhq.com/AshbyCo/posting-1', 'ashby', 'ashbyco'],
    ['https://apply.workable.com/workco/j/ABC123/', 'workable', 'workco'],
    ['https://careers.smartrecruiters.com/SmartCo/1939-eng', 'smartrecruiters', 'smartco'],
    ['https://recruitco.recruitee.com/o/backend-dev', 'recruitee', 'recruitco'],
    ['https://breezyco.breezy.hr/p/123-role', 'breezy', 'breezyco'],
    ['https://ttco.teamtailor.com/jobs/456', 'teamtailor', 'ttco'],
    ['https://pinco.pinpointhq.com/en/postings/x', 'pinpoint', 'pinco'],
  ];

  it.each(cases)('extracts %s -> %s:%s', (url, source, token) => {
    const map = extractAtsTokens([makeJob(url)]);
    expect(map.get(source)?.has(token)).toBe(true);
  });

  it('ignores non-ATS urls, generic subdomains, workable short links, and invalid urls', () => {
    const map = extractAtsTokens([
      makeJob('https://example.com/AcmeCo/jobs/1'),
      makeJob('https://www.recruitee.com/pricing'),
      makeJob('https://apply.workable.com/j/ABC123'),
      makeJob('https://greenhouse.io/customers'),
      makeJob('not a url'),
    ]);
    expect(map.size).toBe(0);
  });

  it('dedupes case-insensitively into one set per source', () => {
    const map = extractAtsTokens([
      makeJob('https://boards.greenhouse.io/acme/jobs/1'),
      makeJob('https://boards.greenhouse.io/ACME/jobs/2'),
      makeJob('https://jobs.lever.co/plaid/1'),
    ]);
    expect([...(map.get('greenhouse') ?? [])]).toEqual(['acme']);
    expect([...(map.get('lever') ?? [])]).toEqual(['plaid']);
  });
});

interface SeedShape {
  greenhouse: { tokens: string[] };
  lever: { slugs: string[] };
  ashby: { tokens: string[] };
  workable?: { tokens: string[] };
}

describe('harvestNewCompanyTokens', () => {
  let dir: string;
  const seed: SeedShape = {
    greenhouse: { tokens: ['acme'] },
    lever: { slugs: ['plaid'] },
    ashby: { tokens: [] },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(os.tmpdir(), 'jobhelp-harvest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends only new tokens atomically and reports per-source counts', async () => {
    const p = join(dir, 'company-sources.json');
    await writeFile(p, JSON.stringify(seed, null, 2) + '\n', 'utf8');

    const added = await harvestNewCompanyTokens(
      [
        makeJob('https://boards.greenhouse.io/acme/jobs/1'),
        makeJob('https://boards.greenhouse.io/newco/jobs/2'),
        makeJob('https://jobs.lever.co/fresh/1'),
        makeJob('https://apply.workable.com/orphan/j/1'),
      ],
      p,
    );

    expect(added).toEqual({ greenhouse: 1, lever: 1 });
    const parsed = JSON.parse(await readFile(p, 'utf8')) as SeedShape;
    expect(parsed.greenhouse.tokens).toEqual(['acme', 'newco']);
    expect(parsed.lever.slugs).toEqual(['plaid', 'fresh']);
    expect(parsed.ashby.tokens).toEqual([]);
    expect(parsed.workable).toBeUndefined();
    expect(await readdir(dir)).toEqual(['company-sources.json']);
  });

  it('does not rewrite the file when every token is already known', async () => {
    const p = join(dir, 'company-sources.json');
    const original = JSON.stringify(seed, null, 2) + '\n';
    await writeFile(p, original, 'utf8');

    const added = await harvestNewCompanyTokens(
      [makeJob('https://boards.greenhouse.io/ACME/jobs/1')],
      p,
    );

    expect(added).toEqual({});
    expect(await readFile(p, 'utf8')).toBe(original);
  });

  it('short-circuits without touching the filesystem when no ATS urls are present', async () => {
    const p = join(dir, 'company-sources.json');
    const added = await harvestNewCompanyTokens([makeJob('https://example.com/x')], p);
    expect(added).toEqual({});
    expect(await readdir(dir)).toEqual([]);
  });

  it('skips quietly when the company-sources file does not exist', async () => {
    const p = join(dir, 'company-sources.json');
    const added = await harvestNewCompanyTokens(
      [makeJob('https://boards.greenhouse.io/newco/jobs/1')],
      p,
    );
    expect(added).toEqual({});
    expect(await readdir(dir)).toEqual([]);
  });

  it('throws HarvestError on malformed JSON', async () => {
    const p = join(dir, 'company-sources.json');
    await writeFile(p, 'not json{{{', 'utf8');
    await expect(
      harvestNewCompanyTokens([makeJob('https://boards.greenhouse.io/newco/jobs/1')], p),
    ).rejects.toBeInstanceOf(HarvestError);
  });
});

function makeConfig(outDir: string): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: '/dev/null',
      skills: ['typescript'],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'entry',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: { topN: 20, digestK: 10 },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: outDir },
  };
}

describe('runDigest harvest wiring', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(os.tmpdir(), 'jobhelp-harvest-wire-'));
    vi.stubEnv('JOBHELP_CONFIG_PATH', join(dir, 'config.json'));
    mocks.fetchJobs.mockReset();
    mocks.runPipeline.mockReset();
    mocks.runPipeline.mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('harvests from the full pre-pipeline pool during runDigest', async () => {
    const p = join(dir, 'company-sources.json');
    await writeFile(p, JSON.stringify({ greenhouse: { tokens: [] } }) + '\n', 'utf8');
    mocks.fetchJobs.mockResolvedValue([makeJob('https://boards.greenhouse.io/poolco/jobs/1')]);

    await runDigest(makeConfig(join(dir, 'out')));

    const parsed = JSON.parse(await readFile(p, 'utf8')) as { greenhouse: { tokens: string[] } };
    expect(parsed.greenhouse.tokens).toEqual(['poolco']);
  });

  it('never fails the digest when the harvest errors', async () => {
    await writeFile(join(dir, 'company-sources.json'), '{{{', 'utf8');
    mocks.fetchJobs.mockResolvedValue([makeJob('https://boards.greenhouse.io/x/jobs/1')]);

    await expect(runDigest(makeConfig(join(dir, 'out')))).resolves.toBeDefined();
  });
});

describe('expand-companies helpers', () => {
  it('generates ranked slug variants including suffix-stripped stages', () => {
    expect(slugVariants('Acme Labs Inc')).toEqual([
      'acme-labs-inc',
      'acmelabsinc',
      'acme-labs',
      'acmelabs',
      'acme',
    ]);
  });

  it('drops parentheticals and urls before slugifying', () => {
    expect(slugVariants('Vanta AI (YC W21) https://vanta.com')).toEqual(['vanta-ai', 'vantaai', 'vanta']);
  });

  it('collapses single-word names to one variant', () => {
    expect(slugVariants('Stripe')).toEqual(['stripe']);
  });

  it('returns empty for names with no usable characters', () => {
    expect(slugVariants('***')).toEqual([]);
  });

  it('parses the company from an HN who-is-hiring comment', () => {
    expect(companyFromHnComment('<p>Acme &amp; Co | Senior Engineer | Remote (US)</p>')).toBe(
      'Acme & Co',
    );
  });

  it('rejects comments without the pipe-delimited header', () => {
    expect(companyFromHnComment('<p>Just a reply, no header here</p>')).toBeUndefined();
  });

  it('filters candidates against existing tokens and internal duplicates', () => {
    expect(filterNewCandidates(['a1', 'b1', 'a1', 'c1'], new Set(['b1']))).toEqual(['a1', 'c1']);
  });
});
