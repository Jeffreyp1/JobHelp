import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from '../lib/atomicWrite.js';
import { log } from '../lib/log.js';
import { getStateRoot } from '../state/store.js';
import type { Embedder } from './embed.js';

export interface EmbedCacheOptions {
  readonly model: string;
  readonly dir?: string;
  readonly now?: () => Date;
}

export interface CachedEmbedder {
  readonly embedder: Embedder;
  readonly save: () => Promise<void>;
}

interface CacheEntry {
  d: string;
  vec: Float32Array;
}

const MAX_AGE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function defaultCacheDir(): string {
  return join(getStateRoot(), 'cache', 'embeddings');
}

function modelSlug(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]/g, '_');
}

function keyOf(model: string, text: string): string {
  return createHash('sha256').update(JSON.stringify([model, text])).digest('hex');
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function encodeVec(vec: Float32Array): string {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
}

// Buffer.from(base64) can land at a non-4-byte-aligned pool offset; copy before viewing as f32.
function decodeVec(b64: string): Float32Array | undefined {
  const raw = Buffer.from(b64, 'base64');
  if (raw.byteLength === 0 || raw.byteLength % 4 !== 0) return undefined;
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return new Float32Array(copy.buffer);
}

async function loadEntries(filePath: string): Promise<Map<string, CacheEntry>> {
  const entries = new Map<string, CacheEntry>();
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return entries;
  }
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') {
        corrupt++;
        continue;
      }
      const rec = parsed as Record<string, unknown>;
      const h = rec['h'];
      const d = rec['d'];
      const v = rec['v'];
      if (typeof h !== 'string' || typeof d !== 'string' || typeof v !== 'string') {
        corrupt++;
        continue;
      }
      const vec = decodeVec(v);
      if (vec === undefined) {
        corrupt++;
        continue;
      }
      entries.set(h, { d, vec });
    } catch {
      corrupt++;
    }
  }
  if (corrupt > 0) {
    log('warn', 'rank.embed_cache.corrupt_entries', { count: corrupt, filePath });
  }
  return entries;
}

export async function createCachedEmbedder(
  inner: Embedder,
  opts: EmbedCacheOptions,
): Promise<CachedEmbedder> {
  const dir = opts.dir ?? defaultCacheDir();
  const now = opts.now ?? ((): Date => new Date());
  const filePath = join(dir, `${modelSlug(opts.model)}.jsonl`);
  const entries = await loadEntries(filePath);

  const embed = async (texts: readonly string[]): Promise<ReadonlyArray<Float32Array>> => {
    if (texts.length === 0) return [];
    const today = dayStamp(now());
    const results: Array<Float32Array | undefined> = new Array<Float32Array | undefined>(
      texts.length,
    ).fill(undefined);
    const missIdx: number[] = [];
    const missTexts: string[] = [];
    texts.forEach((text, i) => {
      const hit = entries.get(keyOf(opts.model, text));
      if (hit !== undefined) {
        hit.d = today;
        results[i] = hit.vec;
      } else {
        missIdx.push(i);
        missTexts.push(text);
      }
    });
    if (missTexts.length > 0) {
      const vecs = await inner.embed(missTexts);
      if (vecs.length !== missTexts.length) {
        throw new Error(`embedder returned ${vecs.length} vectors for ${missTexts.length} texts`);
      }
      for (let j = 0; j < missTexts.length; j++) {
        const vec = vecs[j];
        const idx = missIdx[j];
        const text = missTexts[j];
        if (vec === undefined || idx === undefined || text === undefined) continue;
        entries.set(keyOf(opts.model, text), { d: today, vec });
        results[idx] = vec;
      }
    }
    return results.map((r) => {
      if (r === undefined) throw new Error('missing embedding result');
      return r;
    });
  };

  const save = async (): Promise<void> => {
    try {
      const cutoff = now().getTime() - MAX_AGE_DAYS * MS_PER_DAY;
      const lines: string[] = [];
      for (const [h, entry] of entries) {
        const seen = Date.parse(`${entry.d}T00:00:00Z`);
        if (Number.isNaN(seen) || seen < cutoff) continue;
        lines.push(JSON.stringify({ h, d: entry.d, v: encodeVec(entry.vec) }));
      }
      await mkdir(dir, { recursive: true });
      const result = await atomicWriteFile(
        filePath,
        lines.length > 0 ? `${lines.join('\n')}\n` : '',
      );
      if (!result.ok) {
        log('warn', 'rank.embed_cache.save_failed', { error: result.error.message, filePath });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log('warn', 'rank.embed_cache.save_failed', { error: message, filePath });
    }
  };

  return { embedder: { embed }, save };
}
