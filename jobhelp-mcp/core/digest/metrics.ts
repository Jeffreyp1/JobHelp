import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { RankedJob, SourceRunResult } from '../types/index.js';

export interface SourceMetric {
  readonly source: string;
  readonly jobCount: number;
  readonly errorType?: string;
}

export interface SemanticStats {
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

export interface RunMetrics {
  readonly date: string;
  readonly generatedAt: string;
  readonly totalDurationMs: number;
  readonly poolKept: number;
  readonly filterDrops: Readonly<Record<string, number>>;
  readonly sources: readonly SourceMetric[];
  readonly rankedCount: number;
  readonly digestCount: number;
  readonly semantic?: SemanticStats;
  readonly historyBoosted: number;
  readonly appliedInDigest?: number;
}

export interface RunMetricsInput {
  readonly date: string;
  readonly generatedAt: string;
  readonly totalDurationMs: number;
  readonly poolKept: number;
  readonly filterDrops: Readonly<Record<string, number>>;
  readonly sourceResults: readonly SourceRunResult[];
  readonly rankedCount: number;
  readonly topK: readonly RankedJob[];
  readonly appliedInDigest?: number;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function buildRunMetrics(input: RunMetricsInput): RunMetrics {
  const semanticScores = input.topK
    .map((r) => r.breakdown.semantic)
    .filter((s): s is number => typeof s === 'number')
    .sort((a, b) => a - b);
  const historyBoosted = input.topK.filter((r) => r.breakdown.historyBoost !== undefined).length;
  return {
    date: input.date,
    generatedAt: input.generatedAt,
    totalDurationMs: input.totalDurationMs,
    poolKept: input.poolKept,
    filterDrops: input.filterDrops,
    sources: input.sourceResults.map((s) => ({
      source: s.source,
      jobCount: s.jobCount,
      ...(s.error !== undefined ? { errorType: s.error.type } : {}),
    })),
    rankedCount: input.rankedCount,
    digestCount: input.topK.length,
    ...(semanticScores.length > 0
      ? {
          semantic: {
            min: semanticScores[0] ?? 0,
            median: median(semanticScores),
            max: semanticScores[semanticScores.length - 1] ?? 0,
          },
        }
      : {}),
    historyBoosted,
    ...(input.appliedInDigest !== undefined ? { appliedInDigest: input.appliedInDigest } : {}),
  };
}

export async function appendRunMetrics(filePath: string, metrics: RunMetrics): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(metrics)}\n`, 'utf8');
}
