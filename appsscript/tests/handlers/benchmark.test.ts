/**
 * Tests for appsscript/src/handlers/benchmark.ts
 *
 * Covers validateBenchmarkRole + handleBenchmarkRole.
 * Uses dependency injection via Deps; CacheService is stubbed via vi.stubGlobal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateBenchmarkRole,
  handleBenchmarkRole,
} from '../../src/handlers/benchmark.js';
import type { Deps } from '../../src/Code.js';
import type { ClaudeClient, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type {
  BenchmarkRoleRequest,
  BenchmarkRoleResult,
} from '../../src/types/api-contract.js';
import { makeCacheService } from '../helpers/gas-mocks.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_PATTERNS =
  'Successful candidates for Senior Engineer at Acme typically have 7-10 years experience. ' +
  'They demonstrate strong systems thinking, have shipped production services at scale, ' +
  'and frequently mention domain expertise in distributed systems on their LinkedIn profiles.';

function makeClaudeJsonResponse(
  payload: unknown = {
    patterns: SAMPLE_PATTERNS,
    keywords: ['distributed systems', 'production services', 'systems thinking'],
    sources: [
      { title: 'LinkedIn — Acme Engineering', url: 'https://linkedin.com/company/acme' },
      { title: 'Acme job posting', url: 'https://acme.example.com/jobs/123' },
    ],
  },
): ClaudeResponse {
  return {
    text: JSON.stringify(payload),
    stopReason: 'end_turn',
    usage: {
      input_tokens: 1800,
      output_tokens: 600,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: 'claude-haiku-4-5-20251001',
  };
}

function makeClaudeMock(response?: ClaudeResponse): ClaudeClient {
  return {
    call: vi.fn(() => response ?? makeClaudeJsonResponse()),
  };
}

function makeDeps(claude: ClaudeClient): Deps {
  return {
    drive: {} as Deps['drive'],
    claude,
    prompt: { composeSystemPrompt: vi.fn() },
  };
}

function makeRequest(
  overrides: Partial<BenchmarkRoleRequest> = {},
): BenchmarkRoleRequest {
  return {
    action: 'benchmark_role',
    company: 'Acme',
    role: 'Senior Engineer',
    model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validateBenchmarkRole', () => {
  it('returns null when input is valid', () => {
    expect(
      validateBenchmarkRole({
        action: 'benchmark_role',
        company: 'Acme',
        role: 'Senior Engineer',
        model: 'claude-haiku-4-5-20251001',
      }),
    ).toBeNull();
  });

  it('errors when company is missing', () => {
    const err = validateBenchmarkRole({
      action: 'benchmark_role',
      role: 'Engineer',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when role is missing', () => {
    const err = validateBenchmarkRole({
      action: 'benchmark_role',
      company: 'Acme',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when model is missing', () => {
    const err = validateBenchmarkRole({
      action: 'benchmark_role',
      company: 'Acme',
      role: 'Engineer',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when company is empty string', () => {
    const err = validateBenchmarkRole({
      action: 'benchmark_role',
      company: '',
      role: 'Engineer',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when role is empty string', () => {
    const err = validateBenchmarkRole({
      action: 'benchmark_role',
      company: 'Acme',
      role: '',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

describe('handleBenchmarkRole', () => {
  let cacheStub: ReturnType<typeof makeCacheService>;

  beforeEach(() => {
    cacheStub = makeCacheService();
    vi.stubGlobal('CacheService', cacheStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T1: returns cached result when CacheService has entry', () => {
    const cached: Omit<BenchmarkRoleResult, 'cached'> = {
      patterns: SAMPLE_PATTERNS,
      keywords: ['k1', 'k2'],
      sources: [{ title: 'Source 1', url: 'https://example.com/1' }],
      cost: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalUsd: 0.001,
      },
    };
    cacheStub = makeCacheService({
      'benchmark:["Acme","Senior Engineer"]': JSON.stringify(cached),
    });
    vi.stubGlobal('CacheService', cacheStub);

    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(true);
    expect(claude.call).not.toHaveBeenCalled();
  });

  it('T2: calls Claude on cache miss', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(false);
    expect(claude.call).toHaveBeenCalledTimes(1);
    expect(cacheStub.getScriptCache().put).toHaveBeenCalledTimes(1);
    const putCall = (cacheStub.getScriptCache().put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe('benchmark:["Acme","Senior Engineer"]');
    expect(putCall[2]).toBe(86400);
  });

  it('T3: forceRefresh=true bypasses cache and re-writes', () => {
    cacheStub = makeCacheService({
      'benchmark:["Acme","Senior Engineer"]': JSON.stringify({
        patterns: 'OLD',
        keywords: [],
        sources: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0 },
      }),
    });
    vi.stubGlobal('CacheService', cacheStub);

    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest({ forceRefresh: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(cacheStub.getScriptCache().get).not.toHaveBeenCalled();
    expect(claude.call).toHaveBeenCalledTimes(1);
    expect(cacheStub.getScriptCache().put).toHaveBeenCalledTimes(1);
  });

  it('T4: missing company returns validation error', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest({ company: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
  });

  it('T5: missing role returns validation error', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest({ role: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
  });

  it('T6: Claude failure returns retryable: true', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new ClaudeApiError('server', 503, 'Service unavailable');
      }),
    };
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.retryable).toBe(true);
  });

  it('T6b: malformed JSON from Claude returns retryable server error', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => ({
        text: 'definitely not json',
        stopReason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        model: 'claude-haiku-4-5-20251001',
      })),
    };
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
  });

  it('T7: result.keywords is non-empty array of strings', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.keywords.every((k) => typeof k === 'string')).toBe(true);
  });

  it('T8: result.sources contains title + url entries', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.sources.length).toBeGreaterThan(0);
    for (const s of result.sources) {
      expect(typeof s.title).toBe('string');
      expect(typeof s.url).toBe('string');
    }
  });

  it('T9: result.patterns is a non-empty string longer than 50 chars', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.patterns).toBe('string');
    expect(result.patterns.length).toBeGreaterThan(50);
  });

  it('T10: cost.totalUsd is positive when Claude is called', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleBenchmarkRole(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });
});
