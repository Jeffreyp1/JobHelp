/**
 * User-supplied configuration loaded from `~/.config/jobhelp/config.json` (or env override).
 * Validated at startup; all fields immutable after load.
 *
 * Design B (zero-API-key): no `anthropic` block. The MCP server never calls Claude.
 * `useLlmFitScore` retained for backward-compat with Phase 1's rank.ts shape but is
 * always forced to `false` by `loadConfig`.
 */
export interface JobDigestConfig {
  readonly profile: ProfileConfig;
  readonly sources: SourcesConfig;
  readonly ranking: RankingConfig;
  readonly rules: RulesConfig;
  readonly output: OutputConfig;
}

export interface ProfileConfig {
  /** Filesystem path to the candidate's resume dump markdown (supports ~ expansion). */
  readonly resumeDumpPath: string;
  readonly skills: readonly string[];
  /** Human-readable location, e.g. "Irvine, CA". */
  readonly location: string;
  readonly remoteOk: boolean;
  /** Minimum acceptable salary in USD. */
  readonly salaryFloor: number;
  readonly seniority: Seniority;
  /** Role families the candidate accepts, e.g. ["backend", "fullstack", "ai-engineer"]. */
  readonly roleFamily: readonly string[];
  /**
   * Canonical country labels (matching {@link detectCountryFromLocation} output,
   * e.g. 'US', 'Canada', 'UK', 'EU'). When empty/undefined, no geo filter is applied.
   * Loader has no defaults — absence means filter off.
   */
  readonly allowedCountries?: readonly string[];
}

export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'staff';

export interface SourcesConfig {
  readonly adzuna?: AdzunaConfig;
  readonly greenhouse?: GreenhouseConfig;
  readonly lever?: LeverConfig;
  readonly ashby?: AshbyConfig;
  readonly usajobs?: UsaJobsConfig;
  readonly jsearch?: JSearchConfig;
  readonly remotive?: RemotiveConfig;
  readonly remoteok?: RemoteOkConfig;
}

export interface AdzunaConfig {
  readonly appId: string;
  readonly appKey: string;
  /** Two-letter country code, e.g. "us". */
  readonly country: string;
  readonly queries: readonly string[];
}

export interface GreenhouseConfig {
  /** Public greenhouse board tokens, e.g. ["doordash", "stripe"]. */
  readonly tokens: readonly string[];
}

export interface LeverConfig {
  /** Public lever client slugs, e.g. ["plaid", "anthropic"]. */
  readonly slugs: readonly string[];
}

export interface AshbyConfig {
  /** Public Ashby job board tokens, e.g. ["ramp", "notion"]. */
  readonly tokens: readonly string[];
}

export interface UsaJobsConfig {
  readonly apiKey: string;
  readonly email: string;
}

export interface JSearchConfig {
  readonly rapidApiKey: string;
}

export interface RemotiveConfig {
  /** Optional list of search keywords; if empty/missing, fetches general feed (limit 100). */
  readonly queries?: readonly string[];
  /** Per-call result cap. Default 100. */
  readonly limit?: number;
}

export interface RemoteOkConfig {
  /** Optional tag filters (e.g., ["python", "backend"]). */
  readonly tags?: readonly string[];
}

export interface RankingConfig {
  /** Always coerced to `false` by `loadConfig` in Design B. Field retained for shape compat. */
  readonly useLlmFitScore: boolean;
  /** Top-N survivors to send through expensive scoring. (LLM path disabled in Design B.) */
  readonly topN: number;
  /** Number of jobs in the final digest. */
  readonly digestK: number;
  /** Field-weighted BM25 tuning. Defaults filled in by loader if absent. */
  readonly bm25?: BM25ConfigBlock;
  /** Recency decay multiplier toggle. Loader injects defaults at runtime; consumers fall back to DEFAULT_RECENCY when constructing config literals in tests. */
  readonly recency?: RecencyConfig;
  /** Hard age cutoff. Loader injects defaults at runtime; consumers fall back to DEFAULT_MAX_AGE. */
  readonly maxAge?: MaxAgeConfig;
  /** Per-source trust weights. Loader injects defaults at runtime; consumers fall back to DEFAULT_SOURCE_TRUST. */
  readonly sourceTrust?: SourceTrustConfig;
  /** Reciprocal Rank Fusion toggle. Opt-in (default disabled); when enabled, replaces the multiplicative product score. */
  readonly fusion?: FusionConfig;
}

export interface FusionConfig {
  readonly enabled: boolean;
  readonly k: number;
}

export interface RecencyConfig {
  readonly enabled: boolean;
  readonly halfLifeDays: number;
}

export interface MaxAgeConfig {
  readonly enabled: boolean;
  readonly days: number;
  readonly requireDate: boolean;
}

export interface SourceTrustConfig {
  readonly enabled: boolean;
  readonly weights: Readonly<Record<string, number>>;
}

export type BM25FieldName = 'title' | 'description' | 'company' | 'location';

export interface BM25ConfigBlock {
  /** TF saturation; ~1.2-2.0 is typical. */
  readonly k1?: number;
  /** Length normalization in [0, 1]. */
  readonly b?: number;
  /** Per-field score multipliers. */
  readonly fieldWeights?: Partial<Record<BM25FieldName, number>>;
  /** IDF floor for tiny pools. */
  readonly minIdfFloor?: number;
}

export type RulesMode = 'defaults_only' | 'additive' | 'replace';

export interface RulesConfig {
  /** Filesystem dir holding user-supplied rule overrides (supports ~ expansion). */
  readonly userRulesDir: string;
  readonly mode: RulesMode;
}

export interface OutputConfig {
  /** Filesystem directory for digest files (supports ~ expansion). */
  readonly dir: string;
}
