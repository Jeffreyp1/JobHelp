/**
 * Digest generator. Agent C populates: orchestrates fetch → pipeline → format.
 */
import type { JobDigestConfig, RankedJob, SourceRunResult } from '../types/index.js';

export interface DigestRunResult {
  readonly date: string;
  readonly jobs: readonly RankedJob[];
  readonly sourceResults: readonly SourceRunResult[];
  readonly totalDurationMs: number;
  readonly markdownPath: string;
  readonly csvPath: string;
}

/**
 * Run a full digest: fetch from all enabled sources, pipeline, format, write to disk.
 * Agent C owns the real implementation.
 */
export async function runDigest(config: JobDigestConfig): Promise<DigestRunResult> {
  void config;
  throw new Error('runDigest() not implemented — Agent C owns core/digest/index.ts');
}
