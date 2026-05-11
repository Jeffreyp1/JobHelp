/**
 * Tests for appsscript/src/handlers/research.ts
 *
 * Covers validateResearchCompany + handleResearchCompany.
 * Uses dependency injection via Deps; CacheService is stubbed via vi.stubGlobal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateResearchCompany,
  handleResearchCompany,
} from '../../src/handlers/research.js';
import type { Deps } from '../../src/Code.js';
import type { ClaudeClient, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type {
  ResearchCompanyRequest,
  ResearchCompanyResult,
} from '../../src/types/api-contract.js';
import { makeCacheService } from '../helpers/gas-mocks.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClaudeJsonResponse(
  payload: unknown = {
    summary: 'Acme is a fictional widget maker focused on innovative widgets.',
    keywords: ['widgets', 'innovation', 'manufacturing'],
    sources: [
      { title: 'About Acme', url: 'https://acme.example.com/about' },
      { title: 'Acme Careers', url: 'https://acme.example.com/careers' },
    ],
  },
): ClaudeResponse {
  return {
    text: JSON.stringify(payload),
    stopReason: 'end_turn',
    usage: {
      input_tokens: 1500,
      output_tokens: 400,
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
  overrides: Partial<ResearchCompanyRequest> = {},
): ResearchCompanyRequest {
  return {
    action: 'research_company',
    company: 'Acme',
    role: 'Senior Engineer',
    model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validateResearchCompany', () => {
  it('returns null when input is valid', () => {
    expect(
      validateResearchCompany({
        action: 'research_company',
        company: 'Acme',
        role: 'Engineer',
        model: 'claude-haiku-4-5-20251001',
      }),
    ).toBeNull();
  });

  it('returns null when role is null (optional)', () => {
    expect(
      validateResearchCompany({
        action: 'research_company',
        company: 'Acme',
        role: null,
        model: 'claude-haiku-4-5-20251001',
      }),
    ).toBeNull();
  });

  it('errors when company is missing', () => {
    const err = validateResearchCompany({
      action: 'research_company',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err).not.toBeNull();
    expect(err?.ok).toBe(false);
    expect(err?.error.type).toBe('validation');
  });

  it('errors when company is non-string', () => {
    const err = validateResearchCompany({
      action: 'research_company',
      company: 42 as unknown,
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when company is empty string', () => {
    const err = validateResearchCompany({
      action: 'research_company',
      company: '',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when model is missing', () => {
    const err = validateResearchCompany({
      action: 'research_company',
      company: 'Acme',
    });
    expect(err?.error.type).toBe('validation');
  });

  it('errors when role is provided as a non-string non-null value', () => {
    const err = validateResearchCompany({
      action: 'research_company',
      company: 'Acme',
      role: 42 as unknown,
      model: 'claude-haiku-4-5-20251001',
    });
    expect(err?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

describe('handleResearchCompany', () => {
  let cacheStub: ReturnType<typeof makeCacheService>;

  beforeEach(() => {
    cacheStub = makeCacheService();
    vi.stubGlobal('CacheService', cacheStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T1: returns cached result when CacheService has entry', () => {
    const cached: Omit<ResearchCompanyResult, 'cached'> = {
      summary: 'Cached summary',
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
      'research:Acme:Senior Engineer': JSON.stringify(cached),
    });
    vi.stubGlobal('CacheService', cacheStub);

    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(true);
    expect(result.summary).toBe('Cached summary');
    expect(cacheStub.getScriptCache().get).toHaveBeenCalledWith(
      'research:Acme:Senior Engineer',
    );
    expect(claude.call).not.toHaveBeenCalled();
  });

  it('T2: calls Claude on cache miss and writes to cache', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(false);
    expect(claude.call).toHaveBeenCalledTimes(1);
    expect(cacheStub.getScriptCache().put).toHaveBeenCalledTimes(1);
    const putCall = (cacheStub.getScriptCache().put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe('research:Acme:Senior Engineer');
    expect(putCall[2]).toBe(86400);
  });

  it('T3: forceRefresh=true skips cache and re-writes to cache', () => {
    cacheStub = makeCacheService({
      'research:Acme:Senior Engineer': JSON.stringify({
        summary: 'OLD',
        keywords: [],
        sources: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0 },
      }),
    });
    vi.stubGlobal('CacheService', cacheStub);

    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest({ forceRefresh: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(false);
    // Cache should NOT be consulted via .get()
    expect(cacheStub.getScriptCache().get).not.toHaveBeenCalled();
    expect(claude.call).toHaveBeenCalledTimes(1);
    expect(cacheStub.getScriptCache().put).toHaveBeenCalledTimes(1);
  });

  it('T4: missing company in handler request still returns validation error', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest({ company: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('validation');
  });

  it('T5: Claude failure returns retryable: true error', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new ClaudeApiError('server', 500, 'Internal server error');
      }),
    };
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.retryable).toBe(true);
  });

  it('T5b: rate limit Claude failure returns retryable: true', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new ClaudeApiError('rate_limit', 429, 'Too Many Requests');
      }),
    };
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.retryable).toBe(true);
  });

  it('T5c: auth failure is NOT retryable', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new ClaudeApiError('auth', 401, 'Bad API key');
      }),
    };
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('auth');
    expect(result.error.retryable).toBe(false);
  });

  it('T5d: malformed JSON from Claude returns retryable server error', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => ({
        text: 'not json at all {{{',
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
    const result = handleResearchCompany(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
  });

  it('T6: result.keywords is non-empty array of strings', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(Array.isArray(result.keywords)).toBe(true);
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.keywords.every((k) => typeof k === 'string')).toBe(true);
  });

  it('T7: result.sources contains title + url for each source', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.sources.length).toBeGreaterThan(0);
    for (const s of result.sources) {
      expect(typeof s.title).toBe('string');
      expect(typeof s.url).toBe('string');
    }
  });

  it('T8: cost.totalUsd is positive when Claude is called', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    const result = handleResearchCompany(deps, makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });

  it('cache key includes role when role provided, empty when null', () => {
    const claude = makeClaudeMock();
    const deps = makeDeps(claude);
    handleResearchCompany(deps, makeRequest({ role: null }));
    const putCall = (cacheStub.getScriptCache().put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe('research:Acme:');
  });
});
