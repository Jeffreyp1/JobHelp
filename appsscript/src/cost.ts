/**
 * Cost calculation for Claude API usage.
 * Converts ClaudeUsage token counts to USD using per-model pricing tables.
 */

import type { ClaudeUsage } from './types/claude-api.js';
import type { CostBreakdown } from './types/api-contract.js';

/** Pricing in USD per 1,000,000 tokens */
interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.10,
    cacheWrite: 1.25,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-opus-4-7': {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
};

/** Fallback pricing if model is not in the table (defaults to Haiku rates) */
const DEFAULT_PRICING: ModelPricing = PRICING_TABLE['claude-haiku-4-5-20251001'];

/**
 * Calculate cost breakdown from Claude usage statistics.
 * @param usage  Token usage from a ClaudeResponse
 * @param model  Anthropic model identifier
 * @returns      CostBreakdown with totalUsd rounded to 4 decimal places
 */
export function calculateCost(usage: ClaudeUsage, model: string): CostBreakdown {
  const pricing = PRICING_TABLE[model] ?? DEFAULT_PRICING;
  const M = 1_000_000;

  const inputCost = (usage.input_tokens * pricing.input) / M;
  const outputCost = (usage.output_tokens * pricing.output) / M;
  const cacheReadCost = (usage.cache_read_input_tokens * pricing.cacheRead) / M;
  const cacheWriteCost = (usage.cache_creation_input_tokens * pricing.cacheWrite) / M;

  const rawTotal = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  const totalUsd = Math.round(rawTotal * 10_000) / 10_000;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
    totalUsd,
  };
}
