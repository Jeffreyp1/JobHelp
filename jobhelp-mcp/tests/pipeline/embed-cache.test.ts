import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCachedEmbedder } from '../../core/pipeline/embedCache.js';
import type { Embedder } from '../../core/pipeline/embed.js';
import { __resetForTests, getRecentLogs } from '../../core/lib/log.js';

const NOW = (): Date => new Date('2026-07-14T00:00:00Z');

function makeInner(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embed: async (texts) => {
      calls.push([...texts]);
      return texts.map((t) => new Float32Array([t.length, 1]));
    },
  };
}

let dir: string;

beforeEach(async () => {
  __resetForTests();
  dir = await mkdtemp(join(tmpdir(), 'embed-cache-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createCachedEmbedder', () => {
  it('computes misses via the inner embedder and returns vectors in order', async () => {
    const inner = makeInner();
    const { embedder } = await createCachedEmbedder(inner, { model: 'm', dir, now: NOW });
    const out = await embedder.embed(['alpha', 'beta']);
    expect(inner.calls).toEqual([['alpha', 'beta']]);
    expect(out[0]).toEqual(new Float32Array([5, 1]));
    expect(out[1]).toEqual(new Float32Array([4, 1]));
  });

  it('serves hits from disk after save, without calling the inner embedder', async () => {
    const first = makeInner();
    const a = await createCachedEmbedder(first, { model: 'm', dir, now: NOW });
    const [, beta] = await a.embedder.embed(['alpha', 'beta']);
    await a.save();

    const second = makeInner();
    const b = await createCachedEmbedder(second, { model: 'm', dir, now: NOW });
    const out = await b.embedder.embed(['beta']);
    expect(second.calls).toHaveLength(0);
    expect(out[0]).toEqual(beta);
  });

  it('preserves order when a batch mixes hits and misses', async () => {
    const seed = makeInner();
    const a = await createCachedEmbedder(seed, { model: 'm', dir, now: NOW });
    await a.embedder.embed(['beta']);
    await a.save();

    const inner = makeInner();
    const b = await createCachedEmbedder(inner, { model: 'm', dir, now: NOW });
    const out = await b.embedder.embed(['alpha', 'beta', 'gamma']);
    expect(inner.calls).toEqual([['alpha', 'gamma']]);
    expect(out.map((v) => v[0])).toEqual([5, 4, 5]);
  });

  it('does not share entries across models', async () => {
    const first = makeInner();
    const a = await createCachedEmbedder(first, { model: 'model-one', dir, now: NOW });
    await a.embedder.embed(['same text']);
    await a.save();

    const second = makeInner();
    const b = await createCachedEmbedder(second, { model: 'model-two', dir, now: NOW });
    await b.embedder.embed(['same text']);
    expect(second.calls).toHaveLength(1);
  });

  it('returns empty array for empty input without touching the inner embedder', async () => {
    const inner = makeInner();
    const { embedder } = await createCachedEmbedder(inner, { model: 'm', dir, now: NOW });
    expect(await embedder.embed([])).toEqual([]);
    expect(inner.calls).toHaveLength(0);
  });

  it('prunes entries unseen for more than 14 days on save, keeps fresher ones', async () => {
    const vecB64 = Buffer.from(new Float32Array([1, 2]).buffer).toString('base64');
    const file = join(dir, 'm.jsonl');
    await writeFile(
      file,
      `${JSON.stringify({ h: 'aaa', d: '2026-06-29', v: vecB64 })}\n` +
        `${JSON.stringify({ h: 'bbb', d: '2026-07-01', v: vecB64 })}\n`,
      'utf8',
    );
    const cache = await createCachedEmbedder(makeInner(), { model: 'm', dir, now: NOW });
    await cache.save();
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('"aaa"');
    expect(raw).toContain('"bbb"');
  });

  it('refreshes lastSeen on hit so touched entries survive pruning', async () => {
    const vecB64 = Buffer.from(new Float32Array([1, 2]).buffer).toString('base64');
    const hash = createHash('sha256').update(JSON.stringify(['m', 'old text'])).digest('hex');
    const file = join(dir, 'm.jsonl');
    await writeFile(file, `${JSON.stringify({ h: hash, d: '2026-06-29', v: vecB64 })}\n`, 'utf8');
    const inner = makeInner();
    const cache = await createCachedEmbedder(inner, { model: 'm', dir, now: NOW });
    await cache.embedder.embed(['old text']);
    await cache.save();
    expect(inner.calls).toHaveLength(0);
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('"2026-07-14"');
  });

  it('skips corrupt lines with a single counted warn and keeps valid entries usable', async () => {
    const vecB64 = Buffer.from(new Float32Array([1, 2]).buffer).toString('base64');
    const hash = createHash('sha256').update(JSON.stringify(['m', 'good'])).digest('hex');
    const file = join(dir, 'm.jsonl');
    await writeFile(
      file,
      'not json at all\n' +
        `${JSON.stringify({ h: 7, d: '2026-07-10', v: vecB64 })}\n` +
        `${JSON.stringify({ h: 'cc', d: '2026-07-10', v: 'abc' })}\n` +
        `${JSON.stringify({ h: hash, d: '2026-07-10', v: vecB64 })}\n`,
      'utf8',
    );
    const inner = makeInner();
    const cache = await createCachedEmbedder(inner, { model: 'm', dir, now: NOW });
    await cache.embedder.embed(['good']);
    expect(inner.calls).toHaveLength(0);
    const warns = getRecentLogs().filter((e) => e.msg === 'rank.embed_cache.corrupt_entries');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.ctx?.['count']).toBe(3);
  });

  it('save() does not throw when the cache directory cannot be created', async () => {
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'a file, not a directory', 'utf8');
    const cache = await createCachedEmbedder(makeInner(), {
      model: 'm',
      dir: blocked,
      now: NOW,
    });
    await cache.embedder.embed(['x']);
    await expect(cache.save()).resolves.toBeUndefined();
    expect(getRecentLogs().some((e) => e.msg === 'rank.embed_cache.save_failed')).toBe(true);
  });
});
