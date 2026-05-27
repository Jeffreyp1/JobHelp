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

async function pingUsaJobs(config: JobDigestConfig): Promise<PingOutcome> {
  const c = config.sources.usajobs;
  if (c === undefined) {
    return { ok: false, error: { type: 'config_missing', message: 'usajobs config missing' } };
  }
  if (c.apiKey.length === 0 || c.email.length === 0) {
    return { ok: false, error: { type: 'auth', message: 'usajobs credentials missing' } };
  }
  const url = 'https://data.usajobs.gov/api/search?ResultsPerPage=1';
  const response = await safeFetch(url, {
    headers: { Host: 'data.usajobs.gov', 'User-Agent': c.email, 'Authorization-Key': c.apiKey },
  });
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'usajobs') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'usajobs response was not an object' },
    };
  }
  const searchResult = body.body['SearchResult'];
  const count = isRecord(searchResult) ? asNumber(searchResult['SearchResultCountAll']) : undefined;
  return count !== undefined
    ? { ok: true, statusCode: response.status, jobCount: count }
    : { ok: true, statusCode: response.status };
}

async function pingJSearch(config: JobDigestConfig): Promise<PingOutcome> {
  const c = config.sources.jsearch;
  if (c === undefined) {
    return { ok: false, error: { type: 'config_missing', message: 'jsearch config missing' } };
  }
  if (c.rapidApiKey.length === 0) {
    return { ok: false, error: { type: 'auth', message: 'jsearch credentials missing' } };
  }
  const url = 'https://jsearch.p.rapidapi.com/search?query=engineer&page=1&num_pages=1';
  const response = await safeFetch(url, {
    headers: { 'X-RapidAPI-Key': c.rapidApiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
  });
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'jsearch') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'jsearch response was not an object' },
    };
  }
  const data = body.body['data'];
  const jobCount = Array.isArray(data) ? data.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingYc(): Promise<PingOutcome> {
  const url = 'https://www.workatastartup.com/jobs/search?q=software%20engineer';
  const response = await safeFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'yc') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'yc response was not an object' },
    };
  }
  const jobs = body.body['jobs'];
  const jobCount = Array.isArray(jobs) ? jobs.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingWeWorkRemotely(): Promise<PingOutcome> {
  const url = 'https://weworkremotely.com/remote-jobs.rss';
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'weworkremotely') };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'body read failed';
    return { ok: false, statusCode: response.status, error: networkError(msg) };
  }
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('rss') && !contentType.includes('xml') && !/<rss\b/i.test(text)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: `weworkremotely: non-RSS content-type (${contentType})` },
    };
  }
  const items = text.match(/<item\b/gi);
  const jobCount = items !== null ? items.length : 0;
  return { ok: true, statusCode: response.status, jobCount };
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

async function pingAshbySlug(token: string): Promise<PingOutcome> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'ashby') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'ashby response was not an object' },
    };
  }
  const jobs = body.body['jobs'];
  const jobCount = Array.isArray(jobs) ? jobs.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingSmartRecruitersSlug(slug: string): Promise<PingOutcome> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'smartrecruiters') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'smartrecruiters response was not an object' },
    };
  }
  const jobCount = asNumber(body.body['totalFound']);
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingWorkableSlug(slug: string): Promise<PingOutcome> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'workable') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'workable response was not an object' },
    };
  }
  const jobs = body.body['jobs'];
  const jobCount = Array.isArray(jobs) ? jobs.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingRecruiteeSlug(slug: string): Promise<PingOutcome> {
  const url = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'recruitee') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'recruitee response was not an object' },
    };
  }
  const offers = body.body['offers'];
  const jobCount = Array.isArray(offers) ? offers.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingTeamtailorSlug(slug: string): Promise<PingOutcome> {
  const url = `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.rss`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'teamtailor') };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'body read failed';
    return { ok: false, statusCode: response.status, error: networkError(msg) };
  }
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('rss') && !contentType.includes('xml') && !/<rss\b/i.test(text)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: `teamtailor: non-RSS content-type (${contentType})` },
    };
  }
  const items = text.match(/<item\b/gi);
  const jobCount = items !== null ? items.length : 0;
  return { ok: true, statusCode: response.status, jobCount };
}

async function pingBreezySlug(slug: string): Promise<PingOutcome> {
  const url = `https://${encodeURIComponent(slug)}.breezy.hr/json`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'breezy') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!Array.isArray(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'breezy response was not an array' },
    };
  }
  return { ok: true, statusCode: response.status, jobCount: body.body.length };
}

async function pingPinpointSlug(slug: string): Promise<PingOutcome> {
  const url = `https://${encodeURIComponent(slug)}.pinpointhq.com/postings.json`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'pinpoint') };
  }
  const body = await readBody(response);
  if (!('ok' in body)) return { ok: false, statusCode: response.status, error: body };
  if (!isRecord(body.body)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'pinpoint response was not an object' },
    };
  }
  const data = body.body['data'];
  const jobCount = Array.isArray(data) ? data.length : undefined;
  return jobCount !== undefined
    ? { ok: true, statusCode: response.status, jobCount }
    : { ok: true, statusCode: response.status };
}

async function pingPersonioSlug(slug: string): Promise<PingOutcome> {
  const url = `https://${encodeURIComponent(slug)}.jobs.personio.de/xml`;
  const response = await safeFetch(url);
  if (!(response instanceof Response)) return { ok: false, error: response };
  if (!response.ok) {
    return { ok: false, statusCode: response.status, error: statusToError(response.status, 'personio') };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'body read failed';
    return { ok: false, statusCode: response.status, error: networkError(msg) };
  }
  if (!/<workzag-jobs\b/i.test(text) && !/<position\b/i.test(text)) {
    return {
      ok: false,
      statusCode: response.status,
      error: { type: 'parse', message: 'personio: response missing <workzag-jobs> and <position> tags' },
    };
  }
  const positions = text.match(/<position\b/gi);
  const jobCount = positions !== null ? positions.length : 0;
  return { ok: true, statusCode: response.status, jobCount };
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
