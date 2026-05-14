/**
 * User-supplied configuration loaded from `~/.config/jobhelp/config.json` (or env override).
 * Validated at startup; all fields immutable after load.
 */
export interface JobDigestConfig {
  readonly profile: ProfileConfig;
  readonly sources: SourcesConfig;
  readonly ranking: RankingConfig;
  readonly output: OutputConfig;
  readonly anthropic: AnthropicConfig;
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

export interface RankingConfig {
  readonly useLlmFitScore: boolean;
  /** Anthropic model id, e.g. "claude-haiku-4-5". */
  readonly llmModel: string;
  /** Top-N survivors to send to LLM fit-score. */
  readonly topN: number;
  /** Number of jobs in the final digest. */
  readonly digestK: number;
}

export interface OutputConfig {
  /** Filesystem directory for digest files (supports ~ expansion). */
  readonly dir: string;
}

export interface AnthropicConfig {
  /** Anthropic API key. Supports ${ENV_VAR} interpolation. */
  readonly apiKey: string;
}
