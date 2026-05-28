import { asNumber, isRecord } from './_shared.js';
import { networkError, readBody, safeFetch, statusToError, type PingOutcome } from './validate-http.js';

export async function pingGreenhouseToken(token: string): Promise<PingOutcome> {
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

export async function pingLeverSlug(slug: string): Promise<PingOutcome> {
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

export async function pingAshbySlug(token: string): Promise<PingOutcome> {
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

export async function pingSmartRecruitersSlug(slug: string): Promise<PingOutcome> {
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

export async function pingWorkableSlug(slug: string): Promise<PingOutcome> {
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

export async function pingRecruiteeSlug(slug: string): Promise<PingOutcome> {
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

export async function pingTeamtailorSlug(slug: string): Promise<PingOutcome> {
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

export async function pingBreezySlug(slug: string): Promise<PingOutcome> {
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

export async function pingPinpointSlug(slug: string): Promise<PingOutcome> {
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

export async function pingPersonioSlug(slug: string): Promise<PingOutcome> {
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
