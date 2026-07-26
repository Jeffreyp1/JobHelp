/**
 * User-supplied configuration loaded from `~/.config/jobhelp/config.json` (or env override).
 * Validated at startup; all fields immutable after load.
 *
 * Design B (zero-API-key): no `anthropic` block. The MCP server never calls Claude.
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
  /**
   * Skills the candidate is deepest in or most wants to work in. These get extra
   * ranking weight: their own keyword-match vote in rank fusion and lead position
   * in the semantic query. Additive — entries need not repeat in `skills`.
   */
  readonly coreSkills?: readonly string[];
  /** Human-readable location, e.g. "Austin, TX". */
  readonly location: string;
  readonly remoteOk: boolean;
  /** Minimum acceptable salary in USD. */
  readonly salaryFloor: number;
  readonly seniority: Seniority;
  /** Role families the candidate accepts, e.g. ["backend", "fullstack", "ai-engineer"]. */
  readonly roleFamily: readonly string[];
  /**
   * With allowedCountries set, also drop jobs whose location names a place the
   * country detector cannot classify (presumed foreign). Arrangement-only strings
   * ("Remote", "Hybrid", "Worldwide") are still kept. Off by default.
   */
  readonly strictLocation?: boolean;
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
  readonly smartrecruiters?: SmartRecruitersConfig;
  readonly workable?: WorkableConfig;
  readonly recruitee?: RecruiteeConfig;
  readonly teamtailor?: TeamtailorConfig;
  readonly breezy?: BreezyConfig;
  readonly pinpoint?: PinpointConfig;
  readonly personio?: PersonioConfig;
  readonly yc?: YcStartupConfig;
  readonly weworkremotely?: WeWorkRemotelyConfig;
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

export interface SmartRecruitersConfig {
  /** Public SmartRecruiters company slugs, e.g. ["visa", "square"]. */
  readonly tokens: readonly string[];
}

export interface WorkableConfig {
  /** Public Workable account subdomains, e.g. ["polestar", "talkdesk"]. */
  readonly tokens: readonly string[];
}

export interface RecruiteeConfig {
  /** Public Recruitee subdomains, e.g. ["bunq"]. */
  readonly tokens: readonly string[];
}

export interface TeamtailorConfig {
  /** Public Teamtailor subdomains, e.g. ["polestar", "klarna"]. */
  readonly tokens: readonly string[];
}

export interface BreezyConfig {
  /** Public Breezy HR subdomains. */
  readonly tokens: readonly string[];
}

export interface PinpointConfig {
  /** Public Pinpoint subdomains, e.g. ["workwithus"]. */
  readonly tokens: readonly string[];
}

export interface PersonioConfig {
  /** Public Personio subdomains, e.g. ["traderepublic"]. */
  readonly tokens: readonly string[];
}

export interface UsaJobsConfig {
  readonly apiKey: string;
  readonly email: string;
  /** Search keywords; if empty/missing, fetches a general listing. */
  readonly queries?: readonly string[];
}

export interface JSearchConfig {
  readonly rapidApiKey: string;
  /** Search keywords; if empty/missing, fetches a general listing. */
  readonly queries?: readonly string[];
}

export interface YcStartupConfig {
  /** Optional search keywords; if empty/missing, fetches the general WaaS feed. */
  readonly queries?: readonly string[];
}

export interface WeWorkRemotelyConfig {
  /** Optional RSS category slugs; if empty/missing, fetches the main remote-jobs feed. */
  readonly categories?: readonly string[];
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
  /** Local-embedding semantic signal, fused via RRF. Participates only when fusion.enabled. */
  readonly semantic?: SemanticConfig;
  /** Applied-history signal: boost jobs similar to past applications, annotate already-applied ones. Default disabled. */
  readonly history?: HistoryConfig;
  /** Cross-encoder reordering of the top-K ranked jobs. Opt-in (default disabled). */
  readonly rerank?: RerankConfig;
}

export interface HistoryConfig {
  readonly enabled: boolean;
  /** Ceiling for the similarity-to-applied multiplier; values below 1 fall back to the default 1.15. */
  readonly boostCap?: number;
}

export interface SemanticConfig {
  readonly enabled: boolean;
  readonly model?: string;
  /** Max jobs (top-N by BM25) that get embedded. Absent means DEFAULT_SEMANTIC_CANDIDATE_LIMIT. */
  readonly candidateLimit?: number;
}

export interface RerankConfig {
  readonly enabled: boolean;
  /** Cross-encoder model id. Absent means the rerank stage's default. */
  readonly model?: string;
  /** How many already-ranked jobs get reordered by the cross-encoder. Absent means 50. */
  readonly topK?: number;
}

export interface FusionConfig {
  readonly enabled: boolean;
  readonly k: number;
  /**
   * How enabled fusion combines the signals.
   * - `'rrf'` (default): reciprocal-rank fusion of BM25 + recency + role-fit + semantic lists.
   * - `'blend'`: convex score blend of min-max-normalized BM25 and semantic, times an
   *   optional seniority penalty. Uses score magnitude (not rank), so weak matches sink.
   */
  readonly mode?: 'rrf' | 'blend';
  /** blend-mode weights for the convex combination; renormalized to sum 1. Default { bm25: 0.5, semantic: 0.5 }. */
  readonly weights?: BlendWeights;
  /** blend-mode: penalize jobs whose detected level exceeds the profile's target `seniority`. Default true. */
  readonly seniorityPenalty?: boolean;
}

export interface BlendWeights {
  readonly bm25: number;
  readonly semantic: number;
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
