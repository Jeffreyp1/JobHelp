import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import type { SharedHttpOptions } from '../types/source.js';

export type { HttpCacheOptions, SharedHttpOptions } from '../types/source.js';

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

export interface HttpGetOptions extends SharedHttpOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly redirect?: 'manual';
}

export interface HttpTextResult {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly bodyText: string;
  readonly fromCache: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface CacheEnvelope {
  readonly v: 1;
  readonly fetchedAt: number;
  readonly status: number;
  readonly contentType: string;
  readonly bodyText: string;
}

// The envelope deliberately omits the url/headers: query strings and auth
// headers can carry API keys, and the hashed filename is key enough.
function cacheFilePath(opts: HttpGetOptions, url: string): string | undefined {
  if (opts.cache === undefined) return undefined;
  const key = createHash('sha256')
    .update(JSON.stringify([url, opts.headers ?? null, opts.redirect ?? null]))
    .digest('hex');
  return path.join(opts.cache.dir, `${key}.json.gz`);
}

function parseEnvelope(raw: unknown): CacheEnvelope | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r['v'] !== 1) return undefined;
  if (typeof r['fetchedAt'] !== 'number') return undefined;
  if (typeof r['status'] !== 'number') return undefined;
  if (typeof r['contentType'] !== 'string') return undefined;
  if (typeof r['bodyText'] !== 'string') return undefined;
  return {
    v: 1,
    fetchedAt: r['fetchedAt'],
    status: r['status'],
    contentType: r['contentType'],
    bodyText: r['bodyText'],
  };
}

async function readCache(file: string, ttlMs: number): Promise<HttpTextResult | undefined> {
  try {
    const compressed = await readFile(file);
    const env = parseEnvelope(JSON.parse((await gunzip(compressed)).toString('utf8')));
    if (env === undefined) return undefined;
    if (Date.now() - env.fetchedAt >= ttlMs) return undefined;
    return {
      status: env.status,
      ok: true,
      contentType: env.contentType,
      bodyText: env.bodyText,
      fromCache: true,
    };
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, result: HttpTextResult): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const env: CacheEnvelope = {
      v: 1,
      fetchedAt: Date.now(),
      status: result.status,
      contentType: result.contentType,
      bodyText: result.bodyText,
    };
    const compressed = await gzip(Buffer.from(JSON.stringify(env), 'utf8'));
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, compressed);
    await rename(tmp, file);
  } catch {
    // A failed cache write must never fail the fetch itself.
  }
}

// Query strings can carry credentials (e.g. Adzuna app_id/app_key); the logger masks by
// key name and sk-ant- tokens but not URL query values, so error messages must never
// include the query part of a fetched URL.
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export async function httpGetText(url: string, opts: HttpGetOptions = {}): Promise<HttpTextResult> {
  const file = cacheFilePath(opts, url);
  if (file !== undefined && opts.cache !== undefined) {
    const hit = await readCache(file, opts.cache.ttlMs);
    if (hit !== undefined) return hit;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
      ...(opts.redirect !== undefined ? { redirect: opts.redirect } : {}),
    });
    const bodyText = response.ok ? await response.text() : '';
    const result: HttpTextResult = {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') ?? '',
      bodyText,
      fromCache: false,
    };
    if (file !== undefined && response.ok && response.status === 200) {
      await writeCache(file, result);
    }
    return result;
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${timeoutMs}ms: ${redactUrl(url)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
