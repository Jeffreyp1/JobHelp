import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  DEFAULT_EMBED_MODEL,
  getDefaultEmbedder,
  getQueryPrefix,
  type Embedder,
} from '../../core/pipeline/embed.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = new Float32Array([0.6, 0.8]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])),
    ).toBeCloseTo(0, 6);
  });

  it('is 0 when either vector has zero norm', () => {
    expect(
      cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 2])),
    ).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2])),
    ).toThrow(TypeError);
  });
});

describe('embedder surface', () => {
  it('a plain object can implement Embedder', async () => {
    const fake: Embedder = {
      embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
    };
    const out = await fake.embed(['a', 'b']);
    expect(out).toHaveLength(2);
  });

  it('exposes the default model constant and a lazy factory without loading it', () => {
    expect(DEFAULT_EMBED_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
    expect(typeof getDefaultEmbedder).toBe('function');
  });
});

describe('getQueryPrefix', () => {
  it('returns the BGE retrieval prefix for bge-small', () => {
    expect(getQueryPrefix('Xenova/bge-small-en-v1.5')).toBe(
      'Represent this sentence for searching relevant passages: ',
    );
  });

  it('returns the BGE retrieval prefix for bge-base', () => {
    expect(getQueryPrefix('Xenova/bge-base-en-v1.5')).toBe(
      'Represent this sentence for searching relevant passages: ',
    );
  });

  it('returns empty string for the MiniLM default', () => {
    expect(getQueryPrefix(DEFAULT_EMBED_MODEL)).toBe('');
  });

  it('returns empty string for unknown models', () => {
    expect(getQueryPrefix('someorg/some-model')).toBe('');
  });
});
