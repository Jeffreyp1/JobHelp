import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ALL_ADAPTERS } from '../sources/index.js';
import { SourceFetchError } from '../sources/_shared.js';
import { runPipeline } from '../pipeline/index.js';
import { makeAcceptCounter } from '../pipeline/filter.js';
import { appliedJobIds } from '../pipeline/history.js';
import { readState, type ApplicationEntry } from '../state/index.js';
import { defaultCompanySourcesPath } from '../init/companySources.js';
import { harvestNewCompanyTokens } from '../init/harvest.js';
import { log } from '../lib/log.js';
import type {
  FetchOptions,
  JobDigestConfig,
  NormalizedJob,
  RankedJob,
  SharedHttpOptions,
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
import { appendRunMetrics, buildRunMetrics } from './metrics.js';

export interface DigestRunResult {
  readonly date: string;
  readonly jobs: readonly RankedJob[];
  readonly sourceResults: readonly SourceRunResult[];
  readonly totalDurationMs: number;
  readonly markdownPath: string;
  readonly csvPath: string;
  readonly filterDrops: Readonly<Record<string, number>>;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const DEFAULT_HTTP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HTTP_CACHE_DIR = '~/jobhelp/cache/http';
const DEFAULT_CONFIG_PATH = '~/.config/jobhelp/config.json';

async function harvestCompanyTokens(pool: readonly NormalizedJob[]): Promise<void> {
  try {
    const configPath = expandHome(process.env['JOBHELP_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH);
    await harvestNewCompanyTokens(pool, defaultCompanySourcesPath(configPath));
  } catch (err) {
    log('warn', 'company-token harvest failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function resolveHttpOptions(): SharedHttpOptions {
  const timeoutMs = envInt('JOBHELP_HTTP_TIMEOUT_MS');
  const base = timeoutMs !== undefined ? { timeoutMs } : {};
  if (process.env['JOBHELP_HTTP_CACHE'] === 'off') return base;
  const dir = expandHome(process.env['JOBHELP_HTTP_CACHE_DIR'] ?? DEFAULT_HTTP_CACHE_DIR);
  const ttlMs = envInt('JOBHELP_HTTP_CACHE_TTL_MS') ?? DEFAULT_HTTP_CACHE_TTL_MS;
  return { ...base, cache: { dir, ttlMs } };
}

function todayIsoDate(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function classifyError(err: unknown): SourceError {
  if (err instanceof SourceFetchError) return { type: err.type, message: err.message };
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
  opts?: FetchOptions,
): Promise<AdapterOutcome> {
  const start = Date.now();
  try {
    const jobs = await adapter.fetch(config, opts);
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

  let applications: readonly ApplicationEntry[] = [];
  if (config.ranking.history?.enabled === true) {
    const stateRes = await readState();
    if (stateRes.ok) {
      applications = stateRes.value.applications;
    } else {
      log('warn', 'digest.history.state_unavailable', { error: stateRes.error });
    }
  }

  const acceptCounter = makeAcceptCounter(config, now);
  const http = resolveHttpOptions();
  const settled = await Promise.allSettled(
    ALL_ADAPTERS.map((adapter) => runAdapter(adapter, config, { accept: acceptCounter.accept, http })),
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

  const filterDrops = acceptCounter.counts();
  log('info', 'filter.drop_summary', {
    drops: filterDrops,
    kept: acceptCounter.kept(),
    dropped: Object.values(filterDrops).reduce((sum, n) => sum + n, 0),
  });

  let ranked: readonly RankedJob[] = [];
  try {
    ranked = await runPipeline(pool, config, {
      now,
      ...(applications.length > 0 ? { applications } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'pipeline failed', { error: message });
    throw err instanceof Error ? err : new Error(message, { cause: err });
  }

  await harvestCompanyTokens(pool);

  const topK = ranked.slice(0, config.ranking.digestK);
  const totalDurationMs = Date.now() - start;

  const applied =
    applications.length > 0
      ? appliedJobIds(
          topK.map((r) => r.job),
          applications,
        )
      : undefined;

  const meta: DigestMeta = {
    date,
    sourceResults,
    totalDurationMs,
    ...(applied !== undefined ? { appliedJobIds: applied } : {}),
  };

  const markdown = formatDigestMarkdown(topK, meta);
  const csv = formatDigestCsv(topK);

  const outDir = expandHome(config.output.dir);
  await mkdir(outDir, { recursive: true });
  const markdownPath = path.join(outDir, `digest-${date}.md`);
  const csvPath = path.join(outDir, `digest-${date}.csv`);
  await writeFile(markdownPath, markdown, 'utf8');
  await writeFile(csvPath, csv, 'utf8');

  // Trend log: one JSONL line per run so drop-distribution or score drift is visible over time.
  try {
    const metrics = buildRunMetrics({
      date,
      generatedAt: now.toISOString(),
      totalDurationMs,
      poolKept: pool.length,
      filterDrops,
      sourceResults,
      rankedCount: ranked.length,
      topK,
      ...(applied !== undefined ? { appliedInDigest: applied.size } : {}),
    });
    await appendRunMetrics(path.join(outDir, 'metrics.jsonl'), metrics);
  } catch (err) {
    log('warn', 'digest.metrics.append_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log('info', 'digest run finished', {
    date,
    jobCount: topK.length,
    totalDurationMs,
    markdownPath,
    csvPath,
    ...(applied !== undefined ? { appliedInDigest: applied.size } : {}),
  });

  return {
    date,
    jobs: topK,
    sourceResults,
    totalDurationMs,
    markdownPath,
    csvPath,
    filterDrops,
  };
}
