/**
 * Tests for appsscript/src/lib/jobProfile.ts — distilProfile.
 */

import { describe, it, expect, vi } from 'vitest';
import { distilProfile } from '../../src/lib/jobProfile.js';
import type { ClaudeClient, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';

const FULL_PROFILE = {
  titles: ['Senior Backend Engineer', 'Staff Engineer'],
  seniority: 'senior',
  skills: ['typescript', 'node.js', 'postgres', 'kubernetes', 'graphql', 'aws'],
  domains: ['fintech', 'developer tools'],
  searchQueries: ['senior backend engineer', 'staff software engineer', 'platform engineer'],
  filters: { remote: 'preferred', minSalary: 180000, locations: ['Remote', 'New York'] },
  summary: 'A seasoned backend engineer with deep TypeScript and distributed-systems experience.',
};

function makeResponse(text: string, model = 'claude-haiku-4-5-20251001'): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 2000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model,
  };
}

function makeClaude(response: ClaudeResponse | (() => ClaudeResponse)): ClaudeClient {
  return { call: vi.fn(typeof response === 'function' ? response : () => response) };
}

describe('distilProfile', () => {
  it('happy path: full JSON maps to the correct profile', () => {
    const claude = makeClaude(makeResponse(JSON.stringify(FULL_PROFILE)));
    const { profile } = distilProfile(claude, 'claude-haiku-4-5-20251001', 'resume text');
    expect(profile.titles).toEqual(FULL_PROFILE.titles);
    expect(profile.seniority).toBe('senior');
    expect(profile.skills).toEqual(FULL_PROFILE.skills);
    expect(profile.domains).toEqual(FULL_PROFILE.domains);
    expect(profile.searchQueries).toEqual(FULL_PROFILE.searchQueries);
    expect(profile.filters).toEqual(FULL_PROFILE.filters);
    expect(profile.summary).toContain('backend engineer');
  });

  it('passes the system prompt and source text to Claude', () => {
    const claude = makeClaude(makeResponse(JSON.stringify(FULL_PROFILE)));
    distilProfile(claude, 'claude-haiku-4-5-20251001', 'MY-SOURCE-MATERIALS-MARKER');
    const callArg = (claude.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.system[0].text).toMatch(/distil/i);
    expect(callArg.messages[0].content).toContain('MY-SOURCE-MATERIALS-MARKER');
    expect(callArg.model).toBe('claude-haiku-4-5-20251001');
  });

  it('parses fence-wrapped JSON', () => {
    const fenced = '```json\n' + JSON.stringify(FULL_PROFILE) + '\n```';
    const claude = makeClaude(makeResponse(fenced));
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.skills).toEqual(FULL_PROFILE.skills);
  });

  it('parses bare ``` fences with no language tag', () => {
    const fenced = '```\n' + JSON.stringify(FULL_PROFILE) + '\n```';
    const claude = makeClaude(makeResponse(fenced));
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.titles).toEqual(FULL_PROFILE.titles);
  });

  it('backfills missing fields with sane defaults', () => {
    const claude = makeClaude(makeResponse(JSON.stringify({})));
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.titles).toEqual([]);
    expect(profile.seniority).toBe('unspecified');
    expect(profile.skills).toEqual([]);
    expect(profile.domains).toEqual([]);
    expect(profile.searchQueries).toEqual([]);
    expect(profile.filters).toEqual({ remote: 'any', minSalary: null, locations: [] });
    expect(profile.summary).toBe('');
  });

  it('falls back searchQueries to titles.slice(0,3) when empty', () => {
    const claude = makeClaude(
      makeResponse(JSON.stringify({ titles: ['a', 'b', 'c', 'd'], searchQueries: [] })),
    );
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.searchQueries).toEqual(['a', 'b', 'c']);
  });

  it('coerces invalid seniority and remote to defaults', () => {
    const claude = makeClaude(
      makeResponse(JSON.stringify({ seniority: 'wizard', filters: { remote: 'maybe' } })),
    );
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.seniority).toBe('unspecified');
    expect(profile.filters.remote).toBe('any');
  });

  it('drops non-string entries from string arrays', () => {
    const claude = makeClaude(
      makeResponse(JSON.stringify({ skills: ['ts', 42, null, 'go', ''], titles: ['x', 7] })),
    );
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.skills).toEqual(['ts', 'go']);
    expect(profile.titles).toEqual(['x']);
  });

  it('coerces non-numeric minSalary to null', () => {
    const claude = makeClaude(
      makeResponse(JSON.stringify({ filters: { remote: 'no', minSalary: 'lots', locations: ['SF'] } })),
    );
    const { profile } = distilProfile(claude, 'm', 'text');
    expect(profile.filters).toEqual({ remote: 'no', minSalary: null, locations: ['SF'] });
  });

  it('throws on malformed JSON', () => {
    const claude = makeClaude(makeResponse('this is not json {{{'));
    expect(() => distilProfile(claude, 'm', 'text')).toThrow(/invalid JSON/i);
  });

  it('throws when Claude returns a non-object JSON value', () => {
    const claude = makeClaude(makeResponse('[1,2,3]'));
    expect(() => distilProfile(claude, 'm', 'text')).toThrow(/non-object/i);
  });

  it('rethrows a ClaudeApiError unchanged', () => {
    const err = new ClaudeApiError('rate_limit', 429, 'slow down', 30);
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw err;
      }),
    };
    expect(() => distilProfile(claude, 'm', 'text')).toThrow(err);
    try {
      distilProfile(claude, 'm', 'text');
    } catch (e) {
      expect(e).toBeInstanceOf(ClaudeApiError);
      expect((e as ClaudeApiError).errorType).toBe('rate_limit');
    }
  });

  it('rethrows a generic Error from the Claude call', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        throw new Error('network down');
      }),
    };
    expect(() => distilProfile(claude, 'm', 'text')).toThrow('network down');
  });

  it('computes cost from the response usage and model', () => {
    const claude = makeClaude(makeResponse(JSON.stringify(FULL_PROFILE), 'claude-haiku-4-5-20251001'));
    const { cost } = distilProfile(claude, 'claude-haiku-4-5-20251001', 'text');
    // 2000 input @ $1/M = 0.002 ; 500 output @ $5/M = 0.0025 → 0.0045
    expect(cost.inputTokens).toBe(2000);
    expect(cost.outputTokens).toBe(500);
    expect(cost.totalUsd).toBeCloseTo(0.0045, 6);
  });
});
