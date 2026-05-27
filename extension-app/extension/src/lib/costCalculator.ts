/**
 * costCalculator.ts
 *
 * Estimates per-call USD cost for a JobHelp generation, given the user's
 * toggle config and the chosen base "generate" model.
 *
 * Each feature has its own approximate token profile (cached input, fresh
 * input, output). Pricing is per 1M tokens, keyed by Anthropic model id and
 * MIRRORS the canonical PRICING_TABLE in extension-app/appsscript/src/cost.ts — do not
 * edit pricing here without also updating that file.
 *
 * Baseline per-call (used by `generate`):
 *   ~10K cached input + ~1K fresh input + ~1.5K output
 *
 * v2 features (research, benchmark, critique, autoRevise, coverLetter,
 * verifyHooks, multiVersion) are passed as a separate `V2FeatureCosts`
 * argument because the sidepanel keeps that state OUTSIDE ToggleConfig.
 * If omitted, behaviour is identical to v1 (generate only).
 */
import type { ToggleConfig } from '../types/api-contract.js';
import { log } from './structuredLog.js';

export interface CostEstimate {
  generate: number;
  research: number;
  /**
   * v2 LinkedIn role-benchmark cost. Optional so legacy `CostEstimate`
   * literals (constructed before v2) still type-check; estimateCost always
   * populates it (0 when the feature is disabled).
   */
  benchmark?: number;
  critique: number;
  autoRevise: number;
  multiVersion: number;
  coverLetter: number;
  verifyHooks: number;
  total: number;
}

/**
 * v2 feature flags + chosen models, as held by the sidepanel state.
 * Every field is optional; missing flags default to "disabled".
 *
 * NOTE: This is a flat shape because that is how the sidepanel state is
 * organised (see generate.ts state). The legacy `ToggleConfig` nested shape
 * is still accepted as the first argument so the existing
 * `estimateCost(state.toggles, state.generateModel)` call keeps working.
 */
export interface V2FeatureCosts {
  researchEnabled?: boolean;
  researchModel?: string;
  benchmarkEnabled?: boolean;
  benchmarkModel?: string;
  critiqueEnabled?: boolean;
  critiqueModel?: string;
  autoReviseEnabled?: boolean;
  autoReviseModel?: string;
  coverLetterEnabled?: boolean;
  coverLetterModel?: string;
  verifyHooksEnabled?: boolean;
  verifyHooksModel?: string;
  multiVersionEnabled?: boolean;
  multiVersionModel?: string;
  multiVersionCount?: number;
}

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Anthropic pricing per 1M tokens (USD).
 * MIRROR of extension-app/appsscript/src/cost.ts PRICING_TABLE — keep in sync.
 */
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
 * relative cost. Inputs for v2 features (research, benchmark, critique,
 * autoRevise, coverLetter, verifyHooks) align with handler maxTokens caps:
 *   - research/benchmark: maxTokens=1024, ~1.5K input (+web_search variable)
 *   - critique: maxTokens=2048, ~4K input (8-dim scoring is verbose)
 *   - autoRevise: maxTokens=4096, ~2K input
 *   - coverLetter: maxTokens=1024, ~3K input
 *   - verifyHooks: extraction (~1K in, 500 out) + 5 × (500 in + 300 out)
 */
type ProfileKey =
  | 'generate'
  | 'research'
  | 'benchmark'
  | 'critique'
  | 'autoRevise'
  | 'coverLetter'
  | 'verifyHooks';

const PROFILES: Record<ProfileKey, TokenProfile> = {
  generate:    { cacheRead: 10_000, freshInput: 1_000, output: 1_500 },
  research:    { cacheRead:      0, freshInput: 1_500, output:   400 },
  benchmark:   { cacheRead:      0, freshInput: 1_500, output:   400 },
  critique:    { cacheRead: 10_000, freshInput: 4_000, output: 1_500 },
  autoRevise:  { cacheRead: 10_000, freshInput: 2_000, output: 1_500 },
  coverLetter: { cacheRead: 10_000, freshInput: 3_000, output: 1_024 },
  // verifyHooks here is the EXTRACTION step only; per-entity costs are added
  // separately in estimateCost (default 5 entities × 500 in + 300 out).
  verifyHooks: { cacheRead:      0, freshInput: 1_000, output:   500 },
};

/** Default number of named entities verifyHooks will look up. */
const VERIFY_HOOKS_ENTITY_COUNT = 5;
const VERIFY_HOOKS_PER_ENTITY: TokenProfile = {
  cacheRead: 0,
  freshInput: 500,
  output: 300,
};

/** Models we've already warned about this session — keeps the log from spamming. */
const warnedUnknownModels = new Set<string>();

/** Cost of a single call given model + token profile. */
function costFor(modelId: string, profile: TokenProfile): number {
  let pricing = PRICING_PER_M[modelId];
  if (!pricing) {
    // An unknown model id (typo, or a model added to the backend table but not
    // mirrored here) silently bills at Haiku rates — the preview can be wrong
    // by ~75x if the user meant an Opus model. Surface it (audit M16). We
    // still return a finite number so the existing preview UI keeps working.
    if (!warnedUnknownModels.has(modelId)) {
      warnedUnknownModels.add(modelId);
      log('warn', 'costCalculator: unknown model id — falling back to Haiku pricing', {
        modelId,
        knownModels: Object.keys(PRICING_PER_M),
      });
    }
    pricing = DEFAULT_PRICING;
  }
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
 *
 * Backwards compatible: `estimateCost(toggles, model)` (v1 signature) still
 * works. New v2 features can be passed as a third `V2FeatureCosts` argument.
 * When BOTH the legacy `toggles` field AND a matching v2 flag are set, the
 * v2 flag wins (sidepanel state is the source of truth in v2).
 *
 * Disabled or absent toggles cost $0.
 */
export function estimateCost(
  toggles: ToggleConfig,
  generateModel: string,
  v2: V2FeatureCosts = {},
): CostEstimate {
  const generate = costFor(generateModel, PROFILES.generate);

  // Research: prefer v2 flat state, fall back to legacy nested toggle.
  const researchOn = v2.researchEnabled ?? toggles.research?.enabled ?? false;
  const researchModel = v2.researchModel ?? toggles.research?.model ?? generateModel;
  const research = researchOn ? costFor(researchModel, PROFILES.research) : 0;

  // Benchmark: v2-only (no legacy nested toggle exists).
  const benchmarkOn = v2.benchmarkEnabled ?? false;
  const benchmarkModel = v2.benchmarkModel ?? generateModel;
  const benchmark = benchmarkOn ? costFor(benchmarkModel, PROFILES.benchmark) : 0;

  const critiqueOn = v2.critiqueEnabled ?? toggles.critique?.enabled ?? false;
  const critiqueModel = v2.critiqueModel ?? toggles.critique?.model ?? generateModel;
  const critique = critiqueOn ? costFor(critiqueModel, PROFILES.critique) : 0;

  const autoReviseOn = v2.autoReviseEnabled ?? toggles.autoRevise?.enabled ?? false;
  const autoReviseModel = v2.autoReviseModel ?? toggles.autoRevise?.model ?? generateModel;
  const autoRevise = autoReviseOn ? costFor(autoReviseModel, PROFILES.autoRevise) : 0;

  const coverLetterOn = v2.coverLetterEnabled ?? toggles.coverLetter?.enabled ?? false;
  const coverLetterModel = v2.coverLetterModel ?? toggles.coverLetter?.model ?? generateModel;
  const coverLetter = coverLetterOn ? costFor(coverLetterModel, PROFILES.coverLetter) : 0;

  // verifyHooks = extraction (one call) + N entity checks. Default N=5.
  const verifyHooksOn = v2.verifyHooksEnabled ?? toggles.verifyHooks?.enabled ?? false;
  const verifyHooksModel = v2.verifyHooksModel ?? toggles.verifyHooks?.model ?? generateModel;
  const verifyHooks = verifyHooksOn
    ? costFor(verifyHooksModel, PROFILES.verifyHooks) +
      VERIFY_HOOKS_ENTITY_COUNT * costFor(verifyHooksModel, VERIFY_HOOKS_PER_ENTITY)
    : 0;

  // Multi-version repeats the generate profile `count` times under the
  // multi-version model.
  const multiVersionOn = v2.multiVersionEnabled ?? toggles.multiVersion?.enabled ?? false;
  const multiVersionModel =
    v2.multiVersionModel ?? toggles.multiVersion?.model ?? generateModel;
  const multiVersionCount = Math.max(
    0,
    v2.multiVersionCount ?? toggles.multiVersion?.count ?? 0,
  );
  const multiVersion = multiVersionOn
    ? costFor(multiVersionModel, PROFILES.generate) * multiVersionCount
    : 0;

  const total =
    generate +
    research +
    benchmark +
    critique +
    autoRevise +
    coverLetter +
    verifyHooks +
    multiVersion;

  return {
    generate: round4(generate),
    research: round4(research),
    benchmark: round4(benchmark),
    critique: round4(critique),
    autoRevise: round4(autoRevise),
    multiVersion: round4(multiVersion),
    coverLetter: round4(coverLetter),
    verifyHooks: round4(verifyHooks),
    total: round4(total),
  };
}
