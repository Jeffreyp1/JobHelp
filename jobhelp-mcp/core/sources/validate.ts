import { log } from '../lib/log.js';
import type { JobDigestConfig } from '../types/config.js';
import { ALL_ADAPTERS } from './index.js';
import {
  pingAdzuna,
  pingJSearch,
  pingRemoteOk,
  pingRemotive,
  pingUsaJobs,
  pingWeWorkRemotely,
  pingYc,
} from './validate-api-pingers.js';
import {
  pingAshbySlug,
  pingBreezySlug,
  pingGreenhouseToken,
  pingLeverSlug,
  pingPersonioSlug,
  pingPinpointSlug,
  pingRecruiteeSlug,
  pingSmartRecruitersSlug,
  pingTeamtailorSlug,
  pingWorkableSlug,
} from './validate-board-pingers.js';
import type { PingOutcome } from './validate-http.js';

export interface SourceValidationError {
  readonly type: string;
  readonly message: string;
}

export interface SourceValidationResult {
  readonly source: string;
  readonly label?: string;
  readonly ok: boolean;
  readonly jobCount?: number;
  readonly statusCode?: number;
  readonly error?: SourceValidationError;
  readonly durationMs: number;
}

export interface ValidateSourcesOptions {
  readonly source?: string;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsed(start: number): number {
  return Math.max(0, Math.round(now() - start));
}

type Pinger = () => Promise<SourceValidationResult>;

function buildResult(
  source: string,
  outcome: PingOutcome,
  durationMs: number,
  label?: string,
): SourceValidationResult {
  const base: { source: string; ok: boolean; durationMs: number; label?: string } = {
    source,
    ok: outcome.ok,
    durationMs,
  };
  if (label !== undefined) base.label = label;
  const extras: { jobCount?: number; statusCode?: number; error?: SourceValidationError } = {};
  if (outcome.jobCount !== undefined) extras.jobCount = outcome.jobCount;
  if (outcome.statusCode !== undefined) extras.statusCode = outcome.statusCode;
  if (outcome.error !== undefined) extras.error = outcome.error;
  return { ...base, ...extras };
}

async function timed(source: string, label: string | undefined, fn: () => Promise<PingOutcome>): Promise<SourceValidationResult> {
  const start = now();
  try {
    const outcome = await fn();
    return buildResult(source, outcome, elapsed(start), label);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    log('warn', 'validateSources: unexpected throw', { source, label, error: msg });
    return buildResult(source, { ok: false, error: { type: 'network', message: msg } }, elapsed(start), label);
  }
}

function buildPingers(config: JobDigestConfig, adapterName: string): Pinger[] {
  if (adapterName === 'adzuna') {
    return [() => timed('adzuna', config.sources.adzuna?.country, () => pingAdzuna(config))];
  }
  if (adapterName === 'usajobs') {
    return [() => timed('usajobs', undefined, () => pingUsaJobs(config))];
  }
  if (adapterName === 'jsearch') {
    return [() => timed('jsearch', undefined, () => pingJSearch(config))];
  }
  if (adapterName === 'yc') {
    return [() => timed('yc', undefined, pingYc)];
  }
  if (adapterName === 'weworkremotely') {
    return [() => timed('weworkremotely', undefined, pingWeWorkRemotely)];
  }
  if (adapterName === 'greenhouse') {
    const tokens = config.sources.greenhouse?.tokens ?? [];
    return tokens.map((token) => () => timed('greenhouse', token, () => pingGreenhouseToken(token)));
  }
  if (adapterName === 'lever') {
    const slugs = config.sources.lever?.slugs ?? [];
    return slugs.map((slug) => () => timed('lever', slug, () => pingLeverSlug(slug)));
  }
  if (adapterName === 'ashby') {
    const tokens = config.sources.ashby?.tokens ?? [];
    return tokens.map((token) => () => timed('ashby', token, () => pingAshbySlug(token)));
  }
  if (adapterName === 'smartrecruiters') {
    const tokens = config.sources.smartrecruiters?.tokens ?? [];
    return tokens.map((slug) => () => timed('smartrecruiters', slug, () => pingSmartRecruitersSlug(slug)));
  }
  if (adapterName === 'workable') {
    const tokens = config.sources.workable?.tokens ?? [];
    return tokens.map((slug) => () => timed('workable', slug, () => pingWorkableSlug(slug)));
  }
  if (adapterName === 'recruitee') {
    const tokens = config.sources.recruitee?.tokens ?? [];
    return tokens.map((slug) => () => timed('recruitee', slug, () => pingRecruiteeSlug(slug)));
  }
  if (adapterName === 'teamtailor') {
    const tokens = config.sources.teamtailor?.tokens ?? [];
    return tokens.map((slug) => () => timed('teamtailor', slug, () => pingTeamtailorSlug(slug)));
  }
  if (adapterName === 'breezy') {
    const tokens = config.sources.breezy?.tokens ?? [];
    return tokens.map((slug) => () => timed('breezy', slug, () => pingBreezySlug(slug)));
  }
  if (adapterName === 'pinpoint') {
    const tokens = config.sources.pinpoint?.tokens ?? [];
    return tokens.map((slug) => () => timed('pinpoint', slug, () => pingPinpointSlug(slug)));
  }
  if (adapterName === 'personio') {
    const tokens = config.sources.personio?.tokens ?? [];
    return tokens.map((slug) => () => timed('personio', slug, () => pingPersonioSlug(slug)));
  }
  if (adapterName === 'remotive') {
    return [() => timed('remotive', undefined, pingRemotive)];
  }
  if (adapterName === 'remoteok') {
    return [() => timed('remoteok', undefined, pingRemoteOk)];
  }
  return [];
}

export async function validateSources(
  config: JobDigestConfig,
  options?: ValidateSourcesOptions,
): Promise<readonly SourceValidationResult[]> {
  const filter = options?.source;
  const enabledAdapters = ALL_ADAPTERS.filter((a) => a.enabled(config));
  const targets = filter === undefined ? enabledAdapters : enabledAdapters.filter((a) => a.name === filter);
  const pingers: Pinger[] = [];
  for (const adapter of targets) {
    pingers.push(...buildPingers(config, adapter.name));
  }
  if (pingers.length === 0) return [];
  const settled = await Promise.allSettled(pingers.map((p) => p()));
  const out: SourceValidationResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      out.push(s.value);
    } else {
      const msg = s.reason instanceof Error ? s.reason.message : 'unknown error';
      out.push({ source: 'unknown', ok: false, durationMs: 0, error: { type: 'network', message: msg } });
    }
  }
  return out;
}
