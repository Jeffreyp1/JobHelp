/**
 * costCalculator.ts
 *
 * Estimates per-call USD cost for a JobHelp generation, given the user's
 * toggle config and the chosen base "generate" model.
 *
 * Each feature has its own approximate token profile (cached input, fresh
 * input, output). Pricing is per 1M tokens, keyed by Anthropic model id.
 *
 * Baseline per-call (used by `generate`):
 *   ~10K cached input + ~1K fresh input + ~1.5K output
 *
 * Other features run heavier passes — research is an investigative report,
 * critique is a multi-dimension lens read of the produced resume, etc.
 */
import type { ToggleConfig } from '../types/api-contract.js';

export interface CostEstimate {
  generate: number;
  research: number;
  critique: number;
  autoRevise: number;
  multiVersion: number;
  coverLetter: number;
  verifyHooks: number;
  total: number;
}

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
}

/** Anthropic pricing per 1M tokens (USD). */
const PRICING_PER_M: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheRead: 0.1 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3 },
  'claude-opus-4-7': { input: 15.0, output: 75.0, cacheRead: 1.5 },
};

/** Default pricing fallback if an unknown model id is supplied. */
const DEFAULT_PRICING: ModelPricing = PRICING_PER_M['claude-haiku-4-5-20251001'];

interface TokenProfile {
  cacheRead: number;
  freshInput: number;
  output: number;
}

/**
 * Per-feature token profiles. Numbers are coarse but the ratios reflect the
 * relative cost: research and critique are deeper passes than baseline
 * generate; auto-revise is closer to baseline; verify hooks is short.
 */
const PROFILES: Record<
  'generate' | 'research' | 'critique' | 'autoRevise' | 'coverLetter' | 'verifyHooks',
  TokenProfile
> = {
  generate: { cacheRead: 10_000, freshInput: 1_000, output: 1_500 },
  research: { cacheRead: 10_000, freshInput: 6_000, output: 6_000 },
  critique: { cacheRead: 10_000, freshInput: 2_500, output: 2_000 },
  autoRevise: { cacheRead: 10_000, freshInput: 2_000, output: 1_500 },
  coverLetter: { cacheRead: 10_000, freshInput: 1_500, output: 2_500 },
  verifyHooks: { cacheRead: 10_000, freshInput: 1_500, output: 1_000 },
};

/** Cost of a single call given model + token profile. */
function costFor(modelId: string, profile: TokenProfile): number {
  const pricing = PRICING_PER_M[modelId] ?? DEFAULT_PRICING;
  return (
    (profile.cacheRead * pricing.cacheRead +
      profile.freshInput * pricing.input +
      profile.output * pricing.output) /
    1_000_000
  );
}

/** Round to 4 decimal places (matching the wire CostBreakdown convention). */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Estimate the total cost for one Generate click given enabled toggles.
 * Disabled or absent toggles cost $0.
 */
export function estimateCost(toggles: ToggleConfig, generateModel: string): CostEstimate {
  const generate = costFor(generateModel, PROFILES.generate);

  const research = toggles.research?.enabled
    ? costFor(toggles.research.model, PROFILES.research)
    : 0;
  const critique = toggles.critique?.enabled
    ? costFor(toggles.critique.model, PROFILES.critique)
    : 0;
  const autoRevise = toggles.autoRevise?.enabled
    ? costFor(toggles.autoRevise.model, PROFILES.autoRevise)
    : 0;
  const coverLetter = toggles.coverLetter?.enabled
    ? costFor(toggles.coverLetter.model, PROFILES.coverLetter)
    : 0;
  const verifyHooks = toggles.verifyHooks?.enabled
    ? costFor(toggles.verifyHooks.model, PROFILES.verifyHooks)
    : 0;

  // Multi-version repeats the generate profile `count` times under the
  // multi-version model.
  let multiVersion = 0;
  if (toggles.multiVersion?.enabled) {
    const cnt = Math.max(0, toggles.multiVersion.count ?? 0);
    multiVersion = costFor(toggles.multiVersion.model, PROFILES.generate) * cnt;
  }

  const total =
    generate + research + critique + autoRevise + coverLetter + verifyHooks + multiVersion;

  return {
    generate: round4(generate),
    research: round4(research),
    critique: round4(critique),
    autoRevise: round4(autoRevise),
    multiVersion: round4(multiVersion),
    coverLetter: round4(coverLetter),
    verifyHooks: round4(verifyHooks),
    total: round4(total),
  };
}
