export type {
  JobDigestConfig,
  ProfileConfig,
  SourcesConfig,
  AdzunaConfig,
  GreenhouseConfig,
  LeverConfig,
  UsaJobsConfig,
  JSearchConfig,
  RemotiveConfig,
  RemoteOkConfig,
  RankingConfig,
  BM25ConfigBlock,
  BM25FieldName,
  RecencyConfig,
  MaxAgeConfig,
  SourceTrustConfig,
  FusionConfig,
  RulesConfig,
  RulesMode,
  OutputConfig,
  Seniority,
} from './config.js';

export type { NormalizedJob, RemoteMode, JobId } from './job.js';
export { asJobId } from './job.js';

export type { SourceAdapter, SourceRunResult, SourceError, SourceErrorType } from './source.js';

export type { RankedJob, ScoreBreakdown, PipelineStage } from './pipeline.js';

export type { Result } from './result.js';
export { ok, err, isOk, isErr } from './result.js';
