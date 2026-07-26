import { describe, expect, it, afterEach, vi } from 'vitest';
import { runAdapterIsolated } from '../../mcp/src/wiring-helpers.js';
import { SourceFetchError } from '../../core/sources/_shared.js';
import type { FetchOptions, JobDigestConfig, SourceAdapter } from '../../core/types/index.js';

const config: JobDigestConfig = {
  profile: {
    resumeDumpPath: '/tmp/resume.md',
    skills: [],
    location: 'Austin, TX',
    remoteOk: true,
    salaryFloor: 100000,
    seniority: 'entry',
    roleFamily: ['backend'],
  },
  sources: {},
  ranking: { topN: 20, digestK: 10 },
  rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
  output: { dir: '/tmp/jobhelp' },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runAdapterIsolated', () => {
  it('threads http cache options into adapter.fetch', async () => {
    vi.stubEnv('JOBHELP_HTTP_CACHE_DIR', '/tmp/jobhelp-test-cache');
    let seen: FetchOptions | undefined;
    const adapter: SourceAdapter = {
      name: 'probe',
      enabled: () => true,
      fetch: async (_cfg, opts) => {
        seen = opts;
        return [];
      },
    };

    const outcome = await runAdapterIsolated(adapter, config);

    expect(outcome.error).toBeUndefined();
    expect(seen?.http?.cache?.dir).toBe('/tmp/jobhelp-test-cache');
    expect(seen?.http?.cache?.ttlMs).toBeGreaterThan(0);
  });

  it('omits the cache when JOBHELP_HTTP_CACHE=off', async () => {
    vi.stubEnv('JOBHELP_HTTP_CACHE', 'off');
    let seen: FetchOptions | undefined;
    const adapter: SourceAdapter = {
      name: 'probe',
      enabled: () => true,
      fetch: async (_cfg, opts) => {
        seen = opts;
        return [];
      },
    };

    await runAdapterIsolated(adapter, config);

    expect(seen?.http?.cache).toBeUndefined();
  });

  it('forwards a SourceFetchError type instead of collapsing every failure to network', async () => {
    const adapter: SourceAdapter = {
      name: 'ratelimited',
      enabled: () => true,
      fetch: async () => {
        throw new SourceFetchError('rate_limit', 'ratelimited HTTP 429');
      },
    };

    const outcome = await runAdapterIsolated(adapter, config);

    expect(outcome.jobs).toEqual([]);
    expect(outcome.error?.type).toBe('rate_limit');
    expect(outcome.error?.message).toContain('429');
  });
});
