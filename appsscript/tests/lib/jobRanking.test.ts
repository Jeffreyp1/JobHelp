/**
 * Tests for appsscript/src/lib/jobRanking.ts — rankJobs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rankJobs } from '../../src/lib/jobRanking.js';
import type { DiscoveredJob, JobProfile } from '../../src/types/job-discovery.js';
import type { ClaudeClient, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

function makeJob(over: Partial<DiscoveredJob> & { id: string }): DiscoveredJob {
  return {
    id: over.id,
    source: over.source ?? 'manual',
    company: over.company ?? 'Acme',
    title: over.title ?? 'Engineer',
    location: over.location ?? null,
    remote: over.remote ?? null,
    url: over.url ?? `https://x.example/${over.id}`,
    descriptionText: over.descriptionText ?? '',
    postedAt: over.postedAt === undefined ? NOW : over.postedAt,
    discoveredAt: over.discoveredAt ?? NOW,
    salaryMin: over.salaryMin ?? null,
    salaryMax: over.salaryMax ?? null,
    salaryCurrency: over.salaryCurrency ?? null,
  };
}

function makeProfile(skills: string[], summary = 'Strong backend engineer.'): JobProfile {
  return {
    titles: ['Backend Engineer'],
    seniority: 'senior',
    skills,
    domains: [],
    searchQueries: [],
    filters: { remote: 'any', minSalary: null, locations: [] },
    summary,
  };
}

function makeResponse(text: string, model = 'claude-haiku-4-5-20251001'): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model,
  };
}

describe('rankJobs — Stage A (keyword overlap)', () => {
  it('computes keywordScore as the ratio of matched profile skills', () => {
    const profile = makeProfile(['typescript', 'postgres', 'kubernetes', 'graphql']);
    const job = makeJob({
      id: 'j1',
      title: 'TypeScript Engineer',
      descriptionText: 'We use postgres and graphql heavily.',
    });
    const { ranked } = rankJobs([job], profile, { maxDaysOld: 0, topN: 5 });
    expect(ranked[0].keywordScore).toBeCloseTo(3 / 4, 6);
  });

  it('records matchedSkills and missingSkills', () => {
    const profile = makeProfile(['typescript', 'rust', 'docker']);
    const job = makeJob({ id: 'j1', descriptionText: 'Built with typescript and docker.' });
    const { ranked } = rankJobs([job], profile, { maxDaysOld: 0, topN: 5 });
    expect(ranked[0].matchedSkills.sort()).toEqual(['docker', 'typescript']);
    expect(ranked[0].missingSkills).toEqual(['rust']);
  });

  it('matches multi-word skills as substrings and single-token skills on word boundaries', () => {
    const profile = makeProfile(['react', 'machine learning', 'go']);
    // "go" must NOT match inside "category"; "react" must NOT match "reactor"
    const job = makeJob({
      id: 'j1',
      title: 'ML Platform',
      descriptionText: 'Category leading machine learning systems. We write Go.',
    });
    const { ranked } = rankJobs([job], profile, { maxDaysOld: 0, topN: 5 });
    expect(ranked[0].matchedSkills.sort()).toEqual(['go', 'machine learning']);
    expect(ranked[0].missingSkills).toEqual(['react']);
  });

  it('keywordScore is 0 when the profile has no skills', () => {
    const { ranked } = rankJobs([makeJob({ id: 'j1', descriptionText: 'anything' })], makeProfile([]), {
      maxDaysOld: 0,
      topN: 5,
    });
    expect(ranked[0].keywordScore).toBe(0);
  });
});

describe('rankJobs — threshold drop respects topN floor', () => {
  it('drops jobs below the 0.1 keyword threshold when enough remain', () => {
    const profile = makeProfile(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const good = makeJob({ id: 'good', descriptionText: 'a b c d e f' }); // 0.6
    const bad = makeJob({ id: 'bad', descriptionText: 'nothing relevant here' }); // 0
    const { ranked } = rankJobs([good, bad], profile, { maxDaysOld: 0, topN: 1 });
    expect(ranked.map((r) => r.id)).toEqual(['good']);
  });

  it('keeps below-threshold jobs when dropping would leave fewer than topN', () => {
    const profile = makeProfile(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const a = makeJob({ id: 'a', descriptionText: 'nothing here' }); // 0
    const b = makeJob({ id: 'b', descriptionText: 'a only' }); // 0.1 — passes
    const c = makeJob({ id: 'c', descriptionText: 'still nothing' }); // 0
    const { ranked } = rankJobs([a, b, c], profile, { maxDaysOld: 0, topN: 3 });
    expect(ranked.length).toBe(3);
  });
});

describe('rankJobs — recency', () => {
  it('recencyBoost is 1 for a job posted today', () => {
    const { ranked } = rankJobs(
      [makeJob({ id: 'j1', postedAt: NOW, descriptionText: 'x' })],
      makeProfile([]),
      { maxDaysOld: 0, topN: 5 },
    );
    expect(ranked[0].recencyBoost).toBeCloseTo(1, 6);
  });

  it('recencyBoost decays to the 0.5 floor for very old jobs', () => {
    const { ranked } = rankJobs(
      [makeJob({ id: 'j1', postedAt: NOW - 90 * DAY, descriptionText: 'x' })],
      makeProfile([]),
      { maxDaysOld: 0, topN: 5 },
    );
    expect(ranked[0].recencyBoost).toBe(0.5);
  });

  it('treats unknown postedAt as 14 days old', () => {
    const { ranked } = rankJobs(
      [makeJob({ id: 'j1', postedAt: null, descriptionText: 'x' })],
      makeProfile([]),
      { maxDaysOld: 0, topN: 5 },
    );
    expect(ranked[0].recencyBoost).toBeCloseTo(1 - 14 / 30, 6);
  });

  it('hard maxDaysOld filter drops postings older than the limit', () => {
    const fresh = makeJob({ id: 'fresh', postedAt: NOW - 5 * DAY, descriptionText: 'x' });
    const stale = makeJob({ id: 'stale', postedAt: NOW - 40 * DAY, descriptionText: 'x' });
    const { ranked } = rankJobs([fresh, stale], makeProfile([]), { maxDaysOld: 30, topN: 5 });
    expect(ranked.map((r) => r.id)).toEqual(['fresh']);
  });

  it('maxDaysOld of 0 disables the hard recency filter', () => {
    const stale = makeJob({ id: 'stale', postedAt: NOW - 400 * DAY, descriptionText: 'x' });
    const { ranked } = rankJobs([stale], makeProfile([]), { maxDaysOld: 0, topN: 5 });
    expect(ranked.map((r) => r.id)).toEqual(['stale']);
  });
});

describe('rankJobs — Stage B disabled', () => {
  it('ranks keyword-only with fitScore null and zero cost when no claude provided', () => {
    const profile = makeProfile(['typescript', 'postgres']);
    const a = makeJob({ id: 'a', descriptionText: 'typescript postgres' }); // 1.0
    const b = makeJob({ id: 'b', descriptionText: 'typescript only' }); // 0.5
    const { ranked, cost } = rankJobs([a, b], profile, { maxDaysOld: 0, topN: 5 });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
    expect(ranked.every((r) => r.fitScore === null)).toBe(true);
    expect(ranked[0].finalScore).toBeCloseTo(1.0, 6);
    expect(cost).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalUsd: 0,
    });
  });

  it('does not call claude when fitScoreModel is missing', () => {
    const claude: ClaudeClient = { call: vi.fn() };
    const profile = makeProfile(['typescript']);
    rankJobs([makeJob({ id: 'a', descriptionText: 'typescript' })], profile, {
      maxDaysOld: 0,
      topN: 5,
      claude,
    });
    expect(claude.call).not.toHaveBeenCalled();
  });
});

describe('rankJobs — Stage B enabled', () => {
  it('batches survivors ~5 per call, sets fitScore, accumulates cost', () => {
    const profile = makeProfile(['typescript', 'postgres']);
    // 6 jobs all with keywordScore 1.0 → topN*2 = 8 ≥ 6 → all 6 candidates → 2 batches
    const jobs = Array.from({ length: 6 }, (_, i) =>
      makeJob({ id: `j${i}`, descriptionText: 'typescript postgres', title: `Job ${i}` }),
    );
    const calls: string[] = [];
    const claude: ClaudeClient = {
      call: vi.fn((req) => {
        calls.push(req.messages[0].content);
        // figure out how many indices this batch has by counting "--- index"
        const n = (req.messages[0].content.match(/--- index/g) || []).length;
        const arr = Array.from({ length: n }, (_, idx) => ({ index: idx, score: 80 - idx, reason: 'ok' }));
        return makeResponse(JSON.stringify(arr));
      }),
    };
    const { ranked, cost } = rankJobs(jobs, profile, {
      maxDaysOld: 0,
      topN: 4,
      claude,
      fitScoreModel: 'claude-haiku-4-5-20251001',
    });
    expect(claude.call).toHaveBeenCalledTimes(2); // 6 jobs / 5 per batch
    expect(ranked.length).toBe(4);
    expect(ranked.every((r) => typeof r.fitScore === 'number')).toBe(true);
    // cost per call = 1000 in @ $1/M ($0.001) + 200 out @ $5/M ($0.001) = $0.002; ×2 = $0.004
    expect(cost.inputTokens).toBe(2000);
    expect(cost.outputTokens).toBe(400);
    expect(cost.totalUsd).toBeCloseTo(0.004, 6);
  });

  it('uses fitScore*recencyBoost as finalScore for scored jobs', () => {
    const profile = makeProfile(['typescript']);
    const job = makeJob({ id: 'j1', descriptionText: 'typescript', postedAt: NOW - 30 * DAY }); // recency 0.5
    const claude: ClaudeClient = {
      call: vi.fn(() => makeResponse(JSON.stringify([{ index: 0, score: 90, reason: 'great' }]))),
    };
    const { ranked } = rankJobs([job], profile, {
      maxDaysOld: 0,
      topN: 1,
      claude,
      fitScoreModel: 'claude-haiku-4-5-20251001',
    });
    expect(ranked[0].fitScore).toBeCloseTo(0.9, 6);
    expect(ranked[0].finalScore).toBeCloseTo(0.9 * 0.5, 6);
  });

  it('falls back to keywordScore and warns on a batch parse failure', () => {
    const profile = makeProfile(['typescript', 'postgres']);
    const job = makeJob({ id: 'j1', descriptionText: 'typescript postgres' }); // keywordScore 1.0
    const claude: ClaudeClient = {
      call: vi.fn(() => makeResponse('not valid json at all {{{')),
    };
    const { ranked, cost } = rankJobs([job], profile, {
      maxDaysOld: 0,
      topN: 1,
      claude,
      fitScoreModel: 'claude-haiku-4-5-20251001',
    });
    // parse failed → fitScore falls back to keywordScore (1.0)
    expect(ranked[0].fitScore).toBeCloseTo(1.0, 6);
    // cost still accumulated (the call happened, returned usage)
    expect(cost.inputTokens).toBe(1000);
  });

  it('falls back to keywordScore on a ClaudeApiError mid-batch (no cost for that batch)', () => {
    const profile = makeProfile(['typescript']);
    const job = makeJob({ id: 'j1', descriptionText: 'typescript' });
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new ClaudeApiError('server', 503, 'down');
      }),
    };
    const { ranked, cost } = rankJobs([job], profile, {
      maxDaysOld: 0,
      topN: 1,
      claude,
      fitScoreModel: 'claude-haiku-4-5-20251001',
    });
    // "typescript" is present in the JD → keywordScore 1.0; fitScore falls back to it.
    expect(ranked[0].keywordScore).toBeCloseTo(1.0, 6);
    expect(ranked[0].fitScore).toBeCloseTo(1.0, 6);
    expect(cost.totalUsd).toBe(0);
  });

  it('ignores out-of-range / malformed entries in the fit-score array', () => {
    const profile = makeProfile(['typescript']);
    const jobs = [
      makeJob({ id: 'a', descriptionText: 'typescript' }),
      makeJob({ id: 'b', descriptionText: 'typescript' }),
    ];
    const claude: ClaudeClient = {
      call: vi.fn(() =>
        makeResponse(
          JSON.stringify([
            { index: 0, score: 70, reason: 'ok' },
            { index: 99, score: 100 }, // out of range — ignored
            { index: 1, score: 'high' }, // bad score — ignored
            'garbage',
          ]),
        ),
      ),
    };
    const { ranked } = rankJobs(jobs, profile, {
      maxDaysOld: 0,
      topN: 2,
      claude,
      fitScoreModel: 'claude-haiku-4-5-20251001',
    });
    const byId = new Map(ranked.map((r) => [r.id, r]));
    expect(byId.get('a')!.fitScore).toBeCloseTo(0.7, 6);
    // b had no valid entry → falls back to keywordScore (1.0)
    expect(byId.get('b')!.fitScore).toBeCloseTo(1.0, 6);
  });
});

describe('rankJobs — final sort + slicing', () => {
  it('sorts descending by finalScore and slices to topN', () => {
    const profile = makeProfile(['typescript', 'postgres', 'kubernetes', 'graphql']);
    const high = makeJob({ id: 'high', descriptionText: 'typescript postgres kubernetes graphql' }); // 1.0
    const mid = makeJob({ id: 'mid', descriptionText: 'typescript postgres' }); // 0.5
    const low = makeJob({ id: 'low', descriptionText: 'typescript' }); // 0.25
    const { ranked } = rankJobs([mid, low, high], profile, { maxDaysOld: 0, topN: 2 });
    expect(ranked.map((r) => r.id)).toEqual(['high', 'mid']);
  });

  it('returns an empty list for no input jobs', () => {
    const { ranked, cost } = rankJobs([], makeProfile(['x']), { maxDaysOld: 0, topN: 5 });
    expect(ranked).toEqual([]);
    expect(cost.totalUsd).toBe(0);
  });

  it('does not leak the internal _daysOld field on returned jobs', () => {
    const { ranked } = rankJobs([makeJob({ id: 'j1', descriptionText: 'x' })], makeProfile([]), {
      maxDaysOld: 0,
      topN: 5,
    });
    expect('_daysOld' in (ranked[0] as unknown as Record<string, unknown>)).toBe(false);
  });
});
