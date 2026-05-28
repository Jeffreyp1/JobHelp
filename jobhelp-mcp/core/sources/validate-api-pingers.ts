import type { JobDigestConfig } from '../types/config.js';
import { asNumber, isRecord } from './_shared.js';
import { networkError, readBody, safeFetch, statusToError, type PingOutcome } from './validate-http.js';

export async function pingAdzuna(config: JobDigestConfig): Promise<PingOutcome> {
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

export async function pingUsaJobs(config: JobDigestConfig): Promise<PingOutcome> {
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

export async function pingJSearch(config: JobDigestConfig): Promise<PingOutcome> {
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

export async function pingYc(): Promise<PingOutcome> {
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

export async function pingWeWorkRemotely(): Promise<PingOutcome> {
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

export async function pingRemotive(): Promise<PingOutcome> {
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

export async function pingRemoteOk(): Promise<PingOutcome> {
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
