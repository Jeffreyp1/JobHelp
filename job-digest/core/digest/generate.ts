import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ALL_ADAPTERS } from '../sources/index.js';
import { runPipeline } from '../pipeline/index.js';
import { log } from '../lib/log.js';
import type {
  JobDigestConfig,
  NormalizedJob,
  RankedJob,
  SourceAdapter,
  SourceError,
  SourceErrorType,
  SourceRunResult,
} from '../types/index.js';
import {
  formatDigestCsv,
  formatDigestMarkdown,
  type DigestMeta,
} from './format.js';

export interface DigestRunResult {
  readonly date: string;
  readonly jobs: readonly RankedJob[];
  readonly sourceResults: readonly SourceRunResult[];
  readonly totalDurationMs: number;
  readonly markdownPath: string;
  readonly csvPath: string;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function todayIsoDate(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function classifyError(err: unknown): SourceError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  let type: SourceErrorType = 'unknown';
  if (lower.includes('rate') && lower.includes('limit')) type = 'rate_limit';
  else if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden')) type = 'auth';
  else if (lower.includes('parse') || lower.includes('json') || lower.includes('invalid')) type = 'parse';
  else if (lower.includes('network') || lower.includes('fetch') || lower.includes('econn') || lower.includes('timeout')) type = 'network';
  return { type, message };
}

interface AdapterOutcome {
  readonly runResult: SourceRunResult;
  readonly jobs: readonly NormalizedJob[];
}

async function runAdapter(
  adapter: SourceAdapter,
  config: JobDigestConfig,
): Promise<AdapterOutcome> {
  const start = Date.now();
  try {
    const jobs = await adapter.fetch(config);
    const durationMs = Date.now() - start;
    return {
      runResult: { source: adapter.name, jobCount: jobs.length, durationMs },
      jobs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = classifyError(err);
    log('warn', 'source adapter failed', { source: adapter.name, error });
    return {
      runResult: { source: adapter.name, jobCount: 0, durationMs, error },
      jobs: [],
    };
  }
}

export async function runDigest(config: JobDigestConfig): Promise<DigestRunResult> {
  const start = Date.now();
  const now = new Date();
  const date = todayIsoDate(now);

  log('info', 'digest run starting', { adapterCount: ALL_ADAPTERS.length, date });

  const settled = await Promise.allSettled(
    ALL_ADAPTERS.map((adapter) => runAdapter(adapter, config)),
  );

  const sourceResults: SourceRunResult[] = [];
  const pool: NormalizedJob[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const adapter = ALL_ADAPTERS[i];
    if (s === undefined || adapter === undefined) continue;
    if (s.status === 'fulfilled') {
      sourceResults.push(s.value.runResult);
      for (const j of s.value.jobs) pool.push(j);
    } else {
      const reason: unknown = s.reason;
      const error = classifyError(reason);
      log('error', 'adapter wrapper threw', { source: adapter.name, error });
      sourceResults.push({ source: adapter.name, jobCount: 0, durationMs: 0, error });
    }
  }

  let ranked: readonly RankedJob[] = [];
  try {
    ranked = await runPipeline(pool, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'pipeline failed', { error: message });
    throw err instanceof Error ? err : new Error(message);
  }

  const topK = ranked.slice(0, config.ranking.digestK);
  const totalDurationMs = Date.now() - start;

  const meta: DigestMeta = {
    date,
    sourceResults,
    totalDurationMs,
  };

  const markdown = formatDigestMarkdown(topK, meta);
  const csv = formatDigestCsv(topK);

  const outDir = expandHome(config.output.dir);
  await mkdir(outDir, { recursive: true });
  const markdownPath = path.join(outDir, `digest-${date}.md`);
  const csvPath = path.join(outDir, `digest-${date}.csv`);
  await writeFile(markdownPath, markdown, 'utf8');
  await writeFile(csvPath, csv, 'utf8');

  log('info', 'digest run finished', {
    date,
    jobCount: topK.length,
    totalDurationMs,
    markdownPath,
    csvPath,
  });

  return {
    date,
    jobs: topK,
    sourceResults,
    totalDurationMs,
    markdownPath,
    csvPath,
  };
}
