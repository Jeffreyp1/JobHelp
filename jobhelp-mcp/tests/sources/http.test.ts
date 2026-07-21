import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { httpGetText } from '../../core/sources/http.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jobhelp-http-test-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

function stubFetchOnce(body: string, init?: ResponseInit): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(body, { status: 200, ...init })),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('httpGetText', () => {
  it('fetches and returns status, body, and content type without cache options', async () => {
    const mock = stubFetchOnce('{"jobs":[]}', { headers: { 'content-type': 'application/json' } });

    const res = await httpGetText('https://example.com/board');

    expect(mock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.bodyText).toBe('{"jobs":[]}');
    expect(res.contentType).toBe('application/json');
    expect(res.fromCache).toBe(false);
  });

  it('forwards headers and redirect mode to fetch', async () => {
    const mock = stubFetchOnce('x');

    await httpGetText('https://example.com/a', {
      headers: { Accept: 'application/xml' },
      redirect: 'manual',
    });

    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ Accept: 'application/xml' });
    expect(init.redirect).toBe('manual');
  });

  it('serves a second call from cache within the TTL', async () => {
    const mock = stubFetchOnce('{"jobs":[1]}', { headers: { 'content-type': 'application/json' } });
    const cache = { dir: tmpDir, ttlMs: 60_000 };

    const first = await httpGetText('https://example.com/board', { cache });
    const second = await httpGetText('https://example.com/board', { cache });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.bodyText).toBe('{"jobs":[1]}');
    expect(second.contentType).toBe('application/json');
    expect(second.status).toBe(200);
    expect(second.ok).toBe(true);
  });

  it('refetches when the cached entry is older than the TTL', async () => {
    const mock = stubFetchOnce('v1');
    const cache = { dir: tmpDir, ttlMs: 0 };

    await httpGetText('https://example.com/board', { cache });
    const second = await httpGetText('https://example.com/board', { cache });

    expect(mock).toHaveBeenCalledTimes(2);
    expect(second.fromCache).toBe(false);
  });

  it('keys the cache by url so different urls do not collide', async () => {
    const mock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(new Response('a', { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response('b', { status: 200 })));
    vi.stubGlobal('fetch', mock);
    const cache = { dir: tmpDir, ttlMs: 60_000 };

    const a = await httpGetText('https://example.com/a', { cache });
    const b = await httpGetText('https://example.com/b', { cache });

    expect(a.bodyText).toBe('a');
    expect(b.bodyText).toBe('b');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not cache non-200 responses', async () => {
    const mock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    vi.stubGlobal('fetch', mock);
    const cache = { dir: tmpDir, ttlMs: 60_000 };

    const first = await httpGetText('https://example.com/gone', { cache });
    await httpGetText('https://example.com/gone', { cache });

    expect(first.status).toBe(404);
    expect(first.ok).toBe(false);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the network when a cache file is corrupt', async () => {
    const mock = stubFetchOnce('good');
    const cache = { dir: tmpDir, ttlMs: 60_000 };

    await httpGetText('https://example.com/board', { cache });
    const files = await readdir(tmpDir);
    expect(files).toHaveLength(1);
    const file = files[0];
    if (file === undefined) throw new Error('expected cache file');
    await writeFile(path.join(tmpDir, file), 'not gzip at all', 'utf8');

    const res = await httpGetText('https://example.com/board', { cache });

    expect(res.fromCache).toBe(false);
    expect(res.bodyText).toBe('good');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung request after timeoutMs', async () => {
    const mock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    );
    vi.stubGlobal('fetch', mock);

    await expect(httpGetText('https://example.com/hang', { timeoutMs: 25 }))
      .rejects.toThrow(/timed out after 25ms/);
  });

  it('does not leak URL query params (e.g. api keys) in the timeout error', async () => {
    const mock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    );
    vi.stubGlobal('fetch', mock);
    const secretUrl =
      'https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=abc123&app_key=SUPERSECRET';

    const err = await httpGetText(secretUrl, { timeoutMs: 20 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toContain('SUPERSECRET');
    expect(message).not.toContain('app_key');
    expect(message).toContain('api.adzuna.com');
  });
});
