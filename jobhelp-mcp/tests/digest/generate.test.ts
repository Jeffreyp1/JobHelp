import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type {
  FetchOptions,
  JobDigestConfig,
  NormalizedJob,
  RankedJob,
  SourceAdapter,
} from '../../core/types/index.js';

type FetchFn = (config: JobDigestConfig, opts?: FetchOptions) => Promise<readonly NormalizedJob[]>;
type AdapterName = 'alpha' | 'beta' | 'gamma';

interface Handlers {
  alpha: FetchFn;
  beta: FetchFn;
  gamma: FetchFn;
}

const mocks = vi.hoisted((): {
  handlers: Handlers;
  adapterAlpha: SourceAdapter;
  adapterBeta: SourceAdapter;
  adapterGamma: SourceAdapter;
  runPipelineMock: ReturnType<typeof vi.fn<
    [readonly NormalizedJob[], JobDigestConfig],
    Promise<readonly RankedJob[]>
  >>;
} => {
  const handlers: Handlers = {
    alpha: async () => [],
    beta: async () => [],
    gamma: async () => [],
  };
  const adapterAlpha: SourceAdapter = {
    name: 'alpha',
    enabled: () => true,
    fetch: (cfg, opts) => handlers.alpha(cfg, opts),
  };
  const adapterBeta: SourceAdapter = {
    name: 'beta',
    enabled: () => true,
    fetch: (cfg, opts) => handlers.beta(cfg, opts),
  };
  const adapterGamma: SourceAdapter = {
    name: 'gamma',
    enabled: () => true,
    fetch: (cfg, opts) => handlers.gamma(cfg, opts),
  };
  const runPipelineMock = vi.fn<
    [readonly NormalizedJob[], JobDigestConfig],
    Promise<readonly RankedJob[]>
  >();
  return { handlers, adapterAlpha, adapterBeta, adapterGamma, runPipelineMock };
});

vi.mock('../../core/sources/index.js', () => {
  const adapters: readonly SourceAdapter[] = [
    mocks.adapterAlpha,
    mocks.adapterBeta,
    mocks.adapterGamma,
  ];
  return { ALL_ADAPTERS: adapters };
});

vi.mock('../../core/pipeline/index.js', () => ({
  runPipeline: (jobs: readonly NormalizedJob[], cfg: JobDigestConfig) =>
    mocks.runPipelineMock(jobs, cfg),
}));

import { runDigest } from '../../core/digest/generate.js';
import { SourceFetchError } from '../../core/sources/_shared.js';

function setHandler(name: AdapterName, fn: FetchFn): void {
  mocks.handlers[name] = fn;
}

function makeJob(id: string, source: string): NormalizedJob {
  return {
    id,
    source,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    company: `Company ${id}`,
    location: 'Remote',
    remote: 'remote',
    description: 'Description.',
  };
}

function makeRanked(job: NormalizedJob, rank: number, score: number): RankedJob {
  return {
    job,
    rank,
    score,
    breakdown: { keywordOverlap: score, recencyBoost: 1, bm25f: score },
  };
}

function makeConfig(outDir: string, digestK: number): JobDigestConfig {
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
    ranking: {
      topN: 20,
      digestK,
    },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: outDir },
  };
}

describe('runDigest', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jobhelp-digest-test-'));
    mocks.runPipelineMock.mockReset();
    setHandler('alpha', async () => []);
    setHandler('beta', async () => []);
    setHandler('gamma', async () => []);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T20:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('threads http cache options from env to every adapter', async () => {
    const cacheDir = path.join(tmpDir, 'http-cache');
    vi.stubEnv('JOBHELP_HTTP_CACHE_DIR', cacheDir);
    let seen: FetchOptions | undefined;
    setHandler('alpha', async (_cfg, opts) => {
      seen = opts;
      return [];
    });
    mocks.runPipelineMock.mockResolvedValue([]);

    await runDigest(makeConfig(tmpDir, 10));

    expect(seen?.http?.cache?.dir).toBe(cacheDir);
    expect(seen?.http?.cache?.ttlMs).toBe(6 * 60 * 60 * 1000);
  });

  it('omits the http cache when JOBHELP_HTTP_CACHE=off', async () => {
    vi.stubEnv('JOBHELP_HTTP_CACHE', 'off');
    let seen: FetchOptions | undefined;
    setHandler('alpha', async (_cfg, opts) => {
      seen = opts;
      return [];
    });
    mocks.runPipelineMock.mockResolvedValue([]);

    await runDigest(makeConfig(tmpDir, 10));

    expect(seen?.http?.cache).toBeUndefined();
  });

  it('calls every adapter exactly once and concatenates results', async () => {
    const alphaSpy = vi.fn<[JobDigestConfig], Promise<readonly NormalizedJob[]>>(
      async () => [makeJob('a1', 'alpha')],
    );
    const betaSpy = vi.fn<[JobDigestConfig], Promise<readonly NormalizedJob[]>>(
      async () => [makeJob('b1', 'beta'), makeJob('b2', 'beta')],
    );
    const gammaSpy = vi.fn<[JobDigestConfig], Promise<readonly NormalizedJob[]>>(
      async () => [],
    );
    setHandler('alpha', alphaSpy);
    setHandler('beta', betaSpy);
    setHandler('gamma', gammaSpy);

    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.9 - i * 0.1)),
    );

    const config = makeConfig(tmpDir, 10);
    const result = await runDigest(config);

    expect(alphaSpy).toHaveBeenCalledTimes(1);
    expect(betaSpy).toHaveBeenCalledTimes(1);
    expect(gammaSpy).toHaveBeenCalledTimes(1);
    expect(mocks.runPipelineMock).toHaveBeenCalledTimes(1);
    const firstCall = mocks.runPipelineMock.mock.calls[0];
    const passedJobs: readonly NormalizedJob[] = firstCall?.[0] ?? [];
    expect(passedJobs.map((j) => j.id)).toEqual(['a1', 'b1', 'b2']);
    expect(result.jobs).toHaveLength(3);
  });

  it('isolates adapter failure: returns SourceRunResult with error and runs others', async () => {
    setHandler('alpha', async () => {
      throw new Error('network timeout');
    });
    setHandler('beta', async () => [makeJob('b1', 'beta')]);
    setHandler('gamma', async () => {
      throw new Error('rate limit exceeded');
    });
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.5)),
    );

    const result = await runDigest(makeConfig(tmpDir, 10));

    const alpha = result.sourceResults.find((s) => s.source === 'alpha');
    const beta = result.sourceResults.find((s) => s.source === 'beta');
    const gamma = result.sourceResults.find((s) => s.source === 'gamma');
    expect(alpha?.error?.type).toBe('network');
    expect(alpha?.jobCount).toBe(0);
    expect(beta?.error).toBeUndefined();
    expect(beta?.jobCount).toBe(1);
    expect(gamma?.error?.type).toBe('rate_limit');
    expect(result.jobs).toHaveLength(1);
  });

  it('reads SourceFetchError.type for HTTP-status errors rather than guessing from the message', async () => {
    setHandler('alpha', async () => {
      throw new SourceFetchError('rate_limit', 'alpha HTTP 429');
    });
    setHandler('beta', async () => [makeJob('b1', 'beta')]);
    setHandler('gamma', async () => {
      throw new SourceFetchError('not_found', 'gamma HTTP 404');
    });
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.5)),
    );

    const result = await runDigest(makeConfig(tmpDir, 10));

    const alpha = result.sourceResults.find((s) => s.source === 'alpha');
    const gamma = result.sourceResults.find((s) => s.source === 'gamma');
    expect(alpha?.error?.type).toBe('rate_limit');
    expect(gamma?.error?.type).toBe('not_found');
  });

  it('takes top digestK of the ranked list', async () => {
    setHandler('alpha', async () =>
      Array.from({ length: 8 }, (_, i) => makeJob(`a${i}`, 'alpha')),
    );
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 1 - i * 0.05)),
    );

    const result = await runDigest(makeConfig(tmpDir, 3));

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]?.rank).toBe(1);
    expect(result.jobs[2]?.rank).toBe(3);
  });

  it('creates the output directory if it does not exist', async () => {
    const nested = path.join(tmpDir, 'nested', 'deep');
    mocks.runPipelineMock.mockResolvedValue([]);

    await runDigest(makeConfig(nested, 10));

    const st = await stat(nested);
    expect(st.isDirectory()).toBe(true);
  });

  it('writes both digest-{date}.md and digest-{date}.csv', async () => {
    setHandler('alpha', async () => [makeJob('a1', 'alpha')]);
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.9)),
    );

    const result = await runDigest(makeConfig(tmpDir, 10));

    expect(result.markdownPath).toBe(path.join(tmpDir, 'digest-2026-05-14.md'));
    expect(result.csvPath).toBe(path.join(tmpDir, 'digest-2026-05-14.csv'));
    const md = await readFile(result.markdownPath, 'utf8');
    const csv = await readFile(result.csvPath, 'utf8');
    expect(md).toContain('JobHelp daily digest - 2026-05-14');
    expect(md).toContain('Title a1');
    expect(csv.split('\n')[0]).toBe(
      'rank,score,source,company,title,location,remote,salaryMin,salaryMax,postedAt,url,id',
    );
    expect(csv).toContain('a1');
  });

  it('returns a fully populated DigestRunResult', async () => {
    setHandler('alpha', async () => [makeJob('a1', 'alpha')]);
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.7)),
    );

    const result = await runDigest(makeConfig(tmpDir, 10));

    expect(result.date).toBe('2026-05-14');
    expect(result.sourceResults).toHaveLength(3);
    expect(typeof result.totalDurationMs).toBe('number');
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.markdownPath.endsWith('.md')).toBe(true);
    expect(result.csvPath.endsWith('.csv')).toBe(true);
    expect(result.jobs).toHaveLength(1);
  });

  it('appends one metrics line per run to metrics.jsonl in the output dir', async () => {
    setHandler('alpha', async () => [makeJob('a1', 'alpha')]);
    mocks.runPipelineMock.mockImplementation(async (jobs: readonly NormalizedJob[]) =>
      jobs.map((j, i) => makeRanked(j, i + 1, 0.9)),
    );

    await runDigest(makeConfig(tmpDir, 10));
    await runDigest(makeConfig(tmpDir, 10));

    const lines = (await readFile(path.join(tmpDir, 'metrics.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first: unknown = JSON.parse(lines[0] ?? '');
    expect(first).toMatchObject({
      date: '2026-05-14',
      poolKept: 1,
      rankedCount: 1,
      digestCount: 1,
      historyBoosted: 0,
    });
  });

  it('classifies auth-flavored errors', async () => {
    setHandler('alpha', async () => {
      throw new Error('Unauthorized: bad token');
    });
    mocks.runPipelineMock.mockResolvedValue([]);

    const result = await runDigest(makeConfig(tmpDir, 10));
    const alpha = result.sourceResults.find((s) => s.source === 'alpha');
    expect(alpha?.error?.type).toBe('auth');
  });

  it('classifies parse-flavored errors', async () => {
    setHandler('alpha', async () => {
      throw new Error('JSON parse error');
    });
    mocks.runPipelineMock.mockResolvedValue([]);

    const result = await runDigest(makeConfig(tmpDir, 10));
    const alpha = result.sourceResults.find((s) => s.source === 'alpha');
    expect(alpha?.error?.type).toBe('parse');
  });

  it('preserves the original throwable as Error.cause when pipeline rejects with a non-Error', async () => {
    setHandler('alpha', async () => [makeJob('a1', 'alpha')]);
    const originalErr: { kind: string; detail: string } = {
      kind: 'pipeline-broke',
      detail: 'something went wrong',
    };
    mocks.runPipelineMock.mockImplementation(async (): Promise<readonly RankedJob[]> => {
      throw originalErr;
    });

    let caught: unknown;
    try {
      await runDigest(makeConfig(tmpDir, 10));
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.cause).toBe(originalErr);
    }
  });
});
