import { log } from '../lib/log.js';
import type { JobDigestConfig } from '../types/config.js';
import { ALL_ADAPTERS } from './index.js';
import { asNumber, classifyHttpStatus, isRecord } from './_shared.js';

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

interface PingOutcome {
  readonly ok: boolean;
  readonly jobCount?: number;
  readonly statusCode?: number;
  readonly error?: SourceValidationError;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsed(start: number): number {
  return Math.max(0, Math.round(now() - start));
}

function networkError(message: string): SourceValidationError {
  return { type: 'network', message };
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response | SourceValidationError> {
  try {
    return await fetch(url, init);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return networkError(msg);
  }
}

async function readBody(response: Response): Promise<{ ok: true; body: unknown } | SourceValidationError> {
  let text: string;
  try {
    text = await response.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'body read failed';
    return networkError(msg);
  }
  if (text.length === 0) {
    return { type: 'parse', message: 'empty body' };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { type: 'parse', message: 'response was not valid JSON' };
  }
}

function statusToError(status: number, source: string): SourceValidationError {
  return { type: classifyHttpStatus(status), message: `${source} HTTP ${status}` };
}

async function pingAdzuna(config: JobDigestConfig): Promise<PingOutcome> {
  const c = config.sources.adzuna;
  if (c === undefined) {
    return { ok: false, error: { type: 'config_missing', message: 'adzuna config missing' } };
  }
  if (c.appId.length === 0 || c.appKey.length === 0) {
    return { ok: false, error: { type: 'auth', message: 'adzuna credentials missing' } };
  }
  const params = new URLSearchParams({
    app_id: c.appId,
    app_key: c.appKey,
    results_per_page: '1',
    what: 'engineer',
    'content-type': 'application/json',
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(c.country)}/search/1?${params.toString()}`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'adzuna') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'adzuna response was not an object' },
    };
  }
  const count = asNumber(body.body['count']);
  return count !== undefined
    ? { ok: true, statusCode: response.status, jobCount: count }
    : { ok: true, statusCode: response.status };
}

async function pingGreenhouseToken(token: string): Promise<PingOutcome> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=false`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'greenhouse') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'greenhouse response was not an object' },
    };
  }
  const meta = body.body['meta'];
  const fromMeta = isRecord(meta) ? asNumber(meta['total']) : undefined;
  const fromJobs = Array.isArray(body.body['jobs']) ? body.body['jobs'].length : undefined;
  const jobCount = fromMeta ?? fromJobs;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingLeverSlug(slug: string): Promise<PingOutcome> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=1`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'lever') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!Array.isArray(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'lever response was not an array' },
    };
  }
  return { ok: true, statusCode: response.status, jobCount: body.body.length };
}

async function pingRemotive(): Promise<PingOutcome> {
  const url = 'https://remotive.com/api/remote-jobs?limit=1';
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'remotive') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'remotive response was not an object' },
    };
  }
  const jobs = body.body['jobs'];
  const total = asNumber(body.body['job-count']);
  const jobCount = total ?? (Array.isArray(jobs) ? jobs.length : undefined);
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingRemoteOk(): Promise<PingOutcome> {
  const url = 'https://remoteok.com/api?limit=1';
  const response = await safeFetch(url, {
    headers: { 'User-Agent': 'JobHelp/1.0 (+https://github.com/Jeffreyp1/JobHelp)' },
  });
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'remoteok') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!Array.isArray(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'remoteok response was not an array' },
    };
  }
  const jobCount = Math.max(0, body.body.length - 1);
  return { ok: true, statusCode: response.status, jobCount };
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
  if (adapterName === 'greenhouse') {
    const tokens = config.sources.greenhouse?.tokens ?? [];
    return tokens.map((token) => () => timed('greenhouse', token, () => pingGreenhouseToken(token)));
  }
  if (adapterName === 'lever') {
    const slugs = config.sources.lever?.slugs ?? [];
    return slugs.map((slug) => () => timed('lever', slug, () => pingLeverSlug(slug)));
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
