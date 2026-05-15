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
  /** Human-readable location, e.g. "Austin, TX". */
  readonly location: string;
  readonly remoteOk: boolean;
  /** Minimum acceptable salary in USD. */
  readonly salaryFloor: number;
  readonly seniority: Seniority;
  /** Role families the candidate accepts, e.g. ["backend", "fullstack", "ai-engineer"]. */
  readonly roleFamily: readonly string[];
}

export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'staff';

export interface SourcesConfig {
  readonly adzuna?: AdzunaConfig;
  readonly greenhouse?: GreenhouseConfig;
  readonly lever?: LeverConfig;
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
